import '../../[...slug]/module.css';
import '../../[...slug]/advanced.css';
import { AdvancedShell } from '../../[...slug]/advanced-shell';
import { StockWorkspace } from '../../[...slug]/stock-workspace';
import { erpLoad } from '../../[...slug]/actions';
import { erpStockOverview } from '../../[...slug]/stock-location-actions';

export default async function StockAdjustmentsPage(){
  const [products,overview]=await Promise.all([erpLoad('products'),erpStockOverview()]);
  return <AdvancedShell title="Ajustes de Estoque" subtitle="Corrija o saldo do Local de Estoque selecionado, mantendo histórico e rastreabilidade." activePath="/dashboard/estoque/ajustes">
    <StockWorkspace products={products.data} history={overview.history} locations={overview.locations} balances={overview.balances} mode="adjustment"/>
  </AdvancedShell>;
}
