'use client';

import { useMemo, useState } from 'react';
import {
  salesCardAcquirerSave,
  salesCardBrandSave,
  salesCreditInstallmentSave,
  salesOptionsGet,
  salesPaymentMethodSave,
  salesPaymentTermSave,
} from './sales-options-actions';

type Row=Record<string,unknown>;
type SalesOptions={payment_methods:Row[];payment_terms:Row[];card_brands:Row[];card_acquirers:Row[];credit_installments:Row[]};
const s=(v:unknown)=>String(v??'');
const n=(v:unknown)=>{const x=Number(v??0);return Number.isFinite(x)?x:0};
const pct=(v:unknown)=>n(v).toLocaleString('pt-BR',{minimumFractionDigits:0,maximumFractionDigits:4});

export function SalesOptionsWorkspace({initial}:{initial:SalesOptions}){
  const [methods,setMethods]=useState(initial.payment_methods);
  const [terms,setTerms]=useState(initial.payment_terms);
  const [brands,setBrands]=useState(initial.card_brands);
  const [acquirers,setAcquirers]=useState(initial.card_acquirers);
  const [installments,setInstallments]=useState(initial.credit_installments);
  const [message,setMessage]=useState('');
  const [busy,setBusy]=useState('');
  const [acquirerSearch,setAcquirerSearch]=useState('');
  const [showEnabledAcquirers,setShowEnabledAcquirers]=useState(false);
  const [termId,setTermId]=useState('');
  const [termName,setTermName]=useState('');
  const [termMethod,setTermMethod]=useState<'crediario'|'boleto'>('crediario');
  const [termInstallments,setTermInstallments]=useState(1);
  const [termFirstDue,setTermFirstDue]=useState(30);
  const [termInterval,setTermInterval]=useState(30);
  const [termInterest,setTermInterest]=useState(0);
  const [termActive,setTermActive]=useState(true);

  async function reload(){const r=await salesOptionsGet();if(r.ok){setMethods(r.payment_methods);setTerms(r.payment_terms);setBrands(r.card_brands);setAcquirers(r.card_acquirers);setInstallments(r.credit_installments);}return r;}
  async function run(key:string,fn:()=>Promise<Record<string,unknown>>,success:string){setBusy(key);setMessage('');try{const r=await fn();if(r.ok){await reload();setMessage(success);}else setMessage(`Não foi possível salvar: ${s(r.error||'erro')}`);}catch(e){setMessage(`Não foi possível salvar: ${e instanceof Error?e.message:'erro'}`);}finally{setBusy('');}}

  function patchMethod(code:string,field:string,value:unknown){setMethods(rows=>rows.map(x=>s(x.code)===code?{...x,[field]:value}:x));}
  async function saveMethod(row:Row){const code=s(row.code);await run(`method:${code}`,()=>salesPaymentMethodSave({code,name:s(row.name),active:row.active!==false}),`${s(row.name)} atualizado.`);}

  async function toggleBrand(row:Row){const code=s(row.code),active=row.active===false;setBrands(rows=>rows.map(x=>s(x.code)===code?{...x,active}:x));await run(`brand:${code}`,()=>salesCardBrandSave({code,active}),`${s(row.name)} ${active?'ativada':'desativada'}.`);}

  const filteredAcquirers=useMemo(()=>{const q=acquirerSearch.trim().toLowerCase();return acquirers.filter(a=>(!showEnabledAcquirers||a.active!==false)&&(q===''||s(a.name).toLowerCase().includes(q)||s(a.cnpj).replace(/\D/g,'').includes(q.replace(/\D/g,''))));},[acquirers,acquirerSearch,showEnabledAcquirers]);
  async function toggleAcquirer(row:Row){const cnpj=s(row.cnpj),active=row.active===false;setAcquirers(rows=>rows.map(x=>s(x.cnpj)===cnpj?{...x,active,preferred:active?x.preferred:false}:x));await run(`acq:${cnpj}`,()=>salesCardAcquirerSave({cnpj,active,preferred:active?Boolean(row.preferred):false}),`${s(row.name)} ${active?'habilitada':'desabilitada'}.`);}
  async function preferAcquirer(row:Row){const cnpj=s(row.cnpj);setAcquirers(rows=>rows.map(x=>({...x,active:s(x.cnpj)===cnpj?true:x.active,preferred:s(x.cnpj)===cnpj})));await run(`pref:${cnpj}`,()=>salesCardAcquirerSave({cnpj,active:true,preferred:true}),`${s(row.name)} definida como credenciadora preferencial.`);}

  function patchInstallment(count:number,field:string,value:unknown){setInstallments(rows=>rows.map(x=>n(x.installments)===count?{...x,[field]:value}:x));}
  async function saveInstallment(row:Row){const count=n(row.installments);await run(`installment:${count}`,()=>salesCreditInstallmentSave({installments:count,active:row.active!==false,interest_percent:n(row.interest_percent)}),`Crédito ${count}x atualizado.`);}

  function clearTerm(){setTermId('');setTermName('');setTermMethod('crediario');setTermInstallments(1);setTermFirstDue(30);setTermInterval(30);setTermInterest(0);setTermActive(true);}
  function editTerm(row:Row){setTermId(s(row.id));setTermName(s(row.name));setTermMethod(s(row.method)==='boleto'?'boleto':'crediario');setTermInstallments(Math.max(n(row.installments),1));setTermFirstDue(Math.max(n(row.first_due_days),0));setTermInterval(Math.max(n(row.interval_days),1));setTermInterest(Math.max(n(row.interest_percent),0));setTermActive(row.active!==false);document.getElementById('sales-term-editor')?.scrollIntoView({behavior:'smooth',block:'center'});}
  async function saveTerm(){if(!termName.trim()){setMessage('Informe o nome do plano de venda a prazo.');return;}await run('term-save',()=>salesPaymentTermSave({id:termId||null,name:termName.trim(),method:termMethod,installments:Math.max(termInstallments,1),first_due_days:Math.max(termFirstDue,0),interval_days:Math.max(termInterval,1),interest_percent:Math.max(termInterest,0),active:termActive}),termId?'Plano de venda a prazo atualizado.':'Plano de venda a prazo criado.');clearTerm();}
  async function toggleTerm(row:Row){await run(`term:${s(row.id)}`,()=>salesPaymentTermSave({id:s(row.id),name:s(row.name),method:s(row.method),installments:n(row.installments)||1,first_due_days:n(row.first_due_days),interval_days:n(row.interval_days)||30,interest_percent:n(row.interest_percent),active:row.active===false}),`Plano ${row.active===false?'ativado':'desativado'}.`);}

  return <div className="erp-sales-options-shell">
    <section className="erp-module-card erp-sales-options-intro">
      <div><small>CENTRAL DE VENDAS</small><h2>Opções de Vendas</h2><p>Defina aqui o que estará disponível nas vendas do Gestão e do ThorPDV: meios de pagamento, cartões, parcelamentos e condições de venda a prazo.</p></div>
      <span className="erp-sales-options-badge">Configuração central</span>
    </section>

    <section className="erp-module-card erp-sales-options-section">
      <div className="erp-sales-options-head"><div><small>FORMAS DE PAGAMENTO</small><h2>Meios aceitos pela empresa</h2><p>Ative apenas as formas utilizadas na operação. A opção Venda a Prazo usa os planos configurados mais abaixo.</p></div></div>
      <div className="erp-payment-method-grid">{methods.map(row=>{const code=s(row.code);return <article className={`erp-payment-method-card ${row.active===false?'off':''}`} key={code}><div><strong>{s(row.name)}</strong><small>{code}</small></div><label className="erp-switch"><input type="checkbox" checked={row.active!==false} onChange={e=>patchMethod(code,'active',e.target.checked)}/><span/></label><input value={s(row.name)} onChange={e=>patchMethod(code,'name',e.target.value)} aria-label={`Nome de ${code}`}/><button className="erp-ghost" disabled={busy===`method:${code}`} onClick={()=>saveMethod(row)}>{busy===`method:${code}`?'Salvando...':'Salvar'}</button></article>})}</div>
    </section>

    <section className="erp-module-card erp-sales-options-section">
      <div className="erp-sales-options-head"><div><small>CARTÕES</small><h2>Bandeiras aceitas</h2><p>As bandeiras são independentes da credenciadora. Habilite as que sua loja aceita no débito e/ou crédito.</p></div></div>
      <div className="erp-brand-grid">{brands.map(row=><button type="button" className={`erp-brand-chip ${row.active===false?'off':'on'}`} key={s(row.code)} disabled={busy===`brand:${s(row.code)}`} onClick={()=>toggleBrand(row)}><span>{row.active===false?'○':'✓'}</span><b>{s(row.name)}</b><small>{row.active===false?'Desativada':'Ativa'}</small></button>)}</div>
    </section>

    <section className="erp-module-card erp-sales-options-section">
      <div className="erp-sales-options-head"><div><small>CARTÕES</small><h2>Credenciadoras / adquirentes</h2><p>Catálogo pré-carregado com credenciadores marcados como ativos na fonte de maio/2026. Marque as empresas com as quais sua loja realmente possui relacionamento.</p></div><div className="erp-acquirer-filters"><input value={acquirerSearch} onChange={e=>setAcquirerSearch(e.target.value)} placeholder="Buscar por nome ou CNPJ"/><label><input type="checkbox" checked={showEnabledAcquirers} onChange={e=>setShowEnabledAcquirers(e.target.checked)}/> Somente habilitadas</label></div></div>
      <div className="erp-acquirer-list">{filteredAcquirers.map(row=>{const cnpj=s(row.cnpj),active=row.active!==false,preferred=Boolean(row.preferred);return <article className={`erp-acquirer-row ${active?'enabled':''}`} key={cnpj}><label className="erp-switch"><input type="checkbox" checked={active} onChange={()=>toggleAcquirer(row)}/><span/></label><div><strong>{s(row.name)}</strong><small>CNPJ {cnpj} · Status {s(row.status||'Ativo')}</small></div><button type="button" className={`erp-preferred ${preferred?'active':''}`} disabled={busy===`pref:${cnpj}`} onClick={()=>preferAcquirer(row)}>{preferred?'★ Preferencial':'☆ Tornar preferencial'}</button></article>})}{!filteredAcquirers.length&&<div className="erp-empty">Nenhuma credenciadora encontrada para o filtro.</div>}</div>
    </section>

    <section className="erp-module-card erp-sales-options-section">
      <div className="erp-sales-options-head"><div><small>CARTÃO DE CRÉDITO</small><h2>Parcelamento de 1x a 12x</h2><p>Por padrão as 12 opções estão disponíveis. Você pode desativar parcelas e informar uma taxa percentual própria para cada quantidade.</p></div></div>
      <div className="erp-installment-grid">{installments.map(row=>{const count=n(row.installments);return <article key={count} className={row.active===false?'off':''}><div><strong>{count}x</strong><label className="erp-switch"><input type="checkbox" checked={row.active!==false} onChange={e=>patchInstallment(count,'active',e.target.checked)}/><span/></label></div><label>Taxa %<input type="number" min="0" step="0.01" value={n(row.interest_percent)} onChange={e=>patchInstallment(count,'interest_percent',Math.max(n(e.target.value),0))}/></label><button className="erp-ghost" disabled={busy===`installment:${count}`} onClick={()=>saveInstallment(row)}>Salvar</button></article>})}</div>
    </section>

    <section id="sales-term-editor" className="erp-module-card erp-sales-options-section">
      <div className="erp-sales-options-head"><div><small>VENDA A PRAZO</small><h2>Boleto e Crediário</h2><p>Estas condições são usadas pelos Pedidos de Venda e pelo ThorPDV. A configuração não fica mais dentro do pedido.</p></div><button className="erp-ghost" onClick={clearTerm}>Novo plano</button></div>
      <div className="erp-term-config-grid"><label>Nome do plano<input value={termName} onChange={e=>setTermName(e.target.value)} placeholder="Ex.: Crediário 3x 30/60/90"/></label><label>Modalidade<select value={termMethod} onChange={e=>setTermMethod(e.target.value as 'crediario'|'boleto')}><option value="crediario">Crediário</option><option value="boleto">Boleto</option></select></label><label>Parcelas<input type="number" min="1" max="60" value={termInstallments} onChange={e=>setTermInstallments(Math.max(n(e.target.value),1))}/></label><label>1º vencimento<input type="number" min="0" value={termFirstDue} onChange={e=>setTermFirstDue(Math.max(n(e.target.value),0))}/><small>dias</small></label><label>Intervalo<input type="number" min="1" value={termInterval} onChange={e=>setTermInterval(Math.max(n(e.target.value),1))}/><small>dias</small></label><label>Taxa %<input type="number" min="0" step="0.01" value={termInterest} onChange={e=>setTermInterest(Math.max(n(e.target.value),0))}/></label><label className="erp-term-active"><input type="checkbox" checked={termActive} onChange={e=>setTermActive(e.target.checked)}/> Plano ativo</label><button className="erp-primary" disabled={busy==='term-save'} onClick={saveTerm}>{busy==='term-save'?'Salvando...':termId?'Atualizar plano':'Adicionar plano'}</button></div>
      <div className="erp-term-list">{terms.map(row=><article key={s(row.id)} className={row.active===false?'off':''}><div><strong>{s(row.name)}</strong><span>{s(row.method)==='boleto'?'Boleto':'Crediário'} · {n(row.installments)}x · 1º em {n(row.first_due_days)} dias · intervalo {n(row.interval_days)} dias · taxa {pct(row.interest_percent)}%</span></div><div><button className="erp-ghost" onClick={()=>editTerm(row)}>Editar</button><button className="erp-ghost" disabled={busy===`term:${s(row.id)}`} onClick={()=>toggleTerm(row)}>{row.active===false?'Ativar':'Desativar'}</button></div></article>)}</div>
    </section>

    {message&&<div className="erp-sales-options-message">{message}</div>}
  </div>;
}
