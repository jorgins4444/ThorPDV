function num(value){const n=Number(value||0);return Number.isFinite(n)?n:0}
function text(value){return String(value??'').trim()}
function esc(value){return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function money(value){return num(value).toLocaleString('pt-BR',{style:'currency',currency:'BRL'})}
function dateBr(value){const d=value instanceof Date?value:new Date(value);return Number.isNaN(d.getTime())?'—':d.toLocaleDateString('pt-BR')}
function addDays(base,days){const d=new Date(base);d.setHours(12,0,0,0);d.setDate(d.getDate()+Number(days||0));return d}
function schedule(principal,term,baseDate=new Date()){
  principal=Math.max(Math.round(num(principal)*100)/100,0);
  const count=Math.max(Number(term?.installments||1),1);
  const rate=Math.max(num(term?.interest_percent),0);
  const interest=Math.round(principal*rate)/100;
  const total=Math.round((principal+interest)*100)/100;
  const each=Math.round((total/count)*100)/100;
  const first=Math.max(Number(term?.first_due_days??30),0);
  const interval=Math.max(Number(term?.interval_days??30),1);
  let inserted=0;
  const rows=[];
  for(let i=1;i<=count;i++){
    const amount=i===count?Math.round((total-inserted)*100)/100:each;
    inserted=Math.round((inserted+amount)*100)/100;
    rows.push({installment:i,installments:count,amount,dueDate:addDays(baseDate,first+(i-1)*interval).toISOString().slice(0,10)});
  }
  return {principal,rate,interest,total,count,first,interval,rows};
}

function installSalesSettlementV073(ThorAgent){
  const previousSetCommercialContext=ThorAgent.prototype.setCommercialContext;
  const previousFinalizeSale=ThorAgent.prototype.finalizeSale;

  ThorAgent.prototype.setCommercialContext=function(input={}){
    const hasExplicitTerm=Object.prototype.hasOwnProperty.call(input,'term');
    if(!hasExplicitTerm)return previousSetCommercialContext.call(this,input);
    const order=input.salesOrderId?this.store.salesOrder(input.salesOrderId):null;
    const term=input.term&&typeof input.term==='object'?{...input.term}:null;
    this._commercialV070={salesOrderId:order?.id||input.salesOrderId||null,order,term};
    return {ok:true,order,term};
  };

  ThorAgent.prototype.finalizeSale=async function(input={}){
    const ctx=this._commercialV070||null;
    let settlement=null;
    if(ctx?.term){
      const quote=this.quoteCheckout({items:input.items||[],discount:input.discount||0,surcharge:input.surcharge||0});
      const paid=(input.payments||[]).reduce((sum,p)=>sum+num(p.amount),0);
      const remaining=Math.max(Math.round((num(quote.total)-paid)*100)/100,0);
      if(remaining<=0.009){
        // Pedido originalmente a prazo, mas quitado integralmente no caixa: vira venda imediata.
        ctx.term=null;
      }else{
        settlement=schedule(remaining,ctx.term,new Date());
      }
    }
    const result=await previousFinalizeSale.call(this,input);
    return {...result,termSettlement:settlement,salesOrderId:ctx?.salesOrderId||null};
  };

  ThorAgent.prototype.termDuplicateDocument=function(input={}){
    const term=input.term&&typeof input.term==='object'?input.term:{};
    const plan=schedule(input.principal,term,input.baseDate||new Date());
    const context=(()=>{try{return JSON.parse(this.store.get('context','{}')||'{}')}catch{return {}}})();
    const company=text(context.company_trade_name||context.company_name||'THORPDV');
    const legal=text(context.company_legal_name||'');
    const cnpj=text(context.company_cnpj||context.cnpj||'');
    const branch=text(context.branch_name||'');
    const issuerAddress=[context.branch_street,context.branch_number,context.branch_district,context.branch_city,context.branch_state].map(text).filter(Boolean).join(', ');
    const customer=text(input.customerName||'Cliente identificado');
    const customerDocument=text(input.customerDocument||'');
    const orderNumber=text(input.salesOrderNumber||input.salesOrderId||'');
    const method=text(term.method)==='boleto'?'BOLETO':'CREDIÁRIO';
    const created=dateBr(input.baseDate||new Date());

    const pages=plan.rows.map(row=>`<section class="duplicate-page">
      <header><div class="brand">${esc(company)}</div>${legal?`<div>${esc(legal)}</div>`:''}${cnpj?`<div>CNPJ: ${esc(cnpj)}</div>`:''}${branch?`<div>${esc(branch)}</div>`:''}${issuerAddress?`<div>${esc(issuerAddress)}</div>`:''}</header>
      <div class="doc-title">DUPLICATA DE VENDA A PRAZO</div>
      <div class="non-fiscal">DOCUMENTO NÃO FISCAL</div>
      <div class="grid">
        <div><span>Pedido</span><b>${esc(orderNumber||'—')}</b></div>
        <div><span>Emissão</span><b>${esc(created)}</b></div>
        <div><span>Modalidade</span><b>${esc(method)}</b></div>
        <div><span>Parcela</span><b>${row.installment}/${row.installments}</b></div>
        <div><span>Vencimento</span><b>${esc(dateBr(row.dueDate+'T12:00:00'))}</b></div>
        <div><span>Valor da parcela</span><b class="amount">${esc(money(row.amount))}</b></div>
      </div>
      <div class="customer"><span>Cliente</span><b>${esc(customer)}</b>${customerDocument?`<small>CPF/CNPJ: ${esc(customerDocument)}</small>`:''}</div>
      <div class="summary"><div>Principal financiado <b>${esc(money(plan.principal))}</b></div><div>Taxa <b>${plan.rate.toLocaleString('pt-BR')}%</b></div><div>Juros <b>${esc(money(plan.interest))}</b></div><div>Total financiado <b>${esc(money(plan.total))}</b></div></div>
      <div class="declaration">Referente à parcela ${row.installment} de ${row.installments} da venda a prazo${orderNumber?` vinculada ao pedido ${esc(orderNumber)}`:''}.</div>
      <div class="signature"><div>____________________________________<br>Assinatura / Recebimento</div></div>
      <footer>ThorPDV • Duplicata ${row.installment}/${row.installments} • ${esc(method)}</footer>
    </section>`).join('');

    const html=`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><style>
      @page{size:A5 portrait;margin:10mm}*{box-sizing:border-box}body{margin:0;font-family:Arial,sans-serif;color:#111;background:#fff}.duplicate-page{min-height:185mm;position:relative;page-break-after:always;border:1px solid #bbb;padding:9mm}.duplicate-page:last-child{page-break-after:auto}header{text-align:center;font-size:10px;line-height:1.35}.brand{font-size:18px;font-weight:800;margin-bottom:2px}.doc-title{text-align:center;font-size:16px;font-weight:800;margin-top:9mm}.non-fiscal{text-align:center;font-size:10px;font-weight:700;margin:2mm 0 6mm}.grid{display:grid;grid-template-columns:1fr 1fr;gap:4mm;border-top:1px solid #ddd;border-bottom:1px solid #ddd;padding:5mm 0}.grid div,.customer{display:flex;flex-direction:column;gap:1mm}.grid span,.customer span{font-size:9px;text-transform:uppercase;color:#666}.grid b,.customer b{font-size:12px}.grid .amount{font-size:18px}.customer{margin-top:6mm}.customer small{font-size:10px}.summary{margin-top:6mm;padding:4mm;background:#f4f4f4;font-size:10px;display:grid;grid-template-columns:1fr 1fr;gap:2mm}.summary div{display:flex;justify-content:space-between;gap:3mm}.declaration{font-size:10px;line-height:1.5;margin-top:8mm}.signature{text-align:center;margin-top:20mm;font-size:10px}footer{position:absolute;bottom:7mm;left:9mm;right:9mm;text-align:center;border-top:1px solid #ddd;padding-top:3mm;font-size:9px;color:#666}
    </style></head><body>${pages}</body></html>`;
    return {kind:'text',html,text:'',title:`Duplicatas ${orderNumber||'venda a prazo'}`,filename:`ThorPDV-Duplicatas-${orderNumber||Date.now()}-${plan.count}x.pdf`,installments:plan.rows.length,schedule:plan};
  };
}

module.exports={installSalesSettlementV073,schedule};
