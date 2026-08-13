import '../../[...slug]/module.css';
import '../../[...slug]/advanced.css';
import '../../[...slug]/sales-options.css';
import { AdvancedShell } from '../../[...slug]/advanced-shell';
import { SalesOptionsWorkspace } from '../../[...slug]/sales-options-workspace';
import { salesOptionsGet } from '../../[...slug]/sales-options-actions';
import { inventoryPolicyGet, inventoryPolicySaveForm } from '../../[...slug]/inventory-policy-actions';

export default async function SalesOptionsPage(){
  const [options,inventoryPolicy]=await Promise.all([salesOptionsGet(),inventoryPolicyGet()]);
  const allowNegative=Boolean(inventoryPolicy.allow_negative_stock);
  return <AdvancedShell
    title="Opções de Vendas"
    subtitle="Central de formas de pagamento, cartões, estoque no PDV, parcelamento e condições de venda a prazo."
    activePath="/dashboard/configuracoes/opcoes-vendas"
  >
    <section className="erp-module-card erp-sales-options-section">
      <div className="erp-sales-options-head"><div><small>ESTOQUE NO PDV</small><h2>Venda com estoque negativo</h2><p>Quando bloqueado, o ThorPDV valida o saldo antes de concluir a venda. Quando permitido, somente a baixa de venda pode deixar o estoque abaixo de zero.</p></div></div>
      <form action={inventoryPolicySaveForm} className="erp-payment-method-card" style={{maxWidth:760}}>
        <div><strong>{allowNegative?'Estoque negativo permitido':'Estoque negativo bloqueado'}</strong><small>{allowNegative?'O caixa pode vender acima do saldo disponível.':'A venda será interrompida antes da finalização quando não houver saldo suficiente.'}</small></div>
        <label className="erp-switch" title="Permitir venda com estoque negativo"><input name="allow_negative_stock" type="checkbox" defaultChecked={allowNegative}/><span/></label>
        <button type="submit" className="erp-primary">Salvar política</button>
      </form>
    </section>
    <SalesOptionsWorkspace initial={{
      payment_methods:options.payment_methods,
      payment_terms:options.payment_terms,
      card_brands:options.card_brands,
      card_acquirers:options.card_acquirers,
      credit_installments:options.credit_installments,
    }}/>
  </AdvancedShell>;
}
