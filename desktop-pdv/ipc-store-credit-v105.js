const { ipcMain } = require('electron');

function installStoreCreditVoucherIpcV105(ThorAgent) {
  if (!ThorAgent.prototype.__storeCreditVoucherInstanceV105) {
    ThorAgent.prototype.__storeCreditVoucherInstanceV105 = true;
    const originalStart = ThorAgent.prototype.start;
    ThorAgent.prototype.start = async function (...args) {
      global.__thorPdvAgentV105 = this;
      return originalStart.apply(this, args);
    };
  }

  const agent = () => {
    const instance = global.__thorPdvAgentV105;
    if (!instance) throw new Error('agent_not_ready');
    return instance;
  };

  for (const channel of ['thor:store-credit-voucher', 'thor:store-credit-vouchers', 'thor:print-store-credit-voucher']) {
    try { ipcMain.removeHandler(channel); } catch {}
  }
  ipcMain.handle('thor:store-credit-voucher', async (_event, number) => agent().storeCreditVoucher(number));
  ipcMain.handle('thor:store-credit-vouchers', async (_event, query = '', limit = 50) => agent().storeCreditVouchers(query, limit));
  ipcMain.handle('thor:print-store-credit-voucher', async (_event, voucher) => agent().printStoreCreditVoucher(voucher));
}

module.exports = { installStoreCreditVoucherIpcV105 };
