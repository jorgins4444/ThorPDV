function installBlindCashCloseV122(ThorAgent) {
  if (ThorAgent.prototype.__blindCashCloseV122) return;
  ThorAgent.prototype.__blindCashCloseV122 = true;
  const originalPreview = ThorAgent.prototype.cashClosingPreview;
  const originalClose = ThorAgent.prototype.closeCash;
  const originalLast = ThorAgent.prototype.lastCashCloseSummary;
  const originalDoc = ThorAgent.prototype.cashCloseDocument;
  const originalSessions = ThorAgent.prototype.cashSessions;
  const originalHistorical = ThorAgent.prototype.closeHistoricalCash;
  const blind = (agent) => agent.currentOperator?.()?.permissions?.cash?.blind_close === true;
  const methods = ['cash','pix','debit_card','credit_card','voucher','store_credit','store_credit_voucher','term_sale','boleto','other'];
  const mask = (summary) => ({
    blind_close:true,
    client_event_id:summary?.client_event_id||'',
    business_date:summary?.business_date||'',
    status:summary?.status||'',
    source:summary?.source||'local',
    pending_events:Number(summary?.pending_events||0),
    rejected_events:Number(summary?.rejected_events||0),
    payment_methods:[...new Set([...(summary?.payments||[]).map(p=>String(p.method||'')),...methods])].filter(Boolean),
  });
  ThorAgent.prototype.cashClosingPreview = async function (...args) {
    const summary=await originalPreview.apply(this,args);
    return blind(this)?mask(summary):summary;
  };
  // Não expor valores do histórico no navegador de sessões do operador cego.
  if(typeof originalSessions==='function')ThorAgent.prototype.cashSessions=async function (...args){
    const result=await originalSessions.apply(this,args);
    if(!blind(this))return result;
    return {...result,sessions:(result.sessions||[]).map(s=>({
      client_event_id:s.client_event_id,business_date:s.business_date,opened_at:s.opened_at,
      status:s.status,operator_name:s.operator_name,blind_close:true
    }))};
  };
  const secureCounts=async(agent,payload,preview)=>{
    const operator=agent.currentOperator?.();
    if(!operator?.permissions?.cash?.close)throw new Error('operator_not_allowed_to_close_cash');
    const counted=Array.isArray(payload.countedPayments)?payload.countedPayments:[];
    if(!counted.length)throw new Error('cash_count_required');
    const allowed=new Set([...methods,...(preview.payments||[]).map(p=>String(p.method||''))]);
    const amounts=new Map();
    for(const item of counted){
      const method=String(item?.method||'');const value=Number(item?.counted);
      if(!method||!allowed.has(method)||amounts.has(method)||!Number.isFinite(value)||value<0)throw new Error('invalid_cash_count');
      amounts.set(method,value);
    }
    const closingAmount=Number(payload.closingAmount);
    if(!Number.isFinite(closingAmount)||closingAmount<0)throw new Error('invalid_cash_count');
    const reconciliation={...preview,counted_payments:[...(preview.payments||[])].map(p=>{
      const method=String(p.method||'');const expected=Number(p.amount||0);const counted=amounts.get(method)??0;
      return {method,expected,counted,difference:counted-expected};
    }),closing_amount:closingAmount,difference:closingAmount-Number(preview.expected_cash||0),blind_close:true};
    return {closingAmount,reconciliation};
  };
  const paymentNames={cash:'Dinheiro',pix:'PIX',debit_card:'Cartao de debito',credit_card:'Cartao de credito',voucher:'Voucher',store_credit:'Credito em loja',store_credit_voucher:'Vale-credito',term_sale:'Venda a prazo',boleto:'Boleto',other:'Outras formas'};
  const money=(v)=>Number(v||0).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
  const safe=(v)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const clean=(v)=>String(v??'').replace(/[\r\n\t]+/g,' ').trim();
  const captureBlindCount=(agent,payload,preview,closingAmount)=>{
    const operator=agent.currentOperator?.()||{};
    let context={};try{context=JSON.parse(agent.store?.get('context','{}')||'{}');}catch{}
    agent._blindCashReceipt={
      operatorId:String(operator.id||''),
      operatorName:clean(operator.name||operator.full_name||'Operador'),
      company:clean(context.company_trade_name||context.company_name||'ThorPDV'),
      branch:clean(context.branch_name||''),
      businessDate:clean(preview.business_date||''),
      recordedAt:new Date().toISOString(),
      countedPayments:payload.countedPayments.map(p=>({method:clean(p.method),counted:Number(p.counted)})),
      closingAmount,
    };
  };
  ThorAgent.prototype.blindCashCountDocument=function(){
    if(!blind(this))throw new Error('cash_close_count_receipt_not_allowed');
    const receipt=this._blindCashReceipt;
    const operator=this.currentOperator?.();
    if(!receipt||!operator||String(operator.id)!==receipt.operatorId)throw new Error('cash_close_count_receipt_not_found');
    const lines=[receipt.company,receipt.branch,'--------------------------------------------',
      'FECHAMENTO AS CEGAS - VALORES CONFERIDOS',
      'Data caixa: '+(receipt.businessDate||'-'),
      'Operador: '+receipt.operatorName,
      'Emissao: '+new Date(receipt.recordedAt).toLocaleString('pt-BR'),
      '--------------------------------------------'];
    for(const item of receipt.countedPayments){
      const name=paymentNames[item.method]||item.method;
      lines.push((name+': ').slice(0,29)+'R$ '+money(item.counted));
    }
    lines.push('--------------------------------------------');
    lines.push('Dinheiro fisico contado: R$ '+money(receipt.closingAmount));
    lines.push('--------------------------------------------');
    lines.push('Comprovante de contagem do operador');
    lines.push('Sem valores esperados ou diferencas');
    lines.push('Conferencia gerencial em relatorio separado');
    lines.push('','________________________________');
    lines.push('Assinatura do operador','','');
    const text=lines.filter((line,i)=>line!==undefined).join('\n');
    const html='<!doctype html><html><head><meta charset="utf-8"><style>@page{margin:2mm}body{width:72mm;margin:0 auto;padding:2mm 1mm;font:10.5px/1.3 monospace;color:#000}pre{white-space:pre-wrap;word-break:normal;margin:0}</style></head><body><pre>'+safe(text)+'</pre></body></html>';
    return {kind:'text',text,html,title:'Fechamento as cegas - contagem',filename:'ThorPDV-Contagem-Cega-'+Date.now()+'.pdf'};
  };
  ThorAgent.prototype.closeCash = async function (payload={}) {
    if (!blind(this)) return originalClose.call(this,payload);
    // Calcula totais e diferenças somente no agente, sem confiar no renderer.
    const preview=await originalPreview.call(this);
    const {closingAmount,reconciliation}=await secureCounts(this,payload,preview);
    const result=await originalClose.call(this,{...payload,closingAmount,reconciliation});
    captureBlindCount(this,payload,preview,closingAmount);
    return {ok:true,eventId:result.eventId,blind_close:true,print_pending:true};
  };
  if(typeof originalHistorical==='function')ThorAgent.prototype.closeHistoricalCash=async function(payload={}){
    if(!blind(this))return originalHistorical.call(this,payload);
    const target=String(payload.cashOpenEventId||'');
    if(!target)throw new Error('cash_not_found');
    const preview=await originalPreview.call(this,{cashOpenEventId:target});
    const {closingAmount,reconciliation}=await secureCounts(this,payload,preview);
    await originalHistorical.call(this,{...payload,closingAmount,reconciliation});
    captureBlindCount(this,payload,preview,closingAmount);
    return {ok:true,blind_close:true,print_pending:true};
  };
  ThorAgent.prototype.lastCashCloseSummary = function (...args) {
    const result=originalLast.apply(this,args);
    return blind(this)&&result?mask(result):result;
  };
  ThorAgent.prototype.cashCloseDocument = function (summaryInput=null) {
    if (blind(this)) throw new Error('cash_close_report_not_allowed');
    return originalDoc.call(this,summaryInput);
  };
}
module.exports={installBlindCashCloseV122};
