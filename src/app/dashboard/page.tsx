import './dashboard-studio-v2.css';
import './[...slug]/module.css';
import './[...slug]/management-shell.css';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { DashboardStudioV2 } from './dashboard-studio-v2';
import { AdvancedShell } from './[...slug]/advanced-shell';
import { dashboardLoad } from './actions';

const SESSION_COOKIE = 'thorpdv_test_session';

export default async function DashboardPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    const cookieStore = await cookies();
    const token = cookieStore.get(SESSION_COOKIE)?.value;
    if (!token) redirect('/login');

    const { data, error } = await supabase.rpc('temp_session_status', { p_token: token });
    const status = data as { ok?: boolean; must_change_password?: boolean } | null;
    if (error || !status?.ok) redirect('/login');
    if (status.must_change_password) redirect('/change-password');
  }

  const live = await dashboardLoad();
  return <AdvancedShell title="Dashboard Executivo" subtitle="Thor BI em tempo real: vendas, rentabilidade, caixa, PDV, financeiro, estoque, fiscal e operação." activePath="/dashboard">
    <DashboardStudioV2 initial={(live ?? {}) as Record<string, unknown>} />
  </AdvancedShell>;
}
