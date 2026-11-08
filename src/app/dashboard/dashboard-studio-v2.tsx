'use client';

import { useCallback,useEffect,useRef,useState,type CSSProperties,type DragEvent } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { createClient as createBrowserClient } from '@/lib/supabase/client';
import { dashboardLoad,dashboardPreferencesLoad,dashboardPreferencesSave,inventoryIntelligenceLoad } from './actions';
import { dashboardRealtimeChannel } from './dashboard-realtime-actions';
import { Visual,type ChartType } from './dashboard-visuals-v2';
import { pointsFor } from './dashboard-data-v2';
import { asData,asRows,chartLabels,chartTypes,defaultTiles,isoDate,metricInfo,n,number,rgba,sizeLabels,themeLabels,today,type Data,type Size,type Theme,type TileConfig,type TileId } from './dashboard-config-v2';

function MetricCard({id,color,data}:{id:TileId;color:string;data:Data}){const info=metricInfo(id,data);if(!info||info.value===null)return <div className="bi-kpi"><div className="bi-kpi-accent" style={{background:color}}/><strong className="muted">{info?.text??'N/D'}</strong><p>{info?.caption??'Indicador indisponível.'}</p></div>;return <div className="bi-kpi"><div className="bi-kpi-accent" style={{background:color}}/><strong>{info.text}</strong>{info.delta!==null&&Number.isFinite(info.delta)?<em className={info.delta>=0?'up':'down'}>{info.delta>=0?'↑':'↓'} {number(Math.abs(info.delta))}% vs. período anterior</em>:null}<p>{info.caption}</p></div>}

type DashboardLoadRequest={s:string;e:string;b:string;announce:boolean};

export function DashboardStudioV2({initial}:{initial:Data}){
 const [data,setData]=useState(initial),[tiles,setTiles]=useState<TileConfig[]>(defaultTiles),[start,setStart]=useState(String(initial.start??today())),[end,setEnd]=useState(String(initial.end??today())),[branch,setBranch]=useState('');
 const [gridColumns,setGridColumns]=useState(4),[theme,setTheme]=useState<Theme>('light'),[editing,setEditing]=useState(false),[selectedId,setSelectedId]=useState<TileId>('dailyRevenue');
 const [loading,setLoading]=useState(false),[message,setMessage]=useState(''),[saving,setSaving]=useState(false),[prefsLoaded,setPrefsLoaded]=useState(false),[fullscreen,setFullscreen]=useState(false),[liveState,setLiveState]=useState<'connecting'|'live'|'offline'>('connecting');
 const dragRef=useRef<TileId|null>(null),stageRef=useRef<HTMLDivElement|null>(null);
 const activeLoadRef=useRef<Promise<void>|null>(null),queuedLoadRef=useRef<DashboardLoadRequest|null>(null),lastRealtimeRefreshRef=useRef(0);
 const branches=asRows(data.branches),avg=asData(data.averages);
 const [inventory,setInventory]=useState<Data>({});
 const [inventoryState,setInventoryState]=useState<'loading'|'ready'|'unavailable'>('loading');
 useEffect(()=>{
  let alive=true;setInventoryState('loading');
  void inventoryIntelligenceLoad(branch||undefined).then(r=>{
   if(!alive)return;
   if(r.ok){setInventory(r);setInventoryState('ready');}
   else {setInventory({});setInventoryState('unavailable');}
  }).catch(()=>{if(alive){setInventory({});setInventoryState('unavailable');}});
  return()=>{alive=false};
 },[branch,data]);
 const idleRows=asRows(inventory.idle),slowRows=asRows(inventory.slow),expiryRows=asRows(inventory.expiry);
 const idle15=idleRows.filter(r=>r.status==='15_29'),idle30=idleRows.filter(r=>r.status==='30_plus'),neverSold=idleRows.filter(r=>r.status==='never_sold');
 const expiryGroups=[{key:'expired',label:'Vencidos'},{key:'0_30',label:'Até 30 dias'},{key:'31_45',label:'31 a 45 dias'},{key:'46_60',label:'46 a 60 dias'},{key:'61_90',label:'61 a 90 dias'},{key:'90_plus',label:'Mais de 90 dias'}];
 const [rankings,setRankings]=useState<{today:Data;month:Data}>({today:{},month:{}});
 const [rankingLoading,setRankingLoading]=useState(false);
 useEffect(()=>{
  let alive=true;
  const now=new Date(),day=isoDate(now),first=isoDate(new Date(now.getFullYear(),now.getMonth(),1));
  setRankingLoading(true);
  void Promise.all([dashboardLoad(day,day,branch||undefined),dashboardLoad(first,day,branch||undefined)])
   .then(([todayData,monthData])=>{if(alive)setRankings({today:todayData.ok?todayData:{},month:monthData.ok?monthData:{}})})
   .catch(()=>{if(alive)setRankings({today:{},month:{}})})
   .finally(()=>{if(alive)setRankingLoading(false)});
  return()=>{alive=false};
 },[branch,data]);
 const rankRows=(period:Data)=>asRows(period.top_products).slice().sort((a,b)=>n(b.quantity)-n(a.quantity)).slice(0,10);
 const payRows=asRows(data.payments).slice().sort((a,b)=>n(b.total)-n(a.total)).slice(0,6);


 const load=useCallback(async(s=start,e=end,b=branch,announce=false)=>{
  const request:DashboardLoadRequest={s,e,b,announce};
  if(activeLoadRef.current){
   const queued=queuedLoadRef.current;
   queuedLoadRef.current={...request,announce:announce||queued?.announce===true};
   await activeLoadRef.current;
   return;
  }
  const run=async()=>{
   let current:DashboardLoadRequest|null=request;
   setLoading(true);
   try{
    while(current){
     const r=await dashboardLoad(current.s,current.e,current.b||undefined);
     if(r.ok){setData(r);if(current.announce)setMessage('Dashboard atualizado.')}else setMessage(String(r.error??'Falha ao atualizar o dashboard.'));
     current=queuedLoadRef.current;
     queuedLoadRef.current=null;
    }
   }finally{setLoading(false)}
  };
  const promise=run();
  activeLoadRef.current=promise;
  try{await promise}finally{if(activeLoadRef.current===promise)activeLoadRef.current=null}
 },[start,end,branch]);
 useEffect(()=>{let alive=true;void dashboardPreferencesLoad().then(r=>{if(!alive)return;const stored=Array.isArray(r.layout)?r.layout as Record<string,unknown>[]:[];if(stored.length){const base=new Map(defaultTiles.map(t=>[t.id,t]));const restored=stored.map(raw=>{const id=String(raw.id) as TileId,b=base.get(id);if(!b)return null;const chart=chartTypes.includes(String(raw.chart) as ChartType)?String(raw.chart) as ChartType:b.chart,size=(['s','m','l','wide'].includes(String(raw.size))?String(raw.size):b.size) as Size;return {...b,title:String(raw.title??b.title),size,color:String(raw.color??b.color),chart,visible:raw.visible!==false}}).filter(Boolean) as TileConfig[];setTiles([...restored,...defaultTiles.filter(t=>!restored.some(r0=>r0.id===t.id))]);}const settings=asData(r.settings);const cols=n(settings.grid_columns);if(cols>=2&&cols<=6)setGridColumns(cols);const th=String(settings.theme??'light') as Theme;if(Object.prototype.hasOwnProperty.call(themeLabels,th))setTheme(th);setPrefsLoaded(true)});return()=>{alive=false}},[]);
 useEffect(()=>{if(!prefsLoaded)return;let alive=true;let channel:RealtimeChannel|null=null;let debounceTimer:number|undefined;const supabase=createBrowserClient();setLiveState('connecting');void dashboardRealtimeChannel().then(r=>{if(!alive)return;const topic=String(r.topic??'');if(!r.ok||!topic){setLiveState('offline');return;}channel=supabase.channel(topic).on('broadcast',{event:'dashboard_change'},()=>{if(debounceTimer)window.clearTimeout(debounceTimer);const elapsed=Date.now()-lastRealtimeRefreshRef.current;const delay=Math.max(600,1000-elapsed);debounceTimer=window.setTimeout(()=>{if(document.visibilityState!=='visible')return;lastRealtimeRefreshRef.current=Date.now();void load(start,end,branch,false)},delay)}).subscribe(status=>{if(!alive)return;if(status==='SUBSCRIBED')setLiveState('live');else if(status==='CHANNEL_ERROR'||status==='TIMED_OUT')setLiveState('offline');else setLiveState('connecting')});});return()=>{alive=false;if(debounceTimer)window.clearTimeout(debounceTimer);if(channel)void supabase.removeChannel(channel)}},[prefsLoaded,start,end,branch,load]);
 useEffect(()=>{const fn=()=>setFullscreen(document.fullscreenElement===stageRef.current);document.addEventListener('fullscreenchange',fn);return()=>document.removeEventListener('fullscreenchange',fn)},[]);

 function preset(kind:'today'|'7d'|'30d'|'month'){const e=new Date(),s=new Date(e);if(kind==='7d')s.setDate(e.getDate()-6);if(kind==='30d')s.setDate(e.getDate()-29);if(kind==='month')s.setDate(1);const si=isoDate(s),ei=isoDate(e);setStart(si);setEnd(ei);void load(si,ei,branch,true)}
 function updateTile(id:TileId,patch:Partial<TileConfig>){setTiles(cur=>cur.map(t=>t.id===id?{...t,...patch}:t))}
 function dropOn(target:TileId){const source=dragRef.current;if(!source||source===target)return;setTiles(cur=>{const from=cur.findIndex(t=>t.id===source),to=cur.findIndex(t=>t.id===target);if(from<0||to<0)return cur;const copy=[...cur],item=copy[from];copy.splice(from,1);copy.splice(to,0,item);return copy});dragRef.current=null}
 async function save(){setSaving(true);const r=await dashboardPreferencesSave(tiles,{grid_columns:gridColumns,theme,realtime:true});setSaving(false);setMessage(r.ok?'Dashboard pessoal salvo.':String(r.error??'Não foi possível salvar.'))}
 function reset(){setTiles(defaultTiles.map(t=>({...t})));setGridColumns(4);setTheme('light');setSelectedId('dailyRevenue')}
 async function toggleFullscreen(){try{if(document.fullscreenElement)await document.exitFullscreen();else await stageRef.current?.requestFullscreen()}catch{setMessage('O navegador não permitiu abrir em tela cheia.')}}
 function renderTile(tile:TileConfig){const metric=metricInfo(tile.id,data);if(metric&&tile.chart==='kpi')return <MetricCard id={tile.id} color={tile.color} data={data}/>;return <Visual chart={tile.chart} points={pointsFor(tile.id,data)} color={tile.color}/>}

 const selected=tiles.find(t=>t.id===selectedId)??tiles[0],visible=tiles.filter(t=>t.visible),spanFor=(size:Size)=>size==='wide'?gridColumns:size==='l'?Math.min(3,gridColumns):size==='m'?Math.min(2,gridColumns):1;
 const branchName=branch?(branches.find(b=>String(b.id)===branch)?.name??'Filial'):'Todas as filiais';
 const summary=[`${number(avg.period_days)} dia(s)`,String(branchName)];
 const stageStyle={'--bi-columns':gridColumns} as CSSProperties;
 const liveLabel=liveState==='live'?'Tempo real conectado':liveState==='offline'?'Realtime desconectado':'Conectando em tempo real…';

 return <div ref={stageRef} className={`bi-stage theme-${theme} ${fullscreen?'is-fullscreen':''}`} style={stageStyle}>
  <div className="bi-topline"><div><span>THOR BI · EXECUTIVE STUDIO</span><h2>Visão integrada da operação</h2><p>Vendas, rentabilidade, PDV, caixa, financeiro, estoque, fiscal e equipe no mesmo painel.</p></div><div className="bi-fresh"><i className={loading||liveState==='connecting'?'loading':liveState==='offline'?'offline':''}/><div><strong>{loading?'Atualizando…':liveLabel}</strong>{summary.map((s,i)=><small key={i}>{s}</small>)}</div></div></div>
  <div className="bi-toolbar"><div className="bi-presets"><button onClick={()=>preset('today')}>Hoje</button><button onClick={()=>preset('7d')}>7 dias</button><button onClick={()=>preset('30d')}>30 dias</button><button onClick={()=>preset('month')}>Mês</button></div><label><span>De</span><input type="date" value={start} onChange={e=>setStart(e.target.value)}/></label><label><span>Até</span><input type="date" value={end} onChange={e=>setEnd(e.target.value)}/></label><label><span>Filial</span><select value={branch} onChange={e=>setBranch(e.target.value)}><option value="">Todas</option>{branches.map(b=><option value={String(b.id)} key={String(b.id)}>{String(b.name)}</option>)}</select></label><label><span>Colunas</span><select value={gridColumns} onChange={e=>setGridColumns(Number(e.target.value))}>{[2,3,4,5,6].map(v=><option key={v} value={v}>{v} colunas</option>)}</select></label><label><span>Tema</span><select value={theme} onChange={e=>setTheme(e.target.value as Theme)}>{Object.entries(themeLabels).map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label><button className="bi-apply" onClick={()=>void load(start,end,branch,true)} disabled={loading}>↻ Atualizar</button><button className="bi-fullscreen" onClick={()=>void toggleFullscreen()}>{fullscreen?'⤓ Sair da tela cheia':'⛶ Tela cheia'}</button><button className={`bi-customize ${editing?'active':''}`} onClick={()=>setEditing(v=>!v)}>⚙ Personalizar</button></div>
  {message?<div className="bi-message" onClick={()=>setMessage('')}>{message}<span>×</span></div>:null}
  <section className="bi-inventory-section" aria-label="Inteligência de estoque">
   <div className="bi-inventory-title"><span>GESTÃO DE ESTOQUE</span><h3>Giro de produtos e controle de validade</h3><p>Produtos com saldo disponível na filial selecionada. Validades exigem lote e data cadastrados.</p></div>
   {inventoryState==='unavailable'?<p className="bi-ranking-empty">Indicadores indisponíveis. Verifique se a migração de inteligência de estoque foi aplicada no Supabase.</p>:<>
   <div className="bi-inventory-counts">
    <div><span>Sem vendas há 15–29 dias</span><strong>{inventoryState==='loading'?'…':idle15.length}</strong></div>
    <div><span>Sem vendas há 30+ dias</span><strong>{inventoryState==='loading'?'…':idle30.length}</strong></div>
    <div><span>Sem histórico de vendas</span><strong>{inventoryState==='loading'?'…':neverSold.length}</strong></div>
    <div><span>Lotes vencidos</span><strong>{inventoryState==='loading'?'…':expiryRows.filter(r=>r.bucket==='expired').length}</strong></div>
   </div>
   <div className="bi-ranking-grid">
    <article className="bi-ranking-card"><div className="bi-ranking-head"><span>BAIXO GIRO</span><h3>10 produtos menos vendidos</h3><small>Quantidade vendida nos últimos 30 dias</small></div><div className="bi-ranking-list">{slowRows.length?slowRows.map((p,i)=><div className="bi-ranking-row" key={String(p.id??i)}><b>{i+1}º</b><span title={String(p.name??'')}>{String(p.name??'Produto')}</span><strong>{number(p.qty_30d)} un.</strong></div>):<p className="bi-ranking-empty">Sem dados de estoque.</p>}</div></article>
    <article className="bi-ranking-card"><div className="bi-ranking-head"><span>PRODUTOS PARADOS</span><h3>Sem vendas há 15 ou 30+ dias</h3><small>Última venda concluída</small></div><div className="bi-ranking-list">{idleRows.length?idleRows.slice(0,12).map((p,i)=><div className="bi-ranking-row" key={String(p.id??i)}><b>{i+1}º</b><span title={String(p.name??'')}>{String(p.name??'Produto')}</span><strong>{p.status==='never_sold'?'Sem histórico':String(p.idle_days)+' dias'}</strong></div>):<p className="bi-ranking-empty">Nenhum produto parado identificado.</p>}</div></article>
    <article className="bi-ranking-card"><div className="bi-ranking-head"><span>VALIDADE</span><h3>Vencimentos por faixa</h3><small>Quantidade de lotes com saldo</small></div><div className="bi-ranking-list">{expiryGroups.map((g,i)=><div className="bi-ranking-row" key={g.key}><b>{i+1}º</b><span>{g.label}</span><strong>{expiryRows.filter(p=>p.bucket===g.key).length} lote(s)</strong></div>)}{!expiryRows.length?<p className="bi-ranking-empty">Nenhum lote com validade cadastrado. Isso não significa ausência de produtos vencidos.</p>:null}</div></article>
   </div>
   {expiryRows.some(p=>p.bucket==='expired'||p.bucket==='0_30')?<div className="bi-inventory-alert"><strong>Atenção aos lotes vencidos ou próximos do vencimento</strong>{expiryRows.filter(p=>p.bucket==='expired'||p.bucket==='0_30').slice(0,15).map((p,i)=><div key={i}>{String(p.name??'Produto')} · Lote {String(p.lot_number??'—')} · {String(p.expiry_date??'')} · {p.bucket==='expired'?'Vencido':String(p.days_left)+' dias restantes'}</div>)}</div>:null}
   </>}
  </section>
  <section className="bi-ranking-grid" aria-label="Rankings de vendas">
   <article className="bi-ranking-card"><div className="bi-ranking-head"><span>FORMAS DE PAGAMENTO</span><h3>Top formas de pagamento</h3><small>Período selecionado</small></div><div className="bi-ranking-list">{payRows.length?payRows.map((p,i)=><div className="bi-ranking-row" key={String(p.method??i)}><b>{i+1}º</b><span>{({cash:'Dinheiro',pix:'PIX',credit:'Crédito',credit_card:'Crédito',debit:'Débito',debit_card:'Débito',voucher:'Voucher',store_credit:'Crediário'} as Record<string,string>)[String(p.method)]??String(p.method??'Outros')}</span><strong>{new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(n(p.total))}</strong></div>):<p className="bi-ranking-empty">Sem pagamentos no período.</p>}</div></article>
   {([{key:'today',title:'Top 10 produtos do dia'},{key:'month',title:'Top 10 produtos do mês'}] as const).map(group=><article className="bi-ranking-card" key={group.key}><div className="bi-ranking-head"><span>PRODUTOS MAIS VENDIDOS</span><h3>{group.title}</h3><small>Ranking por quantidade vendida</small></div><div className="bi-ranking-list">{rankRows(rankings[group.key]).length?rankRows(rankings[group.key]).map((p,i)=><div className="bi-ranking-row" key={String(p.product??i)}><b>{i+1}º</b><span title={String(p.product??'Produto')}>{String(p.product??'Produto')}</span><strong>{number(p.quantity)} un.</strong></div>):<p className="bi-ranking-empty">{rankingLoading?'Carregando ranking…':'Sem produtos vendidos no período.'}</p>}</div></article>)}
  </section>
  <div className={`bi-canvas ${editing?'editing':''}`}>{visible.map(tile=><article key={tile.id} className="bi-card" style={{'--tile':tile.color,'--tile-soft':rgba(tile.color,.12),'--span':spanFor(tile.size)} as CSSProperties} draggable={editing} onDragStart={(e:DragEvent)=>{dragRef.current=tile.id;e.dataTransfer.effectAllowed='move'}} onDragOver={e=>{if(editing)e.preventDefault()}} onDrop={()=>dropOn(tile.id)}><header><div><span>{tile.id==='pdvFlow'||tile.id==='cashDaily'?'OPERAÇÃO':tile.id==='finance'||tile.id==='receivables'?'FINANCEIRO':tile.id==='stock'||tile.id==='stockValue'?'ESTOQUE':tile.id==='fiscal'?'FISCAL':tile.id==='system'||tile.id==='alerts'?'SISTEMA':'ANÁLISE'}</span><h3>{tile.title}</h3></div>{editing?<div className="bi-card-tools"><button title="Editar" onClick={()=>setSelectedId(tile.id)}>⚙</button><button title="Mover">⠿</button><button title="Ocultar" onClick={()=>updateTile(tile.id,{visible:false})}>×</button></div>:<i className="bi-dot"/>}</header><div className="bi-body">{renderTile(tile)}</div></article>)}</div>
  {editing?<aside className="bi-editor"><div className="bi-editor-head"><div><span>THOR BI</span><h3>Personalizar dashboard</h3></div><button onClick={()=>setEditing(false)}>×</button></div><div className="bi-editor-actions"><button onClick={reset}>Restaurar padrão</button><button className="primary" onClick={()=>void save()} disabled={saving}>{saving?'Salvando…':'Salvar layout'}</button></div><div className="bi-editor-global"><h4>Layout global</h4><label><span>Quantidade de colunas</span><select value={gridColumns} onChange={e=>setGridColumns(Number(e.target.value))}>{[2,3,4,5,6].map(v=><option value={v} key={v}>{v} colunas</option>)}</select></label><label><span>Tema</span><select value={theme} onChange={e=>setTheme(e.target.value as Theme)}>{Object.entries(themeLabels).map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label><div className="bi-live-note">● Atualização por evento em tempo real. Eventos em rajada são agrupados para manter o painel fluido.</div></div><h4>Indicadores e gráficos</h4><div className="bi-editor-list">{tiles.map(t=><div key={t.id} className={`bi-editor-row ${selectedId===t.id?'selected':''}`}><input type="checkbox" checked={t.visible} onChange={e=>updateTile(t.id,{visible:e.target.checked})}/><button onClick={()=>setSelectedId(t.id)}>{t.title}</button></div>)}</div>{selected?<div className="bi-properties"><h4>Card selecionado</h4><label><span>Título</span><input value={selected.title} onChange={e=>updateTile(selected.id,{title:e.target.value})}/></label><label><span>Visual</span><select value={selected.chart} onChange={e=>updateTile(selected.id,{chart:e.target.value as ChartType})}>{chartTypes.map(c=><option value={c} key={c}>{chartLabels[c]}</option>)}</select></label><label><span>Tamanho</span><select value={selected.size} onChange={e=>updateTile(selected.id,{size:e.target.value as Size})}>{Object.entries(sizeLabels).map(([v,l])=><option value={v} key={v}>{l}</option>)}</select></label><label><span>Cor principal</span><div className="bi-color"><input type="color" value={selected.color} onChange={e=>updateTile(selected.id,{color:e.target.value})}/><code>{selected.color}</code></div></label><p>Arraste os cards no canvas para reposicionar. Todos os 18 visuais podem ser usados em qualquer indicador.</p></div>:null}</aside>:null}
 </div>;
}
