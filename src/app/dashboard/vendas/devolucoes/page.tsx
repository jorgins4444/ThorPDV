import '../../[...slug]/module.css';
import '../../[...slug]/advanced.css';
import './sales-returns.css';
import { AdvancedShell } from '../../[...slug]/advanced-shell';
import { SalesReturnWorkspace } from './sales-return-workspace';

export default function SalesReturnsPage(){
  return <AdvancedShell
    title="Devoluções"
    subtitle="Acompanhe devoluções do ThorPDV, créditos lançados em clientes, Vales Crédito emitidos e seus saldos."
    activePath="/dashboard/vendas/devolucoes"
    backHref="/dashboard/vendas"
    backLabel="Vendas"
  >
    <SalesReturnWorkspace/>
  </AdvancedShell>;
}
