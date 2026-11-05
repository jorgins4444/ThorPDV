# Fechamento às cegas — contrato ThorGestão ↔ ThorPDV

## Permissão de perfil
Adicionar no editor de perfis do **ThorGestão**, grupo **Caixa**:
- `cash.close`: pode executar fechamento.
- `cash.blind_close`: deve executar fechamento às cegas; **true** oculta valores esperados, movimentações e diferenças do operador. Não é permissão de consultar resultados.
- Futuro: `cash.close_report.view`: consulta e impressão do relatório completo pela gestão.

O ThorPDV v0.9.22 reconhece `operator.permissions.cash.blind_close === true` no snapshot de usuário recebido pela sincronização. A interface de configuração no ThorGestão e a propagação do novo campo **ainda exigem validação/implementação no backend**; não ativar o modo antes disso.

## Regras de segurança
- O agente mascara o preview devolvido ao renderer e calcula internamente os valores esperados na conclusão.
- O renderer envia apenas os valores contados; totais e diferenças fornecidos pelo cliente não são aceitos no modo cego.
- O resultado da conclusão e a consulta do último fechamento não expõem resumo financeiro ao operador com `blind_close=true`.
- A impressão do relatório detalhado fica bloqueada para o perfil cego; não imprimir o fechamento completo automaticamente nesse perfil.
- O modo normal permanece disponível para operadores sem a flag; a impressão térmica passa a tentar ESC/POS RAW se a impressão HTML do Windows falhar.

## Validação obrigatória antes da liberação
1. Configurar `cash.blind_close=true` no perfil da Gestão e verificar que o snapshot chega ao PDV.
2. Conferir que a tela, o IPC de preview, o IPC de fechamento e o IPC de reimpressão não expõem valores esperados.
3. Conferir se o fechamento persistido no servidor inclui diferenças e valores reais para a gestão.
4. Testar impressão normal em térmica 80 mm e PDF; observar erros reais do driver e fallback ESC/POS.
5. Testar falta de impressora, caixa offline, fechamento duplicado e operador sem `cash.close`.
6. Validar que o perfil gerente pode consultar/imprimir relatório detalhado após sincronização.

**Importante:** a implementação da tela de gestão de perfis e da consulta de relatórios pelo ThorGestão não está incluída nesta entrega. Não afirmar alinhamento ponta a ponta antes desses testes.
