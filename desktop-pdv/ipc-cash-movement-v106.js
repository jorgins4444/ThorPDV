const { ipcMain } = require('electron');
const hardware = require('./agent/hardware');

function installCashMovementIpcV106(ThorAgent) {
  if (!ThorAgent.prototype.__cashMovementIpcV106) {
    ThorAgent.prototype.__cashMovementIpcV106 = true;
    const originalStart = ThorAgent.prototype.start;
    ThorAgent.prototype.start = async function (...args) {
      global.__thorPdvCashAgentV106 = this;
      return originalStart.apply(this, args);
    };
  }

  try { ipcMain.removeHandler('thor:print-cash-movement-44'); } catch {}
  ipcMain.handle('thor:print-cash-movement-44', async (_event, receipt = {}) => {
    const agent = global.__thorPdvCashAgentV106;
    if (!agent) throw new Error('agent_not_ready');
    const target = agent.settings().printerName;
    if (!target) throw new Error('printer_not_configured');
    if (target === '__PDF__') throw new Error('thermal_printer_required');
    const doc = agent.cashMovementDocument(receipt);
    await hardware.printText(target, doc.text);
    return { ok: true, target, width: 44, eventId: receipt.event_id || null };
  });
}

module.exports = { installCashMovementIpcV106 };
