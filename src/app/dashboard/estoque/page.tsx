import Link from 'next/link';
import '../[...slug]/module.css';
import '../[...slug]/advanced.css';
import '../[...slug]/management-shell.css';
import { AdvancedShell } from '../[...slug]/advanced-shell';
import { StockWorkspace } from '../[...slug]/stock-workspace';
import { erpLoad } from '../[...slug]/actions';

export default async function StockPage() {
  const [products, history] = await Promise.all([erpLoad('products'), erpLoad('stock')]);
  return <AdvancedShell title="Gestão de Estoque" subtitle="Movimentações, compras, inventários, transferências e ajustes integrados." activePath="/dashboard/estoque">
    <div className="erp-stock-hub-links">
      <Link className="erp-primary" href="/dashboard/compras">Compras / Entradas</Link>
      <Link className="erp-ghost" href="/dashboard/estoque/inventario">Inventário</Link>
      <Link className="erp-ghost" href="/dashboard/estoque/transferencias">Transferências</Link>
      <Link className="erp-ghost" href="/dashboard/estoque/ajustes">Ajustes</Link>
    </div>
    <StockWorkspace products={products.data} history={history.data}/>
  </AdvancedShell>;
}
