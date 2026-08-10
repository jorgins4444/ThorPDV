import '../../[...slug]/module.css';
import '../../[...slug]/advanced.css';
import '../stock-home.css';
import '../stock-locations.css';
import { AdvancedShell } from '../../[...slug]/advanced-shell';
import { StockLocationsWorkspace } from '../../[...slug]/stock-locations-workspace';
import { erpLoad } from '../../[...slug]/actions';
import { erpStockOverview } from '../../[...slug]/stock-location-actions';

export default async function StockLocationsPage(){
  const [overview,branches]=await Promise.all([erpStockOverview(),erpLoad('branches')]);
  return <AdvancedShell title="Locais de Estoque" subtitle="Separe os saldos por Matriz, Filial, Depósito ou qualquer outro local físico." activePath="/dashboard/estoque/locais">
    <StockLocationsWorkspace locations={overview.locations} branches={branches.data} balances={overview.balances}/>
  </AdvancedShell>;
}
