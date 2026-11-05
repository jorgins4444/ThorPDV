# Alinhamento de permissões — ThorGestão e ThorPDV (fase 1)

## Objetivo
ThorGestão é a fonte de verdade para papéis, vínculos por empresa/filial e permissões. ThorPDV aplica a mesma decisão na interface **e no agente**, inclusive em operações offline, sem confiar em flags enviadas pelo renderer.

## Catálogo proposto (contrato, não migração aplicada)
Cada chave possui escopo e ação independentes. **Ausência de permissão = negar**, exceto regras de compatibilidade explicitamente migradas e auditadas.

| Domínio | Chaves sugeridas | Escopo |
| --- | --- | --- |
| Venda | sale.view, sale.create, sale.discount, sale.price_override, sale.item_cancel, sale.cancel, sale.return | filial/terminal |
| Caixa | cash.open, cash.close, cash.supply, cash.withdraw, cash.reopen, cash.view | filial/terminal |
| Fiscal | fiscal.view, fiscal.issue, fiscal.cancel, fiscal.invalidate, fiscal.xml, fiscal.reprint | empresa/filial |
| Estoque | stock.view, stock.adjust, stock.transfer, stock.loss, stock.negative | filial |
| Produto | product.view, product.create, product.edit, product.price, product.cost | empresa/filial |
| Cliente | customer.view, customer.create, customer.edit, customer.block, customer.credit | empresa/filial |
| Financeiro | finance.view, finance.receive, finance.reverse, finance.export | empresa/filial |
| Relatório | report.view, report.export, report.cost, report.margin | empresa/filial |
| Administração | admin.user, admin.role, admin.branch, admin.terminal, admin.settings | empresa |
| Integração | integration.fiscal, integration.sync, integration.update | empresa/terminal |

## Contrato de autorização
1. Gestão persiste perfil, permissões explícitas, escopo e versão; valida cada operação sensível no backend (inclusive APIs e RPCs).
2. O bootstrap do PDV recebe um snapshot assinado/autenticado com `tenant_id`, `branch_id`, `operator_id`, `permissions`, `version`, `issued_at`, `expires_at`; a assinatura e o escopo devem ser verificados pelo agente.
3. O agente valida a permissão no ponto da ação, não apenas na UI. O renderer só oculta/desabilita controles como conveniência.
4. Offline: respeitar expiração e política por ação; ações de alto risco (estorno, cancelamento fiscal, mudança de preço, reabertura de caixa) devem exigir validação online ou autorização offline criptograficamente verificável.
5. Supervisor: jamais aceitar `supervisor_user_id` isolado como prova. Exigir autorização de uso único vinculada a ação, operador, terminal, venda, escopo e prazo, validada no servidor ou por prova offline verificável.
6. Auditoria append-only: operador, autorizador, ação, recurso, valores antes/depois, terminal, filial, data, motivo, resultado e identificador de correlação. Não armazenar senha/PIN.
7. Propagar revogações e versões para terminais; rejeitar snapshots de outras empresas/filiais.

## Achados verificados no código
- `desktop-pdv/agent/v3-return.js` verifica `permissions.sale.return`, mas permite contorno com simples `supervisorAuthorization.supervisor_user_id`; requer endurecimento coordenado com o mecanismo real de autenticação.
- `desktop-pdv/agent/index.js` contém operações de abertura/fechamento e movimentação de caixa sem checagem explícita de permissão nesses métodos básicos; investigar wrappers instalados no runtime antes de alterar.
- O código de interface do PDV não deve ser tratado como fronteira de segurança.
- Não foi possível confirmar, nesta etapa, a matriz completa de perfis do ThorGestão; evitar inventar rotas/tabelas e alterar regras de produção sem inventário.

## Critérios de aceite para a próxima fase
- Inventário de todas as permissões reais do ThorGestão e de todos os handlers do PDV, com mapeamento 1:1.
- Testes positivos/negativos para cada papel e escopo, com e sem conexão.
- Tentativa de chamada direta ao IPC/API com usuário sem permissão é negada.
- Revogação na Gestão chega ao terminal e respeita política de expiração.
- Supervisor sem autorização verificável não consegue liberar devolução.
- Registro de auditoria disponível no ThorGestão para toda ação sensível.

## Estratégia de implantação
1. Inventariar banco, API, interface e agentes; registrar lacunas.
2. Criar catálogo canônico e migração retrocompatível de papéis existentes.
3. Adicionar autorização no backend e agente, com testes automatizados.
4. Adicionar experiência de permissões e auditoria na Gestão e feedback no PDV.
5. Piloto em filial controlada, monitorar negações e sincronização; só então liberar produção.
