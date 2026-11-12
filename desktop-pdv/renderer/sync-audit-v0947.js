'use strict';
/* Manual sync dialog and persistent audit viewer. Works with the agent's status endpoint. */
(() => {
  const css = document.createElement('style');
  css.textContent = `
  .thor-sync-panel{position:fixed;inset:0;background:rgba(7,15,30,.70);z-index:2147483000;display:grid;place-items:center;padding:20px}
  .thor-sync-card{background:#152238;color:#eef5ff;width:min(760px,96vw);max-height:85vh;overflow:auto;border-radius:16px;padding:24px;box-shadow:0 20px 70px #0008;font:14px system-ui,sans-serif}
  .thor-sync-head{display:flex;justify-content:space-between;align-items:center;gap:16px}.thor-sync-head h2{margin:0 0 12px;font-size:20px}
  .thor-sync-card button{padding:9px 14px;border:1px solid #63728b;background:#263b59;color:white;border-radius:8px;cursor:pointer}
  .thor-sync-track{height:18px;border-radius:20px;background:#33455d;overflow:hidden;margin:16px 0 8px}
  .thor-sync-fill{height:100%;width:0;background:linear-gradient(90deg,#24a5ff,#56e3ad);transition:width .35s ease}
  .thor-sync-meta{display:flex;justify-content:space-between;color:#c3d0e1;gap:12px}
  .thor-sync-table{width:100%;border-collapse:collapse;margin-top:14px;font-size:12px}
  .thor-sync-table td,.thor-sync-table th{padding:9px;border-bottom:1px solid #3b4a62;text-align:left;overflow-wrap:anywhere}
  .thor-sync-filters{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}
  .thor-sync-filters input,.thor-sync-filters select{background:#263b59;color:white;border:1px solid #63728b;padding:8px;border-radius:6px}
  `;
  document.head.appendChild(css);
  const escape = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\u0027':'&#39;'}[c]));
  const make = title => {
    const overlay=document.createElement('div');overlay.className='thor-sync-panel';
    overlay.innerHTML='<section class="thor-sync-card" role="dialog" aria-modal="true"><div class="thor-sync-head"><h2>'+escape(title)+'</h2><button type="button" data-close>Fechar</button></div><div data-body></div></section>';
    overlay.querySelector('[data-close]').onclick=()=>overlay.remove();
    document.body.appendChild(overlay);
    return {overlay,body:overlay.querySelector('[data-body]')};
  };
  async function manualSync(){
    const {overlay,body}=make('Sincronização manual');
    body.innerHTML='<div data-phase>Preparando sincronização…</div><div class="thor-sync-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><div class="thor-sync-fill"></div></div><div class="thor-sync-meta"><span data-detail>Aguardando resposta do agente</span><strong data-percent>0%</strong></div>';
    let finished=false;
    const refresh=async()=>{
      if(finished||!overlay.isConnected)return;
      try{
        const status=await window.thor.status();
        const p=status.syncProgress||{};
        const bar=body.querySelector('.thor-sync-track');
        const value=Number.isFinite(Number(p.percent))&&p.percent!==null?Math.max(0,Math.min(100,Number(p.percent))):null;
        if(value!==null){body.querySelector('.thor-sync-fill').style.width=value+'%';body.querySelector('[data-percent]').textContent=value+'%';bar.setAttribute('aria-valuenow',String(value));}
        else {body.querySelector('[data-percent]').textContent='Processando…';bar.removeAttribute('aria-valuenow');}
        body.querySelector('[data-phase]').textContent=p.phase||'Sincronizando…';
        body.querySelector('[data-detail]').textContent=status.syncing?'Sincronização em andamento':'Aguardando conclusão';
      }catch(error){body.querySelector('[data-detail]').textContent='Não foi possível consultar o progresso: '+error.message;}
    };
    const poll=setInterval(refresh,350);await refresh();
    try{
      const result=await window.thor.sync();
      if(result?.ok===false)throw new Error(result.error||'Sincronização não concluída');
      finished=true;body.querySelector('.thor-sync-fill').style.width='100%';body.querySelector('[data-percent]').textContent='100%';
      body.querySelector('.thor-sync-track').setAttribute('aria-valuenow','100');
      body.querySelector('[data-phase]').textContent='Sincronização concluída';
      body.querySelector('[data-detail]').textContent='Operações confirmadas pelo agente';
    }catch(error){finished=true;body.querySelector('[data-phase]').textContent='Falha na sincronização';body.querySelector('[data-detail]').textContent=error.message;body.querySelector('[data-percent]').textContent='Falhou';}
    finally{clearInterval(poll);}
  }
  async function history(){
    const {body}=make('Histórico de sincronização');
    body.innerHTML='<div class="thor-sync-filters"><input type="date" data-date aria-label="Data"><select data-direction><option value="">Todas as direções</option><option value="incoming">Recebidas</option><option value="outgoing">Enviadas</option><option value="bidirectional">Ciclo completo</option></select><select data-status><option value="">Todos os status</option><option value="success">Sucesso</option><option value="failed">Falha</option></select><input data-entity placeholder="Filtrar operação"></div><div data-table></div>';
    const render=async()=>{
      try{
        const status=await window.thor.status();
        const entries=Array.isArray(status.syncHistory)?status.syncHistory:[];
        const date=body.querySelector('[data-date]').value,dir=body.querySelector('[data-direction]').value,st=body.querySelector('[data-status]').value,entity=body.querySelector('[data-entity]').value.toLowerCase();
        const rows=entries.filter(e=>(!date||String(e.startedAt||e.recordedAt||'').slice(0,10)===date)&&(!dir||e.direction===dir)&&(!st||e.status===st)&&(!entity||String(e.entity||e.endpoint||'').toLowerCase().includes(entity)));
        body.querySelector('[data-table]').innerHTML='<p>'+rows.length+' registro(s) exibido(s), de '+entries.length+' armazenado(s) neste terminal.</p><table class="thor-sync-table"><thead><tr><th>Data/hora</th><th>Direção</th><th>Operação</th><th>Status</th><th>Detalhes</th></tr></thead><tbody>'+rows.map(e=>'<tr><td>'+escape(new Date(e.startedAt||e.recordedAt).toLocaleString('pt-BR'))+'</td><td>'+escape(e.direction)+'</td><td>'+escape(e.entity||e.endpoint||e.trigger||'Sincronização')+'</td><td>'+escape(e.status)+'</td><td>'+escape(e.error||((e.count||e.sent||e.received)?'Itens: '+(e.count||e.sent||e.received):''))+'</td></tr>').join('')+'</tbody></table>';
      }catch(error){body.querySelector('[data-table]').textContent='Erro ao carregar histórico: '+error.message;}
    };
    body.querySelectorAll('input,select').forEach(el=>el.addEventListener('input',render));await render();
  }
  const install=()=>{
    const sync=document.getElementById('sync');
    if(sync&&!sync.dataset.thorSyncUi){
      sync.dataset.thorSyncUi='1';
      sync.addEventListener('click',e=>{e.preventDefault();e.stopImmediatePropagation();manualSync();},true);
      const historyBtn=document.createElement('button');historyBtn.type='button';historyBtn.className='secondary compact';historyBtn.textContent='Histórico sync';historyBtn.title='Consultar registros de sincronização';
      historyBtn.onclick=history;sync.parentNode.insertBefore(historyBtn,sync.nextSibling);
    }
  };
  new MutationObserver(install).observe(document.body,{childList:true,subtree:true});install();
  document.addEventListener('keydown',e=>{if(e.key==='F6'&&!e.repeat){e.preventDefault();e.stopImmediatePropagation();manualSync();}},true);
})();
