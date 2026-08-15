import '../../[...slug]/module.css';
import '../../[...slug]/advanced.css';
import '../../[...slug]/receivables.css';
import '../../[...slug]/receivables-bolecode.css';
import '../../[...slug]/receivables-actions-menu.css';
import { AdvancedShell } from '../../[...slug]/advanced-shell';
import { partyList } from '../../[...slug]/party-actions';
import { financialAccountsData } from '../../[...slug]/financial-accounts-actions';
import { erpReceivablesList } from '../../[...slug]/receivables-actions';
import { ReceivablesWorkspace } from '../../[...slug]/receivables-workspace';

export default async function ReceivablesPage(){
  const [receivables,customers,finance]=await Promise.all([erpReceivablesList({}),partyList('customers'),financialAccountsData()]);
  const rows=Array.isArray(receivables.data)?receivables.data:[];
  const customerRows=Array.isArray(customers.data)?customers.data:[];
  return <AdvancedShell title="Contas a Receber" subtitle="Acompanhe títulos a prazo, recebimentos e boletos. A cobrança bancária utiliza Remessa / Retorno CNAB." activePath="/dashboard/financeiro/receber">
    <ReceivablesWorkspace initial={rows} customers={customerRows} accounts={(finance.accounts as Record<string,unknown>[])??[]} paymentMethods={(finance.payment_methods as Record<string,unknown>[])??[]} integrations={[]} initialBillings={[]}/>
  </AdvancedShell>;
}
