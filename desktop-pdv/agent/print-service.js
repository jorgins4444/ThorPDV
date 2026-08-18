const { spawn } = require('child_process');
const crypto = require('crypto');

const HOST_SCRIPT = String.raw`
$ErrorActionPreference='Stop'
$src=@'
using System;
using System.Runtime.InteropServices;
public class ThorPersistentRawPrinter {
 [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Ansi)] public class DOCINFOA { [MarshalAs(UnmanagedType.LPStr)] public string pDocName; [MarshalAs(UnmanagedType.LPStr)] public string pOutputFile; [MarshalAs(UnmanagedType.LPStr)] public string pDataType; }
 [DllImport("winspool.Drv", EntryPoint="OpenPrinterA", SetLastError=true, CharSet=CharSet.Ansi, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)] public static extern bool OpenPrinter(string name,out IntPtr handle,IntPtr defaults);
 [DllImport("winspool.Drv", SetLastError=true, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)] public static extern bool ClosePrinter(IntPtr handle);
 [DllImport("winspool.Drv", EntryPoint="StartDocPrinterA", SetLastError=true, CharSet=CharSet.Ansi, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)] public static extern bool StartDocPrinter(IntPtr handle,int level,[In,MarshalAs(UnmanagedType.LPStruct)] DOCINFOA info);
 [DllImport("winspool.Drv", SetLastError=true, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)] public static extern bool EndDocPrinter(IntPtr handle);
 [DllImport("winspool.Drv", SetLastError=true, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)] public static extern bool StartPagePrinter(IntPtr handle);
 [DllImport("winspool.Drv", SetLastError=true, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)] public static extern bool EndPagePrinter(IntPtr handle);
 [DllImport("winspool.Drv", SetLastError=true, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)] public static extern bool WritePrinter(IntPtr handle,IntPtr bytes,int count,out int written);
 public static bool Send(string printer,byte[] bytes,string name) {
   IntPtr handle; if(!OpenPrinter(printer,out handle,IntPtr.Zero)) return false;
   bool ok=false;
   try {
     var info=new DOCINFOA{pDocName=name,pDataType="RAW"};
     ok=StartDocPrinter(handle,1,info);
     if(!ok) return false;
     StartPagePrinter(handle);
     IntPtr data=Marshal.AllocCoTaskMem(bytes.Length);
     try { Marshal.Copy(bytes,0,data,bytes.Length); int written=0; ok=WritePrinter(handle,data,bytes.Length,out written)&&written==bytes.Length; }
     finally { Marshal.FreeCoTaskMem(data); EndPagePrinter(handle); EndDocPrinter(handle); }
     return ok;
   } finally { ClosePrinter(handle); }
 }
}
'@
Add-Type -TypeDefinition $src
while(($line=[Console]::In.ReadLine()) -ne $null){
  try {
    $cmd=$line|ConvertFrom-Json
    $bytes=[Convert]::FromBase64String([string]$cmd.base64)
    $ok=[ThorPersistentRawPrinter]::Send([string]$cmd.printer,$bytes,[string]$cmd.name)
    if(-not $ok){throw 'raw_print_failed'}
    [Console]::Out.WriteLine((@{id=$cmd.id;ok=$true}|ConvertTo-Json -Compress))
  } catch {
    $id=''; try{$id=$cmd.id}catch{}
    [Console]::Out.WriteLine((@{id=$id;ok=$false;error=$_.Exception.Message}|ConvertTo-Json -Compress))
  }
  [Console]::Out.Flush()
}
`;

class PersistentPrintService {
  constructor({ metric } = {}) {
    this.metric=typeof metric==='function'?metric:()=>{};
    this.child=null;
    this.buffer='';
    this.pending=new Map();
    this.starting=null;
  }
  async start(){
    if(process.platform!=='win32') throw new Error('printing_requires_windows');
    if(this.child&&!this.child.killed)return;
    if(this.starting)return this.starting;
    this.starting=new Promise((resolve,reject)=>{
      const child=spawn('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-Command',HOST_SCRIPT],{windowsHide:true,stdio:['pipe','pipe','pipe']});
      this.child=child;
      child.stdout.setEncoding('utf8');
      child.stdout.on('data',(chunk)=>this.onData(chunk));
      child.stderr.setEncoding('utf8');
      let startupError='';
      child.stderr.on('data',(chunk)=>{startupError+=chunk;});
      child.once('spawn',()=>resolve());
      child.once('error',reject);
      child.once('exit',()=>{this.child=null;for(const item of this.pending.values())item.reject(new Error(startupError.trim()||'print_service_stopped'));this.pending.clear();});
    }).finally(()=>{this.starting=null;});
    return this.starting;
  }
  onData(chunk){
    this.buffer+=chunk;
    let newline;
    while((newline=this.buffer.indexOf('\n'))>=0){
      const line=this.buffer.slice(0,newline).trim();this.buffer=this.buffer.slice(newline+1);
      if(!line)continue;
      let row;try{row=JSON.parse(line);}catch{continue;}
      const pending=this.pending.get(String(row.id));if(!pending)continue;
      clearTimeout(pending.timeout);this.pending.delete(String(row.id));
      if(row.ok)pending.resolve(true);else pending.reject(new Error(row.error||'raw_print_failed'));
    }
  }
  async send(printer,bytes,name='ThorPDV Cupom'){
    if(!printer||printer==='__PDF__')throw new Error('printer_not_configured');
    await this.start();
    const id=crypto.randomUUID();
    const started=Date.now();
    return new Promise((resolve,reject)=>{
      const timeout=setTimeout(()=>{this.pending.delete(id);reject(new Error('print_timeout'));this.restart();},20000);
      this.pending.set(id,{resolve:(value)=>{this.metric('print.spool',Date.now()-started,{printer,name,ok:true});resolve(value);},reject:(error)=>{this.metric('print.spool',Date.now()-started,{printer,name,ok:false,error:error.message});reject(error);},timeout});
      try{this.child.stdin.write(JSON.stringify({id,printer,name,base64:Buffer.from(bytes).toString('base64')})+'\n');}
      catch(error){clearTimeout(timeout);this.pending.delete(id);reject(error);}
    });
  }
  restart(){try{this.child?.kill();}catch{}this.child=null;}
  stop(){this.restart();}
}

let singleton;
function printService(options={}){if(!singleton)singleton=new PersistentPrintService(options);return singleton;}
module.exports={PersistentPrintService,printService};
