import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from '@/lib/supabase/config';

type FiscalAuthorizationContext =
  | { sessionToken: string; deviceToken?: never }
  | { deviceToken: string; sessionToken?: never };

type FiscalCancellationContext =
  | {
      sessionToken: string;
      deviceToken?: never;
      reason: string;
      operatorUserId?: never;
      supervisorUserId?: never;
    }
  | {
      deviceToken: string;
      sessionToken?: never;
      reason: string;
      operatorUserId: string;
      supervisorUserId?: string | null;
    };

export type ThorFiscalAuthorizationResult = {
  ok?: boolean;
  authorized?: boolean;
  already_authorized?: boolean;
  status?: string;
  document_id?: string;
  access_key?: string | null;
  protocol?: string | null;
  authorization_at?: string | null;
  cStat?: string;
  message?: string;
  error?: string;
  detail?: string;
  validation_errors?: string[];
  retryable?: boolean;
  [key: string]: unknown;
};

export type ThorFiscalCancellationResult = {
  ok?: boolean;
  cancelled?: boolean;
  idempotent?: boolean;
  status?: string;
  document_id?: string;
  cStat?: string;
  message?: string;
  error?: string;
  detail?: string;
  cancellation_protocol?: string | null;
  cancellation_at?: string | null;
  cancel_deadline?: string | null;
  retryable?: boolean;
  [key: string]: unknown;
};

export async function authorizeNfceDocument(
  documentId: string,
  context: FiscalAuthorizationContext,
): Promise<ThorFiscalAuthorizationResult> {
  const payload = context.deviceToken
    ? { document_id: documentId, device_token: context.deviceToken }
    : { document_id: documentId, session_token: context.sessionToken };

  try {
    const response = await fetch(`${SUPABASE_URL}/functions/v1/thorfiscal-authorize`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        apikey: SUPABASE_PUBLISHABLE_KEY,
        authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
      },
      body: JSON.stringify(payload),
      cache: 'no-store',
    });

    const data = (await response.json().catch(() => null)) as ThorFiscalAuthorizationResult | null;
    if (!data) return { ok: false, error: 'thorfiscal_empty_response', status: String(response.status) };
    return data;
  } catch (error) {
    return {
      ok: false,
      error: 'thorfiscal_unreachable',
      detail: error instanceof Error ? error.message : String(error),
      retryable: true,
    };
  }
}

export async function cancelNfceDocument(
  documentId: string,
  context: FiscalCancellationContext,
): Promise<ThorFiscalCancellationResult> {
  const payload = context.deviceToken
    ? {
        document_id: documentId,
        device_token: context.deviceToken,
        reason: context.reason,
        operator_user_id: context.operatorUserId,
        supervisor_user_id: context.supervisorUserId ?? null,
      }
    : {
        document_id: documentId,
        session_token: context.sessionToken,
        reason: context.reason,
      };

  try {
    const response = await fetch(`${SUPABASE_URL}/functions/v1/thorfiscal-cancel`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        apikey: SUPABASE_PUBLISHABLE_KEY,
        authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
      },
      body: JSON.stringify(payload),
      cache: 'no-store',
    });

    const data = (await response.json().catch(() => null)) as ThorFiscalCancellationResult | null;
    if (!data) return { ok: false, error: 'thorfiscal_cancel_empty_response', status: String(response.status) };
    return data;
  } catch (error) {
    return {
      ok: false,
      error: 'thorfiscal_cancel_unreachable',
      detail: error instanceof Error ? error.message : String(error),
      retryable: true,
    };
  }
}
