import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

function digits(value: string) {
  return String(value || '').replace(/\D/g, '');
}

export async function GET(request: NextRequest) {
  const cnpj = digits(request.nextUrl.searchParams.get('cnpj') || '');
  if (cnpj.length !== 14) return NextResponse.json({ ok: false, error: 'invalid_cnpj' }, { status: 400 });

  try {
    const response = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`, { cache: 'no-store' });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return NextResponse.json({ ok: false, error: data?.message || 'cnpj_not_found' }, { status: response.status === 404 ? 404 : 502 });

    const cep = digits(data.cep || '');
    let cepData: Record<string, string> = {};
    if (cep.length === 8) {
      try {
        const cepResponse = await fetch(`https://viacep.com.br/ws/${cep}/json/`, { cache: 'no-store' });
        const result = await cepResponse.json().catch(() => ({}));
        if (cepResponse.ok && !result?.erro) {
          cepData = {
            street: result.logradouro || '',
            complement: result.complemento || '',
            district: result.bairro || '',
            city: result.localidade || '',
            state: result.uf || '',
            ibge_city_code: result.ibge || '',
          };
        }
      } catch {}
    }

    // BrasilAPI fornece dados da Receita. IE so e sugerida se vier
    // explicitamente no provedor; isso nao equivale a consulta SEFAZ.
    const registrations = Array.isArray(data.inscricoes_estaduais) ? data.inscricoes_estaduais : [];
    const state = String(data.uf || '').toUpperCase();
    const matchedIE = registrations.find((entry: Record<string, unknown>) =>
      String(entry.estado_sigla || entry.uf || '').toUpperCase() === state &&
      (entry.ativo === 1 || entry.ativo === true || entry.ativo === '1')
    ) || registrations.find((entry: Record<string, unknown>) =>
      String(entry.estado_sigla || entry.uf || '').toUpperCase() === state
    );
    const suggestedIE = String(matchedIE?.inscricao_estadual || matchedIE?.numero || '').replace(/[^0-9A-Za-z]/g, '');
    const statusCode = String(data.situacao_cadastral ?? '');
    const statusLabel = String(data.descricao_situacao_cadastral ||
      ({'1':'NULA','2':'ATIVA','3':'SUSPENSA','4':'INAPTA','8':'BAIXADA'} as Record<string,string>)[statusCode] || ''
    ).trim().toUpperCase();
    const lookupAt = new Date().toISOString();

    return NextResponse.json({
      ok: true,
      data: {
        document: cnpj,
        name: data.razao_social || '',
        trade_name: data.nome_fantasia || '',
        email: data.email || '',
        phone: data.ddd_telefone_1 || data.ddd_telefone_2 || '',
        state_registration: suggestedIE,
        state_registration_source: suggestedIE ? 'BrasilAPI (nao validada na SEFAZ)' : '',
        registration_needs_sefaz_check: true,
        registration_state: state,
        registration_status: statusLabel,
        registration_status_date: String(data.data_situacao_cadastral || ''),
        registration_opening_date: String(data.data_inicio_atividade || ''),
        registration_source: 'BrasilAPI / dados CNPJ da Receita Federal',
        consulted_at: lookupAt,
        postal_code: cep,
        street: cepData.street || data.logradouro || '',
        number: data.numero || '',
        complement: cepData.complement || data.complemento || '',
        district: cepData.district || data.bairro || '',
        city: cepData.city || data.municipio || '',
        state: cepData.state || data.uf || '',
        ibge_city_code: cepData.ibge_city_code || String(data.codigo_municipio_ibge || data.codigo_municipio || ''),
      },
    });
  } catch {
    return NextResponse.json({ ok: false, error: 'cnpj_lookup_unavailable' }, { status: 503 });
  }
}
