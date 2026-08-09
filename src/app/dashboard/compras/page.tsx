import '../[...slug]/module.css';
import '../[...slug]/advanced.css';
import '../[...slug]/purchase.css';
import '../[...slug]/management-shell.css';
import { AdvancedShell } from '../[...slug]/advanced-shell';
import { PurchaseWorkspace } from '../[...slug]/purchase-workspace';
import { erpLoad } from '../[...slug]/actions';
import { purchaseList } from '../[...slug]/purchase-actions';

export default async function PurchasesPage() {
  const [purchases, suppliers, products] = await Promise.all([
    purchaseList(),
    erpLoad('suppliers'),
    erpLoad('products'),
  ]);
  return <AdvancedShell title="Compras / Entradas" subtitle="Fornecedor → entrada de estoque → atualização de custo → conta a pagar." activePath="/dashboard/compras">
    <PurchaseWorkspace initial={purchases.data} suppliers={suppliers.data} products={products.data}/>
  </AdvancedShell>;
}
