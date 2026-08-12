from pathlib import Path
import re

# 1) Version badge always visible in the Desktop topbar.
app_path = Path('desktop-pdv/renderer/app.js')
app = app_path.read_text(encoding='utf-8')
old_status = '<span id="status" class="status"><i></i><b></b></span><button class="secondary" id="sync">'
new_status = '<span id="status" class="status"><i></i><b></b></span><span class="pdv-version-chip" title="Versão atual do ThorPDV">v${esc(state.status?.appVersion||\'—\')}</span><button class="secondary" id="sync">'
if 'pdv-version-chip' not in app:
    if old_status not in app:
        raise SystemExit('app.js: topbar status marker not found')
    app = app.replace(old_status, new_status, 1)
app_path.write_text(app, encoding='utf-8')

# 2) Resume the operator only for a fresh, validated update restart.
main_path = Path('desktop-pdv/main.js')
main = main_path.read_text(encoding='utf-8')
start = main.find('async function createWindow() {')
end = main.find('\nasync function loadPrintable', start)
if start < 0 or end < 0:
    raise SystemExit('main.js: createWindow markers not found')
new_window = r'''function readPendingUpdateMarker(dataDir) {
  try { return JSON.parse(fs.readFileSync(path.join(dataDir, 'pending-update.json'), 'utf8')); }
  catch { return null; }
}

function isFreshUpdateResume(marker) {
  if (!marker?.targetVersion || String(marker.targetVersion) !== DESKTOP_VERSION) return false;
  const created = Date.parse(String(marker.createdAt || ''));
  return Number.isFinite(created) && Date.now() - created < 30 * 60 * 1000;
}

async function createWindow() {
  const dataDir = app.getPath('userData');
  const pendingUpdate = readPendingUpdateMarker(dataDir);
  const resumeUpdate = isFreshUpdateResume(pendingUpdate);

  agent = new ThorAgent({
    dataDir,
    apiBase: process.env.THORPDV_API_URL || 'https://thorpdv.vercel.app',
    codec: codec(),
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
'''
main = main[:start] + new_window + main[end:]
main_path.write_text(main, encoding='utf-8')

# 3) ThorControl: structured release notes while keeping release_notes backward compatible.
control_path = Path('src/app/control/update-center.tsx')
control = control_path.read_text(encoding='utf-8')

helper_marker = "const dt = (v: unknown) => v ? new Date(String(v)).toLocaleString('pt-BR') : '—';\n"
helpers = r'''const dt = (v: unknown) => v ? new Date(String(v)).toLocaleString('pt-BR') : '—';
const releaseLines = (value: string) => value.split(/\r?\n/).map(v => v.trim().replace(/^[-•*]\s*/, '')).filter(Boolean);
function composeReleaseNotes(form: { changes: string; improvements: string; fixes: string }) {
  const groups: Array<[string,string[]]> = [
    ['MUDANÇAS', releaseLines(form.changes)],
    ['MELHORIAS', releaseLines(form.improvements)],
    ['CORREÇÕES', releaseLines(form.fixes)],
  ];
  return groups.filter(([,items]) => items.length).map(([title,items]) => `${title}\n${items.map(item => `- ${item}`).join('\n')}`).join('\n\n');
}
function releaseNotesPreview(value: unknown) {
  const lines = text(value).split(/\r?\n/).map(v => v.trim()).filter(Boolean).filter(v => !/^(MUDANÇAS|MELHORIAS|CORREÇÕES)$/i.test(v));
  return lines.map(v => v.replace(/^[-•*]\s*/, '')).slice(0, 5).join(' • ') || 'Sem notas cadastradas';
}
'''
if 'composeReleaseNotes' not in control:
    if helper_marker not in control:
        raise SystemExit('control: helper marker not found')
    control = control.replace(helper_marker, helpers, 1)

old_state = "const [releaseForm, setReleaseForm] = useState({ version: '', channel: 'stable', status: 'published', download_url: '', sha256: '', release_notes: '' });"
new_state = "const [releaseForm, setReleaseForm] = useState({ version: '', channel: 'stable', status: 'published', download_url: '', sha256: '', changes: '', improvements: '', fixes: '' });"
if old_state in control:
    control = control.replace(old_state, new_state, 1)
elif new_state not in control:
    raise SystemExit('control: release form state marker not found')

save_start = control.find('  async function saveRelease(e: FormEvent) {')
save_end = control.find('\n\n  async function applyPolicy()', save_start)
if save_start < 0 or save_end < 0:
    raise SystemExit('control: saveRelease markers not found')
new_save = r'''  async function saveRelease(e: FormEvent) {
    e.preventDefault(); setMessage('');
    const release_notes = composeReleaseNotes(releaseForm);
    if (!release_notes) { setMessage('Informe ao menos uma mudança, melhoria ou correção desta versão.'); return; }
    setBusy(true);
    try {
      const { changes, improvements, fixes, ...base } = releaseForm;
      const result = await controlReleaseSave({ ...base, release_notes });
      if (!result?.ok) throw new Error(result?.error || 'release_save_failed');
      setMessage(`Versão ${releaseForm.version} cadastrada com notas de atualização.`);
      setReleaseForm({ version: '', channel: 'stable', status: 'published', download_url: '', sha256: '', changes: '', improvements: '', fixes: '' });
      await load();
    } catch (err) { setMessage(String((err as Error).message || err)); }
    finally { setBusy(false); }
  }'''
control = control[:save_start] + new_save + control[save_end:]

old_notes = '''        <label className="wide"><span>Notas da versão</span><textarea rows={3} value={releaseForm.release_notes} onChange={e => setReleaseForm(f => ({ ...f, release_notes: e.target.value }))} placeholder="Correções e novidades mostradas no PDV." /></label>'''
new_notes = '''        <label className="wide"><span>Mudanças e novidades</span><textarea rows={3} value={releaseForm.changes} onChange={e => setReleaseForm(f => ({ ...f, changes: e.target.value }))} placeholder="Uma mudança por linha. Ex.: Nova tela de atualização contínua" /></label>
        <label className="wide"><span>Melhorias</span><textarea rows={3} value={releaseForm.improvements} onChange={e => setReleaseForm(f => ({ ...f, improvements: e.target.value }))} placeholder="Uma melhoria por linha. Ex.: Sincronização pós-update mais segura" /></label>
        <label className="wide"><span>Correções</span><textarea rows={3} value={releaseForm.fixes} onChange={e => setReleaseForm(f => ({ ...f, fixes: e.target.value }))} placeholder="Uma correção por linha. Ex.: Corrigido logout desnecessário após atualização" /></label>'''
if old_notes in control:
    control = control.replace(old_notes, new_notes, 1)
elif 'releaseForm.changes' not in control:
    raise SystemExit('control: release notes field marker not found')

old_preview = '<small>{text(r.release_notes)}</small>'
new_preview = '<small>{releaseNotesPreview(r.release_notes)}</small>'
if old_preview in control:
    control = control.replace(old_preview, new_preview, 1)

control_path.write_text(control, encoding='utf-8')

# Static guardrails for the intended behavior.
checks = {
  'desktop-pdv/renderer/app.js': ['pdv-version-chip'],
  'desktop-pdv/main.js': ['isFreshUpdateResume', 'finalizePending({ strict: true })'],
  'src/app/control/update-center.tsx': ['composeReleaseNotes', 'Mudanças e novidades', 'Melhorias', 'Correções'],
}
for filename, markers in checks.items():
    text_value = Path(filename).read_text(encoding='utf-8')
    for marker in markers:
        if marker not in text_value:
            raise SystemExit(f'{filename}: missing {marker}')
