import { NextResponse } from 'next/server';

export async function GET(_request: Request, context: { params: Promise<{ cep: string }> }) {
  const { cep } = await context.params;
  const normalized = String(cep || '').replace(/\D/g, '');

  if (normalized.length !== 8) {
    return NextResponse.json({ ok: false, error: 'CEP inválido. Informe 8 dígitos.' }, { status: 400 });
  }

  try {
    const response = await fetch(`https://viacep.com.br/ws/${normalized}/json/`, {
      headers: { Accept: 'application/json' },
      next: { revalidate: 86400 },
    });

    if (!response.ok) {
      return NextResponse.json({ ok: false, error: 'Serviço de CEP indisponível.' }, { status: 502 });
    }

    const data = await response.json() as Record<string, unknown>;
    if (data.erro === true) {
      return NextResponse.json({ ok: false, error: 'CEP não localizado.' }, { status: 404 });
    }

    return NextResponse.json({
      ok: true,
      postal_code: normalized,
      street: String(data.logradouro || ''),
      district: String(data.bairro || ''),
      city: String(data.localidade || ''),
      state: String(data.uf || '').toUpperCase(),
      ibge_city_code: String(data.ibge || '').replace(/\D/g, '').slice(0, 7),
    });
  } catch {
    return NextResponse.json({ ok: false, error: 'Não foi possível consultar o CEP agora. Preencha o endereço manualmente.' }, { status: 502 });
  }
}
