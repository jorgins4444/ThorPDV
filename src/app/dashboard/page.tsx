import './dashboard-studio-v2.css';
import './dashboard-midnight-polish.css';
import './[...slug]/module.css';
import './[...slug]/management-shell.css';
import './dashboard-fullscreen-fix.css';
import { DashboardStudioV2 } from './dashboard-studio-v2';
import { AdvancedShell } from './[...slug]/advanced-shell';
import { dashboardLoad } from './actions';

export default async function DashboardPage() {
  // O proxy já valida sessão, troca obrigatória de senha e acesso ao /dashboard.
  // Repetir getUser + temp_session_status aqui adicionava dois round-trips antes do BI.
  const live = await dashboardLoad();
  return <AdvancedShell title="Dashboard Executivo" subtitle="Thor BI em tempo real: vendas, rentabilidade, caixa, PDV, financeiro, estoque, fiscal e operação." activePath="/dashboard">
    <DashboardStudioV2 initial={(live ?? {}) as Record<string, unknown>} />
  </AdvancedShell>;
}
