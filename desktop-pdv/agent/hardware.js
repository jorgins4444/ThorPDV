const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

function powershell(script) {
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile','-NonInteractive','-Command',script], { windowsHide:true, maxBuffer:1024*1024 }, (error,stdout,stderr)=>{
      if (error) return reject(new Error(stderr || error.message));
      resolve(stdout.trim());
    });
  });
}

function machineId() {
  const macs=[];
  for (const list of Object.values(os.networkInterfaces())) for (const n of list||[]) if (!n.internal && n.mac && n.mac!=='00:00:00:00:00:00') macs.push(n.mac);
  return crypto.createHash('sha256').update([os.hostname(),process.platform,process.arch,...macs.sort()].join('|')).digest('hex');
}

async function listPrinters() {
  const virtualPdf={Name:'__PDF__',DisplayName:'Salvar como PDF',DriverName:'ThorPDV PDF',PortName:'Arquivo PDF',PrinterStatus:'Ready',IsVirtual:true};
  if (process.platform !== 'win32') return [virtualPdf];
  const out=await powershell("Get-Printer | Select-Object Name,DriverName,PortName,PrinterStatus | ConvertTo-Json -Compress");
  if (!out) return [virtualPdf];
  const parsed=JSON.parse(out);
  const printers=(Array.isArray(parsed)?parsed:[parsed]).map(p=>({...p,DisplayName:p.Name,IsVirtual:false}));
  return [virtualPdf,...printers];
}

async function listSerialPorts() {
  if (process.platform !== 'win32') return [];
  const out=await powershell("Get-CimInstance Win32_SerialPort | Select-Object DeviceID,Name,Description | ConvertTo-Json -Compress");
  if (!out) return [];
  const parsed=JSON.parse(out); return Array.isArray(parsed)?parsed:[parsed];
}

async function printText(printerName,text) {
  if (printerName==='__PDF__') throw new Error('pdf_requires_ui');
  if (process.platform !== 'win32') throw new Error('printing_requires_windows');
  if (!printerName) throw new Error('printer_not_configured');
  const file=path.join(os.tmpdir(),`thorpdv-${Date.now()}.txt`); fs.writeFileSync(file,text,'utf8');
  const q=(s)=>String(s).replace(/'/g,"''");
  try { await powershell(`Get-Content -Raw -LiteralPath '${q(file)}' | Out-Printer -Name '${q(printerName)}'`); }
  finally { try{fs.unlinkSync(file);}catch{} }
  return true;
}


function thermalAscii(value) {
  return String(value ?? '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[•·]/g, '-').replace(/[–—]/g, '-')
    .replace(/[^\x0A\x0D\x20-\x7E]/g, '?');
}

async function printThermalText(printerName,text) {
  if (printerName==='__PDF__') throw new Error('pdf_requires_ui');
  if (process.platform !== 'win32') throw new Error('printing_requires_windows');
  if (!printerName) throw new Error('printer_not_configured');
  const normalized=thermalAscii(text).replace(/\r?\n/g,'\n');
  const initialize=Buffer.from([0x1b,0x40,0x1b,0x61,0x00,0x1b,0x4d,0x00]);
  const body=Buffer.from(normalized,'ascii');
  // Feed five lines so the footer clears the cutter, then request a partial cut (GS V 66 0).
  const finish=Buffer.from([0x1b,0x64,0x05,0x1d,0x56,0x42,0x00]);
  const payload=Buffer.concat([initialize,body,finish]);
  await powershell(rawPrinterScript(printerName,payload.toString('base64')));
  return true;
}

function rawPrinterScript(printerName, base64) {
  const q=(s)=>String(s).replace(/'/g,"''");
  return `$src=@'
using System;
using System.Runtime.InteropServices;
public class ThorRawPrinter {
 [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Ansi)] public class DOCINFOA { [MarshalAs(UnmanagedType.LPStr)] public string pDocName; [MarshalAs(UnmanagedType.LPStr)] public string pOutputFile; [MarshalAs(UnmanagedType.LPStr)] public string pDataType; }
 [DllImport("winspool.Drv", EntryPoint="OpenPrinterA", SetLastError=true, CharSet=CharSet.Ansi, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)] public static extern bool OpenPrinter(string szPrinter, out IntPtr hPrinter, IntPtr pd);
 [DllImport("winspool.Drv", SetLastError=true, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)] public static extern bool ClosePrinter(IntPtr hPrinter);
 [DllImport("winspool.Drv", EntryPoint="StartDocPrinterA", SetLastError=true, CharSet=CharSet.Ansi, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)] public static extern bool StartDocPrinter(IntPtr hPrinter, Int32 level, [In,MarshalAs(UnmanagedType.LPStruct)] DOCINFOA di);
 [DllImport("winspool.Drv", SetLastError=true, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)] public static extern bool EndDocPrinter(IntPtr hPrinter);
 [DllImport("winspool.Drv", SetLastError=true, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)] public static extern bool StartPagePrinter(IntPtr hPrinter);
 [DllImport("winspool.Drv", SetLastError=true, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)] public static extern bool EndPagePrinter(IntPtr hPrinter);
 [DllImport("winspool.Drv", SetLastError=true, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)] public static extern bool WritePrinter(IntPtr hPrinter, IntPtr pBytes, Int32 count, out Int32 written);
 public static bool Send(string printer, byte[] bytes) { IntPtr h; if(!OpenPrinter(printer,out h,IntPtr.Zero)) return false; var di=new DOCINFOA{pDocName="ThorPDV RAW",pDataType="RAW"}; bool ok=StartDocPrinter(h,1,di); if(ok){ok=StartPagePrinter(h); IntPtr p=Marshal.AllocCoTaskMem(bytes.Length); try{Marshal.Copy(bytes,0,p,bytes.Length); int total=0; while(ok && total<bytes.Length){int written=0; ok=WritePrinter(h,IntPtr.Add(p,total),bytes.Length-total,out written); if(!ok || written<=0){ok=false;break;} total+=written;} ok=ok && total==bytes.Length;}finally{Marshal.FreeCoTaskMem(p);} EndPagePrinter(h); EndDocPrinter(h);} ClosePrinter(h); return ok; }
}
'@; Add-Type -TypeDefinition $src -ErrorAction SilentlyContinue; $b=[Convert]::FromBase64String('${q(base64)}'); if(-not [ThorRawPrinter]::Send('${q(printerName)}',$b)){throw 'raw_print_failed'}`;
}

async function openDrawer(printerName) {
  if (process.platform !== 'win32') throw new Error('drawer_requires_windows');
  if (!printerName || printerName==='__PDF__') throw new Error('drawer_printer_not_configured');
  const pulse=Buffer.from([0x1b,0x70,0x00,0x19,0xfa]);
  await powershell(rawPrinterScript(printerName,pulse.toString('base64')));
  return true;
}

async function readScaleDetailed(portName, baudRate=9600, timeoutMs=1500) {
  if (process.platform !== 'win32') throw new Error('scale_requires_windows');
  if (!portName) throw new Error('scale_port_not_configured');
  const q=(s)=>String(s).replace(/'/g,"''");
  const baud=Math.max(1200,Number(baudRate)||9600);
  const timeout=Math.max(300,Number(timeoutMs)||1500);
  const script=`$p=New-Object System.IO.Ports.SerialPort '${q(portName)}',${baud},'None',8,'One'; $p.ReadTimeout=${timeout}; try{$p.Open(); $line=$p.ReadLine(); Write-Output $line} finally{if($p.IsOpen){$p.Close()}}`;
  const out=await powershell(script);
  const raw=String(out||'').trim();
  const normalized=raw.replace(',','.');
  const match=normalized.match(/-?\d+(?:\.\d+)?/);
  if(!match) throw new Error('scale_weight_not_detected');
  const value=Number(match[0]);
  if(!Number.isFinite(value)) throw new Error('scale_invalid_weight');
  return { value, raw, token:match[0], hasDecimal:/[.,]\d+/.test(raw) };
}

async function readScale(portName, baudRate=9600, timeoutMs=1500) {
  return (await readScaleDetailed(portName,baudRate,timeoutMs)).value;
}

module.exports={ machineId,listPrinters,listSerialPorts,printText,printThermalText,openDrawer,readScale,readScaleDetailed };
