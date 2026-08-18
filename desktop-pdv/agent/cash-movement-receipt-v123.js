function clean(value) {
  return String(value ?? '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();
}
function number(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}
function money(value) {
  return number(value).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function json(value, fallback = {}) {
  try { return JSON.parse(value || ''); } catch { return fallback; }
}

function installCashMovementReceiptV123(ThorAgent) {
  ThorAgent.prototype.cashMovementDocument = function (receiptInput = {}) {
    const receipt = receiptInput || {};
    const eventRow = receipt.event_id ? this.store.db.prepare('select payload from queue where id=? limit 1').get(String(receipt.event_id)) : null;
    const eventPayload = json(eventRow?.payload, {});
    const context = receipt.context || json(this.store.get('context', '{}'), {});
    const width = 44;
    const rule = (char = '-') => char.repeat(width);
    const fit = (value) => clean(value).slice(0, width);
    const center = (value) => {
      const content = fit(value);
      return ' '.repeat(Math.max(0, Math.floor((width - content.length) / 2))) + content;
    };
    const pair = (label, value) => {
      const left = fit(label);
      const right = fit(value);
      if (left.length + right.length + 1 > width) return [fit(left), fit(right)];
      return [(left + ' '.repeat(width - left.length - right.length) + right).slice(0, width)];
    };
    const wrap = (label, value) => {
      const prefix = clean(label);
      const words = clean(value).split(' ').filter(Boolean);
      if (!words.length) return prefix ? [fit(prefix)] : [];
      const output = [];
      let line = prefix;
      for (const word of words) {
        const candidate = line + (line ? ' ' : '') + word;
        if (candidate.length > width) {
          if (line) output.push(fit(line));
          line = prefix ? ' '.repeat(Math.min(prefix.length, 12)) + word : word;
        } else line = candidate;
      }
      if (line.trim()) output.push(fit(line));
      return output;
    };

    const isSupply = String(receipt.movement_type || '').toLowerCase() === 'supply';
    const type = isSupply ? 'SUPRIMENTO' : 'SANGRIA';
    const signal = isSupply ? '+' : '-';
    const occurred = receipt.occurred_at ? new Date(receipt.occurred_at) : new Date();
    const validDate = Number.isNaN(occurred.getTime()) ? new Date() : occurred;
    const documentNumber = clean(receipt.event_id || '').slice(0, 12).toUpperCase() || 'LOCAL';
    const company = context.company_name || context.tenant_name || context.organization_name || 'THORPDV';
    const tradeName = context.trade_name || context.fantasy_name || '';
    const branch = context.branch_name || context.store_name || '';
    const document = context.company_document || context.cnpj || context.tax_id || '';
    const address = context.branch_address || context.address || '';
    const terminal = context.pos_name || context.pos_code || context.terminal_name || context.terminal_code || 'PDV';
    const operatorId = receipt.operator?.id || eventPayload.operator_user_id || null;
    const staff = typeof this._staffUsersWithHash === 'function' ? this._staffUsersWithHash() : [];
    const staffOperator = staff.find((user) => String(user.id) === String(operatorId || '')) || {};
    const operator = receipt.operator?.name || eventPayload.operator_name || staffOperator.name || staffOperator.full_name || staffOperator.display_name || staffOperator.user_name || staffOperator.email || 'OPERADOR NAO IDENTIFICADO';
    const supervisor = receipt.supervisor?.name || eventPayload.supervisor_name || '';
    const notes = receipt.reason || receipt.notes || eventPayload.reason || eventPayload.notes || 'Nao informado';

    const lines = [
      center(company),
      ...(tradeName && clean(tradeName).toUpperCase() !== clean(company).toUpperCase() ? [center(tradeName)] : []),
      ...(branch ? [center(branch)] : []),
      ...(document ? [center(`CNPJ/CPF: ${document}`)] : []),
      ...(address ? wrap('', address) : []),
      rule('='),
      center(`COMPROVANTE DE ${type}`),
      center('MOVIMENTACAO DE CAIXA'),
      rule('='),
      ...pair('Documento:', documentNumber),
      ...pair('Data:', validDate.toLocaleDateString('pt-BR')),
      ...pair('Hora:', validDate.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })),
      ...pair('Caixa/Terminal:', terminal),
      ...wrap('Operador:', operator),
      ...(supervisor ? wrap('Supervisor:', supervisor) : []),
      rule('-'),
      ...pair(`${type}:`, `${signal} R$ ${money(receipt.amount)}`),
      rule('-'),
      'MOTIVO / OBSERVACAO',
      ...wrap('', notes),
      rule('-'),
      ...pair('Situacao:', 'REGISTRADO'),
      ...pair('Valor total:', `R$ ${money(receipt.amount)}`),
      rule('='),
      '',
      center('________________________________'),
      center('ASSINATURA DO RESPONSAVEL'),
      '',
      center('Operacao registrada pelo ThorPDV'),
      center('Documento sem valor fiscal'),
      '',
      '',
    ];
    const text = lines.flat().map(fit).join('\n');
    const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>@page{size:80mm auto;margin:0}*{box-sizing:border-box}html,body{width:80mm;margin:0;background:#fff;color:#000}body{padding:3mm 3mm 8mm;font-family:"Courier New",Consolas,monospace}pre{margin:0;white-space:pre;font-size:9.5px;line-height:1.3;font-weight:600}</style></head><body><pre>${escaped}</pre></body></html>`;
    return { kind: 'thermal_text', text, html, title: `Comprovante de ${type}`, filename: `ThorPDV-${type}-${documentNumber}.pdf`, receipt };
  };
}

module.exports = { installCashMovementReceiptV123 };
