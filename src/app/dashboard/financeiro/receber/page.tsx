import '../../[...slug]/module.css';
import '../../[...slug]/advanced.css';
import '../../[...slug]/receivables.css';
import '../../[...slug]/receivables-v2.css';
import { AdvancedShell } from '../../[...slug]/advanced-shell';
import { partyList } from '../../[...slug]/party-actions';
import { financialAccountsData } from '../../[...slug]/financial-accounts-actions';
import { financialStructureGet } from '../../[...slug]/financial-structure-actions';
import { erpReceivablesList } from '../../[...slug]/receivables-actions';
import { ReceivablesWorkspaceV2 } from '../../[...slug]/receivables-workspace-v2';

export default async function ReceivablesPage(){
  const [receivables,customers,finance,structure]=await Promise.all([
    erpReceivablesList({}),
    partyList('customers'),
    financialAccountsData(),
    financialStructureGet(),
  ]);
  const rows=Array.isArray(receivables.data)?receivables.data:[];
  const customerRows=Array.isArray(customers.data)?customers.data:[];
  return <AdvancedShell title="Contas a Receber" subtitle="Boleto e Crediário com classificação gerencial, vencidos priorizados e recebimentos no Caixa Interno." activePath="/dashboard/financeiro/receber">
    <ReceivablesWorkspaceV2
      initial={rows}
      customers={customerRows}
      accounts={(finance.accounts as Record<string,unknown>[])??[]}
      paymentMethods={(finance.payment_methods as Record<string,unknown>[])??[]}
      categories={(structure.categories as Record<string,unknown>[])??[]}
      costCenters={(structure.cost_centers as Record<string,unknown>[])??[]}
    />
  </AdvancedShell>;
}
