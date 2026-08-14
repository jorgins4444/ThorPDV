import '../../[...slug]/module.css';
import '../../[...slug]/advanced.css';
import '../../[...slug]/financial-accounts.css';
import '../../[...slug]/bank-integrations.css';
import { AdvancedShell } from '../../[...slug]/advanced-shell';
import { financialAccountsData } from '../../[...slug]/financial-accounts-actions';
import { bankIntegrationsData } from '../../[...slug]/bank-integrations-actions';
import { FinancialAccountsWorkspace } from '../../[...slug]/financial-accounts-workspace';

export default async function FinancialAccountsPage(){
 const [data,integrations]=await Promise.all([financialAccountsData(),bankIntegrationsData()]);
 return <AdvancedShell title="Contas Bancárias" subtitle="Contas, movimentações, transferências, conciliação e integrações de cobrança bancária." activePath="/dashboard/financeiro/contas-bancarias">
  <FinancialAccountsWorkspace initial={data as Record<string,unknown>} integrationsInitial={integrations as Record<string,unknown>}/>
 </AdvancedShell>;
}
