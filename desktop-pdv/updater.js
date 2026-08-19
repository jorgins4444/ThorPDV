const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');
const http = require('http');
const { spawn } = require('child_process');

function semver(value) {
  const match = String(value || '').trim().match(/^(\d+)\.(\d+)\.(\d+)$/);
  return match ? match.slice(1).map(Number) : null;
}

function compareSemver(a, b) {
  const av = semver(a); const bv = semver(b);
  if (!av || !bv) return 0;
  for (let i = 0; i < 3; i += 1) {
    if (av[i] > bv[i]) return 1;
    if (av[i] < bv[i]) return -1;
  }
  return 0;
}

function sanitizeRelease(payload) {
  const release = payload?.release || null;
  if (!release) return null;
  return {
    ...release,
    version: String(release.version || ''),
    download_url: String(release.download_url || ''),
    sha256: String(release.sha256 || '').toLowerCase(),
    release_notes: String(release.release_notes || ''),
  };
}

function updateHelperLogLine(file, message) {
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

function updateHelperScript() {
  return String.raw`param(
  [Parameter(Mandatory=$true)][string]$Installer,
  [Parameter(Mandatory=$true)][string]$LaunchExe,
  [Parameter(Mandatory=$true)][int]$ParentPid,
  [Parameter(Mandatory=$true)][string]$StatusPath,
  [Parameter(Mandatory=$true)][string]$MarkerPath,
  [Parameter(Mandatory=$true)][string]$TargetVersion,
  [switch]$SelfTest
)

$ErrorActionPreference = 'Stop'

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

[xml]$xaml = @"
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
        xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
        Title="Atualização do ThorPDV" Height="430" Width="610"
        WindowStartupLocation="CenterScreen" ResizeMode="NoResize"
        Background="#0E1713" Foreground="#F5FAF7" Topmost="True" ShowInTaskbar="True">
  <Grid Margin="28">
    <Grid.RowDefinitions>
      <RowDefinition Height="Auto"/>
      <RowDefinition Height="Auto"/>
      <RowDefinition Height="Auto"/>
      <RowDefinition Height="*"/>
      <RowDefinition Height="Auto"/>
    </Grid.RowDefinitions>

    <Grid Grid.Row="0">
      <Grid.ColumnDefinitions><ColumnDefinition Width="*"/><ColumnDefinition Width="82"/></Grid.ColumnDefinitions>
      <StackPanel Grid.Column="0">
        <TextBlock Text="THORCONTROL • ATUALIZAÇÃO SEGURA" FontSize="12" FontWeight="Bold" Foreground="#7ED4AA"/>
        <TextBlock x:Name="TitleText" Text="Preparando atualização" FontSize="26" FontWeight="Bold" Margin="0,7,0,0"/>
        <TextBlock x:Name="MessageText" Text="Mantendo seus dados locais protegidos durante a troca de versão." FontSize="13" Foreground="#B7C7BE" TextWrapping="Wrap" Margin="0,7,0,0"/>
        <TextBlock x:Name="VersionText" FontSize="12" Foreground="#7ED4AA" Margin="0,7,0,0"/>
      </StackPanel>
      <Border Grid.Column="1" Width="70" Height="70" CornerRadius="18" Background="#193427" HorizontalAlignment="Right">
        <Canvas x:Name="HammerMark" Width="54" Height="54" RenderTransformOrigin="0.5,0.62">
          <Canvas.RenderTransform><RotateTransform Angle="-12"/></Canvas.RenderTransform>
          <Rectangle Width="10" Height="38" Fill="#C98B2C" RadiusX="4" RadiusY="4" Canvas.Left="23" Canvas.Top="16"/>
          <Rectangle Width="42" Height="17" Fill="#DCE7E1" RadiusX="5" RadiusY="5" Canvas.Left="6" Canvas.Top="7"/>
          <Rectangle Width="11" Height="23" Fill="#B9C8C0" RadiusX="3" RadiusY="3" Canvas.Left="5" Canvas.Top="4"/>
        </Canvas>
      </Border>
    </Grid>

    <ProgressBar x:Name="ProgressBar" Grid.Row="1" Height="10" Minimum="0" Maximum="100"
                 Value="8" Margin="0,24,0,0" Foreground="#42B883" Background="#24352D"/>

    <StackPanel Grid.Row="2" Margin="0,23,0,0">
      <TextBlock x:Name="Step1" Text="✓ Pacote baixado e integridade validada" FontSize="13" Foreground="#7ED4AA" Margin="0,0,0,9"/>
      <TextBlock x:Name="Step2" Text="• Fechando o ThorPDV com segurança" FontSize="13" Foreground="#F5FAF7" Margin="0,0,0,9"/>
      <TextBlock x:Name="Step3" Text="○ Instalando a nova versão" FontSize="13" Foreground="#829188" Margin="0,0,0,9"/>
      <TextBlock x:Name="Step4" Text="○ Abrindo o ThorPDV atualizado" FontSize="13" Foreground="#829188" Margin="0,0,0,9"/>
      <TextBlock x:Name="Step5" Text="○ Restaurando sessão e sincronizando" FontSize="13" Foreground="#829188"/>
    </StackPanel>

    <Border Grid.Row="3" Margin="0,22,0,0" Padding="14" CornerRadius="10" Background="#14231C" VerticalAlignment="Top">
      <TextBlock Text="A base local, caixa aberto, configurações e operações já gravadas permanecem no diretório de dados do terminal. O instalador troca somente os arquivos da aplicação." TextWrapping="Wrap" FontSize="12" Foreground="#A9BAB1"/>
    </Border>

    <Grid Grid.Row="4" Margin="0,18,0,0">
      <TextBlock x:Name="FooterText" Text="Não desligue o computador durante a atualização." FontSize="11" Foreground="#829188" VerticalAlignment="Center"/>
      <Button x:Name="CloseButton" Content="Fechar" Width="100" Height="34" HorizontalAlignment="Right" Visibility="Collapsed"/>
    </Grid>
  </Grid>
</Window>
"@

try {
  $reader = New-Object System.Xml.XmlNodeReader $xaml
  $window = [Windows.Markup.XamlReader]::Load($reader)
} catch {
  Save-BootState 'error' ("Falha ao abrir interface do Atualizador Thor: " + $_.Exception.Message)
  exit 92
}
$titleText = $window.FindName('TitleText')
$messageText = $window.FindName('MessageText')
$versionText = $window.FindName('VersionText')
$bar = $window.FindName('ProgressBar')
$step1 = $window.FindName('Step1')
$step2 = $window.FindName('Step2')
$step3 = $window.FindName('Step3')
$step4 = $window.FindName('Step4')
$step5 = $window.FindName('Step5')
$footer = $window.FindName('FooterText')
$closeButton = $window.FindName('CloseButton')
$hammerMark = $window.FindName('HammerMark')
$versionText.Text = "Versão alvo: v$TargetVersion"
try {
  $rotation = $hammerMark.RenderTransform
  $animation = New-Object Windows.Media.Animation.DoubleAnimation
  $animation.From = -18; $animation.To = 13
  $animation.Duration = [Windows.Duration]::new([TimeSpan]::FromMilliseconds(620))
  $animation.AutoReverse = $true
  $animation.RepeatBehavior = [Windows.Media.Animation.RepeatBehavior]::Forever
  $rotation.BeginAnimation([Windows.Media.RotateTransform]::AngleProperty, $animation)
} catch {}

if ($SelfTest) {
  Save-BootState 'helper_ready' 'Self-test do helper concluído.'
  exit 0
}

function Save-State([string]$Stage, [string]$Message = '') {
  try {
    $payload = @{ stage=$Stage; message=$Message; targetVersion=$TargetVersion; updatedAt=(Get-Date).ToString('o') }
    $payload | ConvertTo-Json -Compress | Set-Content -LiteralPath $StatusPath -Encoding UTF8
  } catch {}
}

function Set-StepState([int]$Index) {
  $done = '#7ED4AA'
  $active = '#F5FAF7'
  $pending = '#829188'
  $step1.Foreground = $done
  $step1.Text = '✓ Pacote baixado e integridade validada'

  if ($Index -ge 2) { $step2.Foreground=$done; $step2.Text='✓ ThorPDV fechado com segurança' }
  else { $step2.Foreground=$active; $step2.Text='• Fechando o ThorPDV com segurança' }

  if ($Index -ge 3) { $step3.Foreground=$done; $step3.Text='✓ Nova versão instalada' }
  elseif ($Index -eq 2) { $step3.Foreground=$active; $step3.Text='• Instalando a nova versão' }
  else { $step3.Foreground=$pending; $step3.Text='○ Instalando a nova versão' }

  if ($Index -ge 4) { $step4.Foreground=$done; $step4.Text='✓ ThorPDV atualizado iniciado' }
  elseif ($Index -eq 3) { $step4.Foreground=$active; $step4.Text='• Abrindo o ThorPDV atualizado' }
  else { $step4.Foreground=$pending; $step4.Text='○ Abrindo o ThorPDV atualizado' }

  if ($Index -ge 5) { $step5.Foreground=$done; $step5.Text='✓ Sessão e sincronização concluídas' }
  elseif ($Index -eq 4) { $step5.Foreground=$active; $step5.Text='• Restaurando sessão e sincronizando' }
  else { $step5.Foreground=$pending; $step5.Text='○ Restaurando sessão e sincronizando' }
}

function Paint([string]$Title, [string]$Message, [int]$Value, [int]$StepIndex, [bool]$Indeterminate = $false) {
  $titleText.Text = $Title
  $messageText.Text = $Message
  $bar.IsIndeterminate = $Indeterminate
  if (-not $Indeterminate) { $bar.Value = $Value }
  Set-StepState $StepIndex
}

function Fail([string]$Message) {
  $script:phase = 'error'
  $titleText.Text = 'Atualização interrompida'
  $messageText.Text = $Message
  $bar.IsIndeterminate = $false
  $bar.Value = 100
  $bar.Foreground = '#C8545A'
  $footer.Text = 'O ThorPDV não apagou sua base local. Feche esta janela e verifique o erro.'
  $closeButton.Visibility = 'Visible'
  Save-State 'error' $Message
}

$closeButton.Add_Click({ $window.Close() })
$script:phase = 'wait_parent'
$script:installerProcess = $null
$script:postInstallAt = $null
$script:deadline = $null
$script:closeAt = $null

Paint 'Preparando troca de versão' 'Aguardando o ThorPDV concluir o fechamento seguro.' 18 1 $true
Save-State 'helper_ready' 'Atualizador visual iniciado.'

$timer = New-Object Windows.Threading.DispatcherTimer
$timer.Interval = [TimeSpan]::FromMilliseconds(350)
$timer.Add_Tick({
  try {
    if ($script:phase -eq 'wait_parent') {
      $parent = Get-Process -Id $ParentPid -ErrorAction SilentlyContinue
      if (-not $parent) {
        Paint 'Instalando ThorPDV' "Aplicando a versão v$TargetVersion. Seus dados locais não serão removidos." 55 2 $true
        Save-State 'installing' 'Instalando pacote validado.'
        $script:installerProcess = Start-Process -FilePath $Installer -ArgumentList '/S' -PassThru -WindowStyle Hidden
        $script:phase = 'installing'
      }
      return
    }

    if ($script:phase -eq 'installing') {
      if ($script:installerProcess -and $script:installerProcess.HasExited) {
        if ($script:installerProcess.ExitCode -ne 0) {
          Fail "O instalador retornou o código $($script:installerProcess.ExitCode)."
          return
        }
        $script:postInstallAt = (Get-Date).AddMilliseconds(1200)
        $script:phase = 'post_install'
        Paint 'Instalação concluída' 'Preparando a abertura da nova versão.' 74 3 $false
      }
      return
    }

    if ($script:phase -eq 'post_install') {
      if ((Get-Date) -ge $script:postInstallAt) {
        Paint 'Abrindo ThorPDV atualizado' 'Iniciando a nova versão e validando a instalação.' 84 3 $true
        Save-State 'restarting' 'Abrindo nova versão.'
        Start-Process -FilePath $LaunchExe -ArgumentList '--thor-update-resume'
        $script:deadline = (Get-Date).AddSeconds(120)
        $script:phase = 'waiting_app'
      }
      return
    }

    if ($script:phase -eq 'waiting_app') {
      $state = $null
      if (Test-Path -LiteralPath $StatusPath) {
        try {
          $raw = Get-Content -Raw -LiteralPath $StatusPath
          if ($raw) { $state = $raw | ConvertFrom-Json }
        } catch {}
      }

      if ($state -and $state.stage -eq 'validating') {
        Paint 'Validando nova versão' 'O ThorPDV atualizado foi iniciado. Conferindo a instalação.' 88 4 $true
      } elseif ($state -and $state.stage -eq 'syncing') {
        Paint 'Restaurando sessão e sincronizando' 'Revalidando o operador e trazendo as alterações do Thor Gestão.' 95 4 $true
      } elseif ($state -and $state.stage -eq 'done') {
        Paint 'ThorPDV atualizado com sucesso' "Versão v$TargetVersion instalada e pronta para uso." 100 5 $false
        $footer.Text = 'Atualização concluída. Voltando para o ThorPDV.'
        $script:phase = 'done'
        $script:closeAt = (Get-Date).AddSeconds(2.2)
      } elseif ($state -and $state.stage -eq 'error') {
        Fail $(if ($state.message) { [string]$state.message } else { 'A nova versão não confirmou a inicialização.' })
      } elseif (-not (Test-Path -LiteralPath $MarkerPath) -and (Get-Date) -lt $script:deadline) {
        Paint 'ThorPDV atualizado' "A versão v$TargetVersion concluiu a instalação." 100 5 $false
        $footer.Text = 'Atualização concluída. Em versões antigas, o operador pode precisar informar o PIN novamente.'
        $script:phase = 'done'
        $script:closeAt = (Get-Date).AddSeconds(2.8)
      } elseif ((Get-Date) -ge $script:deadline) {
        Fail 'A nova versão não confirmou a inicialização dentro do tempo esperado.'
      }
      return
    }

    if ($script:phase -eq 'done' -and (Get-Date) -ge $script:closeAt) {
      $timer.Stop()
      $window.Close()
    }
  } catch {
    Fail $_.Exception.Message
  }
})
$timer.Start()
[void]$window.ShowDialog()
`;
}

class ThorUpdater {
  constructor({ agent, appVersion, apiBase, userDataDir, tempDir, onProgress, quit }) {
    this.agent = agent;
    this.appVersion = String(appVersion || '0.0.0');
    this.apiBase = String(apiBase || '').replace(/\/+$/, '');
    this.userDataDir = userDataDir;
    this.tempDir = tempDir;
    this.onProgress = typeof onProgress === 'function' ? onProgress : () => {};
    this.quit = typeof quit === 'function' ? quit : () => {};
    this.state = { checking: false, installing: false, available: null, lastCheckAt: null, lastError: null };
    this.markerPath = path.join(this.userDataDir, 'pending-update.json');
    this.helperStatusPath = path.join(this.userDataDir, 'update-helper-status.json');
    this.helperLogPath = path.join(this.userDataDir, 'update-helper.log');
  }

  updateInfo() {
    return {
      currentVersion: this.appVersion,
      checking: this.state.checking,
      installing: this.state.installing,
      available: this.state.available,
      lastCheckAt: this.state.lastCheckAt,
      lastError: this.state.lastError,
    };
  }

  emit(stage, payload = {}) {
    const message = { stage, currentVersion: this.appVersion, at: new Date().toISOString(), ...payload };
    try { this.onProgress(message); } catch {}
  }

  token() {
    return this.agent.deviceToken?.() || '';
  }

  async api(pathname, { method = 'POST', body = null } = {}) {
    const token = this.token();
    if (!token) throw new Error('update_device_not_enrolled');
    const response = await fetch(`${this.apiBase}${pathname}`, {
      method,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: body == null ? undefined : JSON.stringify(body),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data?.ok === false) throw new Error(data?.error || `update_http_${response.status}`);
    return data;
  }

  async report(eventType, targetVersion, details = {}) {
    try {
      await this.api('/api/pdv/update/report', {
        body: { targetVersion, eventType, details: { app_version: this.appVersion, ...details } },
      });
    } catch {}
  }

  async check({ silent = false } = {}) {
    if (this.state.checking) return this.state.available;
    this.state.checking = true;
    this.state.lastError = null;
    if (!silent) this.emit('checking');
    try {
      const data = await this.api('/api/pdv/update/check', { body: { currentVersion: this.appVersion } });
      data.release = sanitizeRelease(data);
      if (data.update_available && data.release?.version) {
        const cmp = compareSemver(data.release.version, this.appVersion);
        data.direction = cmp < 0 ? 'rollback' : 'upgrade';
      }
      this.state.available = data;
      this.state.lastCheckAt = new Date().toISOString();
      if (!silent) this.emit(data.update_available ? 'available' : 'current', data);
      return data;
    } catch (error) {
      this.state.lastError = String(error?.message || error);
      if (!silent) this.emit('error', { error: this.state.lastError });
      throw error;
    } finally {
      this.state.checking = false;
    }
  }

  async systemSync() {
    if (this.agent?.sync?.run) return this.agent.sync.run(true);
    if (this.agent?.manualSync) return this.agent.manualSync();
    return null;
  }

  async syncBeforeInstall() {
    this.emit('syncing', { message: 'Sincronizando operações locais antes da atualização.' });
    await this.systemSync();
    const stats = this.agent.store.queueStats();
    if (Number(stats.pending || 0) > 0) throw new Error('update_pending_sync');
    return stats;
  }

  download(url, target, onProgress) {
    return new Promise((resolve, reject) => {
      const run = (currentUrl, redirects = 0) => {
        if (redirects > 5) return reject(new Error('update_too_many_redirects'));
        const client = currentUrl.startsWith('https://') ? https : http;
        const request = client.get(currentUrl, { headers: { 'user-agent': `ThorPDV/${this.appVersion}` } }, (response) => {
          if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
            response.resume();
            return run(new URL(response.headers.location, currentUrl).toString(), redirects + 1);
          }
          if (response.statusCode !== 200) {
            response.resume();
            return reject(new Error(`update_download_http_${response.statusCode}`));
          }
          const total = Number(response.headers['content-length'] || 0);
          let received = 0;
          const file = fs.createWriteStream(target);
          response.on('data', (chunk) => {
            received += chunk.length;
            if (total > 0) onProgress?.(Math.min(100, Math.round((received / total) * 100)), received, total);
          });
          response.pipe(file);
          file.on('finish', () => file.close(() => resolve({ received, total })));
          file.on('error', (error) => { try { fs.unlinkSync(target); } catch {} reject(error); });
        });
        request.setTimeout(120000, () => request.destroy(new Error('update_download_timeout')));
        request.on('error', reject);
      };
      run(url);
    });
  }

  sha256(file) {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash('sha256');
      const stream = fs.createReadStream(file);
      stream.on('error', reject);
      stream.on('data', (chunk) => hash.update(chunk));
      stream.on('end', () => resolve(hash.digest('hex')));
    });
  }

  readMarker() {
    try { return JSON.parse(fs.readFileSync(this.markerPath, 'utf8')); } catch { return null; }
  }

  writeHelperStatus(stage, message = '', details = {}) {
    try {
      fs.writeFileSync(this.helperStatusPath, JSON.stringify({
        stage, message, currentVersion: this.appVersion, updatedAt: new Date().toISOString(), ...details,
      }), 'utf8');
    } catch {}
  }

  readHelperStatus() {
    try {
      return JSON.parse(fs.readFileSync(this.helperStatusPath, 'utf8').replace(/^\uFEFF/, ''));
    } catch { return null; }
  }

  createResumeToken(targetVersion) {
    try {
      const operator = this.agent.currentOperator?.() || null;
      if (!operator?.id || !this.agent?.codec?.encrypt) return '';
      const claim = JSON.stringify({
        operatorId: String(operator.id),
        targetVersion: String(targetVersion),
        issuedAt: new Date().toISOString(),
        nonce: crypto.randomUUID(),
      });
      const token = String(this.agent.codec.encrypt(claim) || '');
      // Session resumption is only trusted when Windows safeStorage actually encrypted it.
      return token.startsWith('enc:') ? token : '';
    } catch { return ''; }
  }

  resumeClaim(marker) {
    try {
      const token = String(marker?.resumeToken || '');
      if (!token.startsWith('enc:') || !this.agent?.codec?.decrypt) return null;
      const raw = this.agent.codec.decrypt(token);
      const claim = JSON.parse(raw || '{}');
      const issued = Date.parse(String(claim.issuedAt || ''));
      if (!claim.operatorId || String(claim.targetVersion) !== this.appVersion) return null;
      if (!Number.isFinite(issued) || Date.now() - issued > 30 * 60 * 1000) return null;
      return claim;
    } catch { return null; }
  }

  async launchCmdFallback({ installer, targetVersion }) {
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

  async install() {
    if (this.state.installing) throw new Error('update_already_installing');
    this.state.installing = true;
    let targetVersion = '';
    try {
      const info = this.state.available?.update_available ? this.state.available : await this.check();
      if (!info?.update_available || !info.release) throw new Error('update_not_available');
      const release = info.release;
      targetVersion = String(release.version || '');
      if (!/^https:\/\//i.test(release.download_url)) throw new Error('update_https_required');
      if (!/^[a-f0-9]{64}$/.test(release.sha256)) throw new Error('update_sha256_invalid');

      await this.syncBeforeInstall();
      const safeVersion = targetVersion.replace(/[^0-9.]/g, '');
      const installer = path.join(this.tempDir, `ThorPDV-Desktop-${safeVersion}-x64.exe`);
      try { fs.unlinkSync(installer); } catch {}

      await this.report('download_started', targetVersion, { direction: info.direction, scope: info.scope });
      this.emit('downloading', { targetVersion, progress: 0, direction: info.direction });
      const downloaded = await this.download(release.download_url, installer, (progress, received, total) => {
        this.emit('downloading', { targetVersion, progress, received, total, direction: info.direction });
      });
      await this.report('downloaded', targetVersion, { bytes: downloaded.received });

      const digest = await this.sha256(installer);
      if (digest.toLowerCase() !== release.sha256.toLowerCase()) {
        await this.report('failed', targetVersion, { stage: 'sha256', expected: release.sha256, actual: digest });
        try { fs.unlinkSync(installer); } catch {}
        throw new Error('update_sha256_mismatch');
      }
      this.emit('verified', { targetVersion, sha256: digest });
      await this.report('verified', targetVersion, { sha256: digest });

      const resumeToken = this.createResumeToken(targetVersion);
      const marker = {
        fromVersion: this.appVersion,
        targetVersion,
        direction: info.direction,
        releaseId: release.id || null,
        installer,
        sha256: digest,
        createdAt: new Date().toISOString(),
        resumeToken,
        helperStatusPath: this.helperStatusPath,
        releaseNotes: release.release_notes || '',
      };
      fs.writeFileSync(this.markerPath, JSON.stringify(marker, null, 2), 'utf8');

      await this.report('installing', targetVersion, {
        installer: path.basename(installer),
        direction: info.direction,
        operator_resume: Boolean(marker.resumeToken),
      });

      this.emit('handoff', {
        targetVersion,
        direction: info.direction,
        message: 'Transferindo a atualização para o Atualizador Thor.',
      });

      const helper = await this.launchVisualHelper({ installer, targetVersion });
      this.emit('helper_ready', { targetVersion, direction: info.direction, helperMode: helper?.mode || 'unknown' });
      setTimeout(() => this.quit(), 550);
      return { ok: true, targetVersion, direction: info.direction, restarting: true };
    } catch (error) {
      this.state.lastError = String(error?.message || error);
      this.emit('error', { error: this.state.lastError, targetVersion });
      if (targetVersion) await this.report('failed', targetVersion, { stage: 'install', error: this.state.lastError });
      throw error;
    } finally {
      this.state.installing = false;
    }
  }

  async finalizePending({ strict = false } = {}) {
    const marker = this.readMarker();
    if (!marker?.targetVersion) return false;
    const created = Date.parse(String(marker.createdAt || ''));
    const age = Number.isFinite(created) ? Date.now() - created : Number.MAX_SAFE_INTEGER;

    if (String(marker.targetVersion) !== this.appVersion) {
      if (strict || age > 15 * 60 * 1000) {
        const message = `A versão iniciada (${this.appVersion}) não corresponde à versão alvo (${marker.targetVersion}).`;
        await this.report('failed', marker.targetVersion, { stage: 'restart_verify', running: this.appVersion });
        this.writeHelperStatus('error', message, { targetVersion: marker.targetVersion });
        try { fs.unlinkSync(this.markerPath); } catch {}
      }
      return false;
    }

    const resumeClaim = this.resumeClaim(marker);
    const expectedOperatorId = String(resumeClaim?.operatorId || '');
    this.writeHelperStatus('validating', 'Validando a versão instalada.', { targetVersion: marker.targetVersion });
    this.emit('restart_validating', { targetVersion: marker.targetVersion });

    let syncOk = true;
    let syncError = '';
    this.writeHelperStatus('syncing', 'Restaurando sessão e sincronizando dados.', { targetVersion: marker.targetVersion });
    try {
      const result = await this.systemSync();
      if (result?.ok === false) {
        syncOk = false;
        syncError = String(result.error || 'sync_unavailable');
      }
    } catch (error) {
      syncOk = false;
      syncError = String(error?.message || error);
    }

    let sessionResumed = false;
    if (expectedOperatorId) {
      const operator = this.agent.currentOperator?.() || null;
      if (operator && String(operator.id) === expectedOperatorId && operator.active !== false) {
        sessionResumed = true;
      } else {
        try { this.agent.logoutOperator?.(); } catch {}
      }
    }

    await this.report('installed', marker.targetVersion, {
      from_version: marker.fromVersion || null,
      direction: marker.direction || 'upgrade',
      sync_ok: syncOk,
      sync_error: syncError || null,
      session_resumed: sessionResumed,
    });

    this.writeHelperStatus('done', syncOk ? 'Atualização concluída e sincronizada.' : 'Atualização concluída; sincronização ficará pendente.', {
      targetVersion: marker.targetVersion,
      syncOk,
      syncError: syncError || null,
      sessionResumed,
    });
    try { fs.unlinkSync(this.markerPath); } catch {}

    this.emit('installed', {
      targetVersion: marker.targetVersion,
      fromVersion: marker.fromVersion,
      syncOk,
      syncError: syncError || null,
      sessionResumed,
      releaseNotes: marker.releaseNotes || '',
    });
    return { ok: true, syncOk, syncError: syncError || null, sessionResumed };
  }
}

module.exports = { ThorUpdater, compareSemver, __updateHelperScript: updateHelperScript, __fallbackCmdScript: fallbackCmdScript };
