from pathlib import Path

# Desktop sync: use the already-deployed /api/pdv/push transport for rollover commands.
sync_path = Path('desktop-pdv/agent/sync.js')
sync = sync_path.read_text(encoding='utf-8')
if not sync.startswith("const crypto = require('crypto');"):
    sync = "const crypto = require('crypto');\n" + sync

headers_marker = "  headers(){\n    const token=this.tokenProvider();\n    return { 'content-type':'application/json', ...(token?{authorization:`Bearer ${token}`}:{}) };\n  }\n"
control_method = r'''

  async control(type,payload={}){
    const id=crypto.randomUUID();
    const response=await this.request('/api/pdv/push',{events:[{id,type,payload}]});
    const row=(response.results||[]).find((item)=>String(item.id)===String(id))||(response.results||[])[0];
    if(!row) throw new Error('cash_command_empty_response');
    if(row.status!=='processed') throw new Error(row.error||row.result?.error||'cash_command_failed');
    if(row.result?.ok===false) throw new Error(row.result.error||'cash_command_failed');
    return row.result||{};
  }
'''
if 'async control(type,payload={})' not in sync:
    if headers_marker not in sync:
        raise SystemExit('sync headers marker not found')
    sync = sync.replace(headers_marker, headers_marker + control_method, 1)
sync = sync.replace("await this.request('/api/pdv/cash/rollover',{});", "await this.control('cash_rollover',{});")
if '/api/pdv/cash/rollover' in sync:
    raise SystemExit('sync still depends on new rollover route')
sync_path.write_text(sync, encoding='utf-8')

# Daily cash agent: query/list/close through the same existing push endpoint.
daily_path = Path('desktop-pdv/agent/daily-cash-v083.js')
daily = daily_path.read_text(encoding='utf-8')

preview_start = daily.find('  ThorAgent.prototype.cashClosingPreview = async function (options = {}) {')
sessions_start = daily.find('  ThorAgent.prototype.cashSessions = async function (filters = {}) {', preview_start)
close_start = daily.find('  ThorAgent.prototype.closeHistoricalCash = async function', sessions_start)
module_end = daily.find('\n}\n\nmodule.exports', close_start)
if min(preview_start,sessions_start,close_start,module_end) < 0:
    raise SystemExit('daily cash block markers not found')

new_blocks = r'''  ThorAgent.prototype.cashClosingPreview = async function (options = {}) {
    const target = text(options.cashOpenEventId || this.store.get('cash_open_event_id'));
    let localAll = null;
    if (target) { try { localAll = this._dailyLocalCashSummary(target); } catch {} }
    const token = this.deviceToken();
    if (!token) {
      if (localAll) return localAll;
      throw new Error('cash_not_found');
    }
    try {
      await this.sync.run(true);
      const server = await this.sync.control('cash_preview_query', { cash_open_event_id: target || '' });
      let unsynced = null;
      if (target) { try { unsynced = this._dailyLocalCashSummary(target, { onlyUnsynced: true }); } catch {} }
      const payments = this._mergeCashPaymentRows(server.payments || [], unsynced?.payments || []);
      const extraCash = num((unsynced?.payments || []).find((p) => p.method === 'cash')?.amount);
      const result = {
        ...server,
        source: unsynced && (unsynced.pending_events || unsynced.rejected_events) ? 'server+local' : 'server',
        payments,
        sales_count: num(server.sales_count) + num(unsynced?.sales_count), sales_total: num(server.sales_total) + num(unsynced?.sales_total),
        cash_payments: num(server.cash_payments) + extraCash, term_sales_total: num(server.term_sales_total) + num(unsynced?.term_sales_total),
        supply: num(server.supply) + num(unsynced?.supply), receivable_received: num(server.receivable_received) + num(unsynced?.receivable_received),
        withdrawal: num(server.withdrawal) + num(unsynced?.withdrawal), expense: num(server.expense) + num(unsynced?.expense), refund: num(server.refund) + num(unsynced?.refund),
        pending_events: num(unsynced?.pending_events), rejected_events: num(unsynced?.rejected_events),
      };
      result.expected_cash = num(result.opening_amount) + result.cash_payments + result.supply + result.receivable_received - result.withdrawal - result.expense - result.refund;
      return result;
    } catch (error) {
      if (localAll) return { ...localAll, warning: error.message || 'server_preview_unavailable' };
      throw error;
    }
  };

  ThorAgent.prototype.cashSessions = async function (filters = {}) {
    this._normalizeCurrentCashDay();
    const local = this._localCashSessions();
    const token = this.deviceToken();
    let server = [];
    let serverDate = businessDate();
    if (token) {
      try {
        await this.sync.run(true);
        const data = await this.sync.control('cash_sessions_query', {
          from: filters.from || '', to: filters.to || '', status: filters.status || 'all',
        });
        server = data.sessions || [];
        serverDate = data.business_date || serverDate;
      } catch {}
    }
    const map = new Map();
    for (const row of local) map.set(String(row.client_event_id), row);
    for (const row of server) map.set(String(row.client_event_id), { ...(map.get(String(row.client_event_id)) || {}), ...row, local_only: false });
    let rows = [...map.values()];
    const from = text(filters.from), to = text(filters.to), status = text(filters.status || 'all');
    if (from) rows = rows.filter((row) => String(row.business_date || '') >= from);
    if (to) rows = rows.filter((row) => String(row.business_date || '') <= to);
    if (status && status !== 'all') rows = rows.filter((row) => status === 'open' ? ['open','pending_close'].includes(String(row.status)) : String(row.status) === status);
    rows.sort((a, b) => String(b.business_date || '').localeCompare(String(a.business_date || '')) || new Date(b.opened_at || 0) - new Date(a.opened_at || 0));
    return { ok: true, businessDate: serverDate, sessions: rows.slice(0, 120) };
  };

  ThorAgent.prototype.closeHistoricalCash = async function ({ cashOpenEventId, closingAmount = 0, notes = '', reconciliation = {} } = {}) {
    const eventId = text(cashOpenEventId);
    if (!eventId) throw new Error('cash_not_found');
    const operator = this.currentOperator?.();
    if (!operator) throw new Error('operator_required');
    if (!permitted(operator, 'cash.close')) throw new Error('operator_not_allowed_to_close_cash');
    if (!this.deviceToken()) throw new Error('historical_cash_close_requires_online');
    const data = await this.sync.control('cash_historical_close', {
      cash_open_event_id: eventId,
      closing_amount: num(closingAmount),
      notes: text(notes),
      operator_user_id: operator.id,
      reconciliation,
    });
    this.store.set(`cash_direct_closed_${eventId}`, data.closed_at || new Date().toISOString());
    const summary = { ...reconciliation, ...data, client_event_id: eventId, closing_amount: num(data.closing_amount ?? closingAmount), difference: num(data.difference), closed_at: data.closed_at || new Date().toISOString(), operator: { id: operator.id, name: operator.name }, notes: text(notes), source: 'server' };
    this.store.set('last_cash_close_summary', JSON.stringify(summary));
    return { ok: true, summary };
  };
'''

daily = daily[:preview_start] + new_blocks + daily[module_end:]
for forbidden in ['/api/pdv/cash/preview','/api/pdv/cash/sessions','/api/pdv/cash/rollover','/api/pdv/cash/close-session']:
    if forbidden in daily:
        raise SystemExit(f'daily cash still depends on {forbidden}')
daily_path.write_text(daily, encoding='utf-8')

# Version 0.8.5.
pkg_path = Path('desktop-pdv/package.json')
pkg = pkg_path.read_text(encoding='utf-8').replace('"version": "0.8.4"','"version": "0.8.5"',1)
if '"version": "0.8.5"' not in pkg:
    raise SystemExit('package version marker not found')
pkg_path.write_text(pkg, encoding='utf-8')

# Static guardrails.
checks={
  'desktop-pdv/agent/sync.js':["async control(type,payload={})","cash_rollover","/api/pdv/push"],
  'desktop-pdv/agent/daily-cash-v083.js':["cash_preview_query","cash_sessions_query","cash_historical_close"],
  'desktop-pdv/package.json':['"version": "0.8.5"'],
}
for filename,markers in checks.items():
    value=Path(filename).read_text(encoding='utf-8')
    for marker in markers:
        if marker not in value: raise SystemExit(f'{filename}: missing {marker}')
