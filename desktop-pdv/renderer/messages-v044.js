const v44FriendlyBase=friendlyError;
let v44LastError=null;
function v44Clean(value){
  const original=String(value?.message||value||'').trim();
  let clean=original,channel='';
  const m=clean.match(/Error invoking remote method\s+['"]([^'"]+)['"]:\s*/i);
  if(m){channel=m[1];clean=clean.slice((m.index||0)+m[0].length);}
  clean=clean.replace(/^(?:Error:\s*)+/i,'').trim();
  return {original,clean,channel};
}
function v44Translate(code,parts){
  const fixed={
    insufficient_stock_at_location:'Produto sem estoque suficiente.',
    insufficient_stock:'Estoque insuficiente.',
    composition_required:'Produto configurado para produção sem composição cadastrada.',
    fractional_quantity_not_allowed:'Este produto não permite quantidade fracionada.',
    product_not_found:'Produto não encontrado ou não sincronizado.',
    cash_not_open:'O caixa está fechado.',
    cash_day_expired:'A sessão de caixa pertence a um dia anterior.',
    operator_required:'Identifique um operador antes de continuar.',
    invalid_credentials:'Usuário ou PIN inválido.',
    supervisor_authorization_required:'Esta operação exige autorização de supervisor.',
    payment_exceeds_total:'Os pagamentos ultrapassam o total da venda.',
    payment_method_not_enabled:'Esta forma de pagamento está desabilitada.',
    term_sale_requires_customer:'Venda a prazo exige um cliente identificado.',
    sale_not_found:'Venda não encontrada.',
    sync_recovery_failed:'A recuperação da venda não foi concluída.',
    pre_sale_reprocess_failed:'A venda foi recuperada, mas a Pré-venda não pôde ser reprocessada.',
    nfce_not_authorized:'A NFC-e ainda não foi autorizada.',
    nfce_request_failed:'Não foi possível solicitar a NFC-e.',
    printer_not_configured:'Nenhuma impressora foi configurada.',
    forbidden:'Você não possui permissão para esta operação.'
  };
  if(code==='insufficient_stock_at_location'){
    const [name,requested,available,unit]=parts,u=unit||'UN';
    return `Produto sem estoque suficiente${name?`: ${name}`:''}. Solicitado: ${requested||'—'} ${u} · Disponível: ${available||'—'} ${u}.`;
  }
  if(fixed[code])return fixed[code];
  if(/failed to fetch|networkerror/i.test(code))return 'Não foi possível conectar ao servidor.';
  if(code.includes('not_found'))return 'O registro necessário não foi encontrado. Atualize e tente novamente.';
  if(code.includes('required'))return 'Falta uma informação obrigatória para concluir a operação.';
  if(code.includes('invalid'))return 'Existe uma informação inválida nesta operação.';
  if(code.includes('not_authorized')||code.includes('not_allowed'))return 'O operador não possui autorização para esta operação.';
  if(code.includes('expired'))return 'Esta sessão ou informação expirou e precisa ser atualizada.';
  return 'Não foi possível concluir a operação. Consulte os detalhes técnicos.';
}
function v44Parse(value){
  const r=v44Clean(value),parts=r.clean.split('|').map(x=>x.trim()),code=String(parts.shift()||'unknown');
  const message=v44Translate(code,parts);
  const tech=[`Código: ${code}`,r.channel?`Origem: ${r.channel}`:'',`Versão: ${state?.status?.appVersion||'—'}`,`Filial: ${state?.status?.context?.branch_name||'—'}`,`PDV: ${state?.status?.context?.pos_name||'—'}`,parts.length?`Parâmetros: ${parts.join(' | ')}`:'',`Mensagem original: ${r.original}`].filter(Boolean).join('\n');
  return {code,message,technical:tech};
}
friendlyError=function(value){const r=v44Parse(value);v44LastError={...r,at:Date.now()};console.error('[ThorPDV]\n'+r.technical);return `${r.message}\n\nCódigo técnico: ${r.code}`||v44FriendlyBase(value);};
window.ThorErrorCenter={parse:v44Parse,last:()=>v44LastError};
