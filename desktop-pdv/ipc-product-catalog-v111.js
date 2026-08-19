const path = require('path');
const Database = require('better-sqlite3');
const { app, ipcMain, safeStorage } = require('electron');

function readSetting(db, key, fallback = '') {
  try {
    const row = db.prepare('select value from settings where key=?').get(key);
    return row ? String(row.value ?? '') : fallback;
  } catch {
    return fallback;
  }
}

function decryptToken(value) {
  const raw = String(value || '');
  if (!raw) return '';
  if (raw.startsWith('plain:')) return raw.slice(6);
  if (!raw.startsWith('enc:') || !safeStorage.isEncryptionAvailable()) return '';
  try {
    return safeStorage.decryptString(Buffer.from(raw.slice(4), 'base64'));
  } catch {
    return '';
  }
}

function parseJson(value, fallback) {
  try {
    return JSON.parse(String(value || ''));
  } catch {
    return fallback;
  }
}

function localCatalog() {
  let db;
  try {
    const dbPath = path.join(app.getPath('userData'), 'thorpdv-local.db');
    db = new Database(dbPath, { readonly: true, fileMustExist: true });
    const rows = db.prepare(`
      select p.*, coalesce(i.quantity,0) quantity, coalesce(pi.price,p.sale_price) base_price
      from products p
      left join inventory i on i.product_id=p.id
      left join price_items pi on pi.product_id=p.id
      where p.active=1
      order by p.name
    `).all().map((row) => ({
      ...row,
      product_code: String(row.product_code || row.sku || ''),
      ncm: String(row.ncm || ''),
      barcodes: parseJson(row.barcodes, []),
      quantity: Number(row.quantity || 0),
      base_price: Number(row.base_price || row.sale_price || 0),
    }));
    const context = parseJson(readSetting(db, 'context', '{}'), {});
    return { products: rows, context };
  } catch {
    return { products: [], context: {} };
  } finally {
    try { db?.close(); } catch {}
  }
}

async function remoteCatalog(token) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const apiBase = String(process.env.THORPDV_API_URL || 'https://thorpdv.vercel.app').replace(/\/+$/, '');
    const response = await fetch(`${apiBase}/api/pdv/pull`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ since: null }),
      signal: controller.signal,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data?.ok) throw new Error(data?.error || `http_${response.status}`);

    const stock = new Map((data.inventory || []).map((row) => [
      String(row.product_id || ''),
      Number(row.quantity || 0),
    ]));
    const prices = new Map((data.price_items || []).map((row) => [
      String(row.product_id || ''),
      Number(row.price || 0),
    ]));

    const products = (data.products || [])
      .filter((product) => product && product.active !== false)
      .map((product) => {
        const id = String(product.id || '');
        return {
          ...product,
          id,
          product_code: String(product.product_code || product.code || product.sku || ''),
          sku: String(product.sku || ''),
          ncm: String(product.ncm || ''),
          barcodes: Array.isArray(product.barcodes) ? product.barcodes : [],
          quantity: stock.has(id) ? Number(stock.get(id) || 0) : 0,
          base_price: prices.has(id)
            ? Number(prices.get(id) || 0)
            : Number(product.sale_price || 0),
        };
      });

    return {
      ok: true,
      source: 'server',
      products,
      context: data.context || {},
    };
  } finally {
    clearTimeout(timeout);
  }
}

function installProductCatalogIpcV111() {
  ipcMain.handle('thor:product-catalog-v111', async () => {
    const fallback = localCatalog();
    let token = '';
    let db;
    try {
      const dbPath = path.join(app.getPath('userData'), 'thorpdv-local.db');
      db = new Database(dbPath, { readonly: true, fileMustExist: true });
      token = decryptToken(readSetting(db, 'device_token', ''));
    } catch {
      token = '';
    } finally {
      try { db?.close(); } catch {}
    }

    if (!token) {
      return {
        ok: true,
        source: 'local',
        offline: true,
        products: fallback.products,
        context: fallback.context,
      };
    }

    try {
      return await remoteCatalog(token);
    } catch (error) {
      return {
        ok: true,
        source: 'local',
        offline: true,
        warning: String(error?.message || error || 'catalog_unavailable'),
        products: fallback.products,
        context: fallback.context,
      };
    }
  });
}

module.exports = { installProductCatalogIpcV111 };