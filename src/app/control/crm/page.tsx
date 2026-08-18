import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { crmDashboard } from './actions';
import { CrmClient } from './crm-client';
import './crm.css';

const CONTROL_COOKIE = 'thor_control_session';

export default async function CrmPage() {
  const token = (await cookies()).get(CONTROL_COOKIE)?.value;
  if (!token) redirect('/control/login');
  const supabase = await createClient();
  const { data } = await supabase.rpc('platform_session_status', { p_token: token });
  if (!(data as { ok?: boolean } | null)?.ok) redirect('/control/login');
  const result = await crmDashboard();
  if (!result.ok) redirect('/control/login');
  return <CrmClient initial={result} />;
}
