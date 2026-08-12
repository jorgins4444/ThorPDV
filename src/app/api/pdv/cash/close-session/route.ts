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
  const body = await request.json().catch(() => null) as null | {
    cashOpenEventId?: string;
    closingAmount?: number;
    notes?: string;
    operatorUserId?: string;
    reconciliation?: Record<string, unknown>;
  };
  if (!body?.cashOpenEventId || !body.operatorUserId) {
    return NextResponse.json({ ok: false, error: 'cash_session_and_operator_required' }, { status: 400 });
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('pdv_cash_close_session', {
    p_device_token: token,
    p_cash_open_event_id: body.cashOpenEventId,
    p_closing_amount: Number(body.closingAmount || 0),
    p_notes: String(body.notes || ''),
    p_operator_user_id: body.operatorUserId,
    p_reconciliation: body.reconciliation || {},
  });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  const result = data as { ok?: boolean } | null;
  return NextResponse.json(result ?? { ok: false, error: 'empty_response' }, { status: result?.ok ? 200 : 400 });
}
