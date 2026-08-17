const hardware = require('./hardware');

function installReceivablePrintV115(ThorAgent) {
  if (!ThorAgent?.prototype || ThorAgent.prototype.__receivablePrintV115) return;
  ThorAgent.prototype.__receivablePrintV115 = true;

  ThorAgent.prototype.printReceivableReceipt = async function (receipt) {
    const doc = this.receivableReceiptDocument(receipt);
    const target = this.settings().printerName;
    if (!target) throw new Error('printer_not_configured');
    if (target === '__PDF__') throw new Error('thermal_printer_required');
    try { await hardware.printThermalText(target, doc.text); }
    catch (rawError) { await hardware.printText(target, doc.text); }
    return { ok:true, target, receipt:doc.receipt };
  };
}

module.exports = { installReceivablePrintV115 };
