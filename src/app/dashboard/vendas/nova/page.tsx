import '../../[...slug]/module.css';
import '../../[...slug]/advanced.css';
import '../../[...slug]/sale.css';
import '../../[...slug]/sales-order.css';
import '../../[...slug]/sales-order-centralized.css';
import { AdvancedShell } from '../../[...slug]/advanced-shell';
import { SaleWorkspaceV070 } from '../../[...slug]/sale-workspace-v070';
import { saleScreenBootstrap } from '../../[...slug]/screen-bootstrap-actions';

export default async function NewSalePage(){
  const boot=await saleScreenBootstrap();
  return <AdvancedShell title="Nova Venda" subtitle="Venda à vista ou a prazo usando as formas e condições definidas em Opções de Vendas." activePath="/dashboard/vendas/nova"><SaleWorkspaceV070 customers={boot.customers} priceTables={boot.priceTables} salesOptions={boot.salesOptions}/></AdvancedShell>;
}
