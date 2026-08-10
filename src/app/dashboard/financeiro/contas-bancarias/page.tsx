import '../../[...slug]/module.css';
import '../../[...slug]/advanced.css';
import '../../[...slug]/financial-accounts.css';
import { AdvancedShell } from '../../[...slug]/advanced-shell';
import { financialAccountsData } from '../../[...slug]/financial-accounts-actions';
import { FinancialAccountsWorkspace } from '../../[...slug]/financial-accounts-workspace';

export default async function FinancialAccountsPage(){
  const data=await financialAccountsData();
  return <AdvancedShell title="Contas Bancárias" subtitle="Caixa Interno, contas bancárias, transferências, lançamentos e base para conciliação financeira." activePath="/dashboard/financeiro/contas-bancarias">
    <FinancialAccountsWorkspace initial={data}/>
  </AdvancedShell>;
}
