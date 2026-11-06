import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

type JsonRecord = Record<string, unknown>;
const digits = (value: unknown) => String(value ?? '').replace(/\D/g, '');
const str = (value: unknown) => String(value ?? '').trim();
const record = (value: unknown): JsonRecord => value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {};
const array = (value: unknown): JsonRecord[] => Array.isArray(value) ? value.map(record) : [];

function validCnpj(cnpj: string) {
  if (cnpj.length !== 14 || /^(\d)\1+$/.test(cnpj)) return false;
  const digit = (base: string, weights: number[]) => {
    const sum = [...base].reduce((n, c, i) => n + Number(c) * weights[i], 0);
    const rem = sum % 11;
    return rem < 2 ? 0 : 11 - rem;
  };
  return digit(cnpj.slice(0, 12), [5,4,3,2,9,8,7,6,5,4,3,2]) === Number(cnpj[12])
    && digit(cnpj.slice(0, 13), [6,5,4,3,2,9,8,7,6,5,4,3,2]) === Number(cnpj[13]);
}

async function queryProvider(url: string) {
  const response = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(9000),
    next: { revalidate: 3600 },
  });
  const json = record(await response.json().catch(() => ({})));
  if (!response.ok) {
    return { ok: false as const, status: response.status, error: str(json.message || json.detalhes || json.error || '') };
  }
  return { ok: true as const, data: json };
}

function fromBrasilApi(data: JsonRecord) {
  const statusCode = str(data.situacao_cadastral);
  const status = str(data.descricao_situacao_cadastral || ({
    '1': 'NULA', '2': 'ATIVA', '3': 'SUSPENSA', '4': 'INAPTA', '8': 'BAIXADA',
  } as Record<string, string>)[statusCode]);
  const uf = str(data.uf).toUpperCase();
  const ies = array(data.inscricoes_estaduais);
  const ie = ies.find(i => str(i.estado_sigla || i.uf).toUpperCase() === uf && (i.ativo === true || i.ativo === 1))
    || ies.find(i => str(i.estado_sigla || i.uf).toUpperCase() === uf);
  return {
    name: str(data.razao_social), trade_name: str(data.nome_fantasia),
    email: str(data.email), phone: str(data.ddd_telefone_1 || data.ddd_telefone_2),
    postal_code: digits(data.cep), street: str(data.logradouro), number: str(data.numero),
    complement: str(data.complemento), district: str(data.bairro),
    city: str(data.municipio), state: uf,
    ibge_city_code: str(data.codigo_municipio_ibge || data.codigo_municipio),
    state_registration: str(ie?.inscricao_estadual || ie?.numero),
    registration_status: status.toUpperCase(),
    registration_status_date: str(data.data_situacao_cadastral),
    registration_opening_date: str(data.data_inicio_atividade),
    registration_source: 'BrasilAPI / dados CNPJ', registration_state: uf,
  };
}

function fromCnpjWs(data: JsonRecord) {
  const e = record(data.estabelecimento);
  const uf = str(record(e.estado).sigla).toUpperCase();
  const city = record(e.cidade);
  const ies = array(e.inscricoes_estaduais);
  const ie = ies.find(i => str(record(i.estado).sigla).toUpperCase() === uf && i.ativo === true)
    || ies.find(i => str(record(i.estado).sigla).toUpperCase() === uf);
  return {
    name: str(data.razao_social), trade_name: str(e.nome_fantasia),
    email: str(e.email), phone: [e.ddd1, e.telefone1].map(str).filter(Boolean).join(''),
    postal_code: digits(e.cep), street: [e.tipo_logradouro, e.logradouro].map(str).filter(Boolean).join(' '),
    number: str(e.numero), complement: str(e.complemento), district: str(e.bairro),
    city: str(city.nome), state: uf, ibge_city_code: str(city.ibge_id),
    state_registration: str(ie?.inscricao_estadual),
    registration_status: str(e.situacao_cadastral).toUpperCase(),
    registration_status_date: str(e.data_situacao_cadastral),
    registration_opening_date: str(e.data_inicio_atividade),
    registration_source: 'CNPJ.ws / fontes publicas agregadas', registration_state: uf,
  };
}

export async function GET(request: NextRequest) {
  const cnpj = digits(request.nextUrl.searchParams.get('cnpj'));
  if (!validCnpj(cnpj)) return NextResponse.json({ ok: false, error: 'invalid_cnpj', message: 'CNPJ invalido.' }, { status: 400 });
  const attempts: { provider: string; status: number; error: string }[] = [];
  const providers = [
    { name: 'BrasilAPI', url: `https://brasilapi.com.br/api/cnpj/v1/${cnpj}`, parse: fromBrasilApi },
    { name: 'CNPJ.ws', url: `https://publica.cnpj.ws/cnpj/${cnpj}`, parse: fromCnpjWs },
  ];
  for (const provider of providers) {
    try {
      const result = await queryProvider(provider.url);
      if (!result.ok) {
        attempts.push({ provider: provider.name, status: result.status, error: result.error });
        if (result.status === 404) continue;
        continue;
      }
      const fields = provider.parse(result.data);
      if (!fields.name) { attempts.push({ provider: provider.name, status: 502, error: 'empty_company_name' }); continue; }
      return NextResponse.json({
        ok: true,
        data: {
          document: cnpj, ...fields,
          state_registration_source: fields.state_registration
            ? provider.name + ' (dado informativo, nao validado na SEFAZ em tempo real)' : '',
          registration_needs_sefaz_check: true,
          consulted_at: new Date().toISOString(),
        },
      });
    } catch (error) {
      attempts.push({ provider: provider.name, status: 503, error: error instanceof Error ? error.name : 'provider_unavailable' });
    }
  }
  const limited = attempts.some(a => a.status === 429);
  const missing = attempts.every(a => a.status === 404);
  const message = limited
    ? 'Limite temporario de consultas gratuitas. Aguarde pelo menos um minuto e tente novamente.'
    : missing ? 'CNPJ nao localizado nas bases publicas consultadas.'
    : 'Os servicos publicos de CNPJ nao responderam. Tente novamente mais tarde.';
  // Nao devolver informacoes internas dos provedores ou dados sensiveis ao navegador.
  console.warn('cnpj_lookup_unavailable', attempts.map(a => ({ provider: a.provider, status: a.status, cause: a.error.slice(0, 80) })));
  return NextResponse.json({ ok: false, error: limited ? 'cnpj_rate_limited' : missing ? 'cnpj_not_found' : 'cnpj_lookup_unavailable', message }, { status: limited ? 429 : missing ? 404 : 503 });
}
