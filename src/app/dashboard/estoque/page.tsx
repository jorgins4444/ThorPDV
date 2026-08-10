import Link from 'next/link';
import '../[...slug]/module.css';
import '../[...slug]/advanced.css';
import '../[...slug]/management-shell.css';
import './stock-home.css';
import { AdvancedShell } from '../[...slug]/advanced-shell';
import { StockWorkspace } from '../[...slug]/stock-workspace';
import { erpLoad } from '../[...slug]/actions';
import { erpStockOverview } from '../[...slug]/stock-location-actions';

// Stock locations v0.7.4: deploy anchor for the location-aware inventory UI.
export default async function StockPage() {
  const [products, overview] = await Promise.all([erpLoad('products'), erpStockOverview()]);
  return <AdvancedShell title="Gestão de Estoque" subtitle="Movimentações e saldos separados por Local de Estoque, com Matriz como padrão." activePath="/dashboard/estoque">
    <div className="erp-stock-hub-links">
      <Link className="erp-primary" href="/dashboard/estoque/locais">Local Estoque</Link>
      <Link className="erp-ghost" href="/dashboard/compras">Compras / Entradas</Link>
      <Link className="erp-ghost" href="/dashboard/estoque/inventario">Inventário</Link>
      <Link className="erp-ghost" href="/dashboard/estoque/transferencias">Transferências</Link>
      <Link className="erp-ghost" href="/dashboard/estoque/ajustes">Ajustes</Link>
    </div>
    <StockWorkspace products={products.data} history={overview.history} locations={overview.locations} balances={overview.balances}/>
  </AdvancedShell>;
}
