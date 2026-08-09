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

    return NextResponse.json({
      ok: true,
      data: {
        document: cnpj,
        name: data.razao_social || '',
        trade_name: data.nome_fantasia || '',
        email: data.email || '',
        phone: data.ddd_telefone_1 || data.ddd_telefone_2 || '',
        state_registration: '',
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
