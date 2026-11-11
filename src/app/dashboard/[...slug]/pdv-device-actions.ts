'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

const SESSION_COOKIE = 'thorpdv_test_session';

async function token() {
  const store = await cookies();
  const value = store.get(SESSION_COOKIE)?.value;
  if (!value) redirect('/login');
  return value;
}

export async function pdvDeviceList() {
  const pToken = await token();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('erp_pdv_devices', { p_token: pToken });
  if (error) return { ok: false, error: error.message, data: [] as Record<string, unknown>[] };
  const result = data as { ok?: boolean; error?: string; data?: Record<string, unknown>[] } | null;
  return { ok: Boolean(result?.ok), error: result?.error, data: Array.isArray(result?.data) ? result.data : [] };
}

export async function pdvGenerateEnrollment(posRegisterId: string, label?: string) {
  const pToken = await token();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('erp_pdv_generate_enrollment', {
    p_token: pToken,
    p_pos_register_id: posRegisterId,
    p_label: label || null,
  });
  if (error) return { ok: false, error: error.message };
  return (data ?? { ok: false, error: 'empty_response' }) as Record<string, unknown>;
}

export async function pdvReconnectDevice(deviceId: string) {
  const pToken = await token();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('erp_pdv_device_reconnect', {
    p_token: pToken,
    p_device_id: deviceId,
  });
  if (error) return { ok: false, error: error.message };
  return (data ?? { ok: false, error: 'empty_response' }) as Record<string, unknown>;
}

export async function pdvSetDeviceStatus(deviceId: string, status: 'offline' | 'blocked') {
  const pToken = await token();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('erp_pdv_device_set_status', {
    p_token: pToken,
    p_device_id: deviceId,
    p_status: status,
  });
  if (error) return { ok: false, error: error.message };
  return (data ?? { ok: false }) as Record<string, unknown>;
}

export async function pdvRemoveDevice(deviceId: string) {
  const pToken = await token();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('erp_pdv_device_remove', { p_token: pToken, p_device_id: deviceId });
  if (error) return { ok: false, error: error.message };
  return (data ?? { ok: false }) as { ok: boolean; error?: string };
}
