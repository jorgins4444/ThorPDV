import Link from 'next/link';
import '../[...slug]/module.css';
import '../[...slug]/advanced.css';
import '../[...slug]/management-shell.css';
import '../[...slug]/sales-options.css';
import './stock-home.css';
import { AdvancedShell } from '../[...slug]/advanced-shell';
import { StockWorkspace } from '../[...slug]/stock-workspace';
import { erpLoad } from '../[...slug]/actions';
import { erpStockOverview } from '../[...slug]/stock-location-actions';

export default async function StockPage() {
  const [products, overview] = await Promise.all([erpLoad('products'), erpStockOverview()]);
  return <AdvancedShell title="Gestão de Estoque" subtitle="Movimentações, saldos e políticas de estoque separadas por loja e Local de Estoque." activePath="/dashboard/estoque">
    <div className="erp-stock-hub-links">
      <Link className="erp-primary" href="/dashboard/estoque/locais">Locais de Estoque</Link>
      <Link className="erp-ghost" href="/dashboard/compras">Compras / Entradas</Link>
      <Link className="erp-ghost" href="/dashboard/estoque/inventario">Inventário</Link>
      <Link className="erp-ghost" href="/dashboard/estoque/transferencias">Transferências</Link>
      <Link className="erp-ghost" href="/dashboard/estoque/ajustes">Ajustes</Link>
    </div>

    <section className="erp-module-card erp-sales-options-section">
      <div className="erp-sales-options-head"><div><small>CONFIGURAÇÃO DE ESTOQUE</small><h2>Política de saldo da loja</h2><p>A configuração para permitir ou bloquear vendas sem saldo está centralizada em Locais de Estoque.</p></div></div>
      <Link className="erp-primary" href="/dashboard/estoque/locais">Configurar em Locais de Estoque</Link>
    </section>

    <StockWorkspace products={products.data} history={overview.history} locations={overview.locations} balances={overview.balances}/>
  </AdvancedShell>;
}
