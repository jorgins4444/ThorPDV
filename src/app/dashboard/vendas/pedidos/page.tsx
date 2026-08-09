import '../../[...slug]/module.css';
import '../../[...slug]/advanced.css';
import '../../[...slug]/sale.css';
import '../../[...slug]/sales-order.css';
import { AdvancedShell } from '../../[...slug]/advanced-shell';
import { SalesOrderWorkspace } from '../../[...slug]/sales-order-workspace';
import { erpLoad, erpSaleCatalog } from '../../[...slug]/actions';
import { listPdvOperators } from '../../[...slug]/operator-actions';
import { paymentTermList, salesOrderList } from '../../[...slug]/sales-order-actions';

// ThorPDV Gestão v0.7.0 — pedidos de venda e negociação a prazo.
export default async function SalesOrdersPage(){
  const [orders,customers,sellers,catalog,terms]=await Promise.all([
    salesOrderList(),erpLoad('customers'),listPdvOperators(),erpSaleCatalog(),paymentTermList(),
  ]);
  return <AdvancedShell
    title="Pedidos de Venda"
    subtitle="Registre a negociação do cliente, venda à vista ou a prazo, e disponibilize o pedido para conclusão no ThorPDV."
    activePath="/dashboard/vendas/pedidos"
  >
    <SalesOrderWorkspace initialOrders={orders.data} customers={customers.data} sellers={sellers.data} catalog={catalog.data} initialTerms={terms.data}/>
  </AdvancedShell>;
}
