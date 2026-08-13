import '../../[...slug]/module.css';
import '../../[...slug]/advanced.css';
import '../../[...slug]/sales-options.css';
import '../stock-home.css';
import '../stock-locations.css';
import { AdvancedShell } from '../../[...slug]/advanced-shell';
import { StockLocationsWorkspace } from '../../[...slug]/stock-locations-workspace';
import { erpLoad } from '../../[...slug]/actions';
import { erpStockOverview } from '../../[...slug]/stock-location-actions';
import { inventoryPolicyGet, inventoryPolicySaveForm } from '../../[...slug]/inventory-policy-actions';

export default async function StockLocationsPage(){
  const [overview,branches,policy]=await Promise.all([erpStockOverview(),erpLoad('branches'),inventoryPolicyGet()]);
  const allowNegative=Boolean(policy.allow_negative_stock);
  return <AdvancedShell title="Locais de Estoque" subtitle="Separe os saldos por Matriz, Filial, Depósito ou qualquer outro local físico e defina a política de saldo da loja." activePath="/dashboard/estoque/locais">
    <section className="erp-module-card erp-sales-options-section">
      <div className="erp-sales-options-head">
        <div>
          <small>POLÍTICA DA LOJA</small>
          <h2>Estoque negativo</h2>
          <p>Defina se a filial atual pode concluir vendas acima do saldo disponível. Esta configuração é sincronizada com o ThorPDV.</p>
        </div>
      </div>
      <form action={inventoryPolicySaveForm} className="erp-payment-method-card" style={{maxWidth:820}}>
        <div>
          <strong>{allowNegative?'Permitir estoque negativo':'Bloquear estoque negativo'}</strong>
          <small>{allowNegative?'As vendas desta filial podem deixar o saldo abaixo de zero.':'O ThorPDV bloqueia a venda antes da finalização quando não houver saldo suficiente.'}</small>
        </div>
        <label className="erp-switch" title="Permitir estoque negativo">
          <input name="allow_negative_stock" type="checkbox" defaultChecked={allowNegative}/>
          <span/>
        </label>
        <button type="submit" className="erp-primary">Salvar política de estoque</button>
      </form>
    </section>
    <StockLocationsWorkspace locations={overview.locations} branches={branches.data} balances={overview.balances}/>
  </AdvancedShell>;
}
