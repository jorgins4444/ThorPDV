'use strict';
const { execFile } = require('child_process');
const COM = /^COM(?:[1-9][0-9]{0,2})$/i;
const BAUD = new Set([1200,2400,4800,9600,19200]);

function readPopS({ port, baudRate = 9600, timeoutMs = 2500 } = {}) {
  if (process.platform !== 'win32') return Promise.reject(new Error('scale_requires_windows'));
  if (!COM.test(String(port || ''))) return Promise.reject(new Error('scale_invalid_com_port'));
  if (!BAUD.has(Number(baudRate))) return Promise.reject(new Error('scale_invalid_baud'));
  const timeout = Math.max(500, Math.min(7000, Number(timeoutMs) || 2500));
  // Bluetooth SPP creates a virtual COM port; the same serial protocol works for wired RS232.
  // POP-S answers a poll (hex 04); it does not continuously stream readings.
  const script = `$ErrorActionPreference='Stop'
$p = New-Object System.IO.Ports.SerialPort
$p.PortName='${String(port).toUpperCase()}'
$p.BaudRate=${Number(baudRate)}
$p.DataBits=8
$p.Parity=[System.IO.Ports.Parity]::None
$p.StopBits=[System.IO.Ports.StopBits]::Two
$p.Handshake=[System.IO.Ports.Handshake]::None
$p.ReadTimeout=250
$p.WriteTimeout=1000
try {
  $p.Open()
  $p.DiscardInBuffer()
  $p.Write([byte[]]@(4),0,1)
  $deadline=[DateTime]::UtcNow.AddMilliseconds(${timeout})
  $buffer=New-Object byte[] 256
  $bytes=New-Object System.Collections.Generic.List[byte]
  while([DateTime]::UtcNow -lt $deadline -and $bytes.Count -lt 256) {
    try {
      $count=$p.Read($buffer,0,$buffer.Length)
      for($i=0;$i -lt $count;$i++) { $bytes.Add($buffer[$i]) }
      if($bytes.Count -ge 7 -and $p.BytesToRead -eq 0) { Start-Sleep -Milliseconds 90; if($p.BytesToRead -eq 0){ break } }
    } catch [System.TimeoutException] {}
  }
  if($bytes.Count -eq 0){ throw 'scale_no_response' }
  $data=$bytes.ToArray()
  [Convert]::ToBase64String($data)
} finally { if($p.IsOpen){$p.Close()} $p.Dispose() }`;
  return new Promise((resolve,reject)=>{
    execFile('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{windowsHide:true,timeout:timeout+4500,maxBuffer:65536},(error,stdout,stderr)=>{
      if(error) return reject(new Error(String(stderr||error.message).trim().slice(0,400)));
      const data=Buffer.from(String(stdout||'').trim(),'base64');
      if(!data.length) return reject(new Error('scale_no_response'));
      const ascii=data.toString('latin1').replace(/[\x00-\x1f\x7f]/g,' ').trim();
      // Different POP-S firmware/protocol selections have different frames.
      // Do not guess a decimal position from an unverified frame.
      const decimal=ascii.match(/(?:^|\s)([+]?[0-9]{1,2}[.,][0-9]{2,3})(?:\s|$)/);
      const weight=decimal?Number(decimal[1].replace(',','.')):null;
      resolve({ok:true,port:String(port).toUpperCase(),protocol:'urano-pop-s',weightKg:weight!==null&&weight>0&&weight<=31?weight:null,rawHex:data.toString('hex').toUpperCase(),rawText:ascii,requiresProtocolVerification:weight===null||weight<=0||weight>31});
    });
  });
}
module.exports={readPopS};
