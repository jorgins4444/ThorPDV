'use server';

import { cookies } from 'next/headers';
import { createClient } from '@/lib/supabase/server';

const CONTROL_COOKIE = 'thor_control_session';

export async function crmDashboard() {
  const token = (await cookies()).get(CONTROL_COOKIE)?.value;
  if (!token) return { ok: false, error: 'unauthorized' };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('control_crm_leads', { p_token: token });
  if (error) return { ok: false, error: error.message };
  return data as Record<string, unknown>;
}

export async function updateCrmLead(id: string, status: string, notes: string) {
  const token = (await cookies()).get(CONTROL_COOKIE)?.value;
  if (!token) return { ok: false, error: 'unauthorized' };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('control_crm_update_lead', { p_token: token, p_id: id, p_status: status, p_notes: notes });
  if (error) return { ok: false, error: error.message };
  return data as { ok?: boolean; error?: string };
}
