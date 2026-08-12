# ThorPDV — Caixa diário (0.8.4)

## Regra operacional

Cada terminal/caixa possui uma sessão independente por data operacional, considerando `America/Fortaleza`.

- O caixa aberto em um dia não recebe novas vendas no dia seguinte.
- Ao detectar a virada do dia, a sessão anterior passa a `pending_close` no servidor.
- O caixa anterior não é fechado automaticamente; ele permanece pesquisável para conferência e fechamento explícito.
- O operador pode abrir normalmente o caixa do novo dia, mesmo existindo sessões anteriores pendentes.
- Vendas e movimentações offline realmente ocorridas no dia anterior são sincronizadas antes do rollover da sessão correspondente.

## Fechamento

O fechamento lista dinamicamente as formas de pagamento ativas no Thor Gestão. Formas usadas historicamente continuam visíveis no fechamento da sessão em que foram utilizadas.

`Venda a Prazo` aparece como forma de pagamento/condição financiada, mas não compõe o numerário físico esperado. O dinheiro esperado considera fundo inicial, vendas em dinheiro, suprimentos/recebimentos e deduz sangrias, despesas e devoluções em dinheiro.

## Busca de caixas

Em `F4 — Controle diário de caixa`, o operador pode filtrar sessões por período e status:

- Abertos / pendentes
- Somente pendentes
- Fechados
- Todos

Caixas anteriores pendentes podem ser visualizados e fechados sem alterar a sessão do dia atual.

## Proteções

O servidor valida a data operacional vinculada à sessão de caixa e impede que uma nova venda PDV seja registrada em sessão de outro dia. A sincronização 0.8.4 também separa eventos históricos dos eventos do dia atual antes do rollover.
