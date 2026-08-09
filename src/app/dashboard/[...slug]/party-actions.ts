'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

const SESSION_COOKIE = 'thorpdv_test_session';
type PartyResource = 'customers' | 'suppliers';
type RpcResult = { ok?: boolean; error?: string; data?: Record<string, unknown>[]; id?: string };

async function getSessionToken() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) redirect('/login');
  return token;
}

async function rpc(name: string, args: Record<string, unknown>) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(name, args);
  if (error) return { ok: false, error: error.message } as RpcResult;
  return (data ?? { ok: false }) as RpcResult;
}

export async function partyList(resource: PartyResource, search?: string) {
  const token = await getSessionToken();
  const result = await rpc('erp_party_list', { p_token: token, p_resource: resource, p_search: search?.trim() || null });
  return { ok: Boolean(result.ok), error: result.error, data: Array.isArray(result.data) ? result.data : [] };
}

export async function partySave(resource: PartyResource, payload: Record<string, unknown>) {
  const token = await getSessionToken();
  return rpc('erp_party_save', { p_token: token, p_resource: resource, p_payload: payload });
}
