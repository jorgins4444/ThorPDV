'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { authorizeNfceDocument, cancelNfceDocument } from '@/lib/fiscal/thorfiscal';

const SESSION_COOKIE = 'thorpdv_test_session';

async function getSessionToken() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) redirect('/login');
  return token;
}

export async function erpFiscalSend(documentId: string) {
  const token = await getSessionToken();
  return authorizeNfceDocument(documentId, { sessionToken: token });
}

export async function erpFiscalDocuments() {
  const token = await getSessionToken();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('erp_fiscal_documents_v2', { p_token: token });
  if (error) return { ok: false, error: error.message, data: [] as Record<string, unknown>[] };
  const result = (data ?? {}) as { ok?: boolean; error?: string; data?: Record<string, unknown>[]; server_time?: string };
  return {
    ok: Boolean(result.ok),
    error: result.error,
    data: Array.isArray(result.data) ? result.data : [],
    server_time: result.server_time,
  };
}

export async function erpFiscalCancel(documentId: string, reason: string) {
  const token = await getSessionToken();
  const cleanReason = reason.trim().replace(/\s+/g, ' ');
  if (cleanReason.length < 15 || cleanReason.length > 255) {
    return { ok: false, error: 'nfce_cancellation_reason_invalid', min: 15, max: 255 };
  }
  return cancelNfceDocument(documentId, { sessionToken: token, reason: cleanReason });
}

export async function erpFiscalXml(documentId: string) {
  const token = await getSessionToken();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('erp_sales_cash_fiscal_xml', {
    p_token: token,
    p_document: documentId,
  });
  if (error) return { ok: false, error: error.message };
  return (data ?? { ok: false, error: 'xml_empty_response' }) as Record<string, unknown>;
}
