'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent } from 'react';
import { dashboardLoad, dashboardPreferencesLoad, dashboardPreferencesSave, logout } from './actions';

type Row=Record<string,unknown>;
type Data=Record<string,unknown>;
type Size='s'|'m'|'l'|'wide';
type ChartType='kpi'|'bar'|'line'|'area'|'donut'|'table';
type TileId='netSales'|'grossProfit'|'netProfit'|'avgTicket'|'salesCount'|'grossMargin'|'trend'|'payments'|'topProducts'|'minute'|'hourly'|'branchSales'|'finance'|'stock';
type TileConfig={id:TileId;title:string;size:Size;color:string;chart:ChartType;visible:boolean};
type Point={label:string;value:number;detail?:string};

const money=(v:unknown)=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(v??0));
const number=(v:unknown)=>new Intl.NumberFormat('pt-BR',{maximumFractionDigits:2}).format(Number(v??0));
const pct=(v:unknown)=>`${new Intl.NumberFormat('pt-BR',{maximumFractionDigits:1}).format(Number(v??0))}%`;
const n=(o:Data|undefined,k:string)=>Number(o?.[k]??0);
const asData=(v:unknown)=>(v&&typeof v==='object'&&!Array.isArray(v)?v as Data:{});
const asRows=(v:unknown)=>(Array.isArray(v)?v as Row[]:[]);

const menu=[
 ['Dashboard','/dashboard','▣'],['Pessoas','/dashboard/clientes','●'],['Vendas','/dashboard/vendas','▰'],
 ['Pedidos de Venda','/dashboard/vendas/pedidos','▱'],['Produtos','/dashboard/produtos','◆'],
 ['Tabela de Preços','/dashboard/tabelas-precos','◇'],['Estoque','/dashboard/estoque','⬡'],
 ['Financeiro','/dashboard/financeiro/receber','▤'],['Administrativo','/dashboard/administrativo/empresas','▧'],
 ['Relatórios','/dashboard/relatorios','▥'],['Atendimento','/dashboard/atendimento','◉']
] as const;

const paymentLabels:Record<string,string>={cash:'Dinheiro',pix:'PIX',credit:'Crédito',credit_card:'Crédito',debit:'Débito',debit_card:'Débito',voucher:'Voucher',store_credit:'Crédito da loja',cashback:'Cashback',bank_slip:'Boleto',term_sale:'Venda a prazo'};

const defaultTiles:TileConfig[]=[
 {id:'netSales',title:'Vendas líquidas',size:'m',color:'#6d28d9',chart:'kpi',visible:true},
 {id:'grossProfit',title:'Lucro bruto',size:'m',color:'#059669',chart:'kpi',visible:true},
 {id:'netProfit',title:'Lucro líquido',size:'m',color:'#0f766e',chart:'kpi',visible:true},
 {id:'avgTicket',title:'Ticket médio',size:'s',color:'#d97706',chart:'kpi',visible:true},
 {id:'salesCount',title:'Quantidade de vendas',size:'s',color:'#2563eb',chart:'kpi',visible:true},
 {id:'grossMargin',title:'Margem bruta',size:'s',color:'#0891b2',chart:'kpi',visible:true},
 {id:'trend',title:'Receita, CMV e lucro bruto',size:'wide',color:'#7c3aed',chart:'line',visible:true},
 {id:'payments',title:'Vendas por forma de pagamento',size:'l',color:'#0ea5e9',chart:'donut',visible:true},
 {id:'topProducts',title:'Produtos mais vendidos',size:'l',color:'#10b981',chart:'bar',visible:true},
 {id:'minute',title:'Vendas por minuto · últimos 60 min',size:'wide',color:'#2563eb',chart:'area',visible:true},
 {id:'hourly',title:'Vendas por hora',size:'l',color:'#8b5cf6',chart:'bar',visible:true},
 {id:'branchSales',title:'Vendas por filial',size:'l',color:'#f59e0b',chart:'bar',visible:true},
 {id:'finance',title:'Posição financeira',size:'m',color:'#ef4444',chart:'bar',visible:true},
 {id:'stock',title:'Situação do estoque',size:'m',color:'#64748b',chart:'donut',visible:true},
];

const chartOptions:Record<TileId,ChartType[]>={
 netSales:['kpi'],grossProfit:['kpi'],netProfit:['kpi'],avgTicket:['kpi'],salesCount:['kpi'],grossMargin:['kpi'],
 trend:['line','area','bar','table'],payments:['donut','bar','table'],topProducts:['bar','donut','table'],
 minute:['area','line','bar','table'],hourly:['bar','line','area','table'],branchSales:['bar','donut','table'],
 finance:['bar','donut','table'],stock:['donut','bar','table']
};

const sizeLabels:Record<Size,string>={s:'Pequeno',m:'Médio',l:'Grande',wide:'Largura total'};
const chartLabels:Record<ChartType,string>={kpi:'Indicador',bar:'Barras',line:'Linha',area:'Área',donut:'Rosca',table:'Tabela'};
const refreshOptions=[[0,'Manual'],[15,'15 segundos'],[30,'30 segundos'],[60,'1 minuto'],[300,'5 minutos'],[900,'15 minutos'],[3600,'1 hora']] as const;

function isoDate(d:Date){const y=d.getFullYear();const m=String(d.getMonth()+1).padStart(2,'0');const day=String(d.getDate()).padStart(2,'0');return `${y}-${m}-${day}`}
function today(){return isoDate(new Date())}
function generatedAt(value:unknown){if(!value)return 'agora';const d=new Date(String(value));return Number.isNaN(d.getTime())?'agora':d.toLocaleString('pt-BR',{timeZone:'America/Fortaleza',hour:'2-digit',minute:'2-digit',second:'2-digit'})}
function shortDate(value:unknown){const raw=String(value??'');if(!raw)return '—';const [y,m,d]=raw.slice(0,10).split('-');return y&&m&&d?`${d}/${m}`:raw}
function minuteLabel(value:unknown){const d=new Date(String(value??''));return Number.isNaN(d.getTime())?'—':d.toLocaleTimeString('pt-BR',{timeZone:'America/Fortaleza',hour:'2-digit',minute:'2-digit'})}

function hexToRgba(hex:string,alpha:number){const clean=hex.replace('#','');const value=clean.length===3?clean.split('').map(x=>x+x).join(''):clean;const num=parseInt(value,16);if(!Number.isFinite(num))return `rgba(109,40,217,${alpha})`;return `rgba(${(num>>16)&255},${(num>>8)&255},${num&255},${alpha})`}

function LineVisual({points,color,area=false}:{points:Point[];color:string;area?:boolean}){
 const values=points.map(p=>Math.max(0,p.value));const max=Math.max(1,...values);const width=640,height=220,pad=18;
 const coords=values.map((v,i)=>{const x=points.length<=1?pad:pad+(i*(width-pad*2)/(points.length-1));const y=height-pad-(v/max)*(height-pad*2);return [x,y] as const});
 const poly=coords.map(([x,y])=>`${x},${y}`).join(' ');
 const areaPath=coords.length?`M ${coords[0][0]} ${height-pad} L ${coords.map(([x,y])=>`${x} ${y}`).join(' L ')} L ${coords[coords.length-1][0]} ${height-pad} Z`:'';
 if(!points.length)return <div className="studio-empty">Sem dados neste período.</div>;
 return <div className="studio-line-wrap"><svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-label="Gráfico">
   <defs><linearGradient id={`g-${color.replace('#','')}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={color} stopOpacity=".32"/><stop offset="1" stopColor={color} stopOpacity=".02"/></linearGradient></defs>
   {[.25,.5,.75,1].map(k=><line key={k} x1={pad} x2={width-pad} y1={height-pad-(height-pad*2)*k} y2={height-pad-(height-pad*2)*k} className="studio-grid-line"/>)}
   {area&&areaPath?<path d={areaPath} fill={`url(#g-${color.replace('#','')})`}/>:null}
   <polyline fill="none" stroke={color} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" points={poly}/>
 </svg><div className="studio-axis-labels"><span>{points[0]?.label}</span><span>{points[Math.floor(points.length/2)]?.label}</span><span>{points[points.length-1]?.label}</span></div></div>;
}

function BarVisual({points,color}:{points:Point[];color:string}){
 const max=Math.max(1,...points.map(p=>Math.abs(p.value)));
 if(!points.length)return <div className="studio-empty">Sem dados neste período.</div>;
 return <div className="studio-bars">{points.slice(0,12).map((p,i)=><div className="studio-bar-row" key={`${p.label}-${i}`}><div className="studio-bar-copy"><span>{p.label}</span><b>{p.detail??money(p.value)}</b></div><div className="studio-bar-track"><i style={{width:`${Math.max(2,Math.abs(p.value)/max*100)}%`,background:color}}/></div></div>)}</div>;
}

function DonutVisual({points,color}:{points:Point[];color:string}){
 const usable=points.filter(p=>p.value>0).slice(0,8);const total=usable.reduce((s,p)=>s+p.value,0);
 if(!total)return <div className="studio-empty">Sem dados neste período.</div>;
 const palette=[color,'#22c55e','#f59e0b','#ec4899','#8b5cf6','#06b6d4','#ef4444','#64748b'];let cursor=0;
 const stops=usable.map((p,i)=>{const start=cursor;cursor+=p.value/total*100;return `${palette[i%palette.length]} ${start}% ${cursor}%`}).join(',');
 return <div className="studio-donut-layout"><div className="studio-donut" style={{background:`conic-gradient(${stops})`}}><div><strong>{money(total)}</strong><span>Total</span></div></div><div className="studio-donut-legend">{usable.map((p,i)=><div key={`${p.label}-${i}`}><i style={{background:palette[i%palette.length]}}/><span>{p.label}</span><b>{p.detail??money(p.value)}</b></div>)}</div></div>;
}

function TableVisual({points}:{points:Point[]}){if(!points.length)return <div className="studio-empty">Sem dados neste período.</div>;return <div className="studio-mini-table">{points.slice(0,12).map((p,i)=><div key={`${p.label}-${i}`}><span>{p.label}</span><b>{p.detail??money(p.value)}</b></div>)}</div>}

function MultiTrend({rows,color,chart}:{rows:Row[];color:string;chart:ChartType}){
 if(chart==='table')return <TableVisual points={rows.map(r=>({label:shortDate(r.report_day),value:Number(r.net_revenue??0),detail:`Receita ${money(r.net_revenue)} · Lucro ${money(r.gross_profit)}`}))}/>;
 if(chart==='bar')return <div className="studio-multi-bars">{rows.slice(-14).map((r,i)=><div className="studio-multi-day" key={`${String(r.report_day)}-${i}`}><div><i style={{height:`${Math.max(2,Math.abs(Number(r.net_revenue??0))/Math.max(1,...rows.map(x=>Math.abs(Number(x.net_revenue??0))))*100)}%`,background:color}}/><i style={{height:`${Math.max(2,Math.abs(Number(r.gross_profit??0))/Math.max(1,...rows.map(x=>Math.abs(Number(x.net_revenue??0))))*100)}%`,background:'#10b981'}}/></div><span>{shortDate(r.report_day)}</span></div>)}</div>;
 const net=rows.map(r=>({label:shortDate(r.report_day),value:Number(r.net_revenue??0)}));
 return <div className="studio-trend-stack"><div className="studio-legend"><span><i style={{background:color}}/>Receita líquida</span><span><i style={{background:'#10b981'}}/>Lucro bruto</span><span><i style={{background:'#cbd5e1'}}/>CMV</span></div><LineVisual points={net} color={color} area={chart==='area'}/><div className="studio-trend-totals"><span>Receita <b>{money(rows.reduce((s,r)=>s+Number(r.net_revenue??0),0))}</b></span><span>CMV <b>{money(rows.reduce((s,r)=>s+Number(r.cmv??0),0))}</b></span><span>Lucro bruto <b>{money(rows.reduce((s,r)=>s+Number(r.gross_profit??0),0))}</b></span></div></div>;
}

function Kpi({tile,sales,comparison}:{tile:TileConfig;sales:Data;comparison:Data}){
 let value='—',caption='',delta:unknown=null;
 if(tile.id==='netSales'){value=money(sales.net??sales.gross);caption='Vendas válidas menos devoluções';delta=comparison.net_pct}
 if(tile.id==='grossProfit'){value=money(sales.gross_profit);caption=`Receita líquida − CMV (${money(sales.cmv)})`;delta=comparison.gross_profit_pct}
 if(tile.id==='netProfit'){value=sales.net_profit_available?money(sales.net_profit):'N/D';caption=sales.net_profit_available?'Resultado líquido do período':'Aguardando DRE completa: impostos, taxas, comissões e despesas por competência'}
 if(tile.id==='avgTicket'){value=money(sales.avg_ticket);caption='Valor médio por venda';delta=comparison.ticket_pct}
 if(tile.id==='salesCount'){value=number(sales.count);caption='Vendas concluídas';delta=comparison.count_pct}
 if(tile.id==='grossMargin'){value=pct(sales.gross_margin);caption='Lucro bruto ÷ receita líquida'}
 const d=delta===null||delta===undefined?null:Number(delta);
 return <div className="studio-kpi"><div className="studio-kpi-label"><span>{tile.title}</span><i style={{background:tile.color}}/></div><strong className={tile.id==='netProfit'&&!sales.net_profit_available?'is-muted':''}>{value}</strong>{d!==null&&Number.isFinite(d)?<em className={d>=0?'up':'down'}>{d>=0?'↑':'↓'} {Math.abs(d).toLocaleString('pt-BR',{maximumFractionDigits:1})}% vs. período anterior</em>:null}<p>{caption}</p></div>;
}

export function DashboardStudio({identity,initial}:{identity:string;initial:Data}){
 const [data,setData]=useState(initial);
 const [tiles,setTiles]=useState<TileConfig[]>(defaultTiles);
 const [start,setStart]=useState(String(initial.start??today()));
 const [end,setEnd]=useState(String(initial.end??today()));
 const [branch,setBranch]=useState('');
 const [loading,setLoading]=useState(false);
 const [collapsed,setCollapsed]=useState(false);
 const [editing,setEditing]=useState(false);
 const [selectedTile,setSelectedTile]=useState<TileId>('trend');
 const [refreshSeconds,setRefreshSeconds]=useState(60);
 const [message,setMessage]=useState('');
 const [saving,setSaving]=useState(false);
 const [prefsLoaded,setPrefsLoaded]=useState(false);
 const dragged=useRef<TileId|null>(null);

 const sales=asData(data.sales);const comparison=asData(data.comparison);const fin=asData(data.finance);const stock=asData(data.stock);
 const branches=asRows(data.branches);const payments=asRows(data.payments);const top=asRows(data.top_products);const hourly=asRows(data.hourly);const minute=asRows(data.minute);const branchSales=asRows(data.branch_sales);const trend=asRows(data.trend);

 const load=useCallback(async(s=start,e=end,b=branch,announce=false)=>{
   setLoading(true);const r=await dashboardLoad(s,e,b||undefined);setLoading(false);
   if(r.ok){setData(r);if(announce)setMessage('Dashboard atualizado.');}
   else setMessage(String(r.error??'Falha ao atualizar o dashboard.'));
 },[start,end,branch]);

 useEffect(()=>{let alive=true;void dashboardPreferencesLoad().then(r=>{if(!alive)return;const stored=Array.isArray(r.layout)?r.layout as Row[]:[];if(stored.length){const known=new Map(defaultTiles.map(t=>[t.id,t]));const restored=stored.map(raw=>{const id=String(raw.id) as TileId;const base=known.get(id);if(!base)return null;return {...base,title:String(raw.title??base.title),size:(['s','m','l','wide'].includes(String(raw.size))?String(raw.size):base.size) as Size,color:String(raw.color??base.color),chart:(chartOptions[id].includes(String(raw.chart) as ChartType)?String(raw.chart):base.chart) as ChartType,visible:raw.visible!==false}}).filter(Boolean) as TileConfig[];const missing=defaultTiles.filter(t=>!restored.some(r0=>r0.id===t.id));setTiles([...restored,...missing]);}
   const settings=asData(r.settings);const refresh=Number(settings.refresh_seconds??60);if(refreshOptions.some(([v])=>v===refresh))setRefreshSeconds(refresh);setPrefsLoaded(true);
 });return()=>{alive=false}},[]);

 useEffect(()=>{if(!prefsLoaded||refreshSeconds<=0)return;const timer=window.setInterval(()=>{if(document.visibilityState==='visible')void load(start,end,branch,false)},refreshSeconds*1000);return()=>window.clearInterval(timer)},[prefsLoaded,refreshSeconds,start,end,branch,load]);

 const pointsFor=useCallback((id:TileId):Point[]=>{
   if(id==='payments')return payments.map(r=>({label:paymentLabels[String(r.method)]??String(r.method??'Outros'),value:Number(r.total??0),detail:`${number(r.quantity)} trans. · ${money(r.total)}`}));
   if(id==='topProducts')return top.map(r=>({label:String(r.product??'Produto'),value:Number(r.revenue??0),detail:`${number(r.quantity)} un. · ${money(r.revenue)}`}));
   if(id==='hourly')return hourly.map(r=>({label:`${String(r.report_hour??0).padStart(2,'0')}:00`,value:Number(r.total??0),detail:`${number(r.quantity)} vendas · ${money(r.total)}`}));
   if(id==='minute')return minute.map(r=>({label:minuteLabel(r.report_minute),value:Number(r.total??0),detail:`${number(r.quantity)} venda(s) · ${money(r.total)}`}));
   if(id==='branchSales')return branchSales.map(r=>({label:String(r.branch??'Filial'),value:Number(r.total??0),detail:`${number(r.quantity)} vendas · ${money(r.total)}`}));
   if(id==='finance')return [{label:'A receber hoje',value:n(fin,'receivable_today')},{label:'A pagar hoje',value:n(fin,'payable_today')},{label:'Receber em aberto',value:n(fin,'receivable_open')},{label:'Pagar em aberto',value:n(fin,'payable_open')},{label:'Vencido',value:n(fin,'overdue')}];
   if(id==='stock')return [{label:'Estoque baixo',value:n(stock,'low'),detail:`${number(stock.low)} produtos`},{label:'Sem estoque',value:n(stock,'zero'),detail:`${number(stock.zero)} produtos`},{label:'Produtos ativos',value:n(stock,'products'),detail:`${number(stock.products)} produtos`}];
   return [];
 },[payments,top,hourly,minute,branchSales,fin,stock]);

 function renderTile(tile:TileConfig){
   if(chartOptions[tile.id].length===1)return <Kpi tile={tile} sales={sales} comparison={comparison}/>;
   if(tile.id==='trend')return <MultiTrend rows={trend} color={tile.color} chart={tile.chart}/>;
   const points=pointsFor(tile.id);
   if(tile.chart==='donut')return <DonutVisual points={points} color={tile.color}/>;
   if(tile.chart==='bar')return <BarVisual points={points} color={tile.color}/>;
   if(tile.chart==='line')return <LineVisual points={points} color={tile.color}/>;
   if(tile.chart==='area')return <LineVisual points={points} color={tile.color} area/>;
   return <TableVisual points={points}/>;
 }

 function preset(kind:'today'|'7d'|'30d'|'month'){
   const e=new Date();let s=new Date(e);if(kind==='7d')s.setDate(e.getDate()-6);if(kind==='30d')s.setDate(e.getDate()-29);if(kind==='month')s=new Date(e.getFullYear(),e.getMonth(),1);
   const si=isoDate(s),ei=isoDate(e);setStart(si);setEnd(ei);void load(si,ei,branch,true);
 }
 function updateTile(id:TileId,patch:Partial<TileConfig>){setTiles(current=>current.map(t=>t.id===id?{...t,...patch}:t))}
 function dropOn(target:TileId){const source=dragged.current;if(!source||source===target)return;setTiles(current=>{const from=current.findIndex(t=>t.id===source),to=current.findIndex(t=>t.id===target);if(from<0||to<0)return current;const copy=[...current];const [item]=copy.splice(from,1);copy.splice(to,0,item);return copy});dragged.current=null}
 async function savePreferences(){setSaving(true);const r=await dashboardPreferencesSave(tiles,{refresh_seconds:refreshSeconds});setSaving(false);setMessage(r.ok?'Layout pessoal salvo no ThorGestão.':String(r.error??'Não foi possível salvar o layout.'))}
 function resetLayout(){setTiles(defaultTiles.map(t=>({...t})));setRefreshSeconds(60);setSelectedTile('trend')}

 const selected=tiles.find(t=>t.id===selectedTile)??tiles[0];
 const visible=tiles.filter(t=>t.visible);
 const liveText=refreshSeconds?`Atualização automática · ${refreshOptions.find(([v])=>v===refreshSeconds)?.[1]??`${refreshSeconds}s`}`:'Atualização manual';

 return <main className={`erp-shell ${collapsed?'erp-collapsed':''}`}>
  <header className="erp-header"><div className="erp-brand-wrap"><Link href="/dashboard" className="erp-logo"><span className="erp-bolt">ϟ</span><span>THOR<b>PDV</b></span></Link><button className="erp-icon-btn erp-menu-toggle" onClick={()=>setCollapsed(!collapsed)}>☰</button></div><div className="erp-account"><span className="erp-avatar">SA</span><div className="erp-account-copy"><strong>THORPDV</strong><span>{identity}</span></div><form action={logout}><button className="erp-logout">Sair</button></form></div></header>
  <aside className="erp-sidebar"><nav className="erp-nav">{menu.map(([label,href,icon],i)=><Link key={href} href={href} className={`erp-nav-item ${i===0?'is-active':''}`}><span className="erp-nav-icon">{icon}</span><span className="erp-nav-label">{label}</span></Link>)}</nav><div className="erp-store-card"><span className="erp-nav-icon">▦</span><div className="erp-store-copy"><small>Loja atual</small><strong>{branch?String(branches.find(b=>String(b.id)===branch)?.name??'FILIAL'):'TODAS'}</strong></div></div></aside>

  <section className="erp-main studio-main">
   <div className="studio-heading"><div><p className="erp-eyebrow">Business Intelligence · Visão do Dono</p><h1>Dashboard Executivo</h1><p>Monte seu painel, mova os cards, troque gráficos, cores e acompanhe a operação em atualização contínua.</p></div><div className="studio-live-badge"><i className={loading?'loading':''}/><div><strong>{loading?'Atualizando...':'Dados ao vivo'}</strong><span>{liveText}</span><small>Último: {generatedAt(data.generated_at)} · Fortaleza</small></div></div></div>

   <section className="studio-toolbar">
    <div className="studio-presets"><button onClick={()=>preset('today')}>Hoje</button><button onClick={()=>preset('7d')}>7 dias</button><button onClick={()=>preset('30d')}>30 dias</button><button onClick={()=>preset('month')}>Este mês</button></div>
    <label><span>Início</span><input type="date" value={start} onChange={e=>setStart(e.target.value)}/></label>
    <label><span>Fim</span><input type="date" value={end} onChange={e=>setEnd(e.target.value)}/></label>
    <label><span>Filial</span><select value={branch} onChange={e=>{setBranch(e.target.value);void load(start,end,e.target.value,true)}}><option value="">Todas</option>{branches.map(b=><option key={String(b.id)} value={String(b.id)}>{String(b.name??'Filial')}</option>)}</select></label>
    <label><span>Atualização</span><select value={refreshSeconds} onChange={e=>setRefreshSeconds(Number(e.target.value))}>{refreshOptions.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label>
    <button className="studio-refresh" disabled={loading} onClick={()=>void load(start,end,branch,true)}>↻ Atualizar</button>
    <button className={`studio-customize ${editing?'active':''}`} onClick={()=>setEditing(v=>!v)}>⚙ Personalizar</button>
   </section>

   {message?<div className="erp-live-message">{message}</div>:null}

   <div className={`studio-canvas ${editing?'is-editing':''}`}>
    {visible.map(tile=>{const style={'--tile-color':tile.color,'--tile-soft':hexToRgba(tile.color,.09)} as CSSProperties;return <article key={tile.id} className={`studio-card size-${tile.size}`} style={style} draggable={editing} onDragStart={()=>{dragged.current=tile.id}} onDragOver={(e:DragEvent<HTMLElement>)=>{if(editing)e.preventDefault()}} onDrop={()=>dropOn(tile.id)}>
      <header className="studio-card-head"><div><span className="studio-card-kicker">{chartLabels[tile.chart]}</span><h2>{tile.title}</h2></div>{editing?<div className="studio-card-tools"><button title="Mover" className="drag">⠿</button><button title="Editar card" onClick={()=>setSelectedTile(tile.id)}>⚙</button><button title="Ocultar card" onClick={()=>updateTile(tile.id,{visible:false})}>×</button></div>:<span className="studio-card-dot"/>}</header>
      <div className="studio-card-body">{renderTile(tile)}</div>
    </article>})}
   </div>

   {editing?<aside className="studio-editor"><div className="studio-editor-head"><div><span>PERSONALIZAÇÃO</span><h3>Meu dashboard</h3></div><button onClick={()=>setEditing(false)}>×</button></div><div className="studio-editor-actions"><button onClick={resetLayout}>Restaurar padrão</button><button className="primary" disabled={saving} onClick={()=>void savePreferences()}>{saving?'Salvando...':'Salvar layout'}</button></div>
    <div className="studio-editor-list"><h4>Cards</h4>{tiles.map(t=><label className={`studio-editor-tile ${t.id===selectedTile?'selected':''}`} key={t.id}><input type="checkbox" checked={t.visible} onChange={e=>updateTile(t.id,{visible:e.target.checked})}/><button type="button" onClick={()=>setSelectedTile(t.id)}>{t.title}</button></label>)}</div>
    {selected?<div className="studio-editor-properties"><h4>Configurar card</h4><label>Título<input value={selected.title} onChange={e=>updateTile(selected.id,{title:e.target.value})}/></label><label>Tamanho<select value={selected.size} onChange={e=>updateTile(selected.id,{size:e.target.value as Size})}>{(Object.keys(sizeLabels) as Size[]).map(s=><option key={s} value={s}>{sizeLabels[s]}</option>)}</select></label><label>Visual<select value={selected.chart} onChange={e=>updateTile(selected.id,{chart:e.target.value as ChartType})}>{chartOptions[selected.id].map(c=><option key={c} value={c}>{chartLabels[c]}</option>)}</select></label><label>Cor<div className="studio-color-field"><input type="color" value={selected.color} onChange={e=>updateTile(selected.id,{color:e.target.value})}/><span>{selected.color.toUpperCase()}</span></div></label><p>Arraste qualquer card pelo painel para alterar a posição. O layout fica salvo por usuário.</p></div>:null}
   </aside>:null}
  </section>
 </main>;
}
