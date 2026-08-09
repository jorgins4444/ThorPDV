import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { authorizeNfceDocument } from '@/lib/fiscal/thorfiscal';

export const runtime = 'nodejs';

function bearer(request: Request) {
  const value = request.headers.get('authorization') ?? '';
  return value.toLowerCase().startsWith('bearer ') ? value.slice(7).trim() : '';
}

type PushEventResult = {
  id?: string;
  type?: string;
  status?: string;
  error?: string;
  result?: Record<string, unknown>;
  [key: string]: unknown;
};

type PushResult = {
  ok?: boolean;
  results?: PushEventResult[];
  [key: string]: unknown;
};

export async function POST(request: Request) {
  const token = bearer(request);
  if (!token) return NextResponse.json({ ok: false, error: 'device_token_required' }, { status: 401 });
  const body = await request.json().catch(() => null) as null | { events?: unknown[] };
  if (!Array.isArray(body?.events)) return NextResponse.json({ ok: false, error: 'events_required' }, { status: 400 });

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('pdv_sync_push', { p_device_token: token, p_events: body.events });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  const result = (data ?? { ok: false, error: 'empty_response' }) as PushResult;
  if (result.ok && Array.isArray(result.results)) {
    for (const event of result.results) {
      if (event.type !== 'fiscal_nfce_request' || event.status !== 'processed') continue;
      const documentId = String(event.result?.fiscal_document_id ?? event.result?.document_id ?? '').trim();
      if (!documentId) continue;

      const authorization = await authorizeNfceDocument(documentId, { deviceToken: token });
      event.result = {
        ...(event.result ?? {}),
        document_id: documentId,
        authorization,
      };
    }
  }

  return NextResponse.json(result, { status: result.ok ? 200 : 401 });
}
