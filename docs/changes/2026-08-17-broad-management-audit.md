# Auditoria ampla do ThorGestão

Data: 2026-08-17

A Auditoria Gerencial passa a registrar operações de inclusão, alteração e exclusão nos cadastros e módulos de negócio que possuem isolamento por empresa (`tenant_id`).

## Cobertura

- 85 tabelas de negócio cobertas automaticamente.
- Novos tipos: cadastro realizado, cadastro alterado e cadastro excluído.
- Identificação do usuário ERP propagada pela sessão.
- Alterações guardam somente os campos efetivamente modificados.
- Inclusões e exclusões guardam snapshots sanitizados.
- Eventos técnicos e tabelas já cobertas por auditorias especializadas são excluídos para evitar duplicidade.

## Segurança

Senhas, PINs, tokens, chaves de API, certificados, credenciais, assinaturas, hashes e XMLs são substituídos por `[DADO PROTEGIDO]`. Conteúdos textuais extensos também são omitidos para controlar volume e exposição.
