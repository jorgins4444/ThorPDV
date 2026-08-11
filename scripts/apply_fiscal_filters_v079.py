from pathlib import Path
import re

p=Path('desktop-pdv/renderer/app.js')
s=p.read_text()

s=s.replace("let state={status:null,products:[],cart:[],payment:'cash',query:'',busy:false,view:'sale',settings:null,fiscalSales:[],fiscalQuery:'',capturingShortcut:false};", "let state={status:null,products:[],cart:[],payment:'cash',query:'',busy:false,view:'sale',settings:null,fiscalSales:[],fiscalQuery:'',fiscalFilter:{status:'all',from:'',to:''},capturingShortcut:false};", 1)

pattern=re.compile(r"function renderFiscalWorkspace\(\)\{[\s\S]*?\n\}\n\nfunction renderFiscalTable\(\)\{[\s\S]*?\n\}\n\nasync function openSaleDetail", re.M)
replacement=r'''function fiscalOperationBucket(sale){
  const saleStatus=String(sale?.status||'');
  const fiscalStatus=String(sale?.fiscal?.status||'');
  if(saleStatus==='cancelled'||saleStatus==='cancel_pending'||fiscalStatus==='cancelled')return 'cancelled';
  if(['rejected','transmission_error','requested','draft','processing'].includes(fiscalStatus))return 'pending';
  if(fiscalStatus==='authorized'||(!fiscalStatus&&saleStatus==='completed'))return 'completed';
  return 'pending';
}
function fiscalFilteredSales(){
  const filter=state.fiscalFilter||{status:'all',from:'',to:''};
  const from=filter.from?new Date(`${filter.from}T00:00:00`).getTime():null;
  const to=filter.to?new Date(`${filter.to}T23:59:59.999`).getTime():null;
  return state.fiscalSales.filter(sale=>{
    if(filter.status!=='all'&&fiscalOperationBucket(sale)!==filter.status)return false;
    const raw=sale.completed_at||sale.created_at||sale.fiscal?.authorization_at||'';
    const time=Date.parse(String(raw));
    if(filter.from&&(!Number.isFinite(time)||time<from))return false;
    if(filter.to&&(!Number.isFinite(time)||time>to))return false;
    return true;
  });
}
function fiscalFilterSummary(){
  const all=state.fiscalSales;
  return {
    completed:all.filter(x=>fiscalOperationBucket(x)==='completed').length,
    cancelled:all.filter(x=>fiscalOperationBucket(x)==='cancelled').length,
    pending:all.filter(x=>fiscalOperationBucket(x)==='pending').length,
  };
}
function renderFiscalWorkspace(){
  const box=document.getElementById('workspace');
  const filter=state.fiscalFilter||{status:'all',from:'',to:''};
  box.innerHTML=`<main class="fiscal-workspace"><section class="fiscal-head"><div><small>MENU FISCAL</small><h1>Vendas e operações fiscais</h1><p>Visualize vendas, reimprima comprovantes, solicite NFC-e, cancele, faça devoluções e acompanhe pendências fiscais.</p></div><button class="secondary" id="fiscalRefresh">Atualizar / sincronizar</button></section><section class="fiscal-toolbar fiscal-toolbar-v079"><div class="fiscal-search-wrap"><label>Pesquisar</label><input id="fiscalSearch" placeholder="Venda, cliente, chave de acesso ou status..." value="${esc(state.fiscalQuery)}"></div><div class="fiscal-filter-field"><label>De</label><input id="fiscalDateFrom" type="date" value="${esc(filter.from||'')}"></div><div class="fiscal-filter-field"><label>Até</label><input id="fiscalDateTo" type="date" value="${esc(filter.to||'')}"></div><div class="fiscal-filter-field fiscal-status-filter"><label>Situação</label><select id="fiscalStatusFilter"><option value="all" ${filter.status==='all'?'selected':''}>Todas</option><option value="completed" ${filter.status==='completed'?'selected':''}>Concluído</option><option value="cancelled" ${filter.status==='cancelled'?'selected':''}>Cancelado</option><option value="pending" ${filter.status==='pending'?'selected':''}>Pendências fiscais</option></select></div><button class="secondary fiscal-today" id="fiscalToday">Hoje</button><button class="secondary fiscal-clear" id="fiscalClear">Limpar</button><span class="fiscal-count" id="fiscalCount"></span></section><section class="fiscal-filter-chips" id="fiscalFilterChips"></section><section class="fiscal-table-card"><div id="fiscalTable"></div></section></main>`;
  let timer;const search=document.getElementById('fiscalSearch');search.oninput=()=>{clearTimeout(timer);timer=setTimeout(()=>refreshFiscalSales(search.value),150)};
  const from=document.getElementById('fiscalDateFrom'),to=document.getElementById('fiscalDateTo'),status=document.getElementById('fiscalStatusFilter');
  from.onchange=()=>{state.fiscalFilter.from=from.value;renderFiscalTable();};
  to.onchange=()=>{state.fiscalFilter.to=to.value;renderFiscalTable();};
  status.onchange=()=>{state.fiscalFilter.status=status.value;renderFiscalTable();};
  document.getElementById('fiscalToday').onclick=()=>{const now=new Date();const y=now.getFullYear(),m=String(now.getMonth()+1).padStart(2,'0'),d=String(now.getDate()).padStart(2,'0'),today=`${y}-${m}-${d}`;state.fiscalFilter.from=today;state.fiscalFilter.to=today;from.value=today;to.value=today;renderFiscalTable();};
  document.getElementById('fiscalClear').onclick=()=>{state.fiscalFilter={status:'all',from:'',to:''};from.value='';to.value='';status.value='all';renderFiscalTable();};
  document.getElementById('fiscalRefresh').onclick=async()=>{await window.thor.sync();await refreshStatus();await refreshFiscalSales();showToast('Histórico fiscal atualizado.');};
  renderFiscalTable();
}

function renderFiscalTable(){
  const box=document.getElementById('fiscalTable');if(!box)return;
  const rows=fiscalFilteredSales(),summary=fiscalFilterSummary();
  const count=document.getElementById('fiscalCount');if(count)count.textContent=`${rows.length} de ${state.fiscalSales.length} operação(ões)`;
  const chips=document.getElementById('fiscalFilterChips');if(chips)chips.innerHTML=`<button class="fiscal-chip ${state.fiscalFilter.status==='completed'?'active':''}" data-fiscal-chip="completed"><b>${summary.completed}</b> Concluídas</button><button class="fiscal-chip ${state.fiscalFilter.status==='cancelled'?'active':''}" data-fiscal-chip="cancelled"><b>${summary.cancelled}</b> Canceladas</button><button class="fiscal-chip pending ${state.fiscalFilter.status==='pending'?'active':''}" data-fiscal-chip="pending"><b>${summary.pending}</b> Pendências fiscais</button>`;
  if(chips)chips.querySelectorAll('[data-fiscal-chip]').forEach(button=>button.onclick=()=>{const selected=button.dataset.fiscalChip;state.fiscalFilter.status=state.fiscalFilter.status===selected?'all':selected;const select=document.getElementById('fiscalStatusFilter');if(select)select.value=state.fiscalFilter.status;renderFiscalTable();});
  if(!rows.length){box.innerHTML='<div class="empty">Nenhuma operação encontrada para os filtros selecionados.</div>';return;}
  box.innerHTML=`<table class="fiscal-table"><thead><tr><th>Venda</th><th>Data</th><th>Cliente</th><th>Total</th><th>Devolvido</th><th>Venda</th><th>NFC-e</th><th>Ações</th></tr></thead><tbody>${rows.map((s,i)=>`<tr class="fiscal-row-${fiscalOperationBucket(s)}"><td><strong>${s.number?`#${esc(s.number)}`:'Pendente'}</strong><small>${esc(String(s.client_event_id||'').slice(0,8))}</small></td><td>${dt(s.completed_at||s.created_at)}</td><td>${esc(s.customer_name||'Consumidor')}</td><td><strong>${money(s.total)}</strong></td><td>${money(s.returned_total||0)}</td><td><span class="sale-status status-${esc(s.status||'pending')}">${saleStatusLabel(s.status)}</span></td><td>${fiscalBadge(s.fiscal)}</td><td><button class="table-action" data-view-sale="${i}">Abrir</button></td></tr>`).join('')}</tbody></table>`;
  box.querySelectorAll('[data-view-sale]').forEach(b=>b.onclick=()=>openSaleDetail(rows[Number(b.dataset.viewSale)]));
}

async function openSaleDetail'''
s,count=pattern.subn(lambda _m:replacement,s,count=1)
if count!=1: raise SystemExit('fiscal workspace/table block not found')
p.write_text(s)

p=Path('desktop-pdv/renderer/styles.css')
s=p.read_text()
css=r'''

/* Fiscal filters v079 */
.fiscal-toolbar-v079{display:grid;grid-template-columns:minmax(230px,1fr) 145px 145px 180px auto auto auto;gap:9px;align-items:end}.fiscal-toolbar-v079 label{display:block;margin:0 0 5px;font-size:10px;font-weight:800;letter-spacing:.05em;text-transform:uppercase;color:#707b75}.fiscal-toolbar-v079 input,.fiscal-toolbar-v079 select{width:100%;height:40px}.fiscal-search-wrap,.fiscal-filter-field{min-width:0}.fiscal-today,.fiscal-clear{height:40px;white-space:nowrap}.fiscal-toolbar-v079 .fiscal-count{align-self:center;margin-top:17px;white-space:nowrap}.fiscal-filter-chips{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 12px}.fiscal-chip{border:1px solid #dfe5e1;background:#fff;color:#53605a;border-radius:999px;padding:7px 11px;font-size:12px;cursor:pointer}.fiscal-chip b{margin-right:4px}.fiscal-chip.active{background:#edf8f1;border-color:#a8d5b8;color:#17683d}.fiscal-chip.pending{color:#9c6010}.fiscal-chip.pending.active{background:#fff7e4;border-color:#ebcd88;color:#8b560b}.fiscal-row-cancelled{background:#fffafa}.fiscal-row-pending{background:#fffdf7}@media(max-width:1100px){.fiscal-toolbar-v079{grid-template-columns:1fr 1fr 1fr}.fiscal-search-wrap{grid-column:1/-1}.fiscal-toolbar-v079 .fiscal-count{margin-top:0}}@media(max-width:650px){.fiscal-toolbar-v079{grid-template-columns:1fr 1fr}.fiscal-search-wrap,.fiscal-status-filter,.fiscal-toolbar-v079 .fiscal-count{grid-column:1/-1}}
'''
if '/* Fiscal filters v079 */' not in s:s+=css
p.write_text(s)
