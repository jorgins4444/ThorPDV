import '../../[...slug]/module.css';
import '../../[...slug]/advanced.css';
import '../../[...slug]/sale.css';
import '../../[...slug]/sales-order.css';
import { AdvancedShell } from '../../[...slug]/advanced-shell';
import { SaleWorkspaceV070 } from '../../[...slug]/sale-workspace-v070';
import { erpLoad } from '../../[...slug]/actions';
import { paymentTermList } from '../../[...slug]/sales-order-actions';

export default async function NewSalePage(){
  const [customers,priceTables,terms]=await Promise.all([erpLoad('customers'),erpLoad('price_tables'),paymentTermList()]);
  return <AdvancedShell title="Nova Venda" subtitle="Venda à vista quitada ou venda a prazo com Boleto/Crediário e parcelas em Contas a Receber." activePath="/dashboard/vendas/nova"><SaleWorkspaceV070 customers={customers.data} priceTables={priceTables.data} terms={terms.data}/></AdvancedShell>;
}
