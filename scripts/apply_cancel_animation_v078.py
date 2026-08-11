from pathlib import Path
import re
import json

# ---------------- Desktop cancellation flow ----------------
p = Path('desktop-pdv/renderer/app.js')
s = p.read_text()
pattern = re.compile(r"function cancelSaleModal\(sale\)\{[\s\S]*?\n\}\n\nfunction returnSaleModal", re.M)
replacement = r'''function cancelProgressSteps(fiscalCancellation,phase,errorStage=0){
  const steps=fiscalCancellation?['Validando prazo','Preparando evento','Assinando evento','Enviando à SEFAZ','Evento aceito','Estorno da venda']:['Validando','Estornando venda','Sincronizando Gestão'];
  const map=fiscalCancellation?{validating:0,building:1,signing:2,sending:3,accepted:4,reversing:5,done:6}:{validating:0,reversing:1,syncing:2,done:3};
  const phaseIndex=phase==='error'?errorStage:(map[phase]??0);
  return `<div class="fiscal-progress-steps smooth cancel-progress-steps ${fiscalCancellation?'fiscal-cancel':'sale-cancel'}">${steps.map((label,index)=>{const done=phase==='done'||index<phaseIndex;const active=phase!=='done'&&phase!=='error'&&index===phaseIndex;const error=phase==='error'&&index===phaseIndex;return `<div class="fiscal-progress-step ${done?'done':''} ${active?'active':''} ${error?'error':''}"><i>${done?'✓':error?'!':''}</i><span>${label}</span></div>`}).join('')}</div>`;
}
function paintCancelProgress(m,sale,{fiscalCancellation,phase='validating',error='',errorStage=0,syncPending=false}={}){
  if(!m?.isConnected)return;
  if(!m.dataset.cancelStartedAt)m.dataset.cancelStartedAt=String(Date.now());
  const elapsed=Math.max(0,Date.now()-Number(m.dataset.cancelStartedAt||Date.now()));
  const fiscal=sale?.fiscal||{};
  const fiscalPct={validating:8,building:23,signing:40,sending:62,accepted:80,reversing:94,done:100,error:Math.max(14,Math.min(88,(errorStage+1)*16))};
  const localPct={validating:12,reversing:62,syncing:88,done:100,error:35};
  const pct=(fiscalCancellation?fiscalPct:localPct)[phase]??10;
  let title=fiscalCancellation?'Validando cancelamento da NFC-e':'Validando cancelamento da venda';
  let subtitle=fiscalCancellation?'Conferindo prazo fiscal e dados do documento.':'Conferindo venda e permissões do operador.';
  if(phase==='building'){title='Preparando evento de cancelamento';subtitle='Montando o evento 110111 com protocolo e justificativa.';}
  if(phase==='signing'){title='Assinando evento com certificado A1';subtitle='Aplicando assinatura digital antes da transmissão.';}
  if(phase==='sending'){title='Enviando cancelamento para a SEFAZ';subtitle='Aguardando o registro do evento no autorizador.';}
  if(phase==='accepted'){title='Cancelamento aceito pela SEFAZ';subtitle='Evento registrado. Finalizando o estorno da venda neste caixa.';}
  if(phase==='reversing'){title=fiscalCancellation?'NFC-e cancelada — estorno concluído':'Venda estornada';subtitle='Estoque e financeiro locais foram revertidos; sincronizando o Thor Gestão.';}
  if(phase==='syncing'){title='Venda estornada';subtitle='Sincronizando o cancelamento com o Thor Gestão.';}
  if(phase==='done'){title=fiscalCancellation?'NFC-e e venda canceladas':'Venda cancelada';subtitle=syncPending?'Cancelamento concluído neste caixa. A sincronização com o Gestão ficará pendente e será reenviada automaticamente.':'Estoque, financeiro e Gestão estão atualizados.';}
  if(phase==='error'){title='Cancelamento não concluído';subtitle=error||'O cancelamento foi interrompido.';}
  const body=m.querySelector('#cancelProgressBody');if(!body)return;
  const protocol=fiscal.cancellation_protocol||'';
  const code=String(fiscal.cancellation_cstat||fiscal.cStat||'').trim();
  const deadline=nfceCancellationState(sale).deadline;
  const stopped=phase==='done'||phase==='error';
  body.innerHTML=`<div class="fiscal-progress-head smooth cancel-progress-head"><div class="fiscal-spinner ${stopped?'stopped':''} ${phase==='done'?'success':''} ${phase==='error'?'cancel-error-spinner':''}">${phase==='done'?'✓':phase==='error'?'!':''}</div><div><small>${fiscalCancellation?'THORFISCAL / CANCELAMENTO':'THORPDV / CANCELAMENTO'}</small><h3>${esc(title)}</h3><p>${esc(subtitle)}</p></div><span class="fiscal-elapsed">${(elapsed/1000).toFixed(1)}s</span></div><div class="fiscal-flight cancel-flight ${phase==='error'?'error':''}"><div class="fiscal-flight-fill" style="width:${pct}%"></div><div class="fiscal-flight-glow" style="left:${Math.max(pct-2,0)}%"></div></div>${cancelProgressSteps(fiscalCancellation,phase,errorStage)}<div class="fiscal-progress-meta"><span>Venda: <b>${sale.number?`#${esc(sale.number)}`:'local'}</b></span>${fiscalCancellation?`<span>Chave: <b>${esc(fiscal.access_key||'—')}</b></span>`:''}${deadline?`<span>Prazo: <b>${esc(cancelDeadlineLabel(deadline))}</b></span>`:''}${protocol?`<span>Protocolo cancelamento: <b>${esc(protocol)}</b></span>`:''}${code?`<span>cStat: <b>${esc(code)}</b></span>`:''}</div>${phase==='error'?`<div class="fiscal-diagnostic error cancel-progress-error"><b>Cancelamento interrompido</b><span>${esc(error||'Verifique o retorno e tente novamente somente se necessário.')}</span></div>`:''}${phase==='done'&&syncPending?'<div class="fiscal-diagnostic warning"><b>Sincronização pendente</b><span>O cancelamento fiscal e o estorno local já foram concluídos. O ThorPDV tentará reenviar a atualização ao Gestão nas próximas sincronizações.</span></div>':''}<div class="actions" id="cancelProgressActions"></div>`;
  const actions=body.querySelector('#cancelProgressActions');
  if(phase==='done'){actions.innerHTML='<button class="primary" id="cancelFinish">Concluir</button>';actions.querySelector('#cancelFinish').onclick=()=>m.remove();}
  if(phase==='error'){const stateNow=nfceCancellationState(sale);const retryable=!fiscalCancellation||stateNow.available;actions.innerHTML=`<button class="secondary" id="cancelClose">Fechar</button>${retryable?'<button class="danger primary" id="cancelRetry">Tentar novamente</button>':''}`;actions.querySelector('#cancelClose').onclick=()=>m.remove();const retry=actions.querySelector('#cancelRetry');if(retry)retry.onclick=()=>{m.remove();cancelSaleModal(sale);};}
}

function cancelSaleModal(sale){
  const stateNow=nfceCancellationState(sale);
  if(stateNow.authorized&&!stateNow.available){infoModal('Cancelamento',friendlyError('nfce_cancellation_window_expired'));return;}
  const fiscalCancellation=stateNow.authorized;
  const intro=fiscalCancellation?`A NFC-e será cancelada primeiro na SEFAZ. Somente após o registro do evento o THOR concluirá o estorno da venda. Prazo normal: até ${esc(cancelDeadlineLabel(stateNow.deadline))}.`:'O cancelamento estorna o estoque e o financeiro da venda.';
  const m=modal(`<h3>${fiscalCancellation?'Cancelar venda + NFC-e':'Cancelar venda'} ${sale.number?`#${esc(sale.number)}`:''}</h3><p class="muted">${intro}</p>${fiscalCancellation?`<div class="fiscal-diagnostic processing"><b>Tempo restante</b><span id="cancelCountdown">${cancelRemainingLabel(stateNow.remainingMs)}</span></div>`:''}<div class="field"><label>Motivo do cancelamento</label><textarea id="cancelReason" rows="3" maxlength="255" placeholder="${fiscalCancellation?'Informe ao menos 15 caracteres...':'Informe o motivo...'}"></textarea></div><div class="actions"><button class="secondary" id="back">Voltar</button><button class="danger primary" id="confirmCancel">${fiscalCancellation?'Cancelar na SEFAZ e estornar venda':'Confirmar cancelamento'}</button></div>`,'wide');
  m.querySelector('#back').onclick=()=>m.remove();
  let countdownTimer=null;
  if(fiscalCancellation&&stateNow.deadline){countdownTimer=setInterval(()=>{if(!m.isConnected){clearInterval(countdownTimer);return;}const rem=stateNow.deadline-Date.now(),label=m.querySelector('#cancelCountdown'),button=m.querySelector('#confirmCancel');if(label)label.textContent=cancelRemainingLabel(rem);if(rem<=0){if(button)button.disabled=true;if(label)label.textContent='Prazo encerrado';clearInterval(countdownTimer);}},1000);}
  m.querySelector('#confirmCancel').onclick=async()=>{
    const reason=m.querySelector('#cancelReason').value.trim().replace(/\s+/g,' ');
    if(!reason)return alert('Informe o motivo.');
    if(fiscalCancellation&&(reason.length<15||reason.length>255))return alert('A justificativa fiscal deve ter entre 15 e 255 caracteres.');
    if(countdownTimer)clearInterval(countdownTimer);
    const card=m.querySelector('.modal-card');card.innerHTML='<div id="cancelProgressBody"></div>';m.dataset.cancelStartedAt=String(Date.now());
    paintCancelProgress(m,sale,{fiscalCancellation,phase:'validating'});
    let settled=false,cancelError=null;
    const task=window.thor.cancelSale({saleKey:saleKey(sale),reason}).then(()=>{settled=true;}).catch(e=>{cancelError=e;settled=true;});
    while(!settled&&m.isConnected){const elapsed=Date.now()-Number(m.dataset.cancelStartedAt||Date.now());const phase=fiscalCancellation?(elapsed<350?'validating':elapsed<800?'building':elapsed<1350?'signing':'sending'):(elapsed<350?'validating':'reversing');paintCancelProgress(m,sale,{fiscalCancellation,phase});await wait(120);}
    await task;
    if(cancelError){const raw=String(cancelError?.message||cancelError||'');let stage=fiscalCancellation?3:1;if(raw.includes('window_expired'))stage=0;else if(raw.includes('reason_invalid'))stage=1;else if(raw.includes('rejected'))stage=4;else if(raw.includes('transmission'))stage=3;paintCancelProgress(m,sale,{fiscalCancellation,phase:'error',error:friendlyError(raw),errorStage:stage});return;}
    let finalSale=sale;try{finalSale=await window.thor.fiscalSale(saleKey(sale));}catch{}
    if(fiscalCancellation){paintCancelProgress(m,finalSale,{fiscalCancellation,phase:'accepted'});await wait(180);}
    paintCancelProgress(m,finalSale,{fiscalCancellation,phase:'reversing'});
    let syncPending=false;
    try{await window.thor.sync();}catch{syncPending=true;}
    try{await refreshProducts();}catch{}
    try{await refreshFiscalSales();}catch{}
    try{finalSale=await window.thor.fiscalSale(saleKey(sale));}catch{}
    paintCancelProgress(m,finalSale,{fiscalCancellation,phase:'done',syncPending});
    showToast(fiscalCancellation?'NFC-e cancelada e venda estornada.':'Venda cancelada.');
  };
}

function returnSaleModal'''
s, count = pattern.subn(replacement, s, count=1)
if count != 1:
    raise SystemExit('cancelSaleModal block not found')
p.write_text(s)

# Desktop CSS
p = Path('desktop-pdv/renderer/styles.css')
s = p.read_text()
marker = '/* cancellation progress v078 */'
if marker not in s:
    s += r'''

/* cancellation progress v078 */
.cancel-progress-steps.fiscal-cancel{grid-template-columns:repeat(6,minmax(0,1fr))}.cancel-progress-steps.sale-cancel{grid-template-columns:repeat(3,minmax(0,1fr))}.cancel-progress-head small{color:#b73540}.cancel-flight .fiscal-flight-fill{background:linear-gradient(90deg,#c54450,#df6a61)}.cancel-flight .fiscal-flight-glow{background:#d94c5733;box-shadow:0 0 20px #d94c5766}.cancel-flight.error .fiscal-flight-fill{background:linear-gradient(90deg,#9f2e38,#d14450)}.cancel-error-spinner{border:0!important;background:#c9424d!important;color:#fff!important;display:grid;place-items:center;font-size:22px;font-weight:900}.cancel-progress-error{margin-top:12px}.cancel-progress-steps .fiscal-progress-step.active{border-color:#efb3b8;background:#fff4f5;color:#9f3039}.cancel-progress-steps .fiscal-progress-step.active i{border-color:#c9424d}.cancel-progress-steps .fiscal-progress-step.done{background:#f9eded;border-color:#e7bdc1;color:#8c3038}.cancel-progress-steps .fiscal-progress-step.done i{background:#c9424d;border-color:#c9424d}@media(max-width:900px){.cancel-progress-steps.fiscal-cancel{grid-template-columns:repeat(3,1fr)}}@media(max-width:560px){.cancel-progress-steps.fiscal-cancel,.cancel-progress-steps.sale-cancel{grid-template-columns:1fr 1fr}}
'''
p.write_text(s)

# Bump Desktop version
p = Path('desktop-pdv/package.json')
data = json.loads(p.read_text())
data['version'] = '0.7.8'
p.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n')

# ---------------- Thor Gestão cancellation flow ----------------
p = Path('src/app/dashboard/[...slug]/fiscal-workspace.tsx')
s = p.read_text()
state_marker = "  const [cancelling, setCancelling] = useState<string | null>(null);\n"
if state_marker not in s:
    raise SystemExit('cancelling state marker not found')
state_insert = """  const [cancelling, setCancelling] = useState<string | null>(null);\n  const [cancelFlow,setCancelFlow]=useState<{id:string;number:string;phase:'validating'|'building'|'signing'|'sending'|'done'|'error';startedAt:number;error?:string;errorStage?:number;protocol?:string;cStat?:string}|null>(null);\n"""
s = s.replace(state_marker, state_insert, 1)

cancel_pattern = re.compile(r"  async function cancelNfce\(id: string, number: unknown\) \{[\s\S]*?\n  \}\n\n  async function downloadXml", re.M)
cancel_replacement = r'''  async function cancelNfce(id: string, number: unknown) {
    const reason = window.prompt(`Justificativa para cancelar a NFC-e ${text(number)} (15 a 255 caracteres):`, '');
    if (!reason) return;
    const clean = reason.trim().replace(/\s+/g, ' ');
    if (clean.length < 15 || clean.length > 255) {
      setMessage('A justificativa deve ter entre 15 e 255 caracteres.');
      return;
    }
    if (!window.confirm(`Confirmar o envio do evento de cancelamento da NFC-e ${text(number)} para a SEFAZ?`)) return;
    setCancelling(id);
    setMessage('');
    const startedAt=Date.now();
    setCancelFlow({id,number:text(number),phase:'validating',startedAt});
    const timers=[
      window.setTimeout(()=>setCancelFlow(current=>current?.id===id&&current.phase!=='done'&&current.phase!=='error'?{...current,phase:'building'}:current),260),
      window.setTimeout(()=>setCancelFlow(current=>current?.id===id&&current.phase!=='done'&&current.phase!=='error'?{...current,phase:'signing'}:current),680),
      window.setTimeout(()=>setCancelFlow(current=>current?.id===id&&current.phase!=='done'&&current.phase!=='error'?{...current,phase:'sending'}:current),1120),
    ];
    const r = await erpFiscalCancel(id, clean);
    timers.forEach(t=>window.clearTimeout(t));
    setCancelling(null);
    if (r.ok && (r.cancelled || r.idempotent)) {
      setCancelFlow({id,number:text(number),phase:'done',startedAt,protocol:text(r.cancellation_protocol),cStat:text(r.cStat)});
      setMessage(`NFC-e cancelada na SEFAZ${r.cancellation_protocol ? ` · protocolo ${String(r.cancellation_protocol)}` : ''}${r.cStat ? ` · cStat ${String(r.cStat)}` : ''}.`);
    } else {
      const labels: Record<string, string> = {
        nfce_cancellation_window_expired: 'O prazo fiscal de 30 minutos para cancelamento desta NFC-e já encerrou.',
        nfce_cancellation_reason_invalid: 'A justificativa deve ter entre 15 e 255 caracteres.',
        nfce_cancellation_rejected: `A SEFAZ rejeitou o cancelamento${r.cStat ? ` (${String(r.cStat)})` : ''}: ${String(r.message ?? r.detail ?? 'verifique o retorno fiscal')}`,
        nfce_cancellation_transmission_error: `Falha de comunicação durante o cancelamento: ${String(r.message ?? r.detail ?? 'tente novamente enquanto estiver no prazo')}`,
      };
      const errorMessage=labels[String(r.error)] ?? `Cancelamento não realizado: ${String(r.message ?? r.detail ?? r.error ?? 'erro')}`;
      const errorStage=String(r.error)==='nfce_cancellation_window_expired'?0:String(r.error)==='nfce_cancellation_reason_invalid'?1:String(r.error)==='nfce_cancellation_rejected'?4:3;
      setCancelFlow({id,number:text(number),phase:'error',startedAt,error:errorMessage,errorStage,cStat:text(r.cStat)});
      setMessage(errorMessage);
    }
    await refresh();
  }

  async function downloadXml'''
s, count = cancel_pattern.subn(cancel_replacement, s, count=1)
if count != 1:
    raise SystemExit('cancelNfce function not found')

jsx_marker = "    {message && <div className=\"erp-message erp-fiscal-message\">{message}</div>}\n"
if jsx_marker not in s:
    raise SystemExit('message jsx marker not found')
flow_jsx = r'''    {cancelFlow && (()=>{
      const steps=['Validando prazo','Preparando evento','Assinando A1','Enviando à SEFAZ','Evento registrado'];
      const phaseIndex=cancelFlow.phase==='validating'?0:cancelFlow.phase==='building'?1:cancelFlow.phase==='signing'?2:cancelFlow.phase==='sending'?3:cancelFlow.phase==='done'?5:(cancelFlow.errorStage??3);
      const percent=cancelFlow.phase==='done'?100:cancelFlow.phase==='error'?Math.max(16,Math.min(88,(phaseIndex+1)*18)):[12,30,50,72,90][phaseIndex]??12;
      const title=cancelFlow.phase==='validating'?'Validando cancelamento da NFC-e':cancelFlow.phase==='building'?'Preparando evento 110111':cancelFlow.phase==='signing'?'Assinando evento com certificado A1':cancelFlow.phase==='sending'?'Enviando cancelamento para a SEFAZ':cancelFlow.phase==='done'?'Cancelamento registrado na SEFAZ':'Cancelamento interrompido';
      const subtitle=cancelFlow.phase==='validating'?'Conferindo prazo fiscal e dados da nota.':cancelFlow.phase==='building'?'Montando chave, protocolo e justificativa do evento.':cancelFlow.phase==='signing'?'Aplicando assinatura digital antes da transmissão.':cancelFlow.phase==='sending'?'Aguardando o retorno do autorizador.':cancelFlow.phase==='done'?'O evento foi registrado e vinculado à NFC-e.':cancelFlow.error||'Não foi possível concluir o cancelamento.';
      return <section className={`erp-module-card fiscal-cancel-flow ${cancelFlow.phase==='done'?'success':''} ${cancelFlow.phase==='error'?'error':''}`}>
        <div className="fiscal-cancel-flow-head"><div className={`fiscal-cancel-spinner ${cancelFlow.phase==='done'?'done':''} ${cancelFlow.phase==='error'?'failed':''}`}>{cancelFlow.phase==='done'?'✓':cancelFlow.phase==='error'?'!':''}</div><div><small>THORFISCAL / CANCELAMENTO</small><h3>{title}</h3><p>{subtitle}</p></div><span>{Math.max(0,(now-cancelFlow.startedAt)/1000).toFixed(1)}s</span></div>
        <div className="fiscal-cancel-flight"><i style={{width:`${percent}%`}}/><b style={{left:`${Math.max(percent-2,0)}%`}}/></div>
        <div className="fiscal-cancel-steps">{steps.map((label,index)=>{const done=cancelFlow.phase==='done'||index<phaseIndex;const active=cancelFlow.phase!=='done'&&cancelFlow.phase!=='error'&&index===phaseIndex;const failed=cancelFlow.phase==='error'&&index===phaseIndex;return <div key={label} className={`${done?'done':''} ${active?'active':''} ${failed?'failed':''}`}><i>{done?'✓':failed?'!':''}</i><span>{label}</span></div>})}</div>
        <div className="fiscal-cancel-meta"><span>NFC-e <b>{cancelFlow.number||'—'}</b></span>{cancelFlow.protocol&&<span>Protocolo <b>{cancelFlow.protocol}</b></span>}{cancelFlow.cStat&&<span>cStat <b>{cancelFlow.cStat}</b></span>}</div>
        {cancelFlow.phase==='error'&&<div className="fiscal-cancel-error"><b>Cancelamento não concluído</b><span>{cancelFlow.error}</span></div>}
        {(cancelFlow.phase==='done'||cancelFlow.phase==='error')&&<div className="fiscal-cancel-actions"><button type="button" className="erp-ghost" onClick={()=>setCancelFlow(null)}>Fechar</button></div>}
      </section>;
    })()}

    {message && <div className="erp-message erp-fiscal-message">{message}</div>}
'''
s = s.replace(jsx_marker, flow_jsx, 1)
p.write_text(s)

# Gestão CSS
p = Path('src/app/dashboard/[...slug]/fiscal.css')
s = p.read_text()
marker = '/* animated fiscal cancellation v078 */'
if marker not in s:
    s += r'''

/* animated fiscal cancellation v078 */
.fiscal-cancel-flow{grid-column:1/-1;padding:18px 20px;border-color:#eed9dc;background:linear-gradient(135deg,#fff,#fff8f8);overflow:hidden}.fiscal-cancel-flow-head{display:flex;align-items:center;gap:13px;position:relative;padding-right:70px}.fiscal-cancel-flow-head small{font-size:10px;font-weight:900;letter-spacing:.12em;color:#b23742}.fiscal-cancel-flow-head h3{margin:3px 0 4px;font-size:18px}.fiscal-cancel-flow-head p{margin:0;color:#6e7471;font-size:12px}.fiscal-cancel-flow-head>span{position:absolute;right:0;top:50%;transform:translateY(-50%);border:1px solid #eadfe0;background:#fff;border-radius:999px;padding:6px 9px;font-size:11px;font-weight:900;color:#7e5559;font-variant-numeric:tabular-nums}.fiscal-cancel-spinner{width:40px;height:40px;flex:0 0 auto;border:4px solid #f0dcde;border-top-color:#c9424d;border-radius:50%;animation:fiscalCancelSpin .85s linear infinite}.fiscal-cancel-spinner.done,.fiscal-cancel-spinner.failed{animation:none;border:0;display:grid;place-items:center;color:#fff;font-size:21px;font-weight:900}.fiscal-cancel-spinner.done{background:#19834b}.fiscal-cancel-spinner.failed{background:#c9424d}.fiscal-cancel-flight{height:7px;position:relative;background:#f3e9ea;border-radius:999px;overflow:visible;margin:17px 0 13px}.fiscal-cancel-flight>i{display:block;height:100%;border-radius:999px;background:linear-gradient(90deg,#b93b47,#dd685f);transition:width .35s cubic-bezier(.2,.8,.2,1)}.fiscal-cancel-flight>b{position:absolute;top:50%;width:24px;height:24px;border-radius:50%;transform:translate(-50%,-50%);background:#d74a5530;box-shadow:0 0 18px #d74a5555;transition:left .35s cubic-bezier(.2,.8,.2,1);animation:fiscalCancelGlow 1.15s ease-in-out infinite}.fiscal-cancel-steps{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px}.fiscal-cancel-steps>div{display:grid;grid-template-columns:24px 1fr;align-items:center;gap:7px;padding:9px;border:1px solid #ece5e6;border-radius:9px;background:#fff;color:#7b7475;font-size:10px;font-weight:800;transition:.25s}.fiscal-cancel-steps i{width:24px;height:24px;border:2px solid #e1d8da;border-radius:50%;display:grid;place-items:center;font-style:normal}.fiscal-cancel-steps .active{border-color:#efb5ba;background:#fff2f3;color:#98333b;transform:translateY(-2px);box-shadow:0 7px 16px #a83e4616}.fiscal-cancel-steps .active i{border-color:#c9424d;animation:fiscalCancelGlow 1s ease-in-out infinite}.fiscal-cancel-steps .done{border-color:#cce7d6;background:#f0faf4;color:#176d41}.fiscal-cancel-steps .done i{background:#19834b;color:#fff;border-color:#19834b}.fiscal-cancel-steps .failed{border-color:#edb6bb;background:#fff0f1;color:#9c2e38}.fiscal-cancel-steps .failed i{background:#c9424d;color:#fff;border-color:#c9424d}.fiscal-cancel-meta{display:flex;gap:10px;flex-wrap:wrap;margin-top:12px;padding:9px 11px;border-radius:9px;background:#fff;font-size:10px;color:#6e6667}.fiscal-cancel-meta b{color:#322f30}.fiscal-cancel-error{display:grid;gap:4px;margin-top:11px;padding:11px 12px;border-radius:9px;background:#fff0f1;color:#992f38;font-size:11px}.fiscal-cancel-actions{display:flex;justify-content:flex-end;margin-top:10px}.fiscal-cancel-flow.success{border-color:#c9e5d3;background:linear-gradient(135deg,#fff,#f5fcf8)}@keyframes fiscalCancelSpin{to{transform:rotate(360deg)}}@keyframes fiscalCancelGlow{50%{transform:translate(-50%,-50%) scale(1.28);opacity:.45}}@media(max-width:900px){.fiscal-cancel-steps{grid-template-columns:repeat(3,1fr)}}@media(max-width:560px){.fiscal-cancel-steps{grid-template-columns:1fr}.fiscal-cancel-flow-head{padding-right:0;align-items:flex-start}.fiscal-cancel-flow-head>span{position:static;transform:none;margin-left:auto}}
'''
p.write_text(s)
