import '../../[...slug]/module.css';
import '../../[...slug]/advanced.css';
import '../../[...slug]/receivables.css';
import '../../[...slug]/receivables-bolecode.css';
import '../../[...slug]/receivables-actions-menu.css';
import { AdvancedShell } from '../../[...slug]/advanced-shell';
import { partyList } from '../../[...slug]/party-actions';
import { financialAccountsData } from '../../[...slug]/financial-accounts-actions';
import { bankIntegrationsData } from '../../[...slug]/bank-integrations-actions';
import { erpReceivablesList } from '../../[...slug]/receivables-actions';
import { receivableBankBillings } from '../../[...slug]/receivables-bolecode-actions';
import { ReceivablesWorkspace } from '../../[...slug]/receivables-workspace';

export default async function ReceivablesPage(){
  const [receivables,customers,finance,banking,billings]=await Promise.all([
    erpReceivablesList({}),
    partyList('customers'),
    financialAccountsData(),
    bankIntegrationsData(),
    receivableBankBillings(),
  ]);
  const rows=Array.isArray(receivables.data)?receivables.data:[];
  const customerRows=Array.isArray(customers.data)?customers.data:[];
  const integrations=Array.isArray(banking.integrations)?banking.integrations as Record<string,unknown>[]:[];
  const billingRows=Array.isArray(billings.data)?billings.data as Record<string,unknown>[]:[];
  return <AdvancedShell title="Contas a Receber" subtitle="Acompanhe títulos a prazo, recebimentos e cobranças bancárias em uma única lista, com todas as operações concentradas em Ações de cada título." activePath="/dashboard/financeiro/receber">
    <ReceivablesWorkspace
      initial={rows}
      customers={customerRows}
      accounts={(finance.accounts as Record<string,unknown>[])??[]}
      paymentMethods={(finance.payment_methods as Record<string,unknown>[])??[]}
      integrations={integrations}
      initialBillings={billingRows}
    />
  </AdvancedShell>;
}
