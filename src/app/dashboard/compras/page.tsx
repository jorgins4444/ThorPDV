import '../[...slug]/module.css';
import '../[...slug]/advanced.css';
import '../[...slug]/purchase.css';
import '../[...slug]/management-shell.css';
import { AdvancedShell } from '../[...slug]/advanced-shell';
import { PurchaseWorkspace } from '../[...slug]/purchase-workspace';
import { erpLoad } from '../[...slug]/actions';
import { purchaseList } from '../[...slug]/purchase-actions';
import { financialStructureGet } from '../[...slug]/financial-structure-actions';

export default async function PurchasesPage() {
  const [purchases, suppliers, products, structure] = await Promise.all([
    purchaseList(),
    erpLoad('suppliers'),
    erpLoad('products'),
    financialStructureGet(),
  ]);
  return <AdvancedShell title="Compras / Entradas" subtitle="Fornecedor → estoque → custo → conta a pagar classificada por categoria e centro de custo." activePath="/dashboard/compras">
    <PurchaseWorkspace initial={purchases.data} suppliers={suppliers.data} products={products.data} categories={structure.categories} costCenters={structure.cost_centers}/>
  </AdvancedShell>;
}
