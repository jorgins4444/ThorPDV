import '../../[...slug]/module.css';
import '../../[...slug]/advanced.css';
import '../../[...slug]/bank-homologation.css';
import '../../[...slug]/ui-visibility-fixes.css';
import { AdvancedShell } from '../../[...slug]/advanced-shell';
import { bankHomologationData } from '../../[...slug]/bank-cnab-actions';
import { BankHomologationWorkspace } from '../../[...slug]/bank-homologation-workspace';
import { HomologationBankSelectorFix } from '../../[...slug]/homologation-bank-selector-fix';

export default async function BankHomologationPage(){
  const data=await bankHomologationData();
  const accounts=Array.isArray(data.accounts)?data.accounts as Record<string,unknown>[]:[];
  const layoutModels=Array.isArray(data.layout_models)?data.layout_models as Record<string,unknown>[]:[];
  return <AdvancedShell title="Homologação Bancária" subtitle="Configure o layout, gere uma remessa teste e só libere a conta após o retorno confirmar o mesmo título." activePath="/dashboard/financeiro/homologacao-bancaria" backHref="/dashboard/financeiro/contas-bancarias" backLabel="Contas Bancárias">
    <HomologationBankSelectorFix accounts={accounts} layoutModels={layoutModels}/>
    <BankHomologationWorkspace initial={data as Record<string,unknown>}/>
  </AdvancedShell>;
}
