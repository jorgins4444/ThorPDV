from pathlib import Path
import json

app_path = Path('desktop-pdv/renderer/app.js')
src = app_path.read_text(encoding='utf-8')

state_line = "let state={status:null,products:[],cart:[],payment:'cash',query:'',busy:false,view:'sale',settings:null,fiscalSales:[],fiscalQuery:'',fiscalFilter:{status:'all',from:'',to:''},capturingShortcut:false};\n"
cache_block = """let state={status:null,products:[],cart:[],payment:'cash',query:'',busy:false,view:'sale',settings:null,fiscalSales:[],fiscalQuery:'',fiscalFilter:{status:'all',from:'',to:''},capturingShortcut:false};
const SETTINGS_HARDWARE_CACHE_TTL_MS=45_000;
let settingsHardwareCache={printers:null,ports:null,loadedAt:0,promise:null};
"""
if 'SETTINGS_HARDWARE_CACHE_TTL_MS' not in src:
    if state_line not in src:
        raise SystemExit('state marker not found')
    src = src.replace(state_line, cache_block, 1)

start = src.find('async function settingsModal(){')
end = src.find('\nfunction openCashModal()', start)
if start < 0 or end < 0:
    raise SystemExit('settingsModal markers not found')

new_settings = r'''function settingsFallbackHardware(settings){
  const virtualPdf={Name:'__PDF__',DisplayName:'Salvar como PDF',DriverName:'ThorPDV PDF',PortName:'Arquivo PDF',IsVirtual:true};
  const configured=String(settings?.printerName||'').trim();
  const printers=[virtualPdf];
  if(configured&&configured!=='__PDF__')printers.push({Name:configured,DisplayName:configured,DriverName:'',PortName:'',IsVirtual:false,ConfiguredOnly:true});
  return {printers,ports:[]};
}
function settingsPrinterOptions(printers,selected=''){
  const byName=new Map();
  for(const p of Array.isArray(printers)?printers:[]){const name=String(p?.Name||'').trim();if(name&&!byName.has(name))byName.set(name,p);}
  if(!byName.has('__PDF__'))byName.set('__PDF__',{Name:'__PDF__',DisplayName:'Salvar como PDF',PortName:'Arquivo PDF',IsVirtual:true});
  if(selected&&!byName.has(selected))byName.set(selected,{Name:selected,DisplayName:selected,ConfiguredOnly:true});
  return `<option value="">Não configurada</option>${[...byName.values()].map(p=>`<option value="${esc(p.Name)}" ${selected===p.Name?'selected':''}>${esc(p.DisplayName||p.Name)}${p.PortName?` — ${esc(p.PortName)}`:''}</option>`).join('')}`;
}
function applySettingsHardware(m,settings,printers,ports,{loading=false,cached=false}={}){
  if(!m?.isConnected)return;
  const select=m.querySelector('#printerSelect');
  const selected=String(select?.value||settings?.printerName||'');
  if(select){select.innerHTML=settingsPrinterOptions(printers,selected);if([...select.options].some(o=>o.value===selected))select.value=selected;}
  const info=m.querySelector('#printerInfo');
  if(info){const physical=(Array.isArray(printers)?printers:[]).filter(p=>p.Name!=='__PDF__'&&!p.ConfiguredOnly);info.innerHTML=physical.map(p=>`<div><b>${esc(p.Name)}</b><span>${esc(p.DriverName||'')} ${p.DriverName&&p.PortName?'•':''} ${esc(p.PortName||'')}</span></div>`).join('')||(loading?'<span>Detectando impressoras do Windows em segundo plano...</span>':'<span>Nenhuma impressora física detectada.</span>');}
  const printerStatus=m.querySelector('#printerHardwareStatus');
  if(printerStatus)printerStatus.textContent=loading?(cached?'Atualizando lista em segundo plano...':'Detectando em segundo plano...'):(cached?'Lista carregada do cache local.':'Hardware atualizado.');
  const serial=m.querySelector('#serialHardware');
  if(serial)serial.textContent=`Portas COM: ${(Array.isArray(ports)?ports:[]).map(p=>String(p?.DeviceID||'')).filter(Boolean).join(', ')||'nenhuma'}`;
  const serialStatus=m.querySelector('#serialHardwareStatus');
  if(serialStatus)serialStatus.textContent=loading?'A detecção não bloqueia mais esta tela.':'';
}
function loadSettingsHardware(m,settings,{force=false}={}){
  const now=Date.now();
  const fallback=settingsFallbackHardware(settings);
  const hasCache=Array.isArray(settingsHardwareCache.printers)&&Array.isArray(settingsHardwareCache.ports);
  const fresh=hasCache&&(now-settingsHardwareCache.loadedAt)<SETTINGS_HARDWARE_CACHE_TTL_MS;
  if(fresh&&!force){applySettingsHardware(m,settings,settingsHardwareCache.printers,settingsHardwareCache.ports,{cached:true});return Promise.resolve(settingsHardwareCache);}
  const initialPrinters=hasCache?settingsHardwareCache.printers:fallback.printers;
  const initialPorts=hasCache?settingsHardwareCache.ports:fallback.ports;
  applySettingsHardware(m,settings,initialPrinters,initialPorts,{loading:true,cached:hasCache});
  if(!settingsHardwareCache.promise||force){
    settingsHardwareCache.promise=Promise.all([
      window.thor.printers().catch(()=>null),
      window.thor.serialPorts().catch(()=>null),
    ]).then(([printers,ports])=>{
      settingsHardwareCache.printers=Array.isArray(printers)&&printers.length?printers:initialPrinters;
      settingsHardwareCache.ports=Array.isArray(ports)?ports:initialPorts;
      settingsHardwareCache.loadedAt=Date.now();
      return settingsHardwareCache;
    }).finally(()=>{settingsHardwareCache.promise=null;});
  }
  const pending=settingsHardwareCache.promise;
  return pending.then(cache=>{applySettingsHardware(m,settings,cache.printers,cache.ports,{cached:false});return cache;}).catch(()=>{applySettingsHardware(m,settings,initialPrinters,initialPorts,{cached:hasCache});return settingsHardwareCache;});
}

function settingsModal(){
  const settings=state.settings||state.status?.settings||{printerName:'',printMode:'ask',printDocument:'ask',shortcuts:{}};
  const shortcuts={...(settings.shortcuts||{})};
  const cached=Array.isArray(settingsHardwareCache.printers)&&Array.isArray(settingsHardwareCache.ports);
  const initial=cached?{printers:settingsHardwareCache.printers,ports:settingsHardwareCache.ports}:settingsFallbackHardware(settings);
  const m=modal(`<div class="settings-head"><div><small>CONFIGURAÇÕES DO TERMINAL</small><h3>Impressão e atalhos</h3></div><span>ThorPDV ${esc(state.status?.appVersion||'')}</span></div><div class="settings-grid"><section><h4>Impressora</h4><div class="field"><label>Destino de impressão</label><select id="printerSelect">${settingsPrinterOptions(initial.printers,String(settings.printerName||''))}</select><small class="muted" id="printerHardwareStatus">${cached?'Lista carregada do cache local.':'Abrindo configurações...'}</small></div><div class="printer-info" id="printerInfo"></div><p class="muted">“Salvar como PDF” abre uma janela para escolher o arquivo no Windows.</p><h4>Comportamento após a venda</h4><div class="field"><label>Modo de impressão</label><select id="printMode"><option value="ask" ${settings.printMode==='ask'?'selected':''}>Perguntar após finalizar</option><option value="direct" ${settings.printMode==='direct'?'selected':''}>Imprimir / solicitar direto</option><option value="never" ${settings.printMode==='never'?'selected':''}>Não imprimir automaticamente</option></select></div><div class="field"><label>Documento padrão</label><select id="printDocument"><option value="ask" ${settings.printDocument==='ask'?'selected':''}>Perguntar: pré-venda ou NFC-e</option><option value="pre_sale" ${settings.printDocument==='pre_sale'?'selected':''}>Pré-venda / comprovante não fiscal</option><option value="nfce" ${settings.printDocument==='nfce'?'selected':''}>NFC-e</option></select></div></section><section><h4>Atalhos das formas de pagamento</h4><p class="muted">Clique em um campo e pressione a tecla que deseja usar. F2, F3, F4, F6 e F12 são reservadas pelo sistema.</p><div class="shortcut-list">${Object.entries(paymentLabels).map(([k,n])=>`<label><span>${n}</span><input readonly data-shortcut="${k}" value="${esc(shortcuts[k]||'')}"></label>`).join('')}</div><h4>Hardware detectado</h4><div class="hardware-list"><span id="serialHardware">Portas COM: ${(initial.ports||[]).map(p=>esc(p.DeviceID)).join(', ')||'nenhuma'}</span><small class="muted" id="serialHardwareStatus"></small></div></section></div><div id="settingsError" class="settings-error"></div><div class="actions"><button class="secondary" id="refreshHardware">Atualizar hardware</button><button class="secondary" id="closeSettings">Cancelar</button><button class="primary" id="saveSettings">Salvar configurações</button></div>`,'wide');
  applySettingsHardware(m,settings,initial.printers,initial.ports,{loading:!cached,cached});
  setTimeout(()=>{void loadSettingsHardware(m,settings);},0);
  m.querySelector('#refreshHardware').onclick=()=>{settingsHardwareCache.loadedAt=0;void loadSettingsHardware(m,settings,{force:true});};
  m.querySelector('#closeSettings').onclick=()=>m.remove();
  m.querySelectorAll('[data-shortcut]').forEach(input=>{input.onfocus=()=>{state.capturingShortcut=true;input.value='Pressione...';};input.onblur=()=>{state.capturingShortcut=false;if(input.value==='Pressione...')input.value=shortcuts[input.dataset.shortcut]||'';};input.onkeydown=e=>{e.preventDefault();const key=normalizeKey(e);if(!key)return;if(reservedShortcuts.has(key)){m.querySelector('#settingsError').textContent=`${key} é reservado pelo sistema.`;return;}shortcuts[input.dataset.shortcut]=key;input.value=key;m.querySelector('#settingsError').textContent='';input.blur();};});
  m.querySelector('#saveSettings').onclick=async()=>{const values=Object.values(shortcuts).filter(Boolean);if(new Set(values).size!==values.length){m.querySelector('#settingsError').textContent='Cada forma de pagamento precisa ter uma tecla diferente.';return;}state.settings=await window.thor.saveSettings({printerName:m.querySelector('#printerSelect').value,printMode:m.querySelector('#printMode').value,printDocument:m.querySelector('#printDocument').value,shortcuts});state.status.settings=state.settings;state.status.printer=state.settings.printerName;m.remove();render();showToast('Configurações salvas neste caixa.');};
}
'''

src = src[:start] + new_settings + src[end:]
app_path.write_text(src, encoding='utf-8')

pkg_path = Path('desktop-pdv/package.json')
pkg = json.loads(pkg_path.read_text(encoding='utf-8'))
pkg['version'] = '0.8.1'
pkg_path.write_text(json.dumps(pkg, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

print('Patched settings modal for immediate rendering + async cached hardware discovery; version 0.8.1')
