import '../../[...slug]/module.css';
import '../../[...slug]/advanced.css';
import '../../[...slug]/financial-accounts.css';
import '../../[...slug]/bank-cnab-account-link.css';
import '../../[...slug]/ui-visibility-fixes.css';
import { AdvancedShell } from '../../[...slug]/advanced-shell';
import { financialAccountsData } from '../../[...slug]/financial-accounts-actions';
import { FinancialAccountsWorkspace } from '../../[...slug]/financial-accounts-workspace';

export default async function FinancialAccountsPage(){
 const data=await financialAccountsData();
 return <AdvancedShell title="Contas Bancárias" subtitle="Contas, movimentações, transferências e cobrança bancária por arquivo." activePath="/dashboard/financeiro/contas-bancarias">
  <FinancialAccountsWorkspace initial={data as Record<string,unknown>}/>
 </AdvancedShell>;
}
