import './dashboard-live.css';
import './dashboard-studio.css';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { DashboardStudio } from './dashboard-studio';
import { dashboardLoad } from './actions';

const SESSION_COOKIE = 'thorpdv_test_session';

export default async function DashboardPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  let displayIdentity = user?.email ?? 'Administrador';

  if (!user) {
    const cookieStore = await cookies();
    const token = cookieStore.get(SESSION_COOKIE)?.value;

    if (!token) redirect('/login');

    const { data, error } = await supabase.rpc('temp_session_status', { p_token: token });
    const status = data as { ok?: boolean; must_change_password?: boolean } | null;

    if (error || !status?.ok) redirect('/login');
    if (status.must_change_password) redirect('/change-password');

    displayIdentity = 'Administrador';
  }

  const live = await dashboardLoad();
  return <DashboardStudio identity={displayIdentity} initial={(live ?? {}) as Record<string, unknown>} />;
}
