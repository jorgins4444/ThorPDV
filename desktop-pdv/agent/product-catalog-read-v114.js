const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const { app, ipcMain, safeStorage } = require('electron');

function decodeDeviceToken(value) {
  const raw = String(value || '');
  if (!raw) return '';
  if (raw.startsWith('plain:')) return raw.slice(6);
  if (!raw.startsWith('enc:') || !safeStorage.isEncryptionAvailable()) return '';
  try { return safeStorage.decryptString(Buffer.from(raw.slice(4), 'base64')); }
  catch { return ''; }
}

function cachePath() {
  return path.join(app.getPath('userData'), 'product-catalog-v114.json');
}

function readCatalogCache() {
  try {
    const data = JSON.parse(fs.readFileSync(cachePath(), 'utf8'));
    return Array.isArray(data?.products) ? data.products : [];
  } catch {
    return [];
  }
}

function writeCatalogCache(products) {
  try {
    fs.writeFileSync(cachePath(), JSON.stringify({ saved_at: new Date().toISOString(), products }, null, 0), 'utf8');
  } catch {}
}

function localCatalog() {
  let db;
  try {
    db = new Database(path.join(app.getPath('userData'), 'thorpdv-local.db'), { readonly: true, fileMustExist: true });
    const tokenRow = db.prepare("select value from settings where key='device_token'").get();
    const columns = new Set(db.prepare('pragma table_info(products)').all().map(row => String(row.name || '')));
    const ncmExpr = columns.has('ncm') ? "coalesce(p.ncm,'')" : "''";
    const brandColumn = ['brand','marca','brand_name'].find(name => columns.has(name));
    const brandExpr = brandColumn ? `coalesce(p.${brandColumn},'')` : "''";
    const rows = db.prepare(`
      select p.id,p.sku,p.name,p.sale_price,p.barcodes,
             ${ncmExpr} ncm,
             ${brandExpr} brand,
             coalesce(i.quantity,0) quantity
      from products p
      left join inventory i on i.product_id=p.id
      where p.active=1
      order by p.name
    `).all();

    return {
      token: decodeDeviceToken(tokenRow?.value),
      products: rows.map(row => ({
        id: String(row.id || ''),
        name: String(row.name || ''),
        product_code: String(row.sku || ''),
        sku: String(row.sku || ''),
        ncm: String(row.ncm || ''),
        brand: String(row.brand || ''),
        barcodes: (() => { try { return JSON.parse(row.barcodes || '[]'); } catch { return []; } })(),
        price: Number(row.sale_price || 0),
        stock: Number(row.quantity || 0),
      })),
    };
  } catch {
    return { token: '', products: [] };
  } finally {
    try { db?.close(); } catch {}
  }
}

function mergeOfflineCatalog(localProducts, cachedProducts) {
  const cache = new Map((cachedProducts || []).map(product => [String(product.id || product.product_code || ''), product]));
  return (localProducts || []).map(product => {
    const cached = cache.get(String(product.id || product.product_code || '')) || {};
    return {
      ...cached,
      ...product,
      ncm: String(product.ncm || cached.ncm || ''),
      brand: String(product.brand || cached.brand || ''),
      price: Number(product.price ?? cached.price ?? 0),
      stock: Number(product.stock ?? cached.stock ?? 0),
    };
  });
}

function normalizePull(data) {
  const inventory = new Map((Array.isArray(data?.inventory) ? data.inventory : []).map(row => [String(row.product_id || ''), Number(row.quantity || 0)]));
  const prices = new Map((Array.isArray(data?.price_items) ? data.price_items : []).map(row => [String(row.product_id || ''), Number(row.price || 0)]));

  return (Array.isArray(data?.products) ? data.products : [])
    .filter(product => product && product.active !== false)
    .map(product => {
      const id = String(product.id || '');
      return {
        id,
        name: String(product.name || ''),
        product_code: String(product.product_code || product.sku || ''),
        sku: String(product.sku || ''),
        ncm: String(product.ncm || product.ncm_code || ''),
        brand: String(product.brand || product.marca || product.brand_name || product.manufacturer || ''),
        barcodes: Array.isArray(product.barcodes) ? product.barcodes.map(String) : [],
        price: prices.has(id) ? Number(prices.get(id)) : Number(product.sale_price || 0),
        stock: Number(inventory.get(id) ?? 0),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
}

async function remoteCatalog(token) {
  if (!token) throw new Error('device_token_unavailable');
  const apiBase = process.env.THORPDV_API_URL || 'https://thorpdv.vercel.app';
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(`${apiBase}/api/pdv/pull`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ since: null }),
      signal: controller.signal,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data?.ok) throw new Error(data?.error || `catalog_http_${response.status}`);
    const products = normalizePull(data);
    writeCatalogCache(products);
    return { ok: true, source: 'online', products, loaded_at: new Date().toISOString() };
  } finally {
    clearTimeout(timeout);
  }
}

function installProductCatalogReadV114() {
  if (global.__thorProductCatalogReadV114) return;
  global.__thorProductCatalogReadV114 = true;
  ipcMain.handle('thor:product-catalog-read-v114', async () => {
    const local = localCatalog();
    try {
      return await remoteCatalog(local.token);
    } catch (error) {
      const products = mergeOfflineCatalog(local.products, readCatalogCache());
      return { ok: true, source: 'offline', products, warning: String(error?.message || 'offline'), loaded_at: new Date().toISOString() };
    }
  });
}

module.exports = { installProductCatalogReadV114 };
