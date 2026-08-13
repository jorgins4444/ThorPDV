import '../../[...slug]/module.css';
import '../../[...slug]/advanced.css';
import '../../[...slug]/sales-options.css';
import '../stock-home.css';
import '../stock-locations.css';
import { AdvancedShell } from '../../[...slug]/advanced-shell';
import { StockLocationsWorkspace } from '../../[...slug]/stock-locations-workspace';
import { erpLoad } from '../../[...slug]/actions';
import { erpStockOverview } from '../../[...slug]/stock-location-actions';

export default async function StockLocationsPage(){
  const [overview,branches]=await Promise.all([erpStockOverview(),erpLoad('branches')]);
  return <AdvancedShell title="Locais de Estoque" subtitle="Gerencie os estoques físicos da loja, a política de saldo de cada estoque e a integridade do histórico de movimentações." activePath="/dashboard/estoque/locais">
    <StockLocationsWorkspace locations={overview.locations} branches={branches.data}/>
  </AdvancedShell>;
}
