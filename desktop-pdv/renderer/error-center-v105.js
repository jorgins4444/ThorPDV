(()=>{
  const previousInfo=typeof infoModal==='function'?infoModal:null;
  let lastReport=null;
  function raw(v){return v&&typeof v==='object'&&v.message?String(v.message):String(v??'').trim();}
  function unwrap(text){
    let channel='';let clean=String(text||'').trim();
    const match=clean.match(/Error invoking remote method\s+['"]([^'"]+)['"]:\s*/i);
    if(match){channel=match[1];clean=clean.slice((match.index||0)+match[0].length);}
    clean=clean.replace(/^(?:Error:\s*)+/i,'').trim();
    return {clean,channel};
  }
  function fallback(code){
    if(!code)return 'Não foi possível concluir a operação.';
    if(/[áàâãéêíóôõúç ]/i.test(code)&&!code.includes('_'))return code;
    if(/^http_\d+$/i.test(code))return 'O servidor retornou uma falha de comunicação.';
    if(/failed to fetch|networkerror|network request failed/i.test(code))return 'Não foi possível conectar ao servidor.';
    if(code.includes('not_found'))return 'O registro necessário não foi encontrado. Atualize os dados e tente novamente.';
    if(code.includes('required'))return 'Falta uma informação obrigatória para concluir a operação.';
    if(code.includes('invalid'))return 'Existe uma informação inválida nesta operação.';
    if(code.includes('not_authorized')||code.includes('not_allowed'))return 'O operador não possui autorização para esta operação.';
    return 'Não foi possível concluir a operação. Consulte os detalhes técnicos.';
  }
  function parse(value){
    const original=raw(value),unwrapped=unwrap(original),parts=unwrapped.clean.split('|').map(x=>x.trim());
    const code=String(parts.shift()||'unknown').trim();
    const item=(window.ThorErrorCatalog||{})[code];
    let message=item?.[0]||fallback(code),action=item?.[1]||'Tente novamente. Se persistir, copie os detalhes técnicos e encaminhe ao suporte.',category=item?.[2]||'Sistema';
    const context={};
    if(code==='insufficient_stock_at_location'){
      context.product=parts[0]||'';context.requested=parts[1]||'';context.available=parts[2]||'';context.unit=parts[3]||'';
      const unit=context.unit||'un.';
      if(context.product)message=`Produto sem estoque suficiente: ${context.product}.`;
      if(context.requested||context.available)message+=` Solicitado: ${context.requested||'—'} ${unit} · Disponível: ${context.available||'—'} ${unit}.`;
    }else if(code==='insufficient_component_stock'){
      context.component=parts[0]||'';context.requested=parts[1]||'';context.available=parts[2]||'';
      if(context.component)message=`Componente sem estoque suficiente: ${context.component}.`;
    }else if(code==='composition_required'){
      context.product=parts[0]||'';
      if(context.product)message=`${context.product} está configurado para produção, mas não possui composição cadastrada.`;
    }else if(parts.length)context.parameters=parts;
    const version=typeof state!=='undefined'?String(state?.status?.appVersion||''):'',branch=typeof state!=='undefined'?String(state?.status?.context?.branch_name||''):'',pos=typeof state!=='undefined'?String(state?.status?.context?.pos_name||''):'';
    const technical=[
      `Código: ${code}`,
      unwrapped.channel?`Canal IPC: ${unwrapped.channel}`:'',
      `Categoria: ${category}`,
      version?`Versão ThorPDV: ${version}`:'',branch?`Filial: ${branch}`:'',pos?`PDV: ${pos}`:'',
      context.product?`Produto: ${context.product}`:'',context.component?`Componente: ${context.component}`:'',
      context.requested?`Quantidade solicitada: ${context.requested}${context.unit?` ${context.unit}`:''}`:'',
      context.available?`Saldo informado: ${context.available}${context.unit?` ${context.unit}`:''}`:'',
      context.parameters?.length?`Parâmetros: ${context.parameters.join(' | ')}`:'',
      `Ação sugerida: ${action}`,
      `Ocorrido em: ${new Date().toLocaleString('pt-BR')}`,
      `Mensagem original: ${original}`
    ].filter(Boolean).join('\n');
    return {code,channel:unwrapped.channel,category,message,action,technical};
  }
  friendlyError=function(value){
    const report=parse(value);lastReport={...report,at:Date.now()};
    try{console.error(`[ThorPDV][${report.category}][${report.code}]\n${report.technical}`);}catch{}
    return report.message;
  };
  if(previousInfo)infoModal=function(title,text){
    const recent=lastReport&&Date.now()-lastReport.at<1200&&String(text||'')===String(lastReport.message||'');
    if(!recent)return previousInfo(title,text);
    const report=lastReport;
    const m=modal(`<h3>${esc(title)}</h3><p class="muted">${esc(report.message)}</p><div class="thor-error-action"><b>O que fazer</b><span>${esc(report.action)}</span></div><details class="thor-error-tech"><summary>Detalhes técnicos para suporte</summary><div class="thor-error-tech-body"><div><b>Código</b><code>${esc(report.code)}</code></div>${report.channel?`<div><b>Origem</b><code>${esc(report.channel)}</code></div>`:''}<pre>${esc(report.technical)}</pre><button type="button" class="secondary" data-copy-thor-error>Copiar diagnóstico</button></div></details><div class="actions"><button class="primary" id="ok">OK</button></div>`);
    m.querySelector('#ok').onclick=()=>m.remove();
    const copy=m.querySelector('[data-copy-thor-error]');if(copy)copy.onclick=async()=>{try{await navigator.clipboard.writeText(report.technical);copy.textContent='Diagnóstico copiado';}catch{copy.textContent='Não foi possível copiar';}};
    return m;
  };
  const style=document.createElement('style');
  style.textContent='.thor-error-action{display:flex;flex-direction:column;gap:5px;margin:12px 0;padding:12px 14px;border-radius:10px;background:rgba(245,158,11,.10);border:1px solid rgba(245,158,11,.24)}.thor-error-action b{font-size:12px;text-transform:uppercase}.thor-error-tech{margin:12px 0;text-align:left}.thor-error-tech summary{cursor:pointer;font-weight:700;font-size:13px}.thor-error-tech-body{display:grid;gap:9px;margin-top:10px;padding:12px;border-radius:10px;background:rgba(15,23,42,.06)}.thor-error-tech-body code,.thor-error-tech-body pre{font-family:Consolas,monospace;font-size:11px;white-space:pre-wrap;word-break:break-word}.thor-error-tech-body pre{max-height:220px;overflow:auto;padding:10px;border-radius:8px;background:rgba(15,23,42,.08);margin:0}';
  document.head.appendChild(style);
  window.ThorErrorCenter={parse,friendly:(value)=>friendlyError(value),last:()=>lastReport};
  window.addEventListener('unhandledrejection',event=>{try{const report=parse(event.reason);console.error('[ThorPDV][Unhandled Promise]\n'+report.technical);}catch{}});
})();
