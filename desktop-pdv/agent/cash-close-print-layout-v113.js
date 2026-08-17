const WIDTH_MM = 80;

const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}[char]));

function installCashClosePrintLayoutV113(ThorAgent) {
  if (!ThorAgent?.prototype || ThorAgent.prototype.__cashClosePrintLayoutV113) return;
  ThorAgent.prototype.__cashClosePrintLayoutV113 = true;

  const previousCashCloseDocument = ThorAgent.prototype.cashCloseDocument;
  if (typeof previousCashCloseDocument !== 'function') return;

  ThorAgent.prototype.cashCloseDocument = function (summaryInput = null) {
    const doc = previousCashCloseDocument.call(this, summaryInput);
    if (!doc || doc.kind !== 'text') return doc;

    // Impressoras térmicas podem anunciar ao Chromium um papel maior que o rolo
    // efetivo. O layout anterior usava `margin: 0 auto`, o que centralizava os
    // 72 mm dentro dessa página lógica e podia empurrar todo o conteúdo para a
    // direita, chegando a imprimir um comprovante aparentemente em branco.
    // Aqui o rolo fica ancorado no canto esquerdo da página lógica e somente o
    // bloco de 44 colunas é centralizado dentro dos 80 mm físicos.
    const text = String(doc.text || '');
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>
      @page { size: ${WIDTH_MM}mm auto; margin: 0; }
      html {
        margin: 0 !important;
        padding: 0 !important;
        width: ${WIDTH_MM}mm !important;
        background: #fff !important;
      }
      body {
        box-sizing: border-box !important;
        margin: 0 !important;
        padding: 2mm 3mm 2mm 3mm !important;
        width: ${WIDTH_MM}mm !important;
        min-width: ${WIDTH_MM}mm !important;
        max-width: ${WIDTH_MM}mm !important;
        background: #fff !important;
        color: #000 !important;
        text-align: left !important;
        overflow: visible !important;
      }
      pre {
        display: block !important;
        box-sizing: border-box !important;
        width: 44ch !important;
        max-width: 70mm !important;
        margin: 0 auto !important;
        padding: 0 !important;
        white-space: pre !important;
        overflow: visible !important;
        color: #000 !important;
        background: transparent !important;
        font-family: Consolas, "Lucida Console", "Courier New", monospace !important;
        font-size: 9.2px !important;
        line-height: 1.22 !important;
        font-weight: 600 !important;
        letter-spacing: 0 !important;
        text-align: left !important;
        -webkit-print-color-adjust: exact !important;
        print-color-adjust: exact !important;
      }
    </style></head><body><pre>${escapeHtml(text)}</pre></body></html>`;

    return {
      ...doc,
      html,
      thermal_width_mm: WIDTH_MM,
      thermal_columns: 44,
      print_layout: 'thermal_80mm_centered_v113',
    };
  };
}

module.exports = { installCashClosePrintLayoutV113 };
