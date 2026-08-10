import '../../[...slug]/module.css';
import '../../[...slug]/advanced.css';
import '../../[...slug]/sales-options.css';
import { AdvancedShell } from '../../[...slug]/advanced-shell';
import { SalesOptionsWorkspace } from '../../[...slug]/sales-options-workspace';
import { salesOptionsGet } from '../../[...slug]/sales-options-actions';

export default async function SalesOptionsPage(){
  const options=await salesOptionsGet();
  return <AdvancedShell
    title="Opções de Vendas"
    subtitle="Central de formas de pagamento, cartões, bandeiras, credenciadoras, parcelamento e condições de venda a prazo."
    activePath="/dashboard/configuracoes/opcoes-vendas"
  >
    <SalesOptionsWorkspace initial={{
      payment_methods:options.payment_methods,
      payment_terms:options.payment_terms,
      card_brands:options.card_brands,
      card_acquirers:options.card_acquirers,
      credit_installments:options.credit_installments,
    }}/>
  </AdvancedShell>;
}
