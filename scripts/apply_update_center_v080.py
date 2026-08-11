from pathlib import Path
import json

# --- ThorControl navigation -------------------------------------------------
p=Path('src/app/control/control-client.tsx'); s=p.read_text(encoding='utf-8')
s=s.replace("import { controlCreateCustomer, controlFiscalDetail, controlLogout, controlSavePricing, controlUpdateLicense, controlDashboard } from './actions';", "import { controlCreateCustomer, controlFiscalDetail, controlLogout, controlSavePricing, controlUpdateLicense, controlDashboard } from './actions';\nimport UpdateCenter from './update-center';", 1)
s=s.replace("type View='overview'|'clients'|'fiscal'|'pricing';", "type View='overview'|'clients'|'fiscal'|'pricing'|'updates';", 1)
s=s.replace("{nav('fiscal','Monitor Fiscal','⌁')}{nav('pricing','Tabela Comercial','R$')}", "{nav('fiscal','Monitor Fiscal','⌁')}{nav('updates','Atualizações','↻')}{nav('pricing','Tabela Comercial','R$')}", 1)
s=s.replace("<h1>{view==='overview'?'Visão Geral':view==='clients'?'Clientes & Licenças':view==='fiscal'?'Monitor Fiscal':'Tabela Comercial'}</h1><p>{view==='fiscal'?'Acompanhe NF-e/NFC-e de todas as lojas em um só lugar.':'Controle comercial e operacional do ecossistema Thor.'}</p></div><button className=\"control-primary\" onClick={()=>setNewOpen(true)}>+ Novo cliente</button>", "<h1>{view==='overview'?'Visão Geral':view==='clients'?'Clientes & Licenças':view==='fiscal'?'Monitor Fiscal':view==='updates'?'Controle de Atualizações':'Tabela Comercial'}</h1><p>{view==='fiscal'?'Acompanhe NF-e/NFC-e de todas as lojas em um só lugar.':view==='updates'?'Libere versões, acompanhe a frota e faça rollback controlado do ThorPDV.':'Controle comercial e operacional do ecossistema Thor.'}</p></div>{view!=='updates'&&<button className=\"control-primary\" onClick={()=>setNewOpen(true)}>+ Novo cliente</button>}", 1)
pricing_marker="  {view==='pricing'&&<section className=\"control-grid-two pricing-grid\">"
if pricing_marker in s and "view==='updates'&&<UpdateCenter" not in s:
    s=s.replace(pricing_marker, "  {view==='updates'&&<UpdateCenter/>}\n"+pricing_marker, 1)
p.write_text(s,encoding='utf-8')

# UpdateCenter TS normalization
p=Path('src/app/control/update-center.tsx'); s=p.read_text(encoding='utf-8')
s=s.replace("import { useEffect, useMemo, useState } from 'react';", "import { FormEvent, useEffect, useMemo, useState } from 'react';", 1)
s=s.replace("  async function load() {\n    const result = await controlUpdateDashboard();\n    if (!result?.ok) { setMessage(result?.error || 'Não foi possível carregar o Update Center.'); return; }\n    setData({\n      summary: result.summary || {}, releases: result.releases || [], tenants: result.tenants || [],\n      policies: result.policies || [], devices: result.devices || [], events: result.events || [],\n    });\n  }", "  async function load() {\n    const result = await controlUpdateDashboard();\n    if (!result?.ok) { setMessage(result?.error || 'Não foi possível carregar o Update Center.'); return; }\n    const raw=result as Record<string,unknown>;\n    setData({\n      summary:(raw.summary&&typeof raw.summary==='object'?raw.summary:{}) as Row,\n      releases:Array.isArray(raw.releases)?raw.releases as Row[]:[],\n      tenants:Array.isArray(raw.tenants)?raw.tenants as Row[]:[],\n      policies:Array.isArray(raw.policies)?raw.policies as Row[]:[],\n      devices:Array.isArray(raw.devices)?raw.devices as Row[]:[],\n      events:Array.isArray(raw.events)?raw.events as Row[]:[],\n    });\n  }", 1)
s=s.replace("async function saveRelease(e: React.FormEvent)", "async function saveRelease(e: FormEvent)", 1)
p.write_text(s,encoding='utf-8')

# Control CSS
p=Path('src/app/control/control.css'); s=p.read_text(encoding='utf-8')
css=r'''

/* ThorControl Update Center v0.8.0 */
.update-center{display:grid;gap:18px}.control-summary-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px}.control-summary-grid article{background:#fff;border:1px solid #e4e9e6;border-radius:14px;padding:16px;display:grid;gap:5px}.control-summary-grid article span{font-size:11px;color:#77817c;font-weight:700;text-transform:uppercase;letter-spacing:.05em}.control-summary-grid article strong{font-size:24px;color:#18231e}.control-summary-grid article small{color:#7b8680}.control-inline-message{padding:11px 13px;border-radius:10px;background:#eaf6ef;color:#276748;border:1px solid #cfe8d9}.update-policy-grid,.update-release-form{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}.update-policy-grid label,.update-release-form label{display:grid;gap:6px}.update-policy-grid label span,.update-release-form label span{font-size:11px;font-weight:800;color:#5d6963}.update-policy-grid input,.update-policy-grid select,.update-release-form input,.update-release-form select,.update-release-form textarea{width:100%;border:1px solid #dce3df;background:#fff;border-radius:9px;padding:10px 11px;color:#1f2b25}.update-policy-reason,.update-release-form .wide{grid-column:1/-1}.update-warning{margin-top:12px;padding:10px 12px;border-radius:9px;background:#fff7e5;border:1px solid #ecd9aa;color:#765a16;font-size:12px;line-height:1.45}.update-row-actions{display:flex;gap:7px;flex-wrap:wrap}.update-row-actions button,.ghost-link,.danger-link{border:0;background:transparent;padding:3px 5px;cursor:pointer;color:#326b50;font-weight:700}.danger-link{color:#a63b43!important}.ghost-link{color:#6f7b75!important}.update-state{display:inline-flex;padding:5px 8px;border-radius:999px;font-size:11px;font-weight:800}.update-state.current{background:#e7f5ed;color:#26704a}.update-state.upgrade{background:#fff2d9;color:#8a5a00}.update-state.rollback{background:#ffebec;color:#9b3038}.update-state.none{background:#edf0ee;color:#6e7973}.control-badge.published{background:#e7f5ed;color:#26704a}.control-badge.blocked{background:#ffebec;color:#9b3038}.control-badge.draft{background:#fff2d9;color:#8a5a00}.control-badge.archived{background:#edf0ee;color:#6e7973}.update-center code{font-size:10px;max-width:340px;white-space:normal;word-break:break-all}.control-actions{display:flex;justify-content:flex-end;gap:9px;margin-top:12px}.control-actions .ghost{background:#fff;color:#54635c;border:1px solid #dce3df}@media(max-width:1100px){.control-summary-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.update-policy-grid,.update-release-form{grid-template-columns:1fr 1fr}}@media(max-width:760px){.control-summary-grid,.update-policy-grid,.update-release-form{grid-template-columns:1fr}.update-policy-reason,.update-release-form .wide{grid-column:auto}}
'''
if 'ThorControl Update Center v0.8.0' not in s: s+=css
p.write_text(s,encoding='utf-8')

# --- Desktop main updater integration --------------------------------------
p=Path('desktop-pdv/main.js'); s=p.read_text(encoding='utf-8')
s=s.replace("const { ThorAgent } = require('./agent');", "const { ThorAgent } = require('./agent');\nconst { ThorUpdater } = require('./updater');", 1)
s=s.replace("let mainWindow;\nlet agent;", "let mainWindow;\nlet agent;\nlet updater;", 1)
s=s.replace("  await agent.start();\n\n  mainWindow = new BrowserWindow", "  await agent.start();\n  updater = new ThorUpdater({\n    agent,\n    appVersion: DESKTOP_VERSION,\n    apiBase: agent.apiBase,\n    userDataDir: app.getPath('userData'),\n    tempDir: app.getPath('temp'),\n    onProgress: (payload) => { try { mainWindow?.webContents.send('thor:update-progress', payload); } catch {} },\n    quit: () => app.quit(),\n  });\n\n  mainWindow = new BrowserWindow", 1)
s=s.replace("  await mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));\n}", "  await mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));\n  void updater.finalizePending().catch(() => {});\n  void updater.check({ silent: true }).then(() => { try { mainWindow?.webContents.send('thor:update-status', updater.updateInfo()); } catch {} }).catch(() => {});\n}", 1)
s=s.replace("syncPolicy: agent.syncPolicy?.() || null }));", "syncPolicy: agent.syncPolicy?.() || null, update: updater?.updateInfo?.() || null }));", 1)
s=s.replace("  handle('thor:share-sale-whatsapp', (saleKey, type, phone) => shareSaleWhatsapp(saleKey, type, phone));\n  handle('thor:print-last'", "  handle('thor:share-sale-whatsapp', (saleKey, type, phone) => shareSaleWhatsapp(saleKey, type, phone));\n  handle('thor:update-info', () => updater?.updateInfo?.() || { currentVersion: DESKTOP_VERSION });\n  handle('thor:check-update', () => updater.check());\n  handle('thor:install-update', () => updater.install());\n  handle('thor:print-last'", 1)
p.write_text(s,encoding='utf-8')

# Preload bridge
p=Path('desktop-pdv/preload.js'); s=p.read_text(encoding='utf-8')
s=s.replace("  shareSaleWhatsapp: (saleKey, type = 'pre_sale', phone = '') => ipcRenderer.invoke('thor:share-sale-whatsapp', saleKey, type, phone),", "  shareSaleWhatsapp: (saleKey, type = 'pre_sale', phone = '') => ipcRenderer.invoke('thor:share-sale-whatsapp', saleKey, type, phone),\n  updateInfo: () => ipcRenderer.invoke('thor:update-info'),\n  checkForUpdates: () => ipcRenderer.invoke('thor:check-update'),\n  installUpdate: () => ipcRenderer.invoke('thor:install-update'),\n  onUpdateProgress: (callback) => { const handler=(_event,payload)=>callback(payload); ipcRenderer.on('thor:update-progress',handler); return ()=>ipcRenderer.removeListener('thor:update-progress',handler); },\n  onUpdateStatus: (callback) => { const handler=(_event,payload)=>callback(payload); ipcRenderer.on('thor:update-status',handler); return ()=>ipcRenderer.removeListener('thor:update-status',handler); },", 1)
p.write_text(s,encoding='utf-8')

# Use package version everywhere, including enrollment/heartbeat context.
p=Path('desktop-pdv/agent/index.js'); s=p.read_text(encoding='utf-8')
s=s.replace("const APP_VERSION='0.2.0';", "const { version: APP_VERSION } = require('../package.json');", 1)
p.write_text(s,encoding='utf-8')

# Renderer bundle
p=Path('desktop-pdv/renderer/index.html'); s=p.read_text(encoding='utf-8')
s=s.replace('<link rel="stylesheet" href="sales-settlement-v073.css">', '<link rel="stylesheet" href="sales-settlement-v073.css"><link rel="stylesheet" href="update-center.css">', 1)
s=s.replace('<script src="sales-settlement-v073.js"></script></body>', '<script src="sales-settlement-v073.js"></script><script src="update-center.js"></script></body>', 1)
p.write_text(s,encoding='utf-8')

# Package version / include updater
p=Path('desktop-pdv/package.json'); pkg=json.loads(p.read_text(encoding='utf-8'))
pkg['version']='0.8.0'
files=pkg.get('build',{}).get('files',[])
if 'updater.js' not in files:
    try: files.insert(files.index('preload.js')+1,'updater.js')
    except ValueError: files.append('updater.js')
pkg['build']['files']=files
p.write_text(json.dumps(pkg,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')

# GitHub Actions: validate updater and publish durable public release assets.
p=Path('.github/workflows/pdv-desktop.yml'); s=p.read_text(encoding='utf-8')
if 'permissions:\n  contents: write' not in s:
    s=s.replace("# v0.7.4: fiscal transmission diagnostics, SEFAZ progress and event log\n", "permissions:\n  contents: write\n\n# ThorPDV Desktop build + durable release assets\n", 1)
s=s.replace("            'main.js',\n            'preload.js',", "            'main.js',\n            'preload.js',\n            'updater.js',", 1)
s=s.replace("      - name: Upload installer\n        uses: actions/upload-artifact@v4", "      - name: Generate SHA-256\n        shell: pwsh\n        run: |\n          $exe = Get-ChildItem dist\\ThorPDV-Desktop-*-x64.exe | Select-Object -First 1\n          if (-not $exe) { throw 'Installer not found' }\n          $hash = (Get-FileHash $exe.FullName -Algorithm SHA256).Hash.ToLower()\n          Set-Content -Path ($exe.FullName + '.sha256') -Value ($hash + '  ' + $exe.Name) -Encoding ascii\n          Write-Host ('SHA256 ' + $hash)\n\n      - name: Upload installer\n        uses: actions/upload-artifact@v4", 1)
s=s.replace("          path: desktop-pdv/dist/*.exe\n          if-no-files-found: error\n          retention-days: 14", "          path: |\n            desktop-pdv/dist/*.exe\n            desktop-pdv/dist/*.sha256\n          if-no-files-found: error\n          retention-days: 14\n\n      - name: Publish durable GitHub Release assets\n        shell: pwsh\n        env:\n          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}\n        run: |\n          $pkg = Get-Content package.json | ConvertFrom-Json\n          $tag = 'pdv-v' + $pkg.version\n          $exe = Get-ChildItem dist\\ThorPDV-Desktop-*-x64.exe | Select-Object -First 1\n          $sha = $exe.FullName + '.sha256'\n          gh release view $tag 2>$null | Out-Null\n          if ($LASTEXITCODE -ne 0) {\n            gh release create $tag --title ('ThorPDV Desktop ' + $pkg.version) --notes ('ThorPDV Desktop ' + $pkg.version + '. A distribuição aos clientes é controlada pelo ThorControl.')\n          }\n          gh release upload $tag $exe.FullName $sha --clobber", 1)
p.write_text(s,encoding='utf-8')

# Assertions
checks={
 'src/app/control/control-client.tsx':['UpdateCenter','Atualizações','Controle de Atualizações'],
 'desktop-pdv/main.js':['ThorUpdater','thor:check-update','thor:install-update'],
 'desktop-pdv/preload.js':['checkForUpdates','installUpdate','onUpdateProgress'],
 'desktop-pdv/renderer/index.html':['update-center.css','update-center.js'],
 '.github/workflows/pdv-desktop.yml':['Publish durable GitHub Release assets','updater.js'],
}
for file,needles in checks.items():
    content=Path(file).read_text(encoding='utf-8')
    missing=[n for n in needles if n not in content]
    if missing: raise SystemExit(f'{file}: missing {missing}')
print('Update Center v0.8.0 integration patch applied')
