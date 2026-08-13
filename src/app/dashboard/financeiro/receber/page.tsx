import '../../[...slug]/module.css';
import '../../[...slug]/advanced.css';
import '../../[...slug]/receivables.css';
import { AdvancedShell } from '../../[...slug]/advanced-shell';
import { erpLoad } from '../../[...slug]/actions';
import { financialAccountsData } from '../../[...slug]/financial-accounts-actions';
import { erpReceivablesList } from '../../[...slug]/receivables-actions';
import { ReceivablesWorkspace } from '../../[...slug]/receivables-workspace';

export default async function ReceivablesPage(){
  const [receivables,customers,finance]=await Promise.all([erpReceivablesList({}),erpLoad('customers'),financialAccountsData()]);
  return <AdvancedShell title="Contas a Receber" subtitle="Somente vendas a prazo em Crediário e Boleto. Receba ou quite as parcelas direcionando o valor para uma Conta Bancária ou para o Caixa Interno." activePath="/dashboard/financeiro/receber">
    <ReceivablesWorkspace initial={receivables.data} customers={customers.data} accounts={(finance.accounts as Record<string,unknown>[])??[]} paymentMethods={(finance.payment_methods as Record<string,unknown>[])??[]}/>
  </AdvancedShell>;
}
