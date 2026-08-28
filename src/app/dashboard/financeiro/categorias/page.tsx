import '../../[...slug]/module.css';
import '../../[...slug]/advanced.css';
import '../../[...slug]/financial-structure.css';
import { AdvancedShell } from '../../[...slug]/advanced-shell';
import { erpLoad } from '../../[...slug]/actions';
import { financialStructureGet } from '../../[...slug]/financial-structure-actions';
import { FinancialStructureWorkspace } from '../../[...slug]/financial-structure-workspace';

export default async function FinancialCategoriesPage(){
  const [structure,branches]=await Promise.all([financialStructureGet(),erpLoad('branches')]);
  return <AdvancedShell title="Categorias Financeiras" subtitle="Classifique receitas, compras e despesas e defina a conta gerencial padrão de cada natureza financeira." activePath="/dashboard/financeiro/categorias">
    <FinancialStructureWorkspace activeTab="categories" initialAccounts={structure.accounts} initialCategories={structure.categories} initialCostCenters={structure.cost_centers} branches={branches.data}/>
  </AdvancedShell>;
}
