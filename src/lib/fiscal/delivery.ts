import { cookies } from 'next/headers';
import { createClient } from '@/lib/supabase/server';

const SESSION_COOKIE = 'thorpdv_test_session';

type Row = Record<string, unknown>;

export type FiscalDelivery = {
  ok?: boolean;
  error?: string;
  document?: Row;
  issuer?: Row;
  branch?: Row;
  sale?: Row;
  items?: Row[];
  payments?: Row[];
  xml?: string;
};

function bearer(request: Request) {
  const value = request.headers.get('authorization') ?? '';
  return value.toLowerCase().startsWith('bearer ') ? value.slice(7).trim() : '';
}

export async function loadFiscalDelivery(request: Request, documentId: string): Promise<FiscalDelivery> {
  const deviceToken = bearer(request);
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(SESSION_COOKIE)?.value ?? '';
  const accessToken = deviceToken || sessionToken;
  const accessKind = deviceToken ? 'device' : 'session';

  if (!accessToken) return { ok: false, error: 'fiscal_asset_auth_required' };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('fiscal_document_delivery', {
    p_access_token: accessToken,
    p_access_kind: accessKind,
    p_document: documentId,
  });

  if (error) return { ok: false, error: error.message };
  return (data ?? { ok: false, error: 'fiscal_asset_empty_response' }) as FiscalDelivery;
}
