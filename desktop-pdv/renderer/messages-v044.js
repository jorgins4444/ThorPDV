const v44FriendlyBase = friendlyError;
friendlyError = function (code) {
  const text = String(code || '');
  if(text.startsWith('insufficient_stock_at_location|')){
    const [,name,requested,available,unit]=text.split('|');
    const qty=(v)=>{const n=Number(v||0);return Number.isFinite(n)?n.toLocaleString('pt-BR',{maximumFractionDigits:3}):String(v||'0');};
    return `Estoque insuficiente para ${name||'o produto'}. Solicitado: ${qty(requested)} ${unit||'UN'}. Disponível: ${qty(available)} ${unit||'UN'}. Ajuste a quantidade ou habilite estoque negativo no ThorGestão.`;
  }
  const messages = {
    discount_not_allowed: 'O perfil deste operador não possui permissão para aplicar desconto.',
    discount_exceeds_supervisor_limit: 'O desconto informado excede inclusive a alçada do supervisor selecionado.',
    invalid_supervisor_authorization: 'A autorização de supervisor não é válida para esta operação.',
    insufficient_stock_at_location: 'Estoque insuficiente para concluir esta venda. Ajuste a quantidade ou habilite estoque negativo no ThorGestão.',
    sync_recovery_failed: 'A venda não pôde ser reprocessada. Consulte o motivo da rejeição de estoque/sincronização antes de tentar novamente.',
  };
  return messages[text] || v44FriendlyBase(code);
};
