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
import { inventoryPolicyGet, inventoryPolicySaveForm } from '../[...slug]/inventory-policy-actions';

export default async function StockPage() {
  const [products, overview, policy] = await Promise.all([erpLoad('products'), erpStockOverview(), inventoryPolicyGet()]);
  const allowNegative=Boolean(policy.allow_negative_stock);
  return <AdvancedShell title="Gestão de Estoque" subtitle="Movimentações, saldos e políticas de estoque separadas por loja e Local de Estoque." activePath="/dashboard/estoque">
    <div className="erp-stock-hub-links">
      <Link className="erp-primary" href="/dashboard/estoque/locais">Local Estoque</Link>
      <Link className="erp-ghost" href="/dashboard/compras">Compras / Entradas</Link>
      <Link className="erp-ghost" href="/dashboard/estoque/inventario">Inventário</Link>
      <Link className="erp-ghost" href="/dashboard/estoque/transferencias">Transferências</Link>
      <Link className="erp-ghost" href="/dashboard/estoque/ajustes">Ajustes</Link>
    </div>

    <section className="erp-module-card erp-sales-options-section">
      <div className="erp-sales-options-head"><div><small>CONFIGURAÇÕES DA LOJA</small><h2>Política de estoque negativo</h2><p>Defina se esta filial pode concluir vendas acima do saldo disponível. A regra é sincronizada com o ThorPDV.</p></div></div>
      <form action={inventoryPolicySaveForm} className="erp-payment-method-card" style={{maxWidth:820}}>
        <div><strong>{allowNegative?'Permitir estoque negativo':'Bloquear estoque negativo'}</strong><small>{allowNegative?'As vendas podem deixar o saldo abaixo de zero.':'O ThorPDV deve bloquear a venda antes da finalização quando não houver saldo suficiente.'}</small></div>
        <label className="erp-switch" title="Permitir estoque negativo"><input name="allow_negative_stock" type="checkbox" defaultChecked={allowNegative}/><span/></label>
        <button type="submit" className="erp-primary">Salvar política da loja</button>
      </form>
    </section>

    <StockWorkspace products={products.data} history={overview.history} locations={overview.locations} balances={overview.balances}/>
  </AdvancedShell>;
}
