import '../../[...slug]/module.css';
import '../../[...slug]/advanced.css';
import '../../[...slug]/bank-homologation.css';
import '../../[...slug]/ui-visibility-fixes.css';
import { AdvancedShell } from '../../[...slug]/advanced-shell';
import { bankHomologationData } from '../../[...slug]/bank-cnab-actions';
import { BankHomologationWorkspace } from '../../[...slug]/bank-homologation-workspace';

export default async function BankHomologationPage(){
  const data=await bankHomologationData();
  return <AdvancedShell title="Homologação Bancária" subtitle="Configure o layout, gere uma remessa teste e só libere a conta após o retorno confirmar o mesmo título." activePath="/dashboard/financeiro/homologacao-bancaria" backHref="/dashboard/financeiro/contas-bancarias" backLabel="Contas Bancárias">
    <BankHomologationWorkspace initial={data as Record<string,unknown>}/>
  </AdvancedShell>;
}
