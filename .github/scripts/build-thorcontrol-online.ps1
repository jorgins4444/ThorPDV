param(
  [string]$OutputPath = (Join-Path $PSScriptRoot '..\..\dist\ThorControl-Atualizador.exe')
)
$ErrorActionPreference = 'Stop'
$source = @'
using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Security.Cryptography;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Win32;

class ReleaseInfo {
  public Version Version;
  public string Tag, InstallerUrl, HashUrl, AssetName;
}

class ThorControlForm : Form {
  const string RepoApi = "https://api.github.com/repos/jorgins4444/ThorPDV/releases?per_page=30";
  Label installed = new Label(), latest = new Label(), status = new Label(), detail = new Label();
  ProgressBar progress = new ProgressBar();
  Button check = new Button(), download = new Button(), local = new Button();
  ReleaseInfo release;
  Version installedVersion = new Version(0,0,0);
  bool busy;

  public ThorControlForm() {
    Text = "ThorControl - Atualizador ThorPDV";
    ClientSize = new Size(680, 440); StartPosition = FormStartPosition.CenterScreen;
    BackColor = Color.FromArgb(245,248,247); Font = new Font("Segoe UI", 10F);
    FormBorderStyle = FormBorderStyle.FixedDialog; MaximizeBox = false;

    var header = new Panel { Dock=DockStyle.Top, Height=112, BackColor=Color.FromArgb(10,92,72) };
    var hammer = new Label { Text="⚒", ForeColor=Color.White, Font=new Font("Segoe UI Symbol",32,FontStyle.Bold), AutoSize=true, Location=new Point(25,26) };
    var title = new Label { Text="ThorControl", ForeColor=Color.White, Font=new Font("Segoe UI",22,FontStyle.Bold), AutoSize=true, Location=new Point(88,22) };
    var sub = new Label { Text="Atualização segura e automática do ThorPDV", ForeColor=Color.FromArgb(210,240,232), AutoSize=true, Location=new Point(91,64) };
    header.Controls.AddRange(new Control[]{hammer,title,sub}); Controls.Add(header);

    installed.SetBounds(28,134,610,25); installed.Font=new Font(Font,FontStyle.Bold);
    latest.SetBounds(28,165,610,25);
    status.SetBounds(28,205,620,28); status.Text="Preparando verificação...";
    progress.SetBounds(28,244,620,24); progress.Style=ProgressBarStyle.Continuous;
    detail.SetBounds(28,275,620,30); detail.ForeColor=Color.DimGray;

    check.Text="Buscar atualização"; check.SetBounds(28,326,185,42);
    download.Text="Baixar e instalar"; download.SetBounds(226,326,185,42); download.Enabled=false;
    local.Text="Selecionar instalador local..."; local.SetBounds(424,326,224,42);
    foreach(var b in new[]{check,download,local}) { b.FlatStyle=FlatStyle.Flat; b.FlatAppearance.BorderSize=0; b.Cursor=Cursors.Hand; }
    check.BackColor=Color.FromArgb(12,125,95); check.ForeColor=Color.White;
    download.BackColor=Color.FromArgb(16,156,104); download.ForeColor=Color.White;
    local.BackColor=Color.FromArgb(225,232,230); local.ForeColor=Color.FromArgb(25,60,50);
    Controls.AddRange(new Control[]{installed,latest,status,progress,detail,check,download,local});

    check.Click += async (s,e) => await CheckAsync();
    download.Click += async (s,e) => await DownloadAsync();
    local.Click += (s,e) => SelectLocal();
    Shown += async (s,e) => await CheckAsync();
  }

  async Task CheckAsync() {
    if(busy) return; SetBusy(true); progress.Value=0; detail.Text="";
    try {
      installedVersion=FindInstalledVersion();
      installed.Text="Versão instalada: " + (installedVersion.Major==0 ? "não identificada" : installedVersion.ToString());
      status.Text="Consultando versões oficiais no GitHub...";
      release=await GetLatestStableAsync();
      latest.Text="Versão mais recente: " + release.Version;
      if(installedVersion >= release.Version) {
        status.Text="Seu ThorPDV já está atualizado.";
        detail.Text="Você ainda pode reinstalar a versão atual ou selecionar um instalador local.";
        download.Text="Reinstalar versão " + release.Version;
      } else {
        status.Text="Nova versão disponível: " + release.Version;
        detail.Text="O download será validado por SHA-256 antes da instalação.";
        download.Text="Baixar e instalar";
      }
      download.Enabled=true;
    } catch(Exception ex) {
      status.Text="Não foi possível consultar o GitHub.";
      detail.Text=Clean(ex.Message); release=null; download.Enabled=false;
    } finally { SetBusy(false); }
  }

  async Task<ReleaseInfo> GetLatestStableAsync() {
    using(var wc=Client()) {
      var json=await wc.DownloadStringTaskAsync(RepoApi);
      var items=new JavaScriptSerializer().DeserializeObject(json) as object[];
      if(items==null) throw new Exception("Resposta inválida do serviço de versões.");
      foreach(var raw in items) {
        var r=raw as Dictionary<string,object>; if(r==null) continue;
        string tag=Val(r,"tag_name");
        var m=Regex.Match(tag??"", @"^pdv-v(\d+\.\d+\.\d+)$", RegexOptions.IgnoreCase);
        if(!m.Success || Bool(r,"draft") || Bool(r,"prerelease")) continue;
        string ver=m.Groups[1].Value, exe="ThorPDV-Desktop-"+ver+"-x64.exe", sum=exe+".sha256";
        string exeUrl=null, sumUrl=null;
        var assets=r.ContainsKey("assets") ? r["assets"] as object[] : null;
        if(assets!=null) foreach(var a0 in assets) {
          var a=a0 as Dictionary<string,object>; if(a==null) continue;
          var n=Val(a,"name"); if(n==exe) exeUrl=Val(a,"browser_download_url"); if(n==sum) sumUrl=Val(a,"browser_download_url");
        }
        if(exeUrl!=null && sumUrl!=null) return new ReleaseInfo{Version=new Version(ver),Tag=tag,InstallerUrl=exeUrl,HashUrl=sumUrl,AssetName=exe};
      }
      throw new Exception("Nenhuma release estável com instalador e checksum foi encontrada.");
    }
  }

  async Task DownloadAsync() {
    if(busy || release==null) return; SetBusy(true); download.Enabled=false; progress.Value=0;
    string dir=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),"Downloads");
    Directory.CreateDirectory(dir);
    string final=Path.Combine(dir,release.AssetName), temp=final+".download";
    try {
      status.Text="Obtendo assinatura de segurança...";
      string expected;
      using(var wc=Client()) expected=Regex.Match(await wc.DownloadStringTaskAsync(release.HashUrl),@"[A-Fa-f0-9]{64}").Value.ToLowerInvariant();
      if(expected.Length!=64) throw new Exception("Checksum SHA-256 inválido na release.");
      status.Text="Baixando " + release.AssetName + "...";
      using(var wc=Client()) {
        wc.DownloadProgressChanged += (s,e) => BeginInvoke((Action)(() => {
          progress.Value=Math.Max(0,Math.Min(100,e.ProgressPercentage));
          detail.Text=Fmt(e.BytesReceived)+" de "+Fmt(e.TotalBytesToReceive)+" ("+e.ProgressPercentage+"%)";
        }));
        await wc.DownloadFileTaskAsync(new Uri(release.InstallerUrl),temp);
      }
      status.Text="Validando integridade do instalador..."; detail.Text="Calculando SHA-256"; progress.Style=ProgressBarStyle.Marquee;
      string actual;
      using(var sha=SHA256.Create()) using(var fs=File.OpenRead(temp)) actual=BitConverter.ToString(sha.ComputeHash(fs)).Replace("-","").ToLowerInvariant();
      progress.Style=ProgressBarStyle.Continuous;
      if(actual!=expected) { File.Move(temp,temp+".invalid-"+DateTime.Now.ToString("yyyyMMddHHmmss")); throw new Exception("A validação SHA-256 falhou. O arquivo não será instalado."); }
      if(File.Exists(final)) File.Replace(temp,final,final+".backup",true); else File.Move(temp,final);
      progress.Value=100; status.Text="Download concluído e validado."; detail.Text="Instalador salvo em: "+final;
      if(MessageBox.Show("Versão "+release.Version+" pronta e validada.\n\nDeseja iniciar a instalação agora?","ThorControl",MessageBoxButtons.YesNo,MessageBoxIcon.Question)==DialogResult.Yes) Launch(final);
    } catch(Exception ex) {
      progress.Style=ProgressBarStyle.Continuous; status.Text="A atualização não foi concluída."; detail.Text=Clean(ex.Message);
    } finally { SetBusy(false); download.Enabled=release!=null; }
  }

  void SelectLocal() {
    using(var d=new OpenFileDialog { Filter="Instalador ThorPDV (*.exe)|*.exe", Title="Selecione o instalador do ThorPDV" })
      if(d.ShowDialog()==DialogResult.OK && MessageBox.Show("Deseja executar este instalador?\n\n"+d.FileName,"ThorControl",MessageBoxButtons.YesNo,MessageBoxIcon.Question)==DialogResult.Yes) Launch(d.FileName);
  }
  void Launch(string path) { Process.Start(new ProcessStartInfo(path){UseShellExecute=true}); Close(); }
  void SetBusy(bool value) { busy=value; check.Enabled=!value; local.Enabled=!value; if(value) download.Enabled=false; UseWaitCursor=value; }
  static WebClient Client() { ServicePointManager.SecurityProtocol=SecurityProtocolType.Tls12; var w=new WebClient(); w.Headers["User-Agent"]="ThorControl-Updater/1.0"; w.Headers["Accept"]="application/vnd.github+json"; return w; }
  static string Val(Dictionary<string,object> d,string k) { return d.ContainsKey(k)&&d[k]!=null ? d[k].ToString() : null; }
  static bool Bool(Dictionary<string,object> d,string k) { return d.ContainsKey(k)&&d[k] is bool&&(bool)d[k]; }
  static string Fmt(long n) { if(n<0)return "?"; return (n/1048576d).ToString("0.0")+" MB"; }
  static string Clean(string s) { return Regex.Replace(s??"Erro desconhecido",@"\s+"," ").Trim(); }

  static Version FindInstalledVersion() {
    foreach(var hive in new[]{RegistryHive.CurrentUser,RegistryHive.LocalMachine})
      foreach(var view in new[]{RegistryView.Registry64,RegistryView.Registry32})
        try {
          using(var root=RegistryKey.OpenBaseKey(hive,view))
          using(var un=root.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Uninstall")) {
            if(un==null) continue;
            foreach(var name in un.GetSubKeyNames()) using(var key=un.OpenSubKey(name)) {
              var display=(key.GetValue("DisplayName")??"").ToString();
              if(display.IndexOf("ThorPDV",StringComparison.OrdinalIgnoreCase)<0) continue;
              var text=(key.GetValue("DisplayVersion")??"").ToString();
              var m=Regex.Match(text,@"\d+\.\d+\.\d+"); Version v; if(m.Success&&Version.TryParse(m.Value,out v)) return v;
            }
          }
        } catch {}
    return new Version(0,0,0);
  }
}

static class Program {
  [STAThread] static void Main() {
    Application.EnableVisualStyles(); Application.SetCompatibleTextRenderingDefault(false);
    Application.Run(new ThorControlForm());
  }
}
'@
$outDir = Split-Path -Parent $OutputPath
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path $csc)) { $csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe' }
$sourceFile = Join-Path $env:TEMP ('ThorControl-' + [guid]::NewGuid().ToString('N') + '.cs')
[IO.File]::WriteAllText($sourceFile, $source, [Text.UTF8Encoding]::new($true))
try {
  & $csc /nologo /target:winexe /optimize+ /platform:anycpu /out:$OutputPath /reference:System.dll /reference:System.Drawing.dll /reference:System.Windows.Forms.dll /reference:System.Web.Extensions.dll /reference:System.Security.dll $sourceFile
  if ($LASTEXITCODE -ne 0) { throw "Falha ao compilar ThorControl." }
} finally {
  Remove-Item -LiteralPath $sourceFile -Force -ErrorAction SilentlyContinue
}
Write-Host "Criado: $OutputPath"
