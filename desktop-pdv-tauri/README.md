# ThorPDV Tauri 2 — protótipo isolado

Esta pasta é um experimento na branch `prototype/tauri2-thorpdv-windows`. **Não substitui o Electron**, não altera `desktop-pdv/` e não deve ser publicada como atualização oficial.

## Objetivo
Preservar as telas originais de `desktop-pdv/renderer` (HTML/CSS/JS) e migrar gradualmente a ponte `window.thor` hoje implementada por `desktop-pdv/preload.js` e `desktop-pdv/main.js`.

## Arquitetura e limitações atuais
- Tauri 2 usa WebView2 no Windows, sem empacotar Chromium.
- O frontend original é copiado **sem alterações** por `npm run prepare:ui`.
- O backend original utiliza Node.js, better-sqlite3, impressão, PowerShell e Electron IPC. Ele **não funciona automaticamente no Rust**.
- A ponte `window.thor` está deliberadamente bloqueada com erro explicativo neste estágio, para não simular operações de caixa, venda, impressão, licença ou balança.
- A migração será feita por contratos explícitos de comandos, com testes de paridade. Uma alternativa a avaliar é sidecar Node assinado/empacotado, mas requer implementação segura de IPC, ciclo de vida e banco SQLite.
- Não instale o protótipo em um caixa de produção.

## Ambiente de desenvolvimento
Requer Node.js, Rust, Cargo, toolchain MSVC e WebView2 Runtime no Windows.

```sh
cd desktop-pdv-tauri
npm install
npm run prepare:ui
npm run dev
```

O protótipo abre a interface original com uma faixa de aviso de homologação; funcionalidades dependentes de `window.thor` estão desabilitadas até a ponte ser implementada.

## Critérios antes de considerar migração
1. Paridade de telas, navegação e atalhos
2. Banco SQLite local, migrações e recuperação de dados
3. Venda e fechamento de caixa offline; reconciliação idempotente
4. NFC-e, XML, PDF e impressoras térmicas
5. Urano POP-S Bluetooth/COM e diagnóstico seguro
6. Licença de terminal, bloqueio offline, perfis e permissões
7. Atualizações assinadas, rollback e instalação Windows
8. Comparação medida de RAM, CPU, startup, consulta de produtos e tamanho do instalador

Não há equivalência funcional nem redução de tamanho comprovadas neste primeiro commit.
