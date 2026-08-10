import '../../[...slug]/module.css';
import '../../[...slug]/advanced.css';
import { AdvancedShell } from '../../[...slug]/advanced-shell';
import { StockTransferLocations } from '../../[...slug]/stock-transfer-locations';
import { erpLoad } from '../../[...slug]/actions';
import { erpStockOverview } from '../../[...slug]/stock-location-actions';

export default async function StockTransfersPage(){
  const [products,overview]=await Promise.all([erpLoad('products'),erpStockOverview()]);
  return <AdvancedShell title="Transferências de Estoque" subtitle="Transfira produtos entre Matriz, Filial, Depósito e demais Locais de Estoque." activePath="/dashboard/estoque/transferencias">
    <StockTransferLocations products={products.data} locations={overview.locations} balances={overview.balances} history={overview.history}/>
  </AdvancedShell>;
}
