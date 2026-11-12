import { cp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';

const source = resolve('../desktop-pdv/renderer');
const target = resolve('ui');
await mkdir(target, { recursive: true });
await cp(source, target, { recursive: true, force: true });
const indexPath = join(target, 'index.html');
const html = await readFile(indexPath, 'utf8');
const injected = html.replace('</head>', '<script src="tauri-prototype-bridge.js"></script></head>');
if (injected === html) throw new Error('Missing closing head in original renderer');
await writeFile(indexPath, injected);
await writeFile(join(target, 'tauri-prototype-bridge.js'), `/* Experimental bridge; no production operations. */
(() => {
  const reason = 'Protótipo Tauri: backend ThorPDV ainda não conectado. Operação indisponível.';
  const fail = () => Promise.reject(new Error(reason));
  const actions = [
    'status','enroll','checkDeviceAccess','sync','syncDiagnostics','performanceMetrics','recordPerformance',
    'recoverSync','disconnectDevice','searchProducts','allProducts','productImageData','customers','catalogSave',
    'catalogStatus','catalogSync','catalogRetry','catalogDiscard','salesOrders','paymentTerms','setCommercialContext',
    'quoteSale','quoteCheckout','operators','operatorLogin','operatorLogout','supervisorAuthorize','openCash',
    'cashMovement','cashPreview','cashSessions','closeHistoricalCash','closeCash','lastCashClose','printCashClose',
    'printCashMovement','receivables','receiveReceivables','printReceivableReceipt','finalizeSale','saveTermDuplicatesPdf',
    'cancelSale','printSaleCancellation','returnSale','storeCreditVoucher','storeCreditVouchers','requestNfce',
    'fiscalSales','fiscalSale','printers','serialPorts','settings','saveSettings','v3Settings','saveV3Settings',
    'setPrinter','openDrawer','readScale','readUranoPopS','paymentIntegrations','beginPayment','printSale',
    'shareSaleWhatsapp','updateInfo','checkForUpdates','installUpdate','operationHistory','reprintOperation',
    'pendingOperations','retryOperation','retryPendingOperations','authorizeSensitiveAction','draftSales',
    'saveDraftSale','loadDraftSale','completeDraftSale','deleteDraftSale','printLast'
  ];
  const bridge = Object.fromEntries(actions.map(name => [name, fail]));
  bridge.onUpdateProgress = () => () => {};
  bridge.onUpdateStatus = () => () => {};
  Object.defineProperty(window, 'thor', { configurable: false, writable: false, value: bridge });
  document.addEventListener('DOMContentLoaded', () => {
    const banner = document.createElement('aside');
    banner.setAttribute('role', 'status');
    banner.style.cssText = 'position:fixed;left:0;right:0;top:0;z-index:2147483647;background:#6b2b00;color:#fff;padding:8px 14px;font:600 13px system-ui;text-align:center';
    banner.textContent = 'PROTÓTIPO TAURI 2 — somente avaliação visual. Vendas, caixa e periféricos indisponíveis.';
    document.body.appendChild(banner);
  });
})();`);
console.log('Original ThorPDV renderer copied to Tauri prototype:', target);
