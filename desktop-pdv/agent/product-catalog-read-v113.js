const path = require('path');
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

function localCatalog() {
  let db;
  try {
    db = new Database(path.join(app.getPath('userData'), 'thorpdv-local.db'), {
      readonly: true,
      fileMustExist: true,
    });
    const tokenRow = db.prepare("select value from settings where key='device_token'").get();
    const rows = db.prepare(`
      select p.id,p.sku,p.name,p.sale_price,p.barcodes,
             coalesce(i.quantity,0) quantity,
             coalesce(pi.price,p.sale_price) base_price
      from products p
      left join inventory i on i.product_id=p.id
      left join price_items pi on pi.product_id=p.id
      where p.active=1
      order by p.name
    `).all();
    return {
      token: decodeDeviceToken(tokenRow?.value),
      products: rows.map(row => ({
        id: String(row.id || ''),
        name: String(row.name || ''),
        product_code: '',
        sku: String(row.sku || ''),
        ncm: '',
        barcodes: (() => { try { return JSON.parse(row.barcodes || '[]'); } catch { return []; } })(),
        price: Number(row.base_price ?? row.sale_price ?? 0),
        stock: Number(row.quantity || 0),
        price_table: 'Tabela sincronizada neste caixa',
      })),
    };
  } catch {
    return { token: '', products: [] };
  } finally {
    try { db?.close(); } catch {}
  }
}

function normalizePull(data) {
  const inventory = new Map((Array.isArray(data?.inventory) ? data.inventory : []).map(row => [String(row.product_id || ''), Number(row.quantity || 0)]));
  const prices = new Map((Array.isArray(data?.price_items) ? data.price_items : []).map(row => [String(row.product_id || ''), Number(row.price || 0)]));
  const priceTable = data?.context?.price_table_id ? 'Tabela de preço vigente' : 'Preço padrão do produto';
  return (Array.isArray(data?.products) ? data.products : [])
    .filter(product => product && product.active !== false)
    .map(product => {
      const id = String(product.id || '');
      return {
        id,
        name: String(product.name || ''),
        product_code: String(product.product_code ?? ''),
        sku: String(product.sku || ''),
        ncm: String(product.ncm || ''),
        barcodes: Array.isArray(product.barcodes) ? product.barcodes.map(String) : [],
        price: prices.has(id) ? Number(prices.get(id)) : Number(product.sale_price || 0),
        stock: Number(inventory.get(id) ?? 0),
        price_table: priceTable,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
}

async function postJson(url, token, body) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify(body || {}),
      signal: controller.signal,
    });
    const data = await response.json().catch(() => ({}));
    return { response, data };
  } finally {
    clearTimeout(timeout);
  }
}

async function remoteCatalog(token) {
  if (!token) throw new Error('device_token_unavailable');
  const apiBase = process.env.THORPDV_API_URL || 'https://thorpdv.vercel.app';

  const primary = await postJson(`${apiBase}/api/pdv/catalog`, token, {});
  if (primary.response.ok && primary.data?.ok) {
    return {
      ok: true,
      source: 'online',
      products: Array.isArray(primary.data.products) ? primary.data.products : [],
      loaded_at: new Date().toISOString(),
    };
  }

  if (primary.response.status !== 404) {
    throw new Error(primary.data?.error || `catalog_http_${primary.response.status}`);
  }

  const fallback = await postJson(`${apiBase}/api/pdv/pull`, token, { since: null });
  if (!fallback.response.ok || !fallback.data?.ok) {
    throw new Error(fallback.data?.error || `pull_http_${fallback.response.status}`);
  }
  return {
    ok: true,
    source: 'online',
    products: normalizePull(fallback.data),
    loaded_at: new Date().toISOString(),
  };
}

function installProductCatalogReadV113() {
  if (global.__thorProductCatalogReadV113) return;
  global.__thorProductCatalogReadV113 = true;
  ipcMain.handle('thor:product-catalog-read', async () => {
    const local = localCatalog();
    try { return await remoteCatalog(local.token); }
    catch (error) {
      return {
        ok: true,
        source: 'offline',
        products: local.products,
        warning: String(error?.message || 'offline'),
        loaded_at: new Date().toISOString(),
      };
    }
  });
}

module.exports = { installProductCatalogReadV113 };
