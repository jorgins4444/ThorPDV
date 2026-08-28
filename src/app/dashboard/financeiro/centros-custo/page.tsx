import '../../[...slug]/module.css';
import '../../[...slug]/advanced.css';
import '../../[...slug]/financial-structure.css';
import { AdvancedShell } from '../../[...slug]/advanced-shell';
import { erpLoad } from '../../[...slug]/actions';
import { financialStructureGet } from '../../[...slug]/financial-structure-actions';
import { FinancialStructureWorkspace } from '../../[...slug]/financial-structure-workspace';

export default async function CostCentersPage(){
  const [structure,branches]=await Promise.all([financialStructureGet(),erpLoad('branches')]);
  return <AdvancedShell title="Centros de Custo" subtitle="Acompanhe despesas e resultados por filial, departamento, projeto ou unidade de responsabilidade." activePath="/dashboard/financeiro/centros-custo">
    <FinancialStructureWorkspace activeTab="cost_centers" initialAccounts={structure.accounts} initialCategories={structure.categories} initialCostCenters={structure.cost_centers} branches={branches.data}/>
  </AdvancedShell>;
}
