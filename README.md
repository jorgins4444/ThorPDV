# ThorPDV

ERP + PDV SaaS para o varejo brasileiro.

## V1

A fundação atual contém:

- Next.js 16 + TypeScript
- Supabase Auth com SSR
- PostgreSQL/Supabase
- arquitetura multi-tenant
- empresas e filiais
- clientes e fornecedores
- produtos e códigos de barras
- estoque e movimentações
- vendas, itens e pagamentos
- contas a pagar/receber
- base para NF-e, NFC-e e NFS-e
- Row Level Security (RLS)
- estrutura pronta para deploy na Vercel

## Desenvolvimento

```bash
npm install
cp .env.example .env.local
npm run dev
```

Variáveis obrigatórias:

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
SUPABASE_SERVICE_ROLE_KEY=
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

> `SUPABASE_SERVICE_ROLE_KEY` é segredo de servidor. Nunca exponha essa chave em código cliente ou com prefixo `NEXT_PUBLIC_`.

## Supabase

A primeira migração está em:

```text
supabase/migrations/20260807123000_init.sql
```

Ela cria a fundação multiempresa do ThorPDV e habilita RLS nas tabelas de negócio.

## Deploy

O projeto foi estruturado para deploy nativo na Vercel. Configure no projeto Vercel as mesmas variáveis do `.env.example` e conecte o repositório GitHub.

## Distribuição do ThorPDV Desktop

As versões do ThorPDV Desktop são publicadas como releases duráveis no GitHub e cadastradas no Update Center do ThorControl. A liberação para os terminais é explícita e pode ser feita em nível global, por cliente ou por PDV específico.

A partir da versão 0.8.2, o Desktop possui atualização assistida com validação SHA-256, sincronização antes e depois da troca de versão, Atualizador Thor visual durante o reinício e notas de versão organizadas em mudanças, melhorias e correções. A política de atualização também pode apontar para uma versão anterior para realizar rollback controlado do aplicativo.

## Roadmap V1

1. Fundação SaaS e autenticação
2. Onboarding de empresa/filial
3. Produtos, clientes e fornecedores
4. Estoque
5. Vendas e ThorPDV
6. Financeiro
7. Integração fiscal NF-e/NFC-e
8. Pagamentos Pix/cartão
9. Relatórios
10. Hardening de segurança e produção

<!-- vercel-rebuild: 2026-08-15T17:59-03:00 -->
