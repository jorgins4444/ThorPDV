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
  ThorAgent.prototype.closeCash = async function (payload={}) {
    if (!blind(this)) return originalClose.call(this,payload);
    // Calcula totais e diferenças somente no agente, sem confiar no renderer.
    const preview=await originalPreview.call(this);
    const {closingAmount,reconciliation}=await secureCounts(this,payload,preview);
    const result=await originalClose.call(this,{...payload,closingAmount,reconciliation});
    return {ok:true,eventId:result.eventId,blind_close:true,print_pending:true};
  };
  if(typeof originalHistorical==='function')ThorAgent.prototype.closeHistoricalCash=async function(payload={}){
    if(!blind(this))return originalHistorical.call(this,payload);
    const target=String(payload.cashOpenEventId||'');
    if(!target)throw new Error('cash_not_found');
    const preview=await originalPreview.call(this,{cashOpenEventId:target});
    const {closingAmount,reconciliation}=await secureCounts(this,payload,preview);
    await originalHistorical.call(this,{...payload,closingAmount,reconciliation});
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
