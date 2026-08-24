'use client';

import { useMemo, useState } from 'react';
import { salesSessionCustomerSearch, salesSessionRulesSave } from './sales-options-actions';

type Row=Record<string,unknown>;
type Rules={require_seller?:boolean;require_customer?:boolean;customer_mode?:string;default_customer?:Row|null;print_behavior?:string;print_document?:string};
const s=(v:unknown)=>String(v??'');

export function SalesSessionRules({initial}:{initial:Rules}){
  const [requireSeller,setRequireSeller]=useState(Boolean(initial.require_seller));
  const [requireCustomer,setRequireCustomer]=useState(Boolean(initial.require_customer));
  const [customerMode,setCustomerMode]=useState<'free'|'default'|'fixed'>(['default','fixed'].includes(s(initial.customer_mode))?s(initial.customer_mode) as 'default'|'fixed':'free');
  const [customer,setCustomer]=useState<Row|null>(initial.default_customer&&typeof initial.default_customer==='object'?initial.default_customer:null);
  const [printBehavior,setPrintBehavior]=useState<'ask'|'always'|'never'>(['always','never'].includes(s(initial.print_behavior))?s(initial.print_behavior) as 'always'|'never':'ask');
  const [printDocument,setPrintDocument]=useState<'nfce'|'pre_sale'>(s(initial.print_document)==='pre_sale'?'pre_sale':'nfce');
  const [search,setSearch]=useState('');
  const [rows,setRows]=useState<Row[]>([]);
  const [loading,setLoading]=useState(false);
  const [saving,setSaving]=useState(false);
  const [message,setMessage]=useState('');

  const needsCustomer=customerMode!=='free';
  const fixed=customerMode==='fixed';
  const customerLabel=useMemo(()=>customer?s(customer.name)||'Cliente selecionado':'Nenhum cliente selecionado',[customer]);

  async function find(){
    setLoading(true);setMessage('');
    try{const r=await salesSessionCustomerSearch(search);if(r.ok)setRows(r.data);else setMessage(`Não foi possível pesquisar: ${s(r.error)}`);}catch(e){setMessage(e instanceof Error?e.message:'Falha na pesquisa.');}finally{setLoading(false);}
  }

  async function save(){
    if(needsCustomer&&!customer){setMessage('Selecione o cliente que será usado como padrão ou fixo.');return;}
    setSaving(true);setMessage('');
    try{
      const r=await salesSessionRulesSave({require_seller:requireSeller,require_customer:fixed?true:requireCustomer,customer_mode:customerMode,default_customer:customer,print_behavior:printBehavior,print_document:printDocument});
      if(r.ok)setMessage('Regras da sessão de venda salvas. A Nova Venda do ThorGestão já usará essa preferência e o ThorPDV receberá a configuração na próxima sincronização.');
      else setMessage(`Não foi possível salvar: ${s(r.error)}`);
    }catch(e){setMessage(e instanceof Error?e.message:'Não foi possível salvar.');}finally{setSaving(false);}
  }

  return <div className="erp-sales-session-grid">
    <section className="erp-module-card erp-sales-options-section">
      <div className="erp-sales-options-head"><div><small>IDENTIFICAÇÃO DA VENDA</small><h2>Regras obrigatórias da sessão</h2><p>Defina quais informações o operador precisa identificar antes de concluir cada venda no ThorPDV.</p></div><span className="erp-sales-options-badge">Regra da filial</span></div>
      <div className="erp-sales-rule-list">
        <label className="erp-sales-rule-card"><span><b>Forçar identificação do vendedor</b><small>O PDV não finaliza a venda enquanto um vendedor não for informado. Vendedor e operador permanecem pessoas distintas.</small></span><span className="erp-switch"><input type="checkbox" checked={requireSeller} onChange={e=>setRequireSeller(e.target.checked)}/><span/></span></label>
        <label className="erp-sales-rule-card"><span><b>Forçar identificação do cliente</b><small>Exige um cliente cadastrado no Gestão. Apenas informar CPF/CNPJ sem vincular o cadastro não satisfaz esta regra.</small></span><span className="erp-switch"><input type="checkbox" checked={fixed||requireCustomer} disabled={fixed} onChange={e=>setRequireCustomer(e.target.checked)}/><span/></span></label>
      </div>
    </section>

    <section className="erp-module-card erp-sales-options-section">
      <div className="erp-sales-options-head"><div><small>IMPRESSÃO APÓS A VENDA</small><h2>Comportamento da impressão</h2><p>Defina como a Nova Venda do ThorGestão deve agir depois que a operação for concluída.</p></div><span className="erp-sales-options-badge">Nova Venda</span></div>
      <div className="erp-sales-customer-mode">
        <label className={printBehavior==='ask'?'active':''}><input type="radio" name="printBehavior" checked={printBehavior==='ask'} onChange={()=>setPrintBehavior('ask')}/><span><b>Perguntar ao finalizar</b><small>Exibe a pergunta antes de abrir a impressão.</small></span></label>
        <label className={printBehavior==='always'?'active':''}><input type="radio" name="printBehavior" checked={printBehavior==='always'} onChange={()=>setPrintBehavior('always')}/><span><b>Imprimir automaticamente</b><small>Após concluir a venda, prepara o documento e abre a impressão.</small></span></label>
        <label className={printBehavior==='never'?'active':''}><input type="radio" name="printBehavior" checked={printBehavior==='never'} onChange={()=>setPrintBehavior('never')}/><span><b>Não imprimir</b><small>Conclui a venda sem abrir a tela de impressão.</small></span></label>
      </div>
      <div className="erp-sales-customer-mode">
        <label className={printDocument==='nfce'?'active':''}><input type="radio" name="printDocument" checked={printDocument==='nfce'} onChange={()=>setPrintDocument('nfce')}/><span><b>NFC-e</b><small>Prepara e autoriza a NFC-e antes da impressão.</small></span></label>
        <label className={printDocument==='pre_sale'?'active':''}><input type="radio" name="printDocument" checked={printDocument==='pre_sale'} onChange={()=>setPrintDocument('pre_sale')}/><span><b>Pré-venda</b><small>Imprime comprovante comercial sem valor fiscal.</small></span></label>
      </div>
    </section>

    <section className="erp-module-card erp-sales-options-section">
      <div className="erp-sales-options-head"><div><small>CLIENTE DA VENDA</small><h2>Cliente padrão ou fixo</h2><p>O cliente padrão é preenchido automaticamente e pode ser trocado. O cliente fixo é aplicado a todas as vendas e não pode ser alterado no caixa.</p></div></div>
      <div className="erp-sales-customer-mode">
        <label className={customerMode==='free'?'active':''}><input type="radio" name="customerMode" checked={customerMode==='free'} onChange={()=>setCustomerMode('free')}/><span><b>Livre</b><small>Sem cliente automático.</small></span></label>
        <label className={customerMode==='default'?'active':''}><input type="radio" name="customerMode" checked={customerMode==='default'} onChange={()=>setCustomerMode('default')}/><span><b>Cliente padrão</b><small>Preenche no início e permite trocar.</small></span></label>
        <label className={customerMode==='fixed'?'active':''}><input type="radio" name="customerMode" checked={customerMode==='fixed'} onChange={()=>setCustomerMode('fixed')}/><span><b>Cliente fixo</b><small>Aplicado e bloqueado em toda venda.</small></span></label>
      </div>

      {needsCustomer&&<div className="erp-sales-customer-picker">
        <div className={`erp-sales-selected-customer ${customer?'selected':''}`}><div><small>{fixed?'CLIENTE FIXO':'CLIENTE PADRÃO'}</small><b>{customerLabel}</b>{customer&&<span>{s(customer.document)||'Sem CPF/CNPJ cadastrado'}</span>}</div>{customer&&<button className="erp-ghost" type="button" onClick={()=>setCustomer(null)}>Trocar cliente</button>}</div>
        <div className="erp-sales-customer-search"><input value={search} onChange={e=>setSearch(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();void find();}}} placeholder="Buscar cliente por nome ou CPF/CNPJ"/><button className="erp-ghost" type="button" disabled={loading} onClick={find}>{loading?'Buscando...':'Buscar'}</button></div>
        <div className="erp-sales-customer-results">{rows.map(row=><button type="button" key={s(row.id)} onClick={()=>{setCustomer(row);setRows([]);setSearch('');}}><span><b>{s(row.name)}</b><small>{s(row.document)||'Sem CPF/CNPJ'}{s(row.phone)?` · ${s(row.phone)}`:''}</small></span><em>Selecionar</em></button>)}{!rows.length&&search&&!loading&&<div className="erp-empty">Use Buscar para localizar o cliente no cadastro.</div>}</div>
      </div>}
    </section>

    <section className="erp-module-card erp-sales-session-summary">
      <div><small>COMPORTAMENTO NO THORPDV / THORGESTÃO</small><b>{requireSeller?'Vendedor obrigatório':'Vendedor opcional'} · {fixed?'Cliente fixo':requireCustomer?'Cliente obrigatório':customerMode==='default'?'Cliente padrão':'Cliente livre'} · {printDocument==='nfce'?'NFC-e':'Pré-venda'} · {printBehavior==='ask'?'Perguntar impressão':printBehavior==='always'?'Impressão automática':'Sem impressão automática'}</b><p>A preferência de impressão é aplicada à Nova Venda do ThorGestão. As demais regras continuam sincronizadas com o ThorPDV.</p></div>
      <button className="erp-primary" type="button" disabled={saving} onClick={save}>{saving?'Salvando...':'Salvar regras da sessão'}</button>
    </section>
    {message&&<div className="erp-sales-options-message">{message}</div>}
  </div>;
}
