import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

function digits(value: string) {
  return String(value || '').replace(/\D/g, '');
}

export async function GET(request: NextRequest) {
  const cep = digits(request.nextUrl.searchParams.get('cep') || '');
  if (cep.length !== 8) return NextResponse.json({ ok: false, error: 'invalid_cep' }, { status: 400 });

  try {
    const response = await fetch(`https://viacep.com.br/ws/${cep}/json/`, { cache: 'no-store' });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data?.erro) return NextResponse.json({ ok: false, error: 'cep_not_found' }, { status: 404 });
    return NextResponse.json({
      ok: true,
      data: {
        postal_code: digits(data.cep || cep),
        street: data.logradouro || '',
        complement: data.complemento || '',
        district: data.bairro || '',
        city: data.localidade || '',
        state: data.uf || '',
        ibge_city_code: data.ibge || '',
      },
    });
  } catch {
    return NextResponse.json({ ok: false, error: 'cep_lookup_unavailable' }, { status: 503 });
  }
}
