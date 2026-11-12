# ThorPDV Windows — sincronização bidirecional e progresso

Rastreio: #34

## Requisitos funcionais
- Registrar de forma durável cada tentativa de sincronização enviada ou recebida, manual, automática ou em reenvio, inclusive quando offline.
- Campos mínimos: identificador da operação e correlação, terminal, entidade, direção, origem, início, fim, total, processados, confirmados, status, código e mensagem de erro.
- Instrumentar os pontos reais de transporte e confirmação; não inferir sucesso apenas porque o processo local terminou.
- Disponibilizar histórico com filtros por período, direção, entidade e status, detalhes e reenvio idempotente.
- Na sincronização manual exibir progresso animado, porcentagem real e etapa atual. Usar estado indeterminado quando o total não for conhecido. Só atingir 100% após confirmações de todas as etapas obrigatórias.
- Em falhas parciais, manter detalhes, preservar fila e permitir retentativa sem duplicação de registros comerciais.

## Homologação obrigatória
- Testes de upload, download, desconexão, reconexão, reenvio, persistência após reinício e duplicidade.
- Integração real com ambiente de homologação Supabase e ThorGestão; teste local não substitui validação remota.
- CI e build Windows aprovados, artifact EXE e SHA256 identificados por execução GitHub Actions.
- Não ativar THORPDV_CATALOG_MUTATIONS_ENABLED antes das migrações e testes.
- Não integrar à main ou publicar release de produção antes de comprovar os critérios acima.

> Este documento especifica a implementação. Não representa código funcional, build ou instalador pronto.
