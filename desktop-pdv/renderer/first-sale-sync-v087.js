(function () {
  const originalSaleStatusLabel = typeof saleStatusLabel === 'function' ? saleStatusLabel : null;

  saleStatusLabel = function (status) {
    const value = String(status || '');
    const labels = {
      completed: 'Concluída',
      cancelled: 'Cancelada',
      pending_sync: 'Aguardando sincronização',
      rejected: 'Erro de sincronização',
      cancel_pending: 'Cancelando',
      return_pending: 'Devolução pendente',
    };
    return labels[value] || (originalSaleStatusLabel ? originalSaleStatusLabel(status) : (value || 'Pendente'));
  };

  const originalFriendlyError = typeof friendlyError === 'function' ? friendlyError : null;
  friendlyError = function (code) {
    const value = String(code || '');
    const labels = {
      cash_open_sync_rejected: 'A abertura do caixa não foi confirmada pelo Gestão. Sincronize o caixa e tente novamente; a venda não foi criada para evitar uma rejeição incorreta.',
      cash_not_open: 'O caixa ainda não está aberto. Abra ou sincronize o caixa antes de finalizar a venda.',
    };
    return labels[value] || (originalFriendlyError ? originalFriendlyError(code) : (value || 'Erro inesperado'));
  };
})();
