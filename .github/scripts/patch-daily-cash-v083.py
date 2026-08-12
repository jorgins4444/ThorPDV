from pathlib import Path

# Main process: install the daily cash layer last and expose targeted cash IPC.
main_path = Path('desktop-pdv/main.js')
main = main_path.read_text(encoding='utf-8')
req = "const { installSalesSettlementV073 } = require('./agent/sales-settlement-v073');\n"
if "installDailyCashV083" not in main:
    if req not in main:
        raise SystemExit('main require marker not found')
    main = main.replace(req, req + "const { installDailyCashV083 } = require('./agent/daily-cash-v083');\n", 1)
install = "installSyncPolicy(ThorAgent);\n"
if "installDailyCashV083(ThorAgent);" not in main:
    if install not in main:
        raise SystemExit('main install marker not found')
    main = main.replace(install, install + "installDailyCashV083(ThorAgent);\n", 1)
old_ipc = "  handle('thor:cash-preview', () => agent.cashClosingPreview());\n"
new_ipc = "  handle('thor:cash-preview', (options) => agent.cashClosingPreview(options || {}));\n  handle('thor:cash-sessions', (filters) => agent.cashSessions(filters || {}));\n  handle('thor:close-historical-cash', (payload) => agent.closeHistoricalCash(payload || {}));\n"
if old_ipc in main:
    main = main.replace(old_ipc, new_ipc, 1)
elif "thor:cash-sessions" not in main:
    raise SystemExit('main IPC marker not found')
main_path.write_text(main, encoding='utf-8')

# Printed closing receipt: dynamic labels, including term sales and future methods from Gestão.
cash_path = Path('desktop-pdv/agent/cash-closing.js')
cash = cash_path.read_text(encoding='utf-8')
cash = cash.replace("store_credit: 'Credito em loja', other: 'Outros',", "store_credit: 'Credito em loja', term_sale: 'Venda a Prazo', other: 'Outros',")
cash = cash.replace("`${PAYMENT_LABELS[p.method] || p.method}: Sist R$", "`${p.name || PAYMENT_LABELS[p.method] || p.method}: Sist R$")
cash = cash.replace("`${PAYMENT_LABELS[p.method] || p.method}: R$", "`${p.name || PAYMENT_LABELS[p.method] || p.method}: R$")
cash_path.write_text(cash, encoding='utf-8')

# Keep the high-frequency status path light: count overdue sessions without calculating every closing summary.
daily_path = Path('desktop-pdv/agent/daily-cash-v083.js')
daily = daily_path.read_text(encoding='utf-8')
status_marker = "  ThorAgent.prototype.status = async function () {"
if '_localOverdueCashCount' not in daily:
    helper = r'''  ThorAgent.prototype._localOverdueCashCount = function () {
    const today = businessDate();
    const opens = this.store.db.prepare("select id,payload,created_at from queue where type='cash_open'").all();
    const closeRows = this.store.db.prepare("select payload from queue where type='cash_close'").all();
    const closed = new Set(closeRows.map((row) => String(json(row.payload, {}).cash_open_event_id || '')).filter(Boolean));
    let count = 0;
    for (const row of opens) {
      if (closed.has(String(row.id)) || this.store.get(`cash_direct_closed_${row.id}`)) continue;
      const payload = json(row.payload, {});
      const date = text(payload.business_date) || businessDate(payload.occurred_at || row.created_at);
      if (date && date < today) count++;
    }
    return count;
  };

'''
    if status_marker not in daily:
        raise SystemExit('daily status marker not found')
    daily = daily.replace(status_marker, helper + status_marker, 1)
daily = daily.replace("    const overdue = this._localCashSessions().filter((session) => session.status === 'pending_close').length;", "    const overdue = this._localOverdueCashCount();")
daily_path.write_text(daily, encoding='utf-8')

# Static checks.
checks = {
    'desktop-pdv/main.js': ['installDailyCashV083(ThorAgent);', "thor:cash-sessions", "thor:close-historical-cash"],
    'desktop-pdv/preload.js': ['cashSessions:', 'closeHistoricalCash:'],
    'desktop-pdv/agent/daily-cash-v083.js': ['cash_day_expired', 'term_sale', 'closeHistoricalCash', '_localOverdueCashCount'],
    'desktop-pdv/renderer/cash-daily-v083.js': ['Buscar caixas', 'Venda a prazo', 'Abertos / pendentes'],
    'desktop-pdv/package.json': ['"version": "0.8.3"'],
}
for filename, markers in checks.items():
    value = Path(filename).read_text(encoding='utf-8')
    for marker in markers:
        if marker not in value:
            raise SystemExit(f'{filename}: missing marker {marker}')
