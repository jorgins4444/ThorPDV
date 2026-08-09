const v44FriendlyBase = friendlyError;
friendlyError = function (code) {
  const text = String(code || '');
  const messages = {
    discount_not_allowed: 'O perfil deste operador não possui permissão para aplicar desconto.',
    discount_exceeds_supervisor_limit: 'O desconto informado excede inclusive a alçada do supervisor selecionado.',
    invalid_supervisor_authorization: 'A autorização de supervisor não é válida para esta operação.',
  };
  return messages[text] || v44FriendlyBase(code);
};
