import '../../[...slug]/module.css';
import '../../[...slug]/advanced.css';
import './sales-returns.css';
import { AdvancedShell } from '../../[...slug]/advanced-shell';
import { SalesReturnWorkspace } from './sales-return-workspace';

// Rebuild trigger: ThorGestao returns module rollout.
export default function SalesReturnsPage(){
  return <AdvancedShell
    title="Devoluções"
    subtitle="Acompanhe devoluções sincronizadas do ThorPDV, créditos lançados em clientes, Vales Crédito emitidos, utilização e saldo disponível."
    activePath="/dashboard/vendas/devolucoes"
    backHref="/dashboard/vendas"
    backLabel="Vendas"
  >
    <SalesReturnWorkspace/>
  </AdvancedShell>;
}
