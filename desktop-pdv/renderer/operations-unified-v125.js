(function(){
 const LABEL={sale:'Venda',receivable:'Recebimento',cash_supply:'Suprimento',cash_withdrawal:'Sangria / Saída',sale_cancel:'Cancelamento',sale_return:'Devolução',cash_open:'Abertura de caixa',cash_close:'Fechamento de caixa'};
 const ICON={sale:'▤',receivable:'$',cash_supply:'+',cash_withdrawal:'−',sale_cancel:'×',sale_return:'↩',cash_open:'◉',cash_close:'●'};
 const METHOD={cash:'Dinheiro',pix:'PIX',debit_card:'Débito',credit_card:'Crédito',voucher:'Voucher',store_credit:'Crédito da Loja',store_credit_voucher:'Vale Crédito',other:'Outros'};
 const safe=v=>typeof esc==='function'?esc(v):String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const fmt=v=>typeof money==='function'?money(Number(v||0)):Number(v||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
 const when=v=>{try{return new Date(v).toLocaleString('pt-BR')}catch{return String(v||'—')}};
 const amountOf=d=>Number(d?.payload?.total??d?.payload?.amount??d?.payload?.closing_amount??d?.payload?.opening_amount??0);
 const originOf=d=>String(d?.payload?.origin||d?.origin||'Local');
 const operatorOf=d=>String(d?.payload?.operator?.name||d?.payload?.operator_name||'—');
 const statusOf=d=>String(d?.payload?.status||'').toLowerCase();
 function detail(d){
   const p=d.payload||{},items=Array.isArray(p.items)?p.items:[],payments=Array.isArray(p.payments)?p.payments:[];
   const m=modal(`<div class="ocu125-head"><div><small>${safe(LABEL[d.type]||d.type)}</small><h3>${safe(d.reference||'Operação')}</h3><p>${safe(originOf(d))} • ${when(d.created_at)}</p></div><span class="live">DETALHES</span></div>
   <div class="ocu125-detail-grid"><article><span>Operador</span><b>${safe(operatorOf(d))}</b></article><article><span>Status</span><b>${safe(p.status||'—')}</b></article><article><span>Valor</span><b>${fmt(amountOf(d))}</b></article><article><span>Origem</span><b>${safe(originOf(d))}</b></article><article><span>Cliente</span><b>${safe(p.customer_name||'—')}</b></article><article><span>Canal</span><b>${safe(p.channel||'—')}</b></article></div>
   ${items.length?`<section class="ocu125-section"><h4>Itens</h4><div class="ocu125-mini-table">${items.map(i=>`<div class="ocu125-mini-row"><b>${safe(i.name||i.description||i.sku||'Item')}</b><span>${safe(i.quantity||0)} un.</span><span>${fmt(i.unit_price??i.unitPrice??0)}</span><strong>${fmt(i.total??0)}</strong></div>`).join('')}</div></section>`:''}
   ${payments.length?`<section class="ocu125-section"><h4>Formas de pagamento</h4><div class="ocu125-mini-table">${payments.map(x=>`<div class="ocu125-payment-row"><span>${safe(METHOD[x.method]||x.method||'Forma')}</span><strong>${fmt(x.amount)}</strong></div>`).join('')}</div></section>`:''}
   ${(p.reason||p.notes)?`<section class="ocu125-section"><h4>Observação / motivo</h4><div class="ocu125-mini-table"><div class="ocu125-payment-row"><span>${safe(p.reason||p.notes)}</span></div></div></section>`:''}
   <div class="actions"><button class="primary" id="ocu125Done">Fechar</button></div>`,'wide ocu125-detail-modal');
   m.querySelector('#ocu125Done').onclick=()=>m.remove();
 }
 async function openUnified(){
   if(typeof modal!=='function')return;
   const m=modal(`<div class="ocu125-head"><div><small>OPERAÇÕES DE CAIXA</small><h3>Histórico completo do caixa</h3><p>ThorPDV + ThorGestão + operações offline ainda pendentes.</p></div><span class="live">SERVIDOR + LOCAL</span></div>
   <div id="ocu125Kpis" class="ocu125-kpis"></div>
   <div class="ocu125-tools"><input id="ocu125Search" placeholder="Venda, operador, cliente ou referência"><select id="ocu125Type"><option value="all">Todas as operações</option>${Object.entries(LABEL).map(([k,v])=>`<option value="${k}">${v}</option>`).join('')}</select><select id="ocu125Origin"><option value="all">Todas as origens</option><option value="ThorPDV">ThorPDV</option><option value="ThorGestão">ThorGestão</option><option value="local">Local / offline</option></select><button class="secondary" id="ocu125Refresh">Atualizar</button></div>
   <div id="ocu125Body" class="ocu125-list"><div class="ocu125-empty">Carregando operações...</div></div><div class="actions"><button class="secondary" id="ocu125Close">Fechar</button></div>`,'wide ocu125-modal');
   let rows=[];
   async function load(){
     const body=m.querySelector('#ocu125Body');body.innerHTML='<div class="ocu125-empty">Atualizando operações...</div>';
     try{
       rows=await window.thor.operationHistory({query:m.querySelector('#ocu125Search').value,type:m.querySelector('#ocu125Type').value,limit:500});
       const origin=m.querySelector('#ocu125Origin').value;
       const filtered=origin==='all'?rows:rows.filter(r=>origin==='local'?String(r.origin)==='local':originOf(r)===origin);
       const sales=filtered.filter(r=>r.type==='sale'&&statusOf(r)!=='cancelled'),cancels=filtered.filter(r=>r.type==='sale_cancel'),closes=filtered.filter(r=>r.type==='cash_close');
       m.querySelector('#ocu125Kpis').innerHTML=`<article><span>Operações</span><strong>${filtered.length}</strong></article><article><span>Vendas</span><strong>${sales.length}</strong></article><article><span>Total vendido</span><strong>${fmt(sales.reduce((s,r)=>s+amountOf(r),0))}</strong></article><article><span>Cancelamentos / fechamentos</span><strong>${cancels.length} / ${closes.length}</strong></article>`;
       body.innerHTML=filtered.length?filtered.map(d=>{const originName=originOf(d),status=statusOf(d);return `<article class="ocu125-row"><span class="ocu125-icon">${ICON[d.type]||'•'}</span><div class="ocu125-type"><small>${safe(LABEL[d.type]||d.type)}</small><b>${safe(d.reference||'Sem referência')}</b><span class="ocu125-origin ${originName==='ThorGestão'?'gestao':''}">${safe(originName)}</span></div><div class="ocu125-info"><b>${safe(operatorOf(d))}</b><small>${when(d.created_at)}${d.payload?.customer_name?' • '+safe(d.payload.customer_name):''}</small></div><div class="ocu125-status ${status}">${safe(status||'registrado')}</div><div class="ocu125-value">${fmt(amountOf(d))}</div><button class="ocu125-detail" data-op-id="${safe(d.id)}">Detalhes</button></article>`}).join(''):'<div class="ocu125-empty">Nenhuma operação encontrada.</div>';
       body.querySelectorAll('[data-op-id]').forEach(b=>b.onclick=()=>detail(filtered.find(r=>String(r.id)===String(b.dataset.opId))||{}));
     }catch(e){body.innerHTML=`<div class="ocu125-empty">${safe(e?.message||'Falha ao carregar operações')}</div>`;}
   }
   let timer;m.querySelector('#ocu125Search').oninput=()=>{clearTimeout(timer);timer=setTimeout(load,180)};m.querySelector('#ocu125Type').onchange=load;m.querySelector('#ocu125Origin').onchange=load;m.querySelector('#ocu125Refresh').onclick=load;m.querySelector('#ocu125Close').onclick=()=>m.remove();load();
 }
 function decorate(){document.querySelectorAll('.v089-menu-grid').forEach(grid=>{if(grid.querySelector('[data-ocu125]'))return;const b=document.createElement('button');b.dataset.ocu125='1';b.innerHTML='<i>☷</i><b>Operações do caixa</b><small>Vendas, cancelamentos e fechamentos</small>';b.onclick=()=>{grid.closest('.modal')?.remove();setTimeout(openUnified,20)};grid.appendChild(b);});}
 window.openUnifiedCashOperationsV125=openUnified;new MutationObserver(decorate).observe(document.documentElement,{subtree:true,childList:true});decorate();
})();
