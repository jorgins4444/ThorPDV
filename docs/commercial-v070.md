# ThorPDV Comercial v0.7.0

## Pedidos de venda
- Cliente obrigatório.
- Vendedor opcional.
- Pedido registra itens, preços e negociação sem baixar estoque e sem gerar financeiro.
- A movimentação acontece somente quando o pedido é convertido em venda.

## Venda a prazo
- Condições: Boleto ou Crediário.
- Planos configuram parcelas, primeiro vencimento, intervalo e taxa.
- Pagamentos imediatos podem compor uma entrada; somente o saldo restante é financiado.
- Apenas o saldo financiado gera parcelas em Contas a Receber.
- Venda à vista precisa estar integralmente quitada e não gera título em Contas a Receber.

## Caixa
- Outras opções contém Suprimento e Sangria.
- Motivo obrigatório com no mínimo 15 caracteres, validado no Desktop e no banco.
- Após a confirmação é gerado comprovante não fiscal da movimentação.

## Pré-venda
- Cupom explicitamente não fiscal.
- Itens exibem quantidade, unidade de medida, valor unitário e total.

## Validação
- Regras financeiras e de motivo de caixa possuem validação também no servidor.
- O Desktop v0.7.0 inclui os módulos comerciais e o modelo de pré-venda não fiscal.
