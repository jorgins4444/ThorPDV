$ErrorActionPreference='Stop'
$root=Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$dist=Join-Path $root 'dist';$assets=Join-Path $root 'build-assets';New-Item -ItemType Directory -Path $dist -Force|Out-Null
$code=@'
using System;using System.Diagnostics;using System.Drawing;using System.IO;using System.Linq;using System.Text.RegularExpressions;using System.Windows.Forms;
public class ThorControlInstaller:Form{
 ListBox list=new ListBox();Label status=new Label();Button install=new Button();string selected="";
 public ThorControlInstaller(){
  Text="ThorControl - Instalador ThorPDV";ClientSize=new Size(650,430);StartPosition=FormStartPosition.CenterScreen;FormBorderStyle=FormBorderStyle.FixedDialog;MaximizeBox=false;BackColor=Color.FromArgb(13,28,21);ForeColor=Color.White;
  var mark=new Label{Text="⚒",Font=new Font("Segoe UI Symbol",42,FontStyle.Bold),ForeColor=Color.FromArgb(213,151,54),Location=new Point(28,18),Size=new Size(78,72),TextAlign=ContentAlignment.MiddleCenter};
  var title=new Label{Text="Instalar ou atualizar o ThorPDV",Font=new Font("Segoe UI",19,FontStyle.Bold),Location=new Point(112,22),AutoSize=true};
  var sub=new Label{Text="Selecione uma versão encontrada nas pastas padrão ou escolha outro arquivo.",Font=new Font("Segoe UI",10),ForeColor=Color.FromArgb(177,201,188),Location=new Point(115,60),AutoSize=true};
  list.Location=new Point(28,112);list.Size=new Size(594,185);list.Font=new Font("Segoe UI",10);list.SelectedIndexChanged+=(s,e)=>{selected=list.SelectedItem==null?"":((Item)list.SelectedItem).Path;install.Enabled=selected.Length>0;status.Text=selected;};
  var browse=new Button{Text="Selecionar outro arquivo...",Location=new Point(28,316),Size=new Size(185,40),FlatStyle=FlatStyle.Flat,BackColor=Color.FromArgb(31,61,47),ForeColor=Color.White};browse.Click+=Browse;
  install.Text="Instalar ThorPDV";install.Location=new Point(430,316);install.Size=new Size(192,40);install.FlatStyle=FlatStyle.Flat;install.BackColor=Color.FromArgb(38,178,108);install.ForeColor=Color.White;install.Enabled=false;install.Click+=Install;
  status.Location=new Point(28,372);status.Size=new Size(594,42);status.ForeColor=Color.FromArgb(159,188,173);status.AutoEllipsis=true;Controls.AddRange(new Control[]{mark,title,sub,list,browse,install,status});Load+=(s,e)=>Discover();
 }
 void Discover(){string home=Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);string[] roots={Path.Combine(home,"Downloads"),Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory),AppDomain.CurrentDomain.BaseDirectory,Path.GetTempPath()};var found=roots.Where(Directory.Exists).SelectMany(p=>Directory.GetFiles(p,"ThorPDV-Desktop-*-x64.exe")).Distinct(StringComparer.OrdinalIgnoreCase).Select(p=>new Item(p)).OrderByDescending(x=>x.Version).ToArray();list.Items.AddRange(found);if(found.Length>0)list.SelectedIndex=0;else status.Text="Nenhum instalador encontrado. Selecione o arquivo manualmente.";}
 void Browse(object s,EventArgs e){using(var d=new OpenFileDialog()){d.Title="Selecione o instalador ThorPDV";d.Filter="Instalador ThorPDV|ThorPDV-Desktop-*.exe|Executáveis|*.exe";if(d.ShowDialog(this)==DialogResult.OK){selected=d.FileName;install.Enabled=true;status.Text=selected;}}}
 void Install(object s,EventArgs e){if(!File.Exists(selected))return;if(MessageBox.Show(this,"Instalar "+Path.GetFileName(selected)+"?","Confirmar",MessageBoxButtons.YesNo,MessageBoxIcon.Question)!=DialogResult.Yes)return;Process.Start(new ProcessStartInfo(selected){UseShellExecute=true});Close();}
 class Item{public string Path;public Version Version;public Item(string p){Path=p;var m=Regex.Match(System.IO.Path.GetFileName(p),@"(\d+\.\d+\.\d+)");Version=m.Success?new Version(m.Groups[1].Value):new Version(0,0,0);}public override string ToString(){return System.IO.Path.GetFileName(Path)+"  •  "+Path;}}
 [STAThread]public static void Main(){Application.EnableVisualStyles();Application.Run(new ThorControlInstaller());}
}
'@
$csc=Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe';if(!(Test-Path $csc)){$csc=Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe'}
$src=Join-Path $env:RUNNER_TEMP 'ThorControl-Atualizador.cs';Set-Content $src $code -Encoding UTF8
& $csc /nologo /target:winexe /optimize+ /reference:System.dll /reference:System.Core.dll /reference:System.Drawing.dll /reference:System.Windows.Forms.dll /win32icon:"$(Join-Path $assets 'thor-hammer.ico')" /out:"$(Join-Path $dist 'ThorControl-Atualizador.exe')" $src
if($LASTEXITCODE-ne 0){throw 'Falha ao compilar ThorControl-Atualizador.exe'}
