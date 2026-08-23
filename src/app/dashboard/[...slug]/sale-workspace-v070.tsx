'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import './sale-checkout-enhancements.css';
import { erpCreateSale, erpSaleCatalog } from './actions';

type Row=Record<string,unknown>;
type CartItem={product_id:string;name:string;sku:string;unit:string;quantity:number;price:number;discount:number;stock:number};
type SalesOptions={payment_methods:Row[];payment_terms:Row[];card_brands:Row[];card_acquirers:Row[];credit_installments:Row[]};
type DiscountTarget={scope:'item'|'sale';index?:number}|null;
const money=(v:unknown)=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(v??0));
const num=(v:unknown)=>{const n=Number(v??0);return Number.isFinite(n)?n:0};
const str=(v:unknown)=>String(v??'');
const normalize=(v:unknown)=>str(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
const productImage=(p:Row)=>str(p.image_url||p.menu_image_url||p.self_service_image_url||'');

function PaymentIcon({code}:{code:string}){
  const icon:Record<string,string>={cash:'$',pix:'◇',debit_card:'▣',credit_card:'▤',voucher:'◆',store_credit:'★',store_credit_voucher:'✦',other:'•••'};
  return <span className={`erp-sale-pay-icon pay-${code}`}>{icon[code]??'●'}</span>;
}

export function SaleWorkspaceV070({customers,priceTables,salesOptions}:{customers:Row[];priceTables:Row[];salesOptions:SalesOptions}){
  const methods=salesOptions.payment_methods.filter(x=>x.active!==false&&str(x.code)!=='term_sale');
  const terms=salesOptions.payment_terms.filter(x=>x.active!==false);
  const brands=salesOptions.card_brands.filter(x=>x.active!==false);
  const acquirers=salesOptions.card_acquirers.filter(x=>x.active!==false);
  const creditInstallments=salesOptions.credit_installments.filter(x=>x.active!==false).sort((a,b)=>num(a.installments)-num(b.installments));
  const defaultMethod=methods.find(x=>str(x.code)==='pix')??methods[0];
  const defaultBrand=brands[0];
  const defaultAcquirer=acquirers.find(x=>Boolean(x.preferred))??acquirers[0];
  const defaultInst=creditInstallments[0];

  const [tableId,setTableId]=useState('');
  const [catalog,setCatalog]=useState<Row[]>([]);
  const [resolvedTable,setResolvedTable]=useState('');
  const [customer,setCustomer]=useState('');
  const [search,setSearch]=useState('');
  const [qty,setQty]=useState(1);
  const [cart,setCart]=useState<CartItem[]>([]);
  const [saleDiscount,setSaleDiscount]=useState(0);
  const [discountTarget,setDiscountTarget]=useState<DiscountTarget>(null);
  const [discountMode,setDiscountMode]=useState<'percent'|'value'>('percent');
  const [discountInput,setDiscountInput]=useState(0);
  const [condition,setCondition]=useState<'immediate'|'term'>('immediate');
  const [method,setMethod]=useState(str(defaultMethod?.code||''));
  const [entryMethod,setEntryMethod]=useState(str(defaultMethod?.code||''));
  const [entryAmount,setEntryAmount]=useState(0);
  const [termId,setTermId]=useState('');
  const [cardBrand,setCardBrand]=useState(str(defaultBrand?.code||''));
  const [cardAcquirer,setCardAcquirer]=useState(str(defaultAcquirer?.cnpj||''));
  const [cardInstallments,setCardInstallments]=useState(Math.max(num(defaultInst?.installments),1));
  const [entryCardBrand,setEntryCardBrand]=useState(str(defaultBrand?.code||''));
  const [entryCardAcquirer,setEntryCardAcquirer]=useState(str(defaultAcquirer?.cnpj||''));
  const [entryCardInstallments,setEntryCardInstallments]=useState(Math.max(num(defaultInst?.installments),1));
  const [message,setMessage]=useState('');
  const [saving,setSaving]=useState(false);

  async function loadCatalog(id=tableId){
    const r=await erpSaleCatalog(id||undefined);
    if(r.ok){setCatalog(r.data);setResolvedTable(String(r.price_table_id??''));}
    else setMessage(String(r.error??'Falha ao carregar catálogo'));
  }
  useEffect(()=>{void loadCatalog(tableId);},[tableId]);
  useEffect(()=>{
    if(!method&&defaultMethod)setMethod(str(defaultMethod.code));
    if(!entryMethod&&defaultMethod)setEntryMethod(str(defaultMethod.code));
  },[defaultMethod,entryMethod,method]);

  const subtotal=useMemo(()=>cart.reduce((s,i)=>s+(i.quantity*i.price-i.discount),0),[cart]);
  const total=Math.max(subtotal-saleDiscount,0);
  const remaining=Math.max(total-entryAmount,0);
  const selectedTerm=terms.find(x=>str(x.id)===termId);
  const interest=num(selectedTerm?.interest_percent);
  const installments=Math.max(num(selectedTerm?.installments),1);
  const interestAmount=condition==='term'?remaining*interest/100:0;
  const financed=remaining+interestAmount;
  const isImmediateCard=method==='credit_card'||method==='debit_card';
  const isEntryCard=entryMethod==='credit_card'||entryMethod==='debit_card';
  const hasSearch=search.trim().length>0;

  const filteredCatalog=useMemo(()=>{
    const q=normalize(search.trim());
    if(!q)return [];
    return catalog.filter(p=>num(p.stock)>0&&[p.product_code,p.name,p.sku,p.barcode].some(v=>normalize(v).includes(q))).slice(0,40);
  },[catalog,search]);

  function addProduct(p:Row|null|undefined){
    if(!p)return;
    const available=num(p.stock);
    if(qty<=0){setMessage('Quantidade inválida.');return;}
    if(qty>available){setMessage(`Estoque insuficiente. Disponível: ${available}.`);return;}
    const price=num(p.effective_price);
    const id=str(p.id);
    let added=true;
    setCart(current=>{
      const index=current.findIndex(i=>i.product_id===id&&i.discount===0);
      if(index<0)return [...current,{product_id:id,name:str(p.name),sku:str(p.sku??''),unit:str(p.unit??'UN'),quantity:qty,price,discount:0,stock:available}];
      const next=[...current];
      const merged=next[index].quantity+qty;
      if(merged>available){setMessage(`Estoque insuficiente. Disponível: ${available}.`);added=false;return current;}
      next[index]={...next[index],quantity:merged};
      return next;
    });
    if(added){setQty(1);setSearch('');setMessage('');}
  }
  function searchKeyDown(e:React.KeyboardEvent<HTMLInputElement>){
    if(e.key==='Enter'&&hasSearch&&filteredCatalog.length===1){e.preventDefault();addProduct(filteredCatalog[0]);}
  }

  function openDiscount(target:DiscountTarget){
    if(!target)return;
    const current=target.scope==='sale'?saleDiscount:cart[target.index??-1]?.discount??0;
    setDiscountTarget(target);setDiscountMode(current>0?'value':'percent');setDiscountInput(current>0?current:0);
  }
  function applyDiscount(){
    if(!discountTarget)return;
    const targetBase=discountTarget.scope==='sale'?subtotal:(()=>{const i=cart[discountTarget.index??-1];return i?i.quantity*i.price:0})();
    const raw=Math.max(discountInput,0);
    const value=discountMode==='percent'?targetBase*Math.min(raw,100)/100:Math.min(raw,targetBase);
    const rounded=Math.round(value*100)/100;
    if(discountTarget.scope==='sale')setSaleDiscount(rounded);
    else setCart(current=>current.map((i,n)=>n===discountTarget.index?{...i,discount:rounded}:i));
    setDiscountTarget(null);setDiscountInput(0);setMessage('');
  }
  function clearDiscount(){
    if(!discountTarget)return;
    if(discountTarget.scope==='sale')setSaleDiscount(0);
    else setCart(current=>current.map((i,n)=>n===discountTarget.index?{...i,discount:0}:i));
    setDiscountTarget(null);setDiscountInput(0);
  }

  function paymentPayload(paymentMethod:string,amount:number,brand:string,acquirer:string,inst:number){
    const card=paymentMethod==='credit_card'||paymentMethod==='debit_card';
    return {method:paymentMethod,amount,...(card?{provider:acquirer,card_brand_code:brand,card_acquirer_cnpj:acquirer,card_installments:paymentMethod==='credit_card'?inst:1}:{})};
  }
  function validateCard(paymentMethod:string,brand:string,acquirer:string,inst:number){
    if(paymentMethod!=='credit_card'&&paymentMethod!=='debit_card')return '';
    if(!brand)return 'Selecione a bandeira do cartão.';
    if(!acquirer)return 'Selecione a credenciadora do cartão em Opções de Vendas.';
    if(paymentMethod==='credit_card'&&!creditInstallments.some(x=>num(x.installments)===inst))return 'Selecione uma quantidade de parcelas habilitada em Opções de Vendas.';
    return '';
  }
  async function finish(){
    if(!cart.length)return;
    if(total<=0){setMessage('O total da venda precisa ser maior que zero.');return;}
    if(saleDiscount>subtotal){setMessage('Desconto da venda maior que o subtotal.');return;}
    if(condition==='immediate'&&!method){setMessage('Selecione uma forma de pagamento.');return;}
    if(condition==='term'&&!customer){setMessage('Venda a prazo exige cliente identificado.');return;}
    if(condition==='term'&&!selectedTerm){setMessage('Selecione um plano de venda a prazo configurado em Opções de Vendas.');return;}
    if(condition==='term'&&remaining<=0.009){setMessage('Não há saldo para financiar. Reduza a entrada ou use venda à vista.');return;}
    if(condition==='term'&&entryAmount>0&&!entryMethod){setMessage('Selecione a forma de pagamento da entrada.');return;}
    const cardError=condition==='immediate'?validateCard(method,cardBrand,cardAcquirer,cardInstallments):(entryAmount>0?validateCard(entryMethod,entryCardBrand,entryCardAcquirer,entryCardInstallments):'');
    if(cardError){setMessage(cardError);return;}
    setSaving(true);setMessage('');
    const payments=condition==='immediate'?[paymentPayload(method,total,cardBrand,cardAcquirer,cardInstallments)]:(entryAmount>0?[paymentPayload(entryMethod,entryAmount,entryCardBrand,entryCardAcquirer,entryCardInstallments)]:[]);
    const term=condition==='term'?{payment_term_id:termId}:null;
    const r=await erpCreateSale({customer_id:customer||null,price_table_id:tableId||resolvedTable||null,channel:'pdv',discount:saleDiscount,items:cart.map(i=>({product_id:i.product_id,quantity:i.quantity,discount:i.discount})),payments,term});
    setSaving(false);
    if(r.ok){
      const termInfo=r.term as Row|undefined;
      setMessage(condition==='term'?`Venda nº ${String(r.number)} concluída. ${String(termInfo?.installments??installments)} parcela(s) de ${str(selectedTerm?.method)==='boleto'?'Boleto':'Crediário'} foram enviadas para Contas a Receber.`:`Venda nº ${String(r.number)} concluída e quitada por ${money(r.total)}.`);
      setCart([]);setSaleDiscount(0);setEntryAmount(0);setSearch('');await loadCatalog();
    }else setMessage(`Não foi possível finalizar: ${String(r.error??'erro')}`);
  }

  const paymentOptions=<><option value="">Selecione...</option>{methods.map(x=><option key={str(x.code)} value={str(x.code)}>{str(x.name)}</option>)}</>;
  const cardFields=(entry=false)=>{
    const payMethod=entry?entryMethod:method;
    const brand=entry?entryCardBrand:cardBrand;
    const acquirer=entry?entryCardAcquirer:cardAcquirer;
    const inst=entry?entryCardInstallments:cardInstallments;
    const setBrand=entry?setEntryCardBrand:setCardBrand;
    const setAcquirer=entry?setEntryCardAcquirer:setCardAcquirer;
    const setInst=entry?setEntryCardInstallments:setCardInstallments;
    return <div className="erp-so-card-options erp-sale-card-options"><label>Bandeira<select value={brand} onChange={e=>setBrand(e.target.value)}><option value="">Selecione...</option>{brands.map(x=><option key={str(x.code)} value={str(x.code)}>{str(x.name)}</option>)}</select></label><label>Credenciadora<select value={acquirer} onChange={e=>setAcquirer(e.target.value)}><option value="">Selecione...</option>{acquirers.map(x=><option key={str(x.cnpj)} value={str(x.cnpj)}>{str(x.name)} — {str(x.cnpj)}</option>)}</select></label>{payMethod==='credit_card'&&<label>Parcelas<select value={inst} onChange={e=>setInst(Math.max(num(e.target.value),1))}>{creditInstallments.map(x=><option key={num(x.installments)} value={num(x.installments)}>{num(x.installments)}x{num(x.interest_percent)>0?` · taxa ${num(x.interest_percent).toLocaleString('pt-BR')}%`:''}</option>)}</select></label>}</div>;
  };

  const modalBase=discountTarget?.scope==='sale'?subtotal:(discountTarget?.scope==='item'&&discountTarget.index!==undefined?((cart[discountTarget.index]?.quantity??0)*(cart[discountTarget.index]?.price??0)):0);
  const modalPreview=discountMode==='percent'?modalBase*Math.min(Math.max(discountInput,0),100)/100:Math.min(Math.max(discountInput,0),modalBase);

  return <div className="erp-sale-fullscreen-shell">
    <header className="erp-sale-fullscreen-header">
      <Link href="/dashboard/vendas" className="erp-sale-back">← Voltar para o ThorGestão</Link>
      <div><small>THORGESTÃO</small><strong>Nova Venda · PDV incorporado</strong></div>
      <span className="erp-sale-fullscreen-status">● Operação de venda</span>
    </header>
    <div className="erp-sale-workspace erp-sale-pdv-look">
      <div className="erp-sale-commandbar">
        <div className="erp-sale-searchbox"><span>⌕</span><input value={search} onChange={e=>setSearch(e.target.value)} onKeyDown={searchKeyDown} placeholder="Digite código, nome ou código de barras do produto..." autoComplete="off" autoFocus/></div>
        <div className="erp-sale-command-meta">
          <label><span>Tabela</span><select value={tableId} onChange={e=>{setTableId(e.target.value);setCart([]);setSaleDiscount(0)}}><option value="">Tabela padrão vigente</option>{priceTables.filter(t=>t.active!==false).map(t=><option key={str(t.id)} value={str(t.id)}>{str(t.name)}</option>)}</select></label>
          <label className="customer"><span>Cliente {condition==='term'&&<b>• obrigatório no prazo</b>}</span><select value={customer} onChange={e=>setCustomer(e.target.value)}><option value="">Consumidor não identificado</option>{customers.filter(c=>c.active!==false).map(c=><option key={str(c.id)} value={str(c.id)}>{str(c.name)}</option>)}</select></label>
        </div>
      </div>

      <div className="erp-sale-main-grid">
        <section className="erp-sale-catalog-panel">
          <header className="erp-sale-panel-head"><div><small>PRODUTOS</small><h3>Pesquisa de produtos</h3></div><span>{hasSearch?`${filteredCatalog.length} encontrado(s)`:'Aguardando pesquisa'}</span></header>
          <div className="erp-sale-product-list">
            {!hasSearch?<div className="erp-sale-empty-state search"><span className="erp-sale-search-empty-icon">⌕</span><b>Pesquise para localizar um produto</b><span>Digite nome, código interno, SKU ou código de barras. Um clique no resultado já adiciona à venda.</span></div>:filteredCatalog.length===0?<div className="erp-sale-empty-state"><b>Nenhum produto encontrado</b><span>Confira o código/nome informado ou o estoque disponível.</span></div>:filteredCatalog.map(p=>{
              const image=productImage(p);
              return <button type="button" key={str(p.id)} className="erp-sale-product-row" onClick={()=>addProduct(p)} title="Clique para adicionar à venda">
                <span className="erp-sale-product-thumb"><span>▦</span>{image&&<img src={image} alt="" loading="lazy" onError={e=>{e.currentTarget.style.display='none'}}/>}</span>
                <span className="erp-sale-product-code">{str(p.product_code||p.sku||'—')}</span>
                <span className="erp-sale-product-name"><b>{str(p.name)}</b><small>{str(p.barcode||p.sku||'Sem código de barras')} · estoque {num(p.stock)} {str(p.unit||'UN')}</small></span>
                <strong>{money(p.effective_price)}</strong>
              </button>;
            })}
          </div>
          <div className="erp-sale-item-entry erp-sale-quick-add"><div className="erp-sale-selected-product"><span>ADIÇÃO RÁPIDA</span><b>1 clique no produto adiciona ao carrinho</b><small>Ajuste a quantidade antes de clicar quando necessário.</small></div><label>Qtd.<input type="number" min="0.001" step="0.001" value={qty} onChange={e=>setQty(num(e.target.value))}/></label></div>
        </section>

        <aside className="erp-sale-cart-panel">
          <header className="erp-sale-panel-head cart"><div><small>VENDA</small><h3>Itens ({cart.length})</h3></div>{cart.length>0&&<button type="button" onClick={()=>{setCart([]);setSaleDiscount(0)}}>Limpar</button>}</header>
          <div className="erp-sale-cart-list">
            {cart.length===0?<div className="erp-sale-empty-cart"><span>▤</span><b>Nenhum item na venda</b><small>Pesquise um produto e clique uma vez para adicionar.</small></div>:cart.map((i,n)=><article className="erp-sale-cart-item erp-sale-cart-item-actions" key={`${i.product_id}-${n}`}><div className="erp-sale-cart-index">{n+1}</div><div className="erp-sale-cart-copy"><b>{i.name}</b><small>{i.sku||'Sem referência'} · {i.quantity} {i.unit} × {money(i.price)}{i.discount>0?` · desconto ${money(i.discount)}`:''}</small></div><div className="erp-sale-cart-value"><strong>{money(i.quantity*i.price-i.discount)}</strong>{i.discount>0&&<small>-{money(i.discount)}</small>}</div><div className="erp-sale-cart-actions"><button type="button" className="discount" onClick={()=>openDiscount({scope:'item',index:n})}>Desconto</button><button type="button" className="remove" title="Remover item" onClick={()=>setCart(c=>c.filter((_,x)=>x!==n))}>×</button></div></article>)}
          </div>

          <div className="erp-sale-totals erp-sale-totals-actions"><div className="erp-sale-discount-summary"><span>Desconto total</span><button type="button" onClick={()=>openDiscount({scope:'sale'})}>{saleDiscount>0?`Editar · ${money(saleDiscount)}`:'+ Aplicar desconto'}</button></div><div><span>Subtotal</span><b>{money(subtotal)}</b></div><div className="liquid"><span>Total da venda</span><strong>{money(total)}</strong></div></div>

          <div className="erp-sale-payment-drawer">
            <div className="erp-so-condition erp-sale-condition"><button type="button" className={condition==='immediate'?'active':''} onClick={()=>{setCondition('immediate');setEntryAmount(0)}}>À vista</button><button type="button" className={condition==='term'?'active':''} onClick={()=>setCondition('term')}>Venda a Prazo</button></div>
            {condition==='immediate'?<>{methods.length?<div className="erp-sale-payment-methods">{methods.map(x=>{const code=str(x.code);return <button type="button" key={code} className={method===code?'active':''} onClick={()=>{setMethod(code);setMessage('')}}><PaymentIcon code={code}/><span>{str(x.name)}</span></button>})}</div>:<p className="erp-so-config-warning">Nenhuma forma de pagamento ativa. Configure as Opções de Vendas.</p>}{isImmediateCard&&cardFields(false)}{isImmediateCard&&!acquirers.length&&<p className="erp-so-config-warning">Habilite uma credenciadora em <Link href="/dashboard/configuracoes/opcoes-vendas">Opções de Vendas →</Link></p>}</>:<><label className="erp-sale-term-field">Plano de venda a prazo<select value={termId} onChange={e=>setTermId(e.target.value)}><option value="">Selecione um plano...</option>{terms.map(t=><option key={str(t.id)} value={str(t.id)}>{str(t.name)}</option>)}</select></label>{selectedTerm&&<div className="erp-so-finance-preview"><b>{str(selectedTerm.method)==='boleto'?'Boleto':'Crediário'}</b> · {installments}x · primeiro vencimento em {num(selectedTerm.first_due_days)} dias · intervalo {num(selectedTerm.interval_days)} dias · taxa {interest.toLocaleString('pt-BR')}%.</div>}<div className="erp-so-grid erp-sale-entry-grid"><label>Entrada agora<input type="number" min="0" max={total} step="0.01" value={entryAmount} onChange={e=>setEntryAmount(Math.min(Math.max(num(e.target.value),0),total))}/></label><label>Forma da entrada<select value={entryMethod} onChange={e=>setEntryMethod(e.target.value)}>{paymentOptions}</select></label></div>{entryAmount>0&&isEntryCard&&cardFields(true)}<div className="erp-so-finance-preview">Saldo {money(remaining)} + taxa {money(interestAmount)} = <strong>{money(financed)}</strong> em {installments}x de aprox. {money(financed/Math.max(installments,1))}. Somente esse saldo irá para Contas a Receber.</div></>}
          </div>

          <button className="erp-sale-finish" disabled={!cart.length||saving||(condition==='term'&&!customer)||!methods.length} onClick={finish}>{saving?'Finalizando...':`Concluir venda · ${money(total)}`}</button>
          {message&&<p className="erp-message erp-sale-message">{message}</p>}
        </aside>
      </div>
    </div>

    {discountTarget&&<div className="erp-sale-modal-backdrop" role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget)setDiscountTarget(null)}}><section className="erp-sale-discount-modal" role="dialog" aria-modal="true" aria-label="Aplicar desconto"><header><div><small>DESCONTO</small><h3>{discountTarget.scope==='sale'?'Desconto total da venda':'Desconto do item'}</h3></div><button type="button" onClick={()=>setDiscountTarget(null)}>×</button></header><div className="erp-sale-discount-modes"><button type="button" className={discountMode==='percent'?'active':''} onClick={()=>{setDiscountMode('percent');setDiscountInput(0)}}>Percentual (%)</button><button type="button" className={discountMode==='value'?'active':''} onClick={()=>{setDiscountMode('value');setDiscountInput(0)}}>Valor (R$)</button></div><label>{discountMode==='percent'?'Percentual de desconto':'Valor do desconto'}<div className="erp-sale-discount-input"><span>{discountMode==='percent'?'%':'R$'}</span><input type="number" min="0" max={discountMode==='percent'?100:modalBase} step="0.01" value={discountInput} onChange={e=>setDiscountInput(num(e.target.value))} autoFocus/></div></label><div className="erp-sale-discount-preview"><span>Base</span><b>{money(modalBase)}</b><span>Desconto</span><b>- {money(modalPreview)}</b><span>Resultado</span><strong>{money(Math.max(modalBase-modalPreview,0))}</strong></div><footer><button type="button" className="clear" onClick={clearDiscount}>Remover desconto</button><button type="button" className="apply" onClick={applyDiscount}>Aplicar desconto</button></footer></section></div>}
  </div>;
}
