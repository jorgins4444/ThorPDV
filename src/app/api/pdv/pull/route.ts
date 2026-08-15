import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

function bearer(request: Request) {
  const value = request.headers.get('authorization') ?? '';
  return value.toLowerCase().startsWith('bearer ') ? value.slice(7).trim() : '';
}

export async function POST(request: Request) {
  const token = bearer(request);
  if (!token) return NextResponse.json({ ok: false, error: 'device_token_required' }, { status: 401 });
  const body = await request.json().catch(() => ({})) as { since?: string | null };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('pdv_pull_v9', { p_device_token: token, p_since: body.since || null });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  const result = data as { ok?: boolean } | null;
  return NextResponse.json(result ?? { ok: false, error: 'empty_response' }, { status: result?.ok ? 200 : 401 });
}
