import '../../[...slug]/module.css';
import '../../[...slug]/advanced.css';
import '../../[...slug]/receivables.css';
import '../../[...slug]/receivables-bolecode.css';
import { AdvancedShell } from '../../[...slug]/advanced-shell';
import { erpLoad } from '../../[...slug]/actions';
import { financialAccountsData } from '../../[...slug]/financial-accounts-actions';
import { bankIntegrationsData } from '../../[...slug]/bank-integrations-actions';
import { erpReceivablesList } from '../../[...slug]/receivables-actions';
import { receivableBankBillings } from '../../[...slug]/receivables-bolecode-actions';
import { ReceivablesBolecodePanel } from '../../[...slug]/receivables-bolecode-panel';
import { ReceivablesWorkspace } from '../../[...slug]/receivables-workspace';

export default async function ReceivablesPage(){
  const [receivables,customers,finance,banking,billings]=await Promise.all([
    erpReceivablesList({}),
    erpLoad('customers'),
    financialAccountsData(),
    bankIntegrationsData(),
    receivableBankBillings(),
  ]);
  const rows=Array.isArray(receivables.data)?receivables.data:[];
  const customerRows=Array.isArray(customers.data)?customers.data:[];
  const integrations=Array.isArray(banking.integrations)?banking.integrations as Record<string,unknown>[]:[];
  const billingRows=Array.isArray(billings.data)?billings.data as Record<string,unknown>[]:[];
  return <AdvancedShell title="Contas a Receber" subtitle="Somente vendas a prazo em Crediário e Boleto. Receba ou quite as parcelas direcionando o valor para uma Conta Bancária ou para o Caixa Interno." activePath="/dashboard/financeiro/receber">
    <ReceivablesBolecodePanel receivables={rows} customers={customerRows} integrations={integrations} initialBillings={billingRows}/>
    <ReceivablesWorkspace initial={rows} customers={customerRows} accounts={(finance.accounts as Record<string,unknown>[])??[]} paymentMethods={(finance.payment_methods as Record<string,unknown>[])??[]}/>
  </AdvancedShell>;
}
