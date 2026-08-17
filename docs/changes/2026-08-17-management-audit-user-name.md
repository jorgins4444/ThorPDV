# Auditoria: identificação do responsável ERP

Data: 2026-08-17

A auditoria gerencial passa a identificar usuários ERP pelo vínculo seguro entre o hash do e-mail de acesso e o cadastro interno de colaboradores do mesmo tenant.

## Comportamento

- Exibe o nome do colaborador como responsável quando existir correspondência.
- Usa o e-mail como alternativa quando o nome não estiver cadastrado.
- Mantém o histórico imutável: eventos antigos também são resolvidos durante a consulta, sem reescrever registros.
- Preserva o isolamento por tenant e a validação da sessão ERP.
