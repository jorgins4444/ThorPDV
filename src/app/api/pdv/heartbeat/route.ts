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

  const license=await pdvLicenseGuard(token);
  if(!license.ok)return NextResponse.json(license.result,{status:license.status});

  const body = await request.json().catch(() => ({})) as {
    appVersion?: string;
    capabilities?: Record<string, unknown>;
    metrics?: Record<string, unknown>;
  };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('pdv_heartbeat', {
    p_device_token: token,
    p_app_version: body.appVersion ?? null,
    p_capabilities: body.capabilities ?? null,
    p_metrics: body.metrics ?? {},
  });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  const result = data as { ok?: boolean; error?: string } | null;
  return NextResponse.json(result ?? { ok: false, error: 'empty_response' }, { status: result?.ok ? 200 : 401 });
}
