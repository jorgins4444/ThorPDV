function installStoreCreditPaymentV106(ThorAgent, Store) {
  if (Store.prototype.__storeCreditPaymentV106) return;
  Store.prototype.__storeCreditPaymentV106 = true;

  Store.prototype.storeCreditVouchers = function (query = '', limit = 50) {
    const normalized = String(query || '').trim().toLowerCase();
    const safeLimit = Math.min(Math.max(Number(limit || 50), 1), 100);
    const rows = normalized
      ? this.db.prepare(`
          select * from store_credit_vouchers
          where status='active'
            and original_amount-used_amount > 0.0001
            and (
              lower(voucher_number) like ? or
              lower(coalesce(guest_name,'')) like ? or
              lower(coalesce(guest_document,'')) like ? or
              lower(coalesce(sale_number,'')) like ?
            )
          order by datetime(updated_at) desc, datetime(issued_at) desc
          limit ?
        `).all(`%${normalized}%`, `%${normalized}%`, `%${normalized}%`, `%${normalized}%`, safeLimit)
      : this.db.prepare(`
          select * from store_credit_vouchers
          where status='active'
            and original_amount-used_amount > 0.0001
          order by datetime(updated_at) desc, datetime(issued_at) desc
          limit ?
        `).all(safeLimit);

    return rows.map((row) => ({
      ...row,
      original_amount: Number(row.original_amount || 0),
      used_amount: Number(row.used_amount || 0),
      remaining: Math.max(Number(row.original_amount || 0) - Number(row.used_amount || 0), 0),
    }));
  };

  ThorAgent.prototype.storeCreditVouchers = function (query = '', limit = 50) {
    return this.store.storeCreditVouchers(query, limit);
  };
}

module.exports = { installStoreCreditPaymentV106 };
