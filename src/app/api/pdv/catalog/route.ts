import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { pdvLicenseGuard } from '@/lib/pdv-license-guard';

export const runtime = 'nodejs';

function bearer(request: Request) {
  const value = request.headers.get('authorization') ?? '';
  return value.toLowerCase().startsWith('bearer ') ? value.slice(7).trim() : '';
}

export async function POST(request: Request) {
  const token = bearer(request);
  if (!token) return NextResponse.json({ ok: false, error: 'device_token_required' }, { status: 401 });

  const license = await pdvLicenseGuard(token);
  if (!license.ok) return NextResponse.json(license.result, { status: license.status });

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('pdv_pull_v10', {
    p_device_token: token,
    p_since: null,
  });

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  const result = data as Record<string, unknown> | null;
  if (!result || result.ok !== true) {
    return NextResponse.json(result ?? { ok: false, error: 'empty_response' }, { status: 401 });
  }

  const products = Array.isArray(result.products) ? result.products as Array<Record<string, unknown>> : [];
  const inventory = Array.isArray(result.inventory) ? result.inventory as Array<Record<string, unknown>> : [];
  const priceItems = Array.isArray(result.price_items) ? result.price_items as Array<Record<string, unknown>> : [];
  const context = (result.context && typeof result.context === 'object' ? result.context : {}) as Record<string, unknown>;

  const stockByProduct = new Map(inventory.map(row => [String(row.product_id ?? ''), Number(row.quantity ?? 0)]));
  const priceByProduct = new Map(priceItems.map(row => [String(row.product_id ?? ''), Number(row.price ?? 0)]));
  const priceTableLabel = context.price_table_id ? 'Tabela de preço vigente' : 'Preço padrão do produto';

  const catalog = products
    .filter(product => product.active !== false)
    .map(product => {
      const id = String(product.id ?? '');
      return {
        id,
        name: String(product.name ?? ''),
        product_code: String(product.product_code ?? ''),
        sku: String(product.sku ?? ''),
        ncm: String(product.ncm ?? ''),
        barcodes: Array.isArray(product.barcodes) ? product.barcodes.map(String) : [],
        price: priceByProduct.has(id) ? Number(priceByProduct.get(id)) : Number(product.sale_price ?? 0),
        stock: Number(stockByProduct.get(id) ?? 0),
        price_table: priceTableLabel,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));

  return NextResponse.json({ ok: true, products: catalog, source: 'server' });
}
