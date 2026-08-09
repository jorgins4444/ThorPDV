const path = require('path');
const fs = require('fs');
const { app, BrowserWindow, ipcMain, safeStorage, dialog } = require('electron');
const { ThorAgent } = require('./agent');
const { installThorAgentV3 } = require('./agent/v3');
const { installReturnFix } = require('./agent/v3-return');
const { installEnrollV3 } = require('./agent/v3-enroll');
const { installDataConsistency } = require('./agent/consistency');
const { installProfilePermissions } = require('./agent/v3-profile-permissions');
const { installSyncPolicy } = require('./agent/sync-policy');
const { installSyncRecovery } = require('./agent/recovery');
const { installCashClosing } = require('./agent/cash-closing');
const { installProductionPrinting } = require('./agent/production');

installThorAgentV3(ThorAgent);
installReturnFix(ThorAgent);
installEnrollV3(ThorAgent);
installDataConsistency(ThorAgent);
installProfilePermissions(ThorAgent);
installSyncRecovery(ThorAgent);
installCashClosing(ThorAgent);
installProductionPrinting(ThorAgent);
installSyncPolicy(ThorAgent);

let mainWindow;
let agent;

function codec() {
  return {
    encrypt(value) {
      if (!value) return '';
      if (!safeStorage.isEncryptionAvailable()) return `plain:${value}`;
      return `enc:${safeStorage.encryptString(value).toString('base64')}`;
    },
    decrypt(value) {
      if (!value) return '';
      if (value.startsWith('plain:')) return value.slice(6);
      if (!value.startsWith('enc:') || !safeStorage.isEncryptionAvailable()) return '';
      return safeStorage.decryptString(Buffer.from(value.slice(4), 'base64'));
    },
  };
}

async function createWindow() {
  agent = new ThorAgent({
    dataDir: app.getPath('userData'),
    apiBase: process.env.THORPDV_API_URL || 'https://thorpdv.vercel.app',
    codec: codec(),
  });
  agent.sync.appVersion = '0.4.1';
  if (typeof agent.logoutOperator === 'function') agent.logoutOperator();
  await agent.start();

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 720,
    backgroundColor: '#f4f6f5',
    title: 'ThorPDV Desktop',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  await mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

async function loadPrintable(doc) {
  const win = new BrowserWindow({ show: false, width: 900, height: 1200, webPreferences: { sandbox: true } });
  if (doc.kind === 'remote_pdf') {
    if (!/^https?:\/\//i.test(doc.url || '')) { win.destroy(); throw new Error('nfce_pdf_url_unavailable'); }
    await win.loadURL(doc.url);
  } else {
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(doc.html || `<pre>${doc.text || ''}</pre>`)}`);
  }
  return win;
}

async function saveAsPdf(doc) {
  const win = await loadPrintable(doc);
  try {
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Salvar documento como PDF',
      defaultPath: path.join(app.getPath('documents'), doc.filename || `ThorPDV-${Date.now()}.pdf`),
      filters: [{ name: 'Documento PDF', extensions: ['pdf'] }],
    });
    if (result.canceled || !result.filePath) return { ok: false, cancelled: true };
    const buffer = await win.webContents.printToPDF({ printBackground: true, preferCSSPageSize: true });
    fs.writeFileSync(result.filePath, buffer);
    return { ok: true, target: 'pdf', filePath: result.filePath };
  } finally { win.destroy(); }
}

async function printRemotePdf(doc, printerName) {
  const win = await loadPrintable(doc);
  try {
    return await new Promise((resolve, reject) => win.webContents.print({ silent: true, printBackground: true, deviceName: printerName }, (success, reason) => success ? resolve({ ok: true, target: printerName }) : reject(new Error(reason || 'print_failed'))));
  } finally { win.destroy(); }
}

async function printHtmlDocument(doc, printerName) {
  const win = await loadPrintable(doc);
  try {
    return await new Promise((resolve, reject) => win.webContents.print({ silent: true, printBackground: true, deviceName: printerName }, (success, reason) => success ? resolve({ ok: true, target: printerName }) : reject(new Error(reason || 'print_failed'))));
  } finally { win.destroy(); }
}

async function printSale(saleKey, type = 'pre_sale', reprint = false) {
  if (agent.currentOperator?.() && !agent.canPrint(type, Boolean(reprint))) {
    if (reprint && type === 'nfce') throw new Error('nfce_reprint_not_allowed');
    if (reprint) throw new Error('document_reprint_not_allowed');
    throw new Error(type === 'nfce' ? 'nfce_print_not_allowed' : 'receipt_print_not_allowed');
  }
  const doc = agent.documentData(saleKey, type);
  const target = agent.settings().printerName;
  if (!target) throw new Error('printer_not_configured');
  if (target === '__PDF__') return saveAsPdf(doc);
  if (doc.kind === 'remote_pdf') return printRemotePdf(doc, target);
  return agent.printDocument(saleKey, type);
}

async function printCashClose(summary) {
  const doc = agent.cashCloseDocument(summary || null);
  const target = agent.settings().printerName;
  if (!target) throw new Error('printer_not_configured');
  if (target === '__PDF__') return saveAsPdf(doc);
  return printHtmlDocument(doc, target);
}

function registerIpc() {
  const handle = (name, fn) => ipcMain.handle(name, async (_event, ...args) => fn(...args));
  handle('thor:status', async () => ({ ...(await agent.status()), appVersion: '0.4.1', operator: agent.currentOperator(), v3Settings: agent.v3Settings(), paymentIntegrations: agent.paymentIntegrations(), syncDiagnostics: agent.syncDiagnostics(), syncPolicy: agent.syncPolicy?.() || null }));
  handle('thor:enroll', (payload) => agent.enroll(payload));
  handle('thor:sync', () => agent.manualSync());
  handle('thor:sync-diagnostics', () => agent.syncDiagnostics());
  handle('thor:recover-sync', () => agent.recoverSync());
  handle('thor:disconnect-device', () => agent.disconnectDevice());
  handle('thor:search-products', (query) => agent.searchProducts(query));
  handle('thor:all-products', () => agent.store.searchProducts('', 5000));
  handle('thor:customers', (query) => agent.searchCustomers(query));
  handle('thor:quote-sale', (items, discount) => agent.quoteSale(items, discount));
  handle('thor:quote-checkout', (payload) => agent.quoteCheckout(payload));
  handle('thor:operators', () => agent.staffUsers());
  handle('thor:operator-login', (payload) => agent.loginOperator(payload));
  handle('thor:operator-logout', () => agent.logoutOperator());
  handle('thor:supervisor-authorize', (payload) => agent.authorizeSupervisor(payload));
  handle('thor:open-cash', (payload) => agent.openCash(payload));
  handle('thor:cash-movement', (payload) => agent.cashMovement(payload));
  handle('thor:cash-preview', () => agent.cashClosingPreview());
  handle('thor:close-cash', (payload) => agent.closeCash(payload));
  handle('thor:last-cash-close', () => agent.lastCashCloseSummary());
  handle('thor:print-cash-close', (summary) => printCashClose(summary));
  handle('thor:finalize-sale', (payload) => agent.finalizeSale(payload));
  handle('thor:cancel-sale', (payload) => agent.cancelSale(payload));
  handle('thor:return-sale', (payload) => agent.returnSale(payload));
  handle('thor:request-nfce', (payload) => agent.requestNfce(payload));
  handle('thor:fiscal-sales', (query) => agent.fiscalSales(query));
  handle('thor:fiscal-sale', (key) => agent.fiscalSale(key));
  handle('thor:printers', () => agent.listPrinters());
  handle('thor:serial-ports', () => agent.listSerialPorts());
  handle('thor:settings', () => agent.settings());
  handle('thor:save-settings', (settings) => agent.saveSettings(settings));
  handle('thor:v3-settings', () => agent.v3Settings());
  handle('thor:save-v3-settings', (settings) => agent.saveV3Settings(settings));
  handle('thor:set-printer', (name) => agent.setPrinter(name));
  handle('thor:open-drawer', () => agent.manualOpenDrawer());
  handle('thor:read-scale', () => agent.readScale());
  handle('thor:payment-integrations', () => agent.paymentIntegrations());
  handle('thor:begin-payment', (payload) => agent.beginIntegratedPayment(payload));
  handle('thor:print-sale', (saleKey, type, reprint) => printSale(saleKey, type, reprint));
  handle('thor:print-last', () => printSale(null, 'pre_sale', true));
}

app.whenReady().then(async () => {
  registerIpc();
  await createWindow();
  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) await createWindow();
  });
});

app.on('window-all-closed', async () => {
  if (agent) await agent.stop();
  if (process.platform !== 'darwin') app.quit();
});
