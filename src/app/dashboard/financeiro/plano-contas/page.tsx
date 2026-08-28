import '../../[...slug]/module.css';
import '../../[...slug]/advanced.css';
import '../../[...slug]/financial-structure.css';
import { AdvancedShell } from '../../[...slug]/advanced-shell';
import { erpLoad } from '../../[...slug]/actions';
import { financialStructureGet } from '../../[...slug]/financial-structure-actions';
import { FinancialStructureWorkspace } from '../../[...slug]/financial-structure-workspace';

export default async function ChartAccountsPage(){
  const [structure,branches]=await Promise.all([financialStructureGet(),erpLoad('branches')]);
  return <AdvancedShell title="Plano de Contas Gerencial" subtitle="Estrutura hierárquica de receitas, custos, despesas, ativos e obrigações usada na classificação financeira e na DRE." activePath="/dashboard/financeiro/plano-contas">
    <FinancialStructureWorkspace activeTab="accounts" initialAccounts={structure.accounts} initialCategories={structure.categories} initialCostCenters={structure.cost_centers} branches={branches.data}/>
  </AdvancedShell>;
}
