const { ipcMain } = require('electron');

function installReceivableIpcV115() {
  const agent = () => {
    const instance = global.__thorPdvAgentV105;
    if (!instance) throw new Error('agent_not_ready');
    return instance;
  };

  for (const channel of ['thor:receivables', 'thor:receive-receivables', 'thor:print-receivable-receipt']) {
    try { ipcMain.removeHandler(channel); } catch {}
  }

  ipcMain.handle('thor:receivables', async (_event, query = '', customerId = null) => agent().receivables(query, customerId));
  ipcMain.handle('thor:receive-receivables', async (_event, payload = {}) => agent().receiveReceivables(payload));
  ipcMain.handle('thor:print-receivable-receipt', async (_event, receipt) => agent().printReceivableReceipt(receipt));
}

module.exports = { installReceivableIpcV115 };
