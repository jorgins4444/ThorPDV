import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { pdvLicenseGuard } from '@/lib/pdv-license-guard';

export const runtime = 'nodejs';

type Body = { event_id?: string; kind?: string; payload?: Record<string, unknown> };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const kinds = new Set(['customer_save', 'product_create', 'product_price', 'stock_adjust']);

export async function POST(request: Request) {
  const header = request.headers.get('authorization') || '';
  const token = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';
  if (!token) return NextResponse.json({ ok: false, error: 'device_token_required' }, { status: 401 });
  const license = await pdvLicenseGuard(token);
  if (!license.ok) return NextResponse.json(license.result, { status: license.status });

  const body = await request.json().catch(() => null) as Body | null;
  if (!body || !UUID.test(String(body.event_id || '')) || !kinds.has(String(body.kind || '')) ||
      !body.payload || typeof body.payload !== 'object' || Array.isArray(body.payload)) {
    return NextResponse.json({ ok: false, error: 'invalid_catalog_mutation' }, { status: 400 });
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('pdv_catalog_apply_v1', {
    p_device_token: token,
    p_event_id: body.event_id,
    p_kind: body.kind,
    p_payload: body.payload,
  });
  if (error) {
    console.error('pdv_catalog_mutation_transport_failure', { code: error.code, message: error.message });
    return NextResponse.json({ ok: false, error: 'catalog_service_unavailable' }, { status: 503 });
  }
  const result = (data || { ok: false, error: 'empty_response' }) as { ok?: boolean; error?: string };
  return NextResponse.json(result, { status: result.ok ? 200 : 422 });
}
