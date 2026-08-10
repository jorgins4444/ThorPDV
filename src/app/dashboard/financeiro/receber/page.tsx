import '../../[...slug]/module.css';
import '../../[...slug]/advanced.css';
import '../../[...slug]/receivables.css';
import { AdvancedShell } from '../../[...slug]/advanced-shell';
import { erpLoad } from '../../[...slug]/actions';
import { erpReceivablesList } from '../../[...slug]/receivables-actions';
import { ReceivablesWorkspace } from '../../[...slug]/receivables-workspace';

export default async function ReceivablesPage(){
  const [receivables,customers]=await Promise.all([erpReceivablesList({}),erpLoad('customers')]);
  return <AdvancedShell title="Contas a Receber" subtitle="Títulos de vendas a prazo e lançamentos financeiros, com filtros completos por emissão, documento, cliente, vencimento e quitação." activePath="/dashboard/financeiro/receber">
    <ReceivablesWorkspace initial={receivables.data} customers={customers.data}/>
  </AdvancedShell>;
}
