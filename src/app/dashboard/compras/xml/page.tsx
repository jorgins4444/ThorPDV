import '../../[...slug]/module.css';
import '../../[...slug]/advanced.css';
import '../../[...slug]/management-shell.css';
import '../../[...slug]/purchase-xml.css';
import { AdvancedShell } from '../../[...slug]/advanced-shell';
import { financialStructureGet } from '../../[...slug]/financial-structure-actions';
import { purchaseXmlContext } from '../../[...slug]/purchase-actions';
import { PurchaseXmlWorkspace } from '../../[...slug]/purchase-xml-workspace';

export default async function PurchaseXmlPage(){
  const [context,structure]=await Promise.all([purchaseXmlContext(),financialStructureGet()]);
  return <AdvancedShell
    title="Entrada de NF-e por XML"
    subtitle="Leia a NF-e, valide o destinatário da filial, confira produtos, conversões, preços e gere estoque + financeiro em uma única confirmação."
    activePath="/dashboard/compras/xml"
  >
    <PurchaseXmlWorkspace
      suppliers={context.suppliers}
      products={context.products}
      links={context.links}
      units={context.units}
      categories={structure.categories}
      chartAccounts={structure.accounts}
      costCenters={structure.cost_centers}
      currentBranchId={structure.current_branch_id||context.branch_id}
      currentBranchName={structure.current_branch_name||context.branch_name}
      currentBranchDocument={context.branch_document}
      currentCompanyName={context.company_name}
    />
  </AdvancedShell>;
}
