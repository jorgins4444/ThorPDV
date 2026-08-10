import '../../[...slug]/module.css';
import '../../[...slug]/advanced.css';
import '../../[...slug]/sale.css';
import '../../[...slug]/sales-order.css';
import '../../[...slug]/sales-order-centralized.css';
import { AdvancedShell } from '../../[...slug]/advanced-shell';
import { SalesOrderWorkspace } from '../../[...slug]/sales-order-workspace';
import { erpLoad, erpSaleCatalog } from '../../[...slug]/actions';
import { listPdvOperators } from '../../[...slug]/operator-actions';
import { salesOrderList } from '../../[...slug]/sales-order-actions';
import { salesOptionsGet } from '../../[...slug]/sales-options-actions';

export default async function SalesOrdersPage(){
  const [orders,customers,sellers,catalog,options]=await Promise.all([
    salesOrderList(),erpLoad('customers'),listPdvOperators(),erpSaleCatalog(),salesOptionsGet(),
  ]);
  return <AdvancedShell
    title="Pedidos de Venda"
    subtitle="Registre produtos, cliente, vendedor e a negociação usando somente as opções comerciais definidas em Configurações."
    activePath="/dashboard/vendas/pedidos"
  >
    <SalesOrderWorkspace
      initialOrders={orders.data}
      customers={customers.data}
      sellers={sellers.data}
      catalog={catalog.data}
      salesOptions={{
        payment_methods:options.payment_methods,
        payment_terms:options.payment_terms,
        card_brands:options.card_brands,
        card_acquirers:options.card_acquirers,
        credit_installments:options.credit_installments,
      }}
    />
  </AdvancedShell>;
}
