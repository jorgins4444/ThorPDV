from pathlib import Path

updater_path = Path('desktop-pdv/updater.js')
text = updater_path.read_text(encoding='utf-8')

# 1) Add low-level helper utilities before the PowerShell generator.
marker = "function updateHelperScript() {\n"
if 'function updateHelperLogLine(' not in text:
    utility = r'''function updateHelperLogLine(file, message) {
  try { fs.appendFileSync(file, `[${new Date().toISOString()}] ${message}\r\n`, 'utf8'); } catch {}
}

function existingPowerShellCandidates() {
  const root = String(process.env.SystemRoot || process.env.WINDIR || 'C:\\Windows');
  const candidates = [
    path.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
    path.join(root, 'Sysnative', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
    'powershell.exe',
  ];
  const seen = new Set();
  return candidates.filter((candidate) => {
    const key = candidate.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return candidate === 'powershell.exe' || fs.existsSync(candidate);
  });
}

function cmdQuote(value) {
  return `"${String(value || '').replace(/%/g, '%%').replace(/"/g, '""')}"`;
}

function fallbackCmdScript() {
  return String.raw`@echo off
setlocal DisableDelayedExpansion
set "INSTALLER=%~1"
set "LAUNCH_EXE=%~2"
set "PARENT_PID=%~3"
set "LOG_PATH=%~4"
set "TARGET_VERSION=%~5"

>>"%LOG_PATH%" echo [%date% %time%] CMD fallback ready for v%TARGET_VERSION%.

:WAIT_PARENT
tasklist /FI "PID eq %PARENT_PID%" /NH 2^>nul | findstr /R /C:"[ ]%PARENT_PID%[ ]" ^>nul
if not errorlevel 1 (
  >nul 2>&1 ping 127.0.0.1 -n 2
  goto WAIT_PARENT
)

>>"%LOG_PATH%" echo [%date% %time%] Parent exited. Starting installer.
start "" /wait "%INSTALLER%" /S
set "INSTALL_EXIT=%ERRORLEVEL%"
>>"%LOG_PATH%" echo [%date% %time%] Installer exit code %INSTALL_EXIT%.
if not "%INSTALL_EXIT%"=="0" exit /b %INSTALL_EXIT%

>nul 2>&1 ping 127.0.0.1 -n 2
>>"%LOG_PATH%" echo [%date% %time%] Restarting ThorPDV.
start "" "%LAUNCH_EXE%" --thor-update-resume
exit /b 0
`;
}

'''
    if marker not in text:
        raise SystemExit('updateHelperScript marker not found')
    text = text.replace(marker, utility + marker, 1)

# 2) Add a self-test switch and make PowerShell boot failures observable before WPF/XAML is loaded.
param_old = "  [Parameter(Mandatory=$true)][string]$TargetVersion\n)\n"
param_new = "  [Parameter(Mandatory=$true)][string]$TargetVersion,\n  [switch]$SelfTest\n)\n"
if param_old in text:
    text = text.replace(param_old, param_new, 1)
elif '[switch]$SelfTest' not in text:
    raise SystemExit('PowerShell param marker not found')

old = "$ErrorActionPreference = 'Stop'\nAdd-Type -AssemblyName PresentationFramework\nAdd-Type -AssemblyName PresentationCore\n\n[xml]$xaml = @\""
new = r'''$ErrorActionPreference = 'Stop'

function Save-BootState([string]$Stage, [string]$Message = '') {
  try {
    $payload = @{ stage=$Stage; message=$Message; targetVersion=$TargetVersion; updatedAt=(Get-Date).ToString('o') }
    $payload | ConvertTo-Json -Compress | Set-Content -LiteralPath $StatusPath -Encoding UTF8
  } catch {}
}

Save-BootState 'helper_booting' 'Iniciando Atualizador Thor.'
try {
  Add-Type -AssemblyName PresentationFramework
  Add-Type -AssemblyName PresentationCore
} catch {
  Save-BootState 'error' ("Falha ao carregar interface do Atualizador Thor: " + $_.Exception.Message)
  exit 91
}

[xml]$xaml = @"'''
if old in text:
    text = text.replace(old, new, 1)
elif "Save-BootState 'helper_booting'" not in text:
    raise SystemExit('PowerShell boot marker not found')

old_xaml = "$reader = New-Object System.Xml.XmlNodeReader $xaml\n$window = [Windows.Markup.XamlReader]::Load($reader)\n"
new_xaml = r'''try {
  $reader = New-Object System.Xml.XmlNodeReader $xaml
  $window = [Windows.Markup.XamlReader]::Load($reader)
} catch {
  Save-BootState 'error' ("Falha ao abrir interface do Atualizador Thor: " + $_.Exception.Message)
  exit 92
}
'''
if old_xaml in text:
    text = text.replace(old_xaml, new_xaml, 1)
elif "Falha ao abrir interface do Atualizador Thor" not in text:
    raise SystemExit('XAML loader marker not found')

selftest_marker = "$versionText.Text = \"Versão alvo: v$TargetVersion\"\n"
if "Self-test do helper concluído" not in text:
    if selftest_marker not in text:
        raise SystemExit('PowerShell self-test marker not found')
    text = text.replace(selftest_marker, selftest_marker + "\nif ($SelfTest) {\n  Save-BootState 'helper_ready' 'Self-test do helper concluído.'\n  exit 0\n}\n", 1)

# 3) Track a local helper diagnostic file.
ctor = "    this.helperStatusPath = path.join(this.userDataDir, 'update-helper-status.json');\n"
if "update-helper.log" not in text:
    if ctor not in text:
        raise SystemExit('constructor marker not found')
    text = text.replace(ctor, ctor + "    this.helperLogPath = path.join(this.userDataDir, 'update-helper.log');\n", 1)

# 4) Replace visual helper launch with explicit PowerShell + CMD fallback.
start = text.find('  async launchVisualHelper({ installer, targetVersion }) {')
end = text.find('\n  async install() {', start)
if start < 0 or end < 0:
    raise SystemExit('launchVisualHelper block not found')
new_launch = r'''  async launchCmdFallback({ installer, targetVersion }) {
    const helperPath = path.join(this.tempDir, `ThorPDV-Update-Fallback-${targetVersion}.cmd`);
    fs.writeFileSync(helperPath, fallbackCmdScript(), 'utf8');
    const cmd = String(process.env.ComSpec || path.join(String(process.env.SystemRoot || 'C:\\Windows'), 'System32', 'cmd.exe'));
    updateHelperLogLine(this.helperLogPath, `Starting CMD fallback: ${cmd}`);

    const command = [helperPath, installer, process.execPath, String(process.pid), this.helperLogPath, String(targetVersion)]
      .map(cmdQuote).join(' ');

    const child = spawn(cmd, ['/d', '/q', '/s', '/c', command], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });

    let spawnError = null;
    let exited = false;
    let exitCode = null;
    child.once('error', (error) => { spawnError = error; });
    child.once('exit', (code) => { exited = true; exitCode = code; });

    await new Promise((resolve) => setTimeout(resolve, 850));
    if (spawnError) {
      updateHelperLogLine(this.helperLogPath, `CMD fallback spawn error: ${spawnError.message}`);
      throw new Error('update_helper_fallback_failed');
    }
    if (exited) {
      updateHelperLogLine(this.helperLogPath, `CMD fallback exited too early: ${exitCode}`);
      throw new Error('update_helper_fallback_failed');
    }

    child.unref();
    this.writeHelperStatus('helper_ready', 'Atualizador alternativo iniciado.', {
      targetVersion: String(targetVersion), helperMode: 'cmd_fallback',
    });
    updateHelperLogLine(this.helperLogPath, 'CMD fallback accepted; application can quit safely.');
    return { ok: true, mode: 'cmd_fallback' };
  }

  async launchVisualHelper({ installer, targetVersion }) {
    if (process.platform !== 'win32') throw new Error('update_install_requires_windows');
    try { fs.unlinkSync(this.helperStatusPath); } catch {}
    try { fs.unlinkSync(this.helperLogPath); } catch {}

    const helperPath = path.join(this.tempDir, `ThorPDV-Update-Helper-${targetVersion}.ps1`);
    fs.writeFileSync(helperPath, `\uFEFF${updateHelperScript()}`, 'utf8');
    updateHelperLogLine(this.helperLogPath, `Preparing update ${this.appVersion} -> ${targetVersion}.`);

    let lastFailure = '';
    for (const powerShell of existingPowerShellCandidates()) {
      try {
        updateHelperLogLine(this.helperLogPath, `Trying PowerShell helper: ${powerShell}`);
        const child = spawn(powerShell, [
          '-NoProfile',
          '-ExecutionPolicy', 'Bypass',
          '-WindowStyle', 'Hidden',
          '-File', helperPath,
          '-Installer', installer,
          '-LaunchExe', process.execPath,
          '-ParentPid', String(process.pid),
          '-StatusPath', this.helperStatusPath,
          '-MarkerPath', this.markerPath,
          '-TargetVersion', String(targetVersion),
        ], { detached: true, stdio: 'ignore', windowsHide: true });

        let spawnError = null;
        let exited = false;
        let exitCode = null;
        child.once('error', (error) => { spawnError = error; });
        child.once('exit', (code) => { exited = true; exitCode = code; });

        const deadline = Date.now() + 7000;
        while (Date.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, 120));
          if (spawnError) throw spawnError;
          const status = this.readHelperStatus();
          if (status?.stage === 'helper_ready') {
            child.unref();
            updateHelperLogLine(this.helperLogPath, `PowerShell helper ready: ${powerShell}`);
            return { ok: true, mode: 'powershell' };
          }
          if (status?.stage === 'error') throw new Error(status.message || 'update_helper_powershell_failed');
          if (exited) throw new Error(`powershell_helper_exit_${exitCode ?? 'unknown'}`);
        }
        throw new Error('powershell_helper_timeout');
      } catch (error) {
        lastFailure = String(error?.message || error);
        updateHelperLogLine(this.helperLogPath, `PowerShell helper failed: ${lastFailure}`);
        try { fs.unlinkSync(this.helperStatusPath); } catch {}
      }
    }

    this.emit('helper_fallback', {
      targetVersion,
      message: 'A interface visual do atualizador não abriu. Usando modo alternativo seguro do Windows.',
      helperError: lastFailure || 'powershell_unavailable',
    });
    await this.report('helper_fallback', targetVersion, { error: lastFailure || 'powershell_unavailable' });
    return this.launchCmdFallback({ installer, targetVersion });
  }
'''
text = text[:start] + new_launch + text[end:]

# 5) Include helper mode in successful handoff result/logging.
old_call = "      await this.launchVisualHelper({ installer, targetVersion });\n      this.emit('helper_ready', { targetVersion, direction: info.direction });\n"
new_call = "      const helper = await this.launchVisualHelper({ installer, targetVersion });\n      this.emit('helper_ready', { targetVersion, direction: info.direction, helperMode: helper?.mode || 'unknown' });\n"
if old_call in text:
    text = text.replace(old_call, new_call, 1)
elif 'helperMode: helper?.mode' not in text:
    raise SystemExit('install helper call marker not found')

if 'module.exports.__updateHelperScript' not in text:
    text = text.replace('module.exports = { ThorUpdater, compareSemver };', 'module.exports = { ThorUpdater, compareSemver, __updateHelperScript: updateHelperScript, __fallbackCmdScript: fallbackCmdScript };')

updater_path.write_text(text, encoding='utf-8')

# 6) Make renderer strip Electron IPC wrapper and map new helper errors.
ui_path = Path('desktop-pdv/renderer/update-center.js')
ui = ui_path.read_text(encoding='utf-8')
old_head = "  const updateError = (code) => ({\n"
if 'normalizeUpdateErrorCode' not in ui:
    normalize = r'''  const normalizeUpdateErrorCode = (value) => {
    const raw = String(value || '');
    const match = raw.match(/(update_[a-z0-9_]+)/i);
    return match ? match[1].toLowerCase() : raw;
  };
  const updateError = (value) => {
    const code = normalizeUpdateErrorCode(value);
    return ({
'''
    if old_head not in ui:
        raise SystemExit('updateError marker not found')
    ui = ui.replace(old_head, normalize, 1)
    tail = "  }[code] || code || 'Falha ao atualizar o ThorPDV.');\n"
    replacement = "    update_helper_powershell_failed: 'O helper visual do Windows falhou; o Thor tentará automaticamente o modo alternativo.',\n    update_helper_fallback_failed: 'Os dois modos do atualizador foram bloqueados pelo Windows. Use a instalação manual desta versão e consulte o log update-helper.log.',\n  }[code] || code || 'Falha ao atualizar o ThorPDV.');\n  };\n"
    if tail not in ui:
        raise SystemExit('updateError tail marker not found')
    ui = ui.replace(tail, replacement, 1)
ui_path.write_text(ui, encoding='utf-8')

# 7) Version bump.
pkg_path = Path('desktop-pdv/package.json')
pkg = pkg_path.read_text(encoding='utf-8')
pkg = pkg.replace('"version": "0.8.5"', '"version": "0.8.6"', 1)
if '"version": "0.8.6"' not in pkg:
    raise SystemExit('version bump failed')
pkg_path.write_text(pkg, encoding='utf-8')

# Guardrails.
checks = {
  'desktop-pdv/updater.js': ['launchCmdFallback', 'existingPowerShellCandidates', 'helper_fallback', 'update-helper.log', '[switch]$SelfTest'],
  'desktop-pdv/renderer/update-center.js': ['normalizeUpdateErrorCode', 'update_helper_fallback_failed'],
  'desktop-pdv/package.json': ['"version": "0.8.6"'],
}
for filename, markers in checks.items():
    value = Path(filename).read_text(encoding='utf-8')
    for item in markers:
        if item not in value:
            raise SystemExit(f'{filename}: missing {item}')
