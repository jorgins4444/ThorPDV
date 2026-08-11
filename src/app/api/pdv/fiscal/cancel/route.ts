import { NextResponse } from 'next/server';
import { cancelNfceDocument } from '@/lib/fiscal/thorfiscal';

export const runtime = 'nodejs';

function bearer(request: Request) {
  const value = request.headers.get('authorization') ?? '';
  return value.toLowerCase().startsWith('bearer ') ? value.slice(7).trim() : '';
}

export async function POST(request: Request) {
  const token = bearer(request);
  if (!token) return NextResponse.json({ ok: false, error: 'device_token_required' }, { status: 401 });

  const body = await request.json().catch(() => null) as null | {
    fiscal_document_id?: string;
    reason?: string;
    operator_user_id?: string;
    supervisor_user_id?: string | null;
  };
  const documentId = String(body?.fiscal_document_id ?? '').trim();
  const reason = String(body?.reason ?? '').trim().replace(/\s+/g, ' ');
  if (!documentId) return NextResponse.json({ ok: false, error: 'fiscal_document_id_required' }, { status: 400 });
  if (reason.length < 15 || reason.length > 255) {
    return NextResponse.json({ ok: false, error: 'nfce_cancellation_reason_invalid', min: 15, max: 255 }, { status: 400 });
  }

  const result = await cancelNfceDocument(documentId, {
    deviceToken: token,
    reason,
    operatorUserId: String(body?.operator_user_id ?? '').trim(),
    supervisorUserId: String(body?.supervisor_user_id ?? '').trim() || null,
  });

  return NextResponse.json(result, { status: result.ok ? 200 : result.error === 'nfce_cancellation_transmission_error' ? 503 : 422 });
}
