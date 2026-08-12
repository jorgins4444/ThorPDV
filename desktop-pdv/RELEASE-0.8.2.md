# ThorPDV Desktop 0.8.2

## Mudanças e novidades
- Atualização contínua com Atualizador Thor visual durante a troca dos arquivos do aplicativo.
- Versão atual do ThorPDV sempre visível na barra superior.
- ThorControl passa a cadastrar notas de versão em Mudanças, Melhorias e Correções.

## Melhorias
- Base SQLite, caixa aberto, configurações e operações persistidas são preservados durante a instalação.
- Sincronização de sistema é executada antes da instalação e novamente após iniciar a nova versão.
- Sessão do operador pode ser retomada após update iniciado na 0.8.2 ou superior usando token curto criptografado pelo Windows safeStorage.
- Nova versão inicia oculta enquanto valida a instalação e sincroniza; o Atualizador Thor permanece visível até a conclusão.
- Rollback continua usando o mesmo mecanismo de pacote validado por SHA-256.

## Correções
- Evita a sensação de que a atualização parou quando o processo principal precisa fechar para substituir os binários.
- Impede iniciar atualização com venda ainda somente no carrinho, evitando perda de uma venda não persistida.
- Remove dependência da permissão manual do operador para a sincronização técnica do updater.
- Um marker JSON isolado não é mais suficiente para retomar sessão de operador.
