import '../../[...slug]/module.css';
import '../../[...slug]/advanced.css';
import '../../[...slug]/sales-options.css';
import '../../[...slug]/sales-session-rules.css';
import { AdvancedShell } from '../../[...slug]/advanced-shell';
import { SalesOptionsTabs } from '../../[...slug]/sales-options-tabs';
import { salesOptionsGet } from '../../[...slug]/sales-options-actions';

export default async function SalesOptionsPage(){
  const options=await salesOptionsGet();
  return <AdvancedShell
    title="Opções de Vendas"
    subtitle="Central de regras da sessão, identificação de cliente e vendedor, formas de pagamento, cartões e condições de venda."
    activePath="/dashboard/configuracoes/opcoes-vendas"
  >
    <SalesOptionsTabs initial={{
      payment_methods:options.payment_methods,
      payment_terms:options.payment_terms,
      card_brands:options.card_brands,
      card_acquirers:options.card_acquirers,
      credit_installments:options.credit_installments,
      session_rules:options.session_rules,
    }}/>
  </AdvancedShell>;
}
