import '../../[...slug]/module.css';
import '../../[...slug]/advanced.css';
import '../../[...slug]/sale.css';
import '../../[...slug]/sales-order.css';
import '../../[...slug]/sales-order-centralized.css';
import { AdvancedShell } from '../../[...slug]/advanced-shell';
import { SaleWorkspaceV070 } from '../../[...slug]/sale-workspace-v070';
import { erpLoad } from '../../[...slug]/actions';
import { salesOptionsGet } from '../../[...slug]/sales-options-actions';

export default async function NewSalePage(){
  const [customers,priceTables,options]=await Promise.all([erpLoad('customers'),erpLoad('price_tables'),salesOptionsGet()]);
  return <AdvancedShell title="Nova Venda" subtitle="Venda à vista ou a prazo usando as formas e condições definidas em Opções de Vendas." activePath="/dashboard/vendas/nova"><SaleWorkspaceV070 customers={customers.data} priceTables={priceTables.data} salesOptions={{payment_methods:options.payment_methods,payment_terms:options.payment_terms,card_brands:options.card_brands,card_acquirers:options.card_acquirers,credit_installments:options.credit_installments}}/></AdvancedShell>;
}
