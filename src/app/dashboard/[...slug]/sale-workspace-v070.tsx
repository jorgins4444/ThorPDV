'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { erpCreateSale, erpSaleCatalog } from './actions';

type Row=Record<string,unknown>;
type CartItem={product_id:string;name:string;sku:string;unit:string;quantity:number;price:number;discount:number;stock:number};
type SalesOptions={payment_methods:Row[];payment_terms:Row[];card_brands:Row[];card_acquirers:Row[];credit_installments:Row[]};
const money=(v:unknown)=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(v??0));
const num=(v:unknown)=>{const n=Number(v??0);return Number.isFinite(n)?n:0};
const str=(v:unknown)=>String(v??'');
const normalize=(v:unknown)=>str(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();

function PaymentIcon({code}:{code:string}){
  const icon:Record<string,string>={cash:'$',pix:'◇',debit_card:'▣',credit_card:'▤',voucher:'◆',store_credit:'★',other:'•••'};
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
  const [product,setProduct]=useState('');
  const [search,setSearch]=useState('');
  const [qty,setQty]=useState(1);
  const [itemDiscount,setItemDiscount]=useState(0);
  const [cart,setCart]=useState<CartItem[]>([]);
  const [saleDiscount,setSaleDiscount]=useState(0);
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
  const selectedProduct=catalog.find(x=>str(x.id)===product);

  const filteredCatalog=useMemo(()=>{
    const q=normalize(search.trim());
    const rows=catalog.filter(p=>num(p.stock)>0);
    if(!q)return rows.slice(0,24);
    return rows.filter(p=>[p.product_code,p.name,p.sku,p.reference,p.ean,p.barcode].some(v=>normalize(v).includes(q))).slice(0,40);
  },[catalog,search]);

  function addProduct(p:Row|null|undefined){
    if(!p)return;
    const available=num(p.stock);
    if(qty<=0){setMessage('Quantidade inválida.');return;}
    if(qty>available){setMessage(`Estoque insuficiente. Disponível: ${available}.`);return;}
    const price=num(p.effective_price);
    if(itemDiscount>qty*price){setMessage('Desconto do item maior que o valor do item.');return;}
    const id=str(p.id);
    setCart(current=>{
      const index=current.findIndex(i=>i.product_id===id&&i.discount===itemDiscount);
      if(index<0)return [...current,{product_id:id,name:str(p.name),sku:str(p.sku??''),unit:str(p.unit??'UN'),quantity:qty,price,discount:itemDiscount,stock:available}];
      const next=[...current];
      const merged=next[index].quantity+qty;
      if(merged>available){setMessage(`Estoque insuficiente. Disponível: ${available}.`);return current;}
      next[index]={...next[index],quantity:merged};
      return next;
    });
    setProduct('');setQty(1);setItemDiscount(0);setSearch('');setMessage('');
  }
  function add(){addProduct(selectedProduct);}

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
    if(saleDiscount>subtotal){setMessage('Desconto da venda maior que o subtotal.');return;}
    if(condition==='term'&&!customer){setMessage('Venda a prazo exige cliente identificado.');return;}
    if(condition==='term'&&!selectedTerm){setMessage('Selecione um plano de venda a prazo configurado em Opções de Vendas.');return;}
    if(condition==='term'&&remaining<=0.009){setMessage('Não há saldo para financiar. Reduza a entrada ou use venda à vista.');return;}
    const cardError=condition==='immediate'?validateCard(method,cardBrand,cardAcquirer,cardInstallments):(entryAmount>0?validateCard(entryMethod,entryCardBrand,entryCardAcquirer,entryCardInstallments):'');
    if(cardError){setMessage(cardError);return;}
    setSaving(true);
    const payments=condition==='immediate'?[paymentPayload(method,total,cardBrand,cardAcquirer,cardInstallments)]:(entryAmount>0?[paymentPayload(entryMethod,entryAmount,entryCardBrand,entryCardAcquirer,entryCardInstallments)]:[]);
    const term=condition==='term'?{payment_term_id:termId}:null;
    const r=await erpCreateSale({customer_id:customer||null,price_table_id:tableId||resolvedTable||null,channel:'pdv',discount:saleDiscount,items:cart.map(i=>({product_id:i.product_id,quantity:i.quantity,discount:i.discount})),payments,term});
    setSaving(false);
    if(r.ok){
      const termInfo=r.term as Row|undefined;
      setMessage(condition==='term'?`Venda nº ${String(r.number)} concluída. ${String(termInfo?.installments??installments)} parcela(s) de ${str(selectedTerm?.method)==='boleto'?'Boleto':'Crediário'} foram enviadas para Contas a Receber.`:`Venda nº ${String(r.number)} concluída e quitada por ${money(r.total)}. Nenhum título foi criado em Contas a Receber.`);
      setCart([]);setSaleDiscount(0);setEntryAmount(0);await loadCatalog();
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

  return <div className="erp-sale-workspace erp-sale-pdv-look">
    <div className="erp-sale-commandbar">
      <div className="erp-sale-searchbox"><span>⌕</span><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Buscar produto por código, nome, referência ou EAN..." autoComplete="off"/></div>
      <div className="erp-sale-command-meta">
        <label><span>Tabela</span><select value={tableId} onChange={e=>{setTableId(e.target.value);setCart([]);}}><option value="">Tabela padrão vigente</option>{priceTables.filter(t=>t.active!==false).map(t=><option key={str(t.id)} value={str(t.id)}>{str(t.name)}</option>)}</select></label>
        <label className="customer"><span>Cliente {condition==='term'&&<b>• obrigatório no prazo</b>}</span><select value={customer} onChange={e=>setCustomer(e.target.value)}><option value="">Consumidor não identificado</option>{customers.filter(c=>c.active!==false).map(c=><option key={str(c.id)} value={str(c.id)}>{str(c.name)}</option>)}</select></label>
      </div>
    </div>

    <div className="erp-sale-main-grid">
      <section className="erp-sale-catalog-panel">
        <header className="erp-sale-panel-head"><div><small>PRODUTOS</small><h3>Catálogo da venda</h3></div><span>{filteredCatalog.length} exibido(s)</span></header>
        <div className="erp-sale-product-list">
          {filteredCatalog.length===0?<div className="erp-sale-empty-state"><b>Nenhum produto encontrado</b><span>Altere a pesquisa ou confira o estoque disponível.</span></div>:filteredCatalog.map(p=>{
            const active=str(p.id)===product;
            return <button type="button" key={str(p.id)} className={`erp-sale-product-row ${active?'active':''}`} onClick={()=>setProduct(str(p.id))} onDoubleClick={()=>{setProduct(str(p.id));addProduct(p)}}>
              <span className="erp-sale-product-code">{str(p.product_code||p.sku||'—')}</span>
              <span className="erp-sale-product-name"><b>{str(p.name)}</b><small>{str(p.sku||p.reference||p.ean||'Sem referência')} · estoque {num(p.stock)} {str(p.unit||'UN')}</small></span>
              <strong>{money(p.effective_price)}</strong>
            </button>;
          })}
        </div>
        <div className="erp-sale-item-entry">
          <div className="erp-sale-selected-product"><span>Produto selecionado</span><b>{selectedProduct?str(selectedProduct.name):'Selecione no catálogo'}</b>{selectedProduct&&<small>{money(selectedProduct.effective_price)} · estoque {num(selectedProduct.stock)} {str(selectedProduct.unit||'UN')}</small>}</div>
          <label>Qtd.<input type="number" min="0.001" step="0.001" value={qty} onChange={e=>setQty(num(e.target.value))}/></label>
          <label>Desc. item<input type="number" min="0" step="0.01" value={itemDiscount} onChange={e=>setItemDiscount(num(e.target.value))}/></label>
          <button className="erp-sale-add-button" type="button" onClick={add} disabled={!product}>+ Adicionar</button>
        </div>
      </section>

      <aside className="erp-sale-cart-panel">
        <header className="erp-sale-panel-head cart"><div><small>VENDA</small><h3>Itens ({cart.length})</h3></div>{cart.length>0&&<button type="button" onClick={()=>setCart([])}>Limpar</button>}</header>
        <div className="erp-sale-cart-list">
          {cart.length===0?<div className="erp-sale-empty-cart"><span>▤</span><b>Nenhum item na venda</b><small>Pesquise um produto e adicione ao carrinho.</small></div>:cart.map((i,n)=><article className="erp-sale-cart-item" key={`${i.product_id}-${n}`}>
            <div className="erp-sale-cart-index">{n+1}</div>
            <div className="erp-sale-cart-copy"><b>{i.name}</b><small>{i.sku||'Sem referência'} · {i.quantity} {i.unit} × {money(i.price)}{i.discount>0?` · desc. ${money(i.discount)}`:''}</small></div>
            <strong>{money(i.quantity*i.price-i.discount)}</strong>
            <button type="button" title="Remover item" onClick={()=>setCart(c=>c.filter((_,x)=>x!==n))}>×</button>
          </article>)}
        </div>

        <div className="erp-sale-totals">
          <label><span>Desconto geral</span><input type="number" min="0" step="0.01" value={saleDiscount} onChange={e=>setSaleDiscount(num(e.target.value))}/></label>
          <div><span>Subtotal</span><b>{money(subtotal)}</b></div>
          <div className="liquid"><span>Total da venda</span><strong>{money(total)}</strong></div>
        </div>

        <div className="erp-sale-payment-drawer">
          <div className="erp-so-condition erp-sale-condition"><button type="button" className={condition==='immediate'?'active':''} onClick={()=>{setCondition('immediate');setEntryAmount(0)}}>À vista</button><button type="button" className={condition==='term'?'active':''} onClick={()=>setCondition('term')}>Venda a Prazo</button></div>
          {condition==='immediate'?<>
            <div className="erp-sale-payment-methods">{methods.map(x=>{const code=str(x.code);return <button type="button" key={code} className={method===code?'active':''} onClick={()=>setMethod(code)}><PaymentIcon code={code}/><span>{str(x.name)}</span></button>})}</div>
            {isImmediateCard&&cardFields(false)}
            {isImmediateCard&&!acquirers.length&&<p className="erp-so-config-warning">Habilite uma credenciadora em <Link href="/dashboard/configuracoes/opcoes-vendas">Opções de Vendas →</Link></p>}
          </>:<>
            <label className="erp-sale-term-field">Plano de venda a prazo<select value={termId} onChange={e=>setTermId(e.target.value)}><option value="">Selecione um plano...</option>{terms.map(t=><option key={str(t.id)} value={str(t.id)}>{str(t.name)}</option>)}</select></label>
            {selectedTerm&&<div className="erp-so-finance-preview"><b>{str(selectedTerm.method)==='boleto'?'Boleto':'Crediário'}</b> · {installments}x · primeiro vencimento em {num(selectedTerm.first_due_days)} dias · intervalo {num(selectedTerm.interval_days)} dias · taxa {interest.toLocaleString('pt-BR')}%.</div>}
            <div className="erp-so-grid erp-sale-entry-grid"><label>Entrada agora<input type="number" min="0" max={total} step="0.01" value={entryAmount} onChange={e=>setEntryAmount(Math.min(Math.max(num(e.target.value),0),total))}/></label><label>Forma da entrada<select value={entryMethod} onChange={e=>setEntryMethod(e.target.value)}>{paymentOptions}</select></label></div>
            {entryAmount>0&&isEntryCard&&cardFields(true)}
            <div className="erp-so-finance-preview">Saldo {money(remaining)} + taxa {money(interestAmount)} = <strong>{money(financed)}</strong> em {installments}x de aprox. {money(financed/Math.max(installments,1))}. Somente esse saldo irá para Contas a Receber.</div>
          </>}
        </div>

        <button className="erp-sale-finish" disabled={!cart.length||saving||(condition==='term'&&!customer)} onClick={finish}>{saving?'Finalizando...':`Concluir venda · ${money(total)}`}</button>
        {message&&<p className="erp-message erp-sale-message">{message}</p>}
      </aside>
    </div>
  </div>;
}
