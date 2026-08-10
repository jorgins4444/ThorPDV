'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { salesOrderCancel, salesOrderDetail, salesOrderList, salesOrderSave } from './sales-order-actions';

type Row=Record<string,unknown>;
type Cart={product_id:string;product_code:string;sku:string;name:string;unit:string;quantity:number;unit_price:number;discount:number};
type SalesOptions={payment_methods:Row[];payment_terms:Row[];card_brands:Row[];card_acquirers:Row[];credit_installments:Row[]};
const money=(v:unknown)=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(v??0));
const n=(v:unknown)=>{const x=Number(v??0);return Number.isFinite(x)?x:0};
const s=(v:unknown)=>String(v??'');

export function SalesOrderWorkspace({initialOrders,customers,sellers,catalog,salesOptions}:{initialOrders:Row[];customers:Row[];sellers:Row[];catalog:Row[];salesOptions:SalesOptions}){
  const methods=salesOptions.payment_methods.filter(x=>x.active!==false&&s(x.code)!=='term_sale');
  const terms=salesOptions.payment_terms.filter(x=>x.active!==false);
  const brands=salesOptions.card_brands.filter(x=>x.active!==false);
  const acquirers=salesOptions.card_acquirers.filter(x=>x.active!==false);
  const creditInstallments=salesOptions.credit_installments.filter(x=>x.active!==false).sort((a,b)=>n(a.installments)-n(b.installments));
  const methodNames=useMemo(()=>Object.fromEntries(salesOptions.payment_methods.map(x=>[s(x.code),s(x.name)])),[salesOptions.payment_methods]);
  const defaultMethod=methods.find(x=>s(x.code)==='pix')??methods[0];
  const defaultBrand=brands[0];
  const defaultAcquirer=acquirers.find(x=>Boolean(x.preferred))??acquirers[0];
  const defaultCreditInstallment=creditInstallments[0];

  const [orders,setOrders]=useState(initialOrders);
  const [editing,setEditing]=useState('');
  const [customer,setCustomer]=useState('');
  const [seller,setSeller]=useState('');
  const [product,setProduct]=useState('');
  const [qty,setQty]=useState(1);
  const [itemDiscount,setItemDiscount]=useState(0);
  const [cart,setCart]=useState<Cart[]>([]);
  const [discount,setDiscount]=useState(0);
  const [surcharge,setSurcharge]=useState(0);
  const [condition,setCondition]=useState<'immediate'|'term'>('immediate');
  const [paymentMethod,setPaymentMethod]=useState(s(defaultMethod?.code||''));
  const [termId,setTermId]=useState('');
  const [cardBrand,setCardBrand]=useState(s(defaultBrand?.code||''));
  const [cardAcquirer,setCardAcquirer]=useState(s(defaultAcquirer?.cnpj||''));
  const [cardInstallments,setCardInstallments]=useState(Math.max(n(defaultCreditInstallment?.installments),1));
  const [notes,setNotes]=useState('');
  const [message,setMessage]=useState('');
  const [search,setSearch]=useState('');
  const [saving,setSaving]=useState(false);

  const subtotal=useMemo(()=>cart.reduce((a,i)=>a+i.quantity*i.unit_price-i.discount,0),[cart]);
  const total=Math.max(subtotal-discount+surcharge,0);
  const selectedTerm=terms.find(t=>s(t.id)===termId);
  const selectedInstallment=creditInstallments.find(x=>n(x.installments)===cardInstallments);
  const isCard=paymentMethod==='debit_card'||paymentMethod==='credit_card';

  function newOrder(){setEditing('');setCustomer('');setSeller('');setProduct('');setQty(1);setItemDiscount(0);setCart([]);setDiscount(0);setSurcharge(0);setCondition('immediate');setPaymentMethod(s(defaultMethod?.code||''));setTermId('');setCardBrand(s(defaultBrand?.code||''));setCardAcquirer(s(defaultAcquirer?.cnpj||''));setCardInstallments(Math.max(n(defaultCreditInstallment?.installments),1));setNotes('');setMessage('');}
  function addItem(){const p=catalog.find(x=>s(x.id)===product);if(!p)return;if(qty<=0){setMessage('Quantidade deve ser maior que zero.');return;}const price=n(p.effective_price??p.sale_price);if(itemDiscount>qty*price){setMessage('Desconto do item maior que o valor do item.');return;}setCart(c=>[...c,{product_id:s(p.id),product_code:s(p.product_code),sku:s(p.sku),name:s(p.name),unit:s(p.unit||'UN'),quantity:qty,unit_price:price,discount:itemDiscount}]);setProduct('');setQty(1);setItemDiscount(0);setMessage('');}
  async function refresh(q=search){const r=await salesOrderList(q);if(r.ok)setOrders(r.data);else setMessage(s(r.error||'Falha ao carregar pedidos.'));}

  async function save(){
    if(!customer){setMessage('O cliente é obrigatório no pedido de venda.');return;}
    if(!cart.length){setMessage('Adicione pelo menos um produto.');return;}
    if(discount>subtotal){setMessage('Desconto geral maior que o subtotal.');return;}
    if(condition==='immediate'&&!paymentMethod){setMessage('Selecione uma forma de pagamento habilitada em Opções de Vendas.');return;}
    if(condition==='term'&&!selectedTerm){setMessage('Selecione um plano de venda a prazo configurado em Opções de Vendas.');return;}
    if(condition==='immediate'&&isCard&&!cardBrand){setMessage('Selecione a bandeira do cartão.');return;}
    if(condition==='immediate'&&isCard&&!cardAcquirer){setMessage('Selecione a credenciadora do cartão em Opções de Vendas.');return;}
    if(condition==='immediate'&&paymentMethod==='credit_card'&&!selectedInstallment){setMessage('Selecione uma quantidade de parcelas de crédito habilitada em Opções de Vendas.');return;}
    setSaving(true);
    const r=await salesOrderSave({
      id:editing||null,customer_id:customer,seller_user_id:seller||null,
      payment_condition:condition,payment_method:condition==='immediate'?paymentMethod:null,
      payment_term_id:condition==='term'?termId:null,
      card_brand_code:condition==='immediate'&&isCard?cardBrand:null,
      card_acquirer_cnpj:condition==='immediate'&&isCard?cardAcquirer:null,
      card_installments:condition==='immediate'&&paymentMethod==='credit_card'?cardInstallments:condition==='immediate'&&paymentMethod==='debit_card'?1:null,
      discount,surcharge,notes:notes||null,
      items:cart.map(i=>({product_id:i.product_id,quantity:i.quantity,discount:i.discount}))
    });
    setSaving(false);
    if(r.ok){newOrder();setMessage(`Pedido nº ${s(r.number)} salvo por ${money(r.total)}. Ele já pode ser sincronizado e buscado no ThorPDV.`);await refresh('');}
    else setMessage(`Não foi possível salvar: ${s(r.error||'erro')}`);
  }

  async function loadOrder(id:string){
    const r=await salesOrderDetail(id);if(!r.ok||!r.order){setMessage(s(r.error||'Pedido não encontrado.'));return;}
    const o=r.order;setEditing(s(o.id));setCustomer(s(o.customer_id));setSeller(s(o.seller_user_id));setCondition(s(o.payment_condition)==='term'?'term':'immediate');setPaymentMethod(s(o.payment_method)||s(defaultMethod?.code||''));setTermId(s(o.payment_term_id));setCardBrand(s(o.card_brand_code)||s(defaultBrand?.code||''));setCardAcquirer(s(o.card_acquirer_cnpj)||s(defaultAcquirer?.cnpj||''));setCardInstallments(Math.max(n(o.card_installments)||n(defaultCreditInstallment?.installments),1));setDiscount(n(o.discount));setSurcharge(n(o.surcharge));setNotes(s(o.notes));setCart((Array.isArray(o.items)?o.items:[]).map(x=>{const i=x as Row;return{product_id:s(i.product_id),product_code:s(i.product_code),sku:s(i.sku),name:s(i.name),unit:s(i.unit||'UN'),quantity:n(i.quantity),unit_price:n(i.unit_price),discount:n(i.discount)}}));setMessage(`Editando pedido nº ${s(o.number)}.`);window.scrollTo({top:0,behavior:'smooth'});
  }
  async function cancel(id:string){const r=await salesOrderCancel(id);if(r.ok){setMessage('Pedido cancelado.');if(editing===id)newOrder();await refresh();}else setMessage(s(r.error||'Não foi possível cancelar.'));}

  function negotiationLabel(o:Row){if(s(o.payment_condition)==='term')return `${s(o.term_method)==='boleto'?'Boleto':'Crediário'} · ${s(o.installments||1)}x`;const method=s(o.payment_method);if(method==='credit_card')return `${methodNames[method]||'Cartão de crédito'} · ${n(o.card_installments)||1}x`;return methodNames[method]||'À vista';}

  return <div className="erp-so-shell">
    <section className="erp-module-card erp-so-form"><div className="erp-so-head"><div><small>{editing?'EDIÇÃO':'NOVO PEDIDO'}</small><h2>{editing?'Editar pedido de venda':'Pedido de venda'}</h2><p>O pedido registra a negociação sem movimentar estoque ou financeiro. As formas e condições disponíveis vêm de Administrativo → Configurações → Opções de Vendas.</p></div><button className="erp-ghost" onClick={newOrder}>Limpar / Novo</button></div>
      <div className="erp-so-grid"><label>Cliente obrigatório<select value={customer} onChange={e=>setCustomer(e.target.value)}><option value="">Selecione o cliente...</option>{customers.filter(x=>x.active!==false).map(x=><option key={s(x.id)} value={s(x.id)}>{s(x.name)}{x.document?` — ${s(x.document)}`:''}</option>)}</select></label><label>Vendedor (opcional)<select value={seller} onChange={e=>setSeller(e.target.value)}><option value="">Sem vendedor identificado</option>{sellers.map(x=><option key={s(x.id)} value={s(x.id)}>{s(x.name)}</option>)}</select></label></div>
      <div className="erp-so-add"><label>Produto<select value={product} onChange={e=>setProduct(e.target.value)}><option value="">Selecione...</option>{catalog.map(p=><option key={s(p.id)} value={s(p.id)}>Cód. {s(p.product_code||'—')} · {s(p.name)} · {money(p.effective_price??p.sale_price)} · {s(p.unit||'UN')}</option>)}</select></label><label>Qtd.<input type="number" min="0.001" step="0.001" value={qty} onChange={e=>setQty(n(e.target.value))}/></label><label>Desc. item<input type="number" min="0" step="0.01" value={itemDiscount} onChange={e=>setItemDiscount(n(e.target.value))}/></label><button className="erp-primary" onClick={addItem} disabled={!product}>Adicionar</button></div>
      <div className="erp-table-scroll"><table className="erp-data-table"><thead><tr><th>Cód.</th><th>Referência</th><th>Produto</th><th>Qtd./UN</th><th>Unitário</th><th>Desconto</th><th>Total</th><th></th></tr></thead><tbody>{cart.length?cart.map((i,idx)=><tr key={`${i.product_id}-${idx}`}><td>{i.product_code||'—'}</td><td>{i.sku||'—'}</td><td>{i.name}</td><td>{i.quantity} {i.unit}</td><td>{money(i.unit_price)}</td><td>{money(i.discount)}</td><td><strong>{money(i.quantity*i.unit_price-i.discount)}</strong></td><td><button className="erp-row-action" onClick={()=>setCart(c=>c.filter((_,x)=>x!==idx))}>Remover</button></td></tr>):<tr><td colSpan={8} className="erp-empty">Adicione os produtos desejados pelo cliente.</td></tr>}</tbody></table></div>
      <div className="erp-so-negotiation"><div className="erp-so-values"><label>Desconto geral<input type="number" min="0" step="0.01" value={discount} onChange={e=>setDiscount(n(e.target.value))}/></label><label>Acréscimo<input type="number" min="0" step="0.01" value={surcharge} onChange={e=>setSurcharge(n(e.target.value))}/></label><div><span>Subtotal</span><b>{money(subtotal)}</b></div><div className="total"><span>Total</span><strong>{money(total)}</strong></div></div>
        <div className="erp-so-payment"><div className="erp-so-condition"><button className={condition==='immediate'?'active':''} onClick={()=>setCondition('immediate')}>À vista</button><button className={condition==='term'?'active':''} onClick={()=>setCondition('term')}>Venda a Prazo</button></div>
          {condition==='immediate'?<>
            <label>Forma negociada<select value={paymentMethod} onChange={e=>setPaymentMethod(e.target.value)}><option value="">Selecione...</option>{methods.map(x=><option key={s(x.code)} value={s(x.code)}>{s(x.name)}</option>)}</select></label>
            {isCard&&<div className="erp-so-card-options"><label>Bandeira<select value={cardBrand} onChange={e=>setCardBrand(e.target.value)}><option value="">Selecione...</option>{brands.map(x=><option key={s(x.code)} value={s(x.code)}>{s(x.name)}</option>)}</select></label><label>Credenciadora<select value={cardAcquirer} onChange={e=>setCardAcquirer(e.target.value)}><option value="">Selecione...</option>{acquirers.map(x=><option key={s(x.cnpj)} value={s(x.cnpj)}>{s(x.name)} — {s(x.cnpj)}</option>)}</select></label>{paymentMethod==='credit_card'&&<label>Parcelas<select value={cardInstallments} onChange={e=>setCardInstallments(Math.max(n(e.target.value),1))}>{creditInstallments.map(x=><option key={n(x.installments)} value={n(x.installments)}>{n(x.installments)}x{n(x.interest_percent)>0?` · taxa ${n(x.interest_percent).toLocaleString('pt-BR')}%`:''}</option>)}</select></label>}</div>}
            {isCard&&!acquirers.length&&<p className="erp-so-config-warning">Nenhuma credenciadora está habilitada. <Link href="/dashboard/configuracoes/opcoes-vendas">Abrir Opções de Vendas →</Link></p>}
          </>:<>
            <label>Plano de venda a prazo<select value={termId} onChange={e=>setTermId(e.target.value)}><option value="">Selecione um plano...</option>{terms.map(t=><option key={s(t.id)} value={s(t.id)}>{s(t.name)}</option>)}</select></label>
            {selectedTerm?<div className="erp-so-finance-preview"><b>{s(selectedTerm.method)==='boleto'?'Boleto':'Crediário'}</b> · {n(selectedTerm.installments)} parcela(s) · primeiro vencimento em {n(selectedTerm.first_due_days)} dias · intervalo {n(selectedTerm.interval_days)} dias · taxa {n(selectedTerm.interest_percent).toLocaleString('pt-BR')}%.</div>:<p className="erp-so-config-warning">Escolha uma condição cadastrada em <Link href="/dashboard/configuracoes/opcoes-vendas">Opções de Vendas →</Link></p>}
          </>}
        </div>
      </div>
      <label className="erp-so-notes">Observações<textarea rows={3} value={notes} onChange={e=>setNotes(e.target.value)} placeholder="Observações comerciais, entrega, negociação..."></textarea></label><div className="erp-so-actions"><button className="erp-primary" onClick={save} disabled={saving||!customer||!cart.length}>{saving?'Salvando...':editing?'Atualizar pedido':'Salvar pedido de venda'}</button></div>{message&&<p className="erp-message">{message}</p>}
    </section>

    <section className="erp-module-card erp-so-list"><div className="erp-so-head"><div><small>PEDIDOS</small><h2>Pedidos de venda</h2></div><div className="erp-so-search"><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Número ou cliente"/><button className="erp-ghost" onClick={()=>refresh()}>Buscar</button></div></div><div className="erp-table-scroll"><table className="erp-data-table"><thead><tr><th>Nº</th><th>Cliente</th><th>Vendedor</th><th>Negociação</th><th>Itens</th><th>Total</th><th>Status</th><th></th></tr></thead><tbody>{orders.length?orders.map(o=><tr key={s(o.id)}><td><strong>#{s(o.number)}</strong></td><td>{s(o.customer_name)}</td><td>{s(o.seller_name)||'—'}</td><td>{negotiationLabel(o)}</td><td>{s(o.item_count)}</td><td>{money(o.total)}</td><td><span className={`erp-so-status ${s(o.status)}`}>{s(o.status)==='open'?'Aberto':s(o.status)==='converted'?'Convertido':'Cancelado'}</span></td><td><div className="erp-so-row-actions"><button onClick={()=>loadOrder(s(o.id))} disabled={s(o.status)!=='open'}>Editar</button><button onClick={()=>cancel(s(o.id))} disabled={s(o.status)!=='open'}>Cancelar</button></div></td></tr>):<tr><td colSpan={8} className="erp-empty">Nenhum pedido de venda encontrado.</td></tr>}</tbody></table></div></section>
  </div>;
}
