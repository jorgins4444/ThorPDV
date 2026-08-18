const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { app, BrowserWindow, ipcMain, safeStorage, dialog, shell, net } = require('electron');
const { ThorAgent } = require('./agent');
const { ThorUpdater } = require('./updater');
const { installThorAgentV3 } = require('./agent/v3');
const { installReturnFix } = require('./agent/v3-return');
const { installEnrollV3 } = require('./agent/v3-enroll');
const { installDataConsistency } = require('./agent/consistency');
const { installProfilePermissions } = require('./agent/v3-profile-permissions');
const { installAdvancedPermissions } = require('./agent/v4-permissions');
const { installSyncPolicy } = require('./agent/sync-policy');
const { installSyncRecovery } = require('./agent/recovery');
const { installCashClosing } = require('./agent/cash-closing');
const { installProductionPrinting } = require('./agent/production');
const { installPreSaleReceipt } = require('./agent/pre-sale-v064');
const { installCommercialV070 } = require('./agent/commercial-v070');
const { installSalesOptionsV071 } = require('./agent/sales-options-v071');
const { installSalesSettlementV073 } = require('./agent/sales-settlement-v073');
const { installDailyCashV083 } = require('./agent/daily-cash-v083');
const { version: DESKTOP_VERSION } = require('./package.json');
const { printService } = require('./agent/print-service');

installThorAgentV3(ThorAgent);
installReturnFix(ThorAgent);
installEnrollV3(ThorAgent);
installDataConsistency(ThorAgent);
installProfilePermissions(ThorAgent);
installAdvancedPermissions(ThorAgent);
installSyncRecovery(ThorAgent);
installCashClosing(ThorAgent);
installProductionPrinting(ThorAgent);
installPreSaleReceipt(ThorAgent);
installCommercialV070(ThorAgent);
installSalesOptionsV071(ThorAgent);
installSalesSettlementV073(ThorAgent);
installSyncPolicy(ThorAgent);
installDailyCashV083(ThorAgent);

let mainWindow;
let agent;
let updater;

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

function readPendingUpdateMarker(dataDir) {
  try { return JSON.parse(fs.readFileSync(path.join(dataDir, 'pending-update.json'), 'utf8')); }
  catch { return null; }
}

function validatedUpdateResume(marker, localCodec) {
  try {
    if (!marker?.targetVersion || String(marker.targetVersion) !== DESKTOP_VERSION) return null;
    const created = Date.parse(String(marker.createdAt || ''));
    if (!Number.isFinite(created) || Date.now() - created > 30 * 60 * 1000) return null;
    const token = String(marker.resumeToken || '');
    if (!token.startsWith('enc:')) return null;
    const claim = JSON.parse(localCodec.decrypt(token) || '{}');
    const issued = Date.parse(String(claim.issuedAt || ''));
    if (!claim.operatorId || String(claim.targetVersion) !== DESKTOP_VERSION) return null;
    if (!Number.isFinite(issued) || Date.now() - issued > 30 * 60 * 1000) return null;
    return claim;
  } catch { return null; }
}

async function createWindow() {
  const dataDir = app.getPath('userData');
  const pendingUpdate = readPendingUpdateMarker(dataDir);
  const localCodec = codec();
  const resumeClaim = validatedUpdateResume(pendingUpdate, localCodec);
  const resumeUpdate = Boolean(resumeClaim);

  agent = new ThorAgent({
    dataDir,
    apiBase: process.env.THORPDV_API_URL || 'https://thorpdv.vercel.app',
    codec: localCodec,
  });
  agent.sync.appVersion = DESKTOP_VERSION;

  // Normal startup still requires a fresh operator login. A validated update restart
  // is the only case where the existing local operator session may be resumed.
  if (!resumeUpdate && typeof agent.logoutOperator === 'function') agent.logoutOperator();
  await agent.start();

  updater = new ThorUpdater({
    agent,
    appVersion: DESKTOP_VERSION,
    apiBase: agent.apiBase,
    userDataDir: dataDir,
    tempDir: app.getPath('temp'),
    onProgress: (payload) => { try { mainWindow?.webContents.send('thor:update-progress', payload); } catch {} },
    quit: () => app.quit(),
  });

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 720,
    backgroundColor: '#f4f6f5',
    title: 'ThorPDV Desktop',
    autoHideMenuBar: true,
    show: !resumeUpdate,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  await mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  if (resumeUpdate) {
    try {
      await updater.finalizePending({ strict: true });
      // Reload after the post-update sync so operator, products and permissions are
      // rendered from the freshly synchronized local database.
      await mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
    } catch (error) {
      updater.writeHelperStatus?.('error', String(error?.message || error));
      console.error('[ThorPDV update resume]', error);
    } finally {
      mainWindow.show();
      mainWindow.focus();
    }
  } else {
    const strictResume = process.argv.includes('--thor-update-resume');
    void updater.finalizePending({ strict: strictResume }).catch((error) => {
      updater.writeHelperStatus?.('error', String(error?.message || error));
    });
  }

  void updater.check({ silent: true }).then(() => {
    try { mainWindow?.webContents.send('thor:update-status', updater.updateInfo()); } catch {}
  }).catch(() => {});
}

async function loadPrintable(doc) {
  const win = new BrowserWindow({ show: false, width: 900, height: 1200, webPreferences: { sandbox: true } });
  if (doc.kind === 'remote_pdf') {
    const rawUrl = String(doc.url || '').trim();
    let targetUrl = '';
    try { targetUrl = new URL(rawUrl, `${String(agent.apiBase || '').replace(/\/+$/, '')}/`).toString(); }
    catch { win.destroy(); throw new Error('nfce_pdf_url_unavailable'); }
    if (!/^https?:\/\//i.test(targetUrl)) { win.destroy(); throw new Error('nfce_pdf_url_unavailable'); }
    const token = agent.deviceToken();
    await win.loadURL(targetUrl, token ? { extraHeaders: `Authorization: Bearer ${token}\n` } : undefined);
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

function normalizeWhatsappPhone(value) {
  let digits = String(value || '').replace(/\D/g, '');
  digits = digits.replace(/^0+/, '');
  if (digits.length === 10 || digits.length === 11) digits = `55${digits}`;
  if (digits.length < 12 || digits.length > 15) throw new Error('whatsapp_phone_invalid');
  return digits;
}

function uniqueDownloadPath(filename) {
  const safe = String(filename || `ThorPDV-${Date.now()}.pdf`).replace(/[<>:"/\\|?*]+/g, '-');
  const first = path.join(app.getPath('downloads'), safe);
  if (!fs.existsSync(first)) return first;
  const ext = path.extname(safe) || '.pdf';
  const base = path.basename(safe, ext);
  return path.join(app.getPath('downloads'), `${base}-${Date.now()}${ext}`);
}

async function shareSaleWhatsapp(saleKey, type = 'pre_sale', phone = '') {
  if (!['pre_sale', 'nfce'].includes(type)) throw new Error('whatsapp_document_invalid');
  const normalizedPhone = normalizeWhatsappPhone(phone);
  const doc = agent.documentData(saleKey, type);
  const win = await loadPrintable(doc);
  try {
    const buffer = await win.webContents.printToPDF({ printBackground: true, preferCSSPageSize: true });
    const filePath = uniqueDownloadPath(doc.filename || `ThorPDV-${Date.now()}.pdf`);
    fs.writeFileSync(filePath, buffer);
    const sale = doc.sale || {};
    const label = type === 'nfce' ? 'NFC-e' : 'pré-venda';
    const number = sale.fiscal?.number || sale.number || '';
    const text = `Olá! Segue ${label}${number ? ` da venda ${number}` : ''} emitida pelo ThorPDV. O PDF ${path.basename(filePath)} está pronto para anexar.`;
    const url = `https://web.whatsapp.com/send?phone=${normalizedPhone}&text=${encodeURIComponent(text)}`;
    await shell.openExternal(url);
    setTimeout(() => { try { shell.showItemInFolder(filePath); } catch {} }, 700);
    return { ok: true, phone: normalizedPhone, filePath, filename: path.basename(filePath), requiresManualAttach: true };
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

async function printCashMovement(receipt) {
  const doc = agent.cashMovementDocument(receipt || {});
  const target = agent.settings().printerName;
  if (!target) throw new Error('printer_not_configured');
  if (target === '__PDF__') return saveAsPdf(doc);
  return printHtmlDocument(doc, target);
}

async function cachedProductImage(source) {
  const raw = String(source || '').trim();
  if (!raw) return '';
  if (/^data:image\//i.test(raw)) return raw;

  let target;
  try { target = new URL(raw, `${String(agent?.apiBase || '').replace(/\/+$/, '')}/`); }
  catch { return ''; }
  if (!['http:', 'https:'].includes(target.protocol)) return '';

  const cacheDir = path.join(app.getPath('userData'), 'product-image-cache');
  const cacheKey = crypto.createHash('sha256').update(target.href).digest('hex');
  await fs.promises.mkdir(cacheDir, { recursive: true });
  const extensions = ['png', 'jpg', 'webp', 'gif', 'bin'];
  for (const extension of extensions) {
    const cached = path.join(cacheDir, `${cacheKey}.${extension}`);
    if (!fs.existsSync(cached)) continue;
    const bytes = await fs.promises.readFile(cached);
    const mime = ({ png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', bin: 'application/octet-stream' })[extension];
    return `data:${mime};base64,${bytes.toString('base64')}`;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await net.fetch(target.href, { signal: controller.signal });
    if (!response.ok) return '';
    const contentType = String(response.headers.get('content-type') || '').split(';')[0].toLowerCase();
    if (!contentType.startsWith('image/')) return '';
    const bytes = Buffer.from(await response.arrayBuffer());
    if (!bytes.length || bytes.length > 8 * 1024 * 1024) return '';
    const extension = contentType.includes('png') ? 'png' : contentType.includes('webp') ? 'webp' : contentType.includes('gif') ? 'gif' : contentType.includes('jpeg') || contentType.includes('jpg') ? 'jpg' : 'bin';
    await fs.promises.writeFile(path.join(cacheDir, `${cacheKey}.${extension}`), bytes);
    return `data:${contentType};base64,${bytes.toString('base64')}`;
  } catch {
    return '';
  } finally {
    clearTimeout(timeout);
  }
}

function registerIpc() {
  const handle = (name, fn) => ipcMain.handle(name, async (_event, ...args) => fn(...args));
  handle('thor:status', async () => ({ ...(await agent.status()), appVersion: DESKTOP_VERSION, operator: agent.currentOperator(), v3Settings: agent.v3Settings(), paymentIntegrations: agent.paymentIntegrations(), syncDiagnostics: agent.syncDiagnostics(), syncPolicy: agent.syncPolicy?.() || null, update: updater?.updateInfo?.() || null }));
  handle('thor:enroll', (payload) => agent.enroll(payload));
  handle('thor:sync', () => agent.manualSync());
  handle('thor:sync-diagnostics', () => agent.syncDiagnostics());
  handle('thor:performance-metrics', (limit) => agent.store.recentMetrics(limit));
  handle('thor:record-performance', (name, durationMs, metadata) => agent.store.metric(name, durationMs, metadata));
  handle('thor:recover-sync', () => agent.recoverSync());
  handle('thor:disconnect-device', () => agent.disconnectDevice());
  handle('thor:search-products', (query) => agent.searchProducts(query));
  handle('thor:all-products', () => agent.store.searchProducts('', 5000));
  handle('thor:product-image-data', (source) => cachedProductImage(source));
  handle('thor:customers', (query) => agent.searchCustomers(query));
  handle('thor:sales-orders', (query) => agent.salesOrders(query));
  handle('thor:payment-terms', () => agent.paymentTerms());
  handle('thor:set-commercial-context', (payload) => agent.setCommercialContext(payload));
  handle('thor:quote-sale', (items, discount) => agent.quoteSale(items, discount));
  handle('thor:quote-checkout', (payload) => agent.quoteCheckout(payload));
  handle('thor:operators', () => agent.staffUsers());
  handle('thor:operator-login', (payload) => agent.loginOperator(payload));
  handle('thor:operator-logout', () => agent.logoutOperator());
  handle('thor:supervisor-authorize', (payload) => agent.authorizeSupervisor(payload));
  handle('thor:open-cash', (payload) => agent.openCash(payload));
  handle('thor:cash-movement', (payload) => agent.cashMovement(payload));
  handle('thor:cash-preview', (options) => agent.cashClosingPreview(options || {}));
  handle('thor:cash-sessions', (filters) => agent.cashSessions(filters || {}));
  handle('thor:close-historical-cash', (payload) => agent.closeHistoricalCash(payload || {}));
  handle('thor:close-cash', (payload) => agent.closeCash(payload));
  handle('thor:last-cash-close', () => agent.lastCashCloseSummary());
  handle('thor:print-cash-close', (summary) => printCashClose(summary));
  handle('thor:print-cash-movement', (receipt) => printCashMovement(receipt));
  handle('thor:finalize-sale', (payload) => agent.finalizeSale(payload));
  handle('thor:save-term-duplicates-pdf', (payload) => saveAsPdf(agent.termDuplicateDocument(payload || {})));
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
  handle('thor:share-sale-whatsapp', (saleKey, type, phone) => shareSaleWhatsapp(saleKey, type, phone));
  handle('thor:update-info', () => updater?.updateInfo?.() || { currentVersion: DESKTOP_VERSION });
  handle('thor:check-update', () => updater.check());
  handle('thor:install-update', () => updater.install());
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
  try { printService().stop(); } catch {}
  if (agent) await agent.stop();
  if (process.platform !== 'darwin') app.quit();
});
