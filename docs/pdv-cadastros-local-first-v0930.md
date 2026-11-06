# ThorPDV — Cadastro de clientes e catálogo local-first (versão de desenvolvimento)

## Escopo

O novo botão **Cadastros** aparece na barra do ThorPDV Desktop (e no menu).
Permite:

- **Clientes**: pessoa física/jurídica, documento, nome, e-mail e telefone.
- **Produto simples**: nome, unidade de medida, custo, preço de venda, categoria/grupo existente no ThorGestão, NCM.
- **Preço**: alterar exclusivamente `sale_price`, incluindo a tabela de preço padrão.
- **Estoque**: aumentar ou diminuir quantidade da filial, exigindo motivo.

As alterações locais são gravadas em transação no SQLite e na tabela
`catalog_outbox`. Assim o caixa retorna imediatamente mesmo se a rede
estiver indisponível. A sincronização é tentada após salvar e depois em
intervalos de 30 segundos; o histórico exibe *Pendente*, *Sincronizado*,
*Tentando novamente* ou *Rejeitado*.

## Segurança

- Permissões separadas: `customer.create`, `product.create`,
  `product.price_edit`, `stock.adjust`, desabilitadas por padrão.
- Um usuário autorizado de Gestão precisa conceder as permissões nos
  **Perfis de Usuário PDV** antes do uso.
- O servidor revalida o perfil ativo do operador no tenant/filial.
- Os eventos são identificados por UUID, com registro transacional único
  em `pdv_catalog_mutations`, impedindo duplicidade por reenvio.
- A autorização do operador no backend usa a identidade associada ao
  dispositivo e ao usuário declarado pelo cliente; para ambientes de
  alta sensibilidade, uma autenticação de operação com prova adicional
  (PIN renovado ou token de sessão assinado) deve ser avaliada antes
  de disponibilizar a ação a operadores com acesso amplo.

## Dependências para publicar

1. **Executar a migration** `supabase/migrations/20261106160000_pdv_catalog_local_first_v0930.sql`
   na base correta do Supabase, primeiro em homologação. Confirmar
   explicitamente que a função `public.pdv_catalog_apply_v1` existe.
2. Verificar os testes de CI web e Windows no PR #24. A CI não aplica a
   migration; aprovação da CI, sozinha, NÃO valida o banco de produção.
3. Implantar a nova API `/api/pdv/catalog-mutation` no ThorGestão.
4. Criar perfil autorizado no ThorGestão com as quatro permissões novas.
5. Testar com dois PDVs conectados na mesma filial e um terceiro offline:
   cadastro de produto/cliente, alteração de preço, entradas/saídas,
   sincronização, retomada após falha da internet, reenvio e auditoria.
6. Testar erro de categoria inexistente, documento inválido, falta de saldo,
   perfil revogado e device/tenant inválido.
7. Só então versionar, compilar e publicar um novo instalador no
   workflow `Build ThorPDV Desktop`.

**Não publique o desktop antes da migration.** Sem ela, operações locais
serão salvas no SQLite mas ficarão pendentes para envio, e um usuário
poderá interpretar incorretamente uma alteração local como aplicada
em todos os terminais.

## Reconciliação

- Preço é visível imediatamente no caixa; atualiza a tabela de preço
  local quando houver preço específico.
- Ajuste de estoque *não* é aplicado de novo depois de um pull se o ACK
  do servidor se perder. O saldo local otimista é preservado enquanto
  houver movimento pendente; quando a operação confirmar, um pull
  completo restaura o valor consolidado.
- Operação rejeitada não é reenviada sem intervenção; o painel permite
  um novo envio autorizado.
- Produtos criados e rejeitados são desativados no SQLite local.
- Atenção: se vendas ocorrerem com estoque/produtos ainda pendentes de
  aceitação do servidor, os dados podem precisar de reconciliação manual.
  Esse cenário deve ser validado no piloto antes de produção.

## Testes locais

No diretório `desktop-pdv`:

```sh
npm install
node --check agent/catalog-local-first-v0930.js
node --check renderer/catalog-local-first-v0930.js
node --test tests/catalog-local-first-v0930.test.js
```
