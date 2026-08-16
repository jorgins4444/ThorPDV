(function () {
  const previousFriendlyError = friendlyError;
  friendlyError = function (code) {
    const messages = {
      store_credit_requires_customer: 'Para uma devolução sem cliente cadastrado, escolha emitir um Vale Crédito. O valor será vinculado ao número do vale, não a um cadastro de cliente.',
      return_customer_identification_required: 'Informe o nome ou CPF da pessoa e escolha emitir Vale Crédito para pessoa sem cadastro.',
      store_credit_voucher_number_required: 'Não foi possível gerar a numeração do Vale Crédito. Tente concluir a devolução novamente.',
      printer_not_configured: 'Vale Crédito gerado, mas nenhuma impressora térmica está configurada para a impressão em 44 colunas.',
      thermal_printer_required: 'O Vale Crédito deve ser impresso em uma impressora térmica configurada no ThorPDV.',
    };
    return messages[String(code || '')] || previousFriendlyError(code);
  };
})();
