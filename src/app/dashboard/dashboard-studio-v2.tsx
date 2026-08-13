'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent } from 'react';
import { dashboardLoad, dashboardPreferencesLoad, dashboardPreferencesSave } from './actions';

type Row=Record<string,unknown>;
type Data=Record<string,unknown>;
type Size='s'|'m'|'l'|'wide';
type Theme='light'|'midnight'|'graphite'|'ocean'|'emerald'|'wine';
type Format='money'|'number'|'percent';
type ChartType='kpi'|'bar'|'column'|'line'|'area'|'donut'|'pie'|'table'|'gauge'|'radial'|'funnel'|'treemap'|'heatmap'|'waterfall'|'combo'|'scatter'|'radar'|'spark';
type TileId=
 'netSales'|'grossProfit'|'netProfit'|'avgTicket'|'salesCount'|'grossMargin'|
 'avgDailyRevenue'|'avgDailySales'|'avgDailyProfit'|'avgHourlyRevenue'|'itemsPerSale'|'stockValue'|
 'dailyRevenue'|'dailyProfit'|'dailySales'|'dailyTicket'|'payments'|'topProducts'|'minute'|'hourly'|'branchSales'|
 'pdvFlow'|'cashDaily'|'sellers'|'finance'|'receivables'|'stock'|'fiscal'|'system'|'alerts';
type TileConfig={id:TileId;title:string;size:Size;color:string;chart:ChartType;visible:boolean};
type Point={label:string;value:number;detail?:string;format?:Format};
type MetricInfo={text:string;caption:string;value:number|null;previous:number|null;delta:number|null;available:boolean;format:Format};

const money=(v:unknown)=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(v??0));
const number=(v:unknown)=>new Intl.NumberFormat('pt-BR',{maximumFractionDigits:2}).format(Number(v??0));
const percent=(v:unknown)=>`${new Intl.NumberFormat('pt-BR',{maximumFractionDigits:1}).format(Number(v??0))}%`;
const asData=(v:unknown)=>(v&&typeof v==='object'&&!Array.isArray(v)?v as Data:{});
const asRows=(v:unknown)=>(Array.isArray(v)?v as Row[]:[]);
const n=(v:unknown)=>Number(v??0);
const fmt=(v:number,format:Format='money')=>format==='money'?money(v):format==='percent'?percent(v):number(v);
const paymentLabels:Record<string,string>={cash:'Dinheiro',pix:'PIX',credit:'Crédito',credit_card:'Crédito',debit:'Débito',debit_card:'Débito',voucher:'Voucher',store_credit:'Crediário',cashback:'Cashback',bank_slip:'Boleto',term_sale:'Venda a prazo'};

const chartTypes:ChartType[]=['kpi','bar','column','line','area','donut','pie','table','gauge','radial','funnel','treemap','heatmap','waterfall','combo','scatter','radar','spark'];
const chartLabels:Record<ChartType,string>={kpi:'Indicador',bar:'Barras horizontais',column:'Colunas',line:'Linha',area:'Área',donut:'Rosca',pie:'Pizza',table:'Tabela',gauge:'Velocímetro',radial:'Radial',funnel:'Funil',treemap:'Mapa de árvore',heatmap:'Mapa de calor',waterfall:'Cascata',combo:'Combinado',scatter:'Dispersão',radar:'Radar',spark:'Sparkline'};
const sizeLabels:Record<Size,string>={s:'Pequeno',m:'Médio',l:'Grande',wide:'Largura total'};
const themeLabels:Record<Theme,string>={light:'Claro executivo',midnight:'Midnight',graphite:'Grafite',ocean:'Oceano',emerald:'Esmeralda',wine:'Vinho'};
const refreshOptions=[[0,'Manual'],[15,'15 segundos'],[30,'30 segundos'],[60,'1 minuto'],[300,'5 minutos'],[900,'15 minutos'],[3600,'1 hora']] as const;
const palette=['#22c55e','#f59e0b','#ec4899','#8b5cf6','#06b6d4','#ef4444','#64748b','#14b8a6','#f97316','#3b82f6','#a855f7'];

const defaultTiles:TileConfig[]=[
 {id:'netSales',title:'Vendas líquidas',size:'m',color:'#6d28d9',chart:'kpi',visible:true},
 {id:'grossProfit',title:'Lucro bruto',size:'m',color:'#059669',chart:'kpi',visible:true},
 {id:'avgTicket',title:'Ticket médio',size:'s',color:'#d97706',chart:'kpi',visible:true},
 {id:'salesCount',title:'Quantidade de vendas',size:'s',color:'#2563eb',chart:'kpi',visible:true},
 {id:'grossMargin',title:'Margem bruta',size:'s',color:'#0891b2',chart:'gauge',visible:true},
 {id:'avgDailyRevenue',title:'Média de vendas por dia',size:'s',color:'#7c3aed',chart:'kpi',visible:true},
 {id:'avgDailySales',title:'Média de cupons por dia',size:'s',color:'#2563eb',chart:'kpi',visible:true},
 {id:'avgDailyProfit',title:'Média de lucro bruto/dia',size:'s',color:'#059669',chart:'kpi',visible:true},
 {id:'avgHourlyRevenue',title:'Média por hora ativa',size:'s',color:'#0e7490',chart:'kpi',visible:true},
 {id:'itemsPerSale',title:'Média de itens por venda',size:'s',color:'#9333ea',chart:'kpi',visible:true},
 {id:'dailyRevenue',title:'Evolução diária das vendas',size:'wide',color:'#6d28d9',chart:'area',visible:true},
 {id:'dailyProfit',title:'Evolução diária do lucro bruto',size:'l',color:'#10b981',chart:'line',visible:true},
 {id:'dailySales',title:'Evolução diária da quantidade de vendas',size:'l',color:'#2563eb',chart:'column',visible:true},
 {id:'dailyTicket',title:'Evolução diária do ticket médio',size:'l',color:'#d97706',chart:'line',visible:true},
 {id:'payments',title:'Vendas por forma de pagamento',size:'l',color:'#0ea5e9',chart:'donut',visible:true},
 {id:'topProducts',title:'Produtos mais vendidos',size:'l',color:'#10b981',chart:'bar',visible:true},
 {id:'minute',title:'Vendas por minuto · últimos 60 min',size:'wide',color:'#2563eb',chart:'area',visible:true},
 {id:'hourly',title:'Vendas por hora',size:'l',color:'#8b5cf6',chart:'column',visible:true},
 {id:'branchSales',title:'Vendas por filial',size:'l',color:'#f59e0b',chart:'bar',visible:true},
 {id:'pdvFlow',title:'Detalhamento de fluxo por PDV',size:'wide',color:'#7c3aed',chart:'table',visible:true},
 {id:'cashDaily',title:'Fluxo diário de caixa',size:'wide',color:'#0f766e',chart:'combo',visible:true},
 {id:'sellers',title:'Desempenho de vendedores / operadores',size:'l',color:'#6366f1',chart:'bar',visible:true},
 {id:'finance',title:'Posição financeira',size:'m',color:'#ef4444',chart:'waterfall',visible:true},
 {id:'receivables',title:'Recebíveis a prazo',size:'m',color:'#f59e0b',chart:'donut',visible:true},
 {id:'stock',title:'Situação do estoque',size:'m',color:'#64748b',chart:'donut',visible:true},
 {id:'stockValue',title:'Valor do estoque a custo',size:'s',color:'#475569',chart:'kpi',visible:true},
 {id:'fiscal',title:'Saúde fiscal / NFC-e',size:'m',color:'#0ea5e9',chart:'radial',visible:true},
 {id:'system',title:'Operação do sistema',size:'m',color:'#7c3aed',chart:'treemap',visible:true},
 {id:'alerts',title:'Alertas operacionais',size:'m',color:'#dc2626',chart:'bar',visible:true},
 {id:'netProfit',title:'Lucro líquido',size:'m',color:'#0f766e',chart:'kpi',visible:false},
];

function isoDate(d:Date){const y=d.getFullYear(),m=String(d.getMonth()+1).padStart(2,'0'),day=String(d.getDate()).padStart(2,'0');return `${y}-${m}-${day}`}
function today(){return isoDate(new Date())}
function shortDate(v:unknown){const s=String(v??'');if(!s)return '—';const [y,m,d]=s.slice(0,10).split('-');return y&&m&&d?`${d}/${m}`:s}
function minuteLabel(v:unknown){const d=new Date(String(v??''));return Number.isNaN(d.getTime())?'—':d.toLocaleTimeString('pt-BR',{timeZone:'America/Fortaleza',hour:'2-digit',minute:'2-digit'})}
function generatedAt(v:unknown){const d=new Date(String(v??''));return Number.isNaN(d.getTime())?'agora':d.toLocaleTimeString('pt-BR',{timeZone:'America/Fortaleza',hour:'2-digit',minute:'2-digit',second:'2-digit'})}
function colorAt(base:string,index:number){return index===0?base:palette[(index-1)%palette.length]}
function rgba(hex:string,alpha:number){const clean=hex.replace('#','');const full=clean.length===3?clean.split('').map(x=>x+x).join(''):clean;const num=parseInt(full,16);if(!Number.isFinite(num))return `rgba(109,40,217,${alpha})`;return `rgba(${(num>>16)&255},${(num>>8)&255},${num&255},${alpha})`}
function displayPoint(p:Point){return p.detail??fmt(p.value,p.format)}
function delta(current:number,previous:number|null){return previous&&previous!==0?(current-previous)/Math.abs(previous)*100:null}

function metricInfo(id:TileId,data:Data):MetricInfo|null{
 const sales=asData(data.sales),comparison=asData(data.comparison),prev=asData(comparison.previous),avg=asData(data.averages),stock=asData(data.stock);
 const make=(value:number,caption:string,format:Format='money',previous:number|null=null,d:number|null=null):MetricInfo=>({text:fmt(value,format),caption,value,previous,delta:d??delta(value,previous),available:true,format});
 if(id==='netSales')return make(n(sales.net??sales.gross),'Vendas válidas menos devoluções','money',n(prev.net),comparison.net_pct==null?null:n(comparison.net_pct));
 if(id==='grossProfit')return make(n(sales.gross_profit),`Receita líquida − CMV (${money(sales.cmv)})`,'money',n(prev.gross_profit),comparison.gross_profit_pct==null?null:n(comparison.gross_profit_pct));
 if(id==='avgTicket')return make(n(sales.avg_ticket),'Valor médio por venda','money',n(prev.avg_ticket),comparison.ticket_pct==null?null:n(comparison.ticket_pct));
 if(id==='salesCount')return make(n(sales.count),'Vendas concluídas','number',n(prev.count),comparison.count_pct==null?null:n(comparison.count_pct));
 if(id==='grossMargin')return make(n(sales.gross_margin),'Lucro bruto ÷ receita líquida','percent',prev.gross_margin==null?null:n(prev.gross_margin));
 if(id==='avgDailyRevenue')return make(n(avg.daily_net_revenue),`Média em ${number(avg.period_days)} dia(s)`);
 if(id==='avgDailySales')return make(n(avg.daily_sales_count),`Cupons/dia no período`,'number');
 if(id==='avgDailyProfit')return make(n(avg.daily_gross_profit),'Lucro bruto médio diário');
 if(id==='avgHourlyRevenue')return make(n(avg.hourly_revenue),`${number(avg.active_hours)} hora(s) com venda`);
 if(id==='itemsPerSale')return make(n(avg.items_per_sale),'Itens líquidos por cupom','number');
 if(id==='stockValue')return make(n(stock.value),'Estoque atual valorizado a custo');
 if(id==='netProfit'){
  const ok=Boolean(sales.net_profit_available);return {text:ok?money(sales.net_profit):'N/D',caption:ok?'Resultado líquido auditável':'Aguardando DRE completa com impostos, taxas, comissões e despesas por competência',value:ok?n(sales.net_profit):null,previous:null,delta:null,available:ok,format:'money'};
 }
 return null;
}

function Kpi({info,color}:{info:MetricInfo;color:string}){
 return <div className="bi-kpi"><div className="bi-kpi-accent" style={{background:color}}/><strong className={!info.available?'muted':''}>{info.text}</strong>{info.delta!==null&&Number.isFinite(info.delta)?<em className={info.delta>=0?'up':'down'}>{info.delta>=0?'↑':'↓'} {number(Math.abs(info.delta))}% vs. período anterior</em>:null}<p>{info.caption}</p></div>;
}
function Empty(){return <div className="bi-empty">Sem dados para este período.</div>}

function Bar({points,color}:{points:Point[];color:string}){const list=points.slice(0,14),max=Math.max(1,...list.map(p=>Math.abs(p.value)));if(!list.length)return <Empty/>;return <div className="bi-bars">{list.map((p,i)=><div className="bi-bar" key={`${p.label}-${i}`}><div><span>{p.label}</span><b>{displayPoint(p)}</b></div><div className="bi-track"><i style={{width:`${Math.max(2,Math.abs(p.value)/max*100)}%`,background:colorAt(color,i)}}/></div></div>)}</div>}
function Columns({points,color}:{points:Point[];color:string}){const list=points.slice(-18),max=Math.max(1,...list.map(p=>Math.abs(p.value)));if(!list.length)return <Empty/>;return <div className="bi-columns">{list.map((p,i)=><div key={`${p.label}-${i}`} className="bi-col" title={`${p.label} · ${displayPoint(p)}`}><div><i style={{height:`${Math.max(3,Math.abs(p.value)/max*100)}%`,background:colorAt(color,i)}}/></div><span>{p.label}</span></div>)}</div>}
function Line({points,color,area=false,spark=false}:{points:Point[];color:string;area?:boolean;spark?:boolean}){if(!points.length)return <Empty/>;const vals=points.map(p=>p.value),min=Math.min(0,...vals),max=Math.max(1,...vals),range=Math.max(1,max-min),w=700,h=spark?90:245,pad=spark?8:22;const coords=vals.map((v,i)=>[points.length===1?w/2:pad+i*(w-pad*2)/(points.length-1),h-pad-(v-min)/range*(h-pad*2)] as const),poly=coords.map(([x,y])=>`${x},${y}`).join(' '),gid=`bi-${color.replace('#','')}-${points.length}-${spark?'s':'n'}`;const fill=coords.length?`M ${coords[0][0]} ${h-pad} L ${coords.map(([x,y])=>`${x} ${y}`).join(' L ')} L ${coords[coords.length-1][0]} ${h-pad} Z`:'';return <div className={`bi-line ${spark?'spark':''}`}><svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none"><defs><linearGradient id={gid} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={color} stopOpacity=".3"/><stop offset="1" stopColor={color} stopOpacity=".02"/></linearGradient></defs>{!spark&&[.25,.5,.75,1].map(k=><line key={k} x1={pad} x2={w-pad} y1={h-pad-(h-pad*2)*k} y2={h-pad-(h-pad*2)*k} className="bi-grid-line"/>)}{area?<path d={fill} fill={`url(#${gid})`}/>:null}<polyline points={poly} fill="none" stroke={color} strokeWidth={spark?5:4} strokeLinecap="round" strokeLinejoin="round"/></svg>{!spark?<div className="bi-axis"><span>{points[0]?.label}</span><span>{points[Math.floor(points.length/2)]?.label}</span><span>{points[points.length-1]?.label}</span></div>:null}</div>}
function Circle({points,color,pie=false}:{points:Point[];color:string;pie?:boolean}){const list=points.filter(p=>p.value>0).slice(0,10),total=list.reduce((s,p)=>s+p.value,0);if(!total)return <Empty/>;const stops=list.map((p,i)=>{const start=list.slice(0,i).reduce((s,x)=>s+x.value,0)/total*100,end=start+p.value/total*100;return `${colorAt(color,i)} ${start}% ${end}%`}).join(',');return <div className="bi-circle-layout"><div className={`bi-donut ${pie?'pie':''}`} style={{background:`conic-gradient(${stops})`}}>{!pie?<div><b>{fmt(total,list[0]?.format)}</b><span>Total</span></div>:null}</div><div className="bi-legend">{list.map((p,i)=><div key={`${p.label}-${i}`}><i style={{background:colorAt(color,i)}}/><span>{p.label}</span><b>{displayPoint(p)}</b></div>)}</div></div>}
function Table({points}:{points:Point[]}){if(!points.length)return <Empty/>;return <div className="bi-table">{points.slice(0,16).map((p,i)=><div key={`${p.label}-${i}`}><span>{p.label}</span><b>{displayPoint(p)}</b></div>)}</div>}
function Gauge({points,color,radial=false}:{points:Point[];color:string;radial?:boolean}){const value=points.reduce((s,p)=>s+p.value,0),max=Math.max(1,...points.map(p=>Math.abs(p.value)))*Math.max(1,points.length),pctv=Math.min(100,Math.abs(value)/max*100);return <div className={radial?'bi-radial':'bi-gauge'}><div style={{background:`conic-gradient(${color} 0 ${pctv}%,var(--bi-track) ${pctv}% 100%)`}}><span><b>{fmt(value,points[0]?.format)}</b><small>{radial?'Consolidado':'Indicador'}</small></span></div></div>}
function Funnel({points,color}:{points:Point[];color:string}){const list=[...points].sort((a,b)=>Math.abs(b.value)-Math.abs(a.value)).slice(0,9),max=Math.max(1,...list.map(p=>Math.abs(p.value)));if(!list.length)return <Empty/>;return <div className="bi-funnel">{list.map((p,i)=><div key={p.label} style={{width:`${35+Math.abs(p.value)/max*65}%`,background:rgba(color,.1+i*.035),borderColor:rgba(color,.25)}}><span>{p.label}</span><b>{displayPoint(p)}</b></div>)}</div>}
function Treemap({points,color}:{points:Point[];color:string}){const list=points.slice(0,14),sum=list.reduce((s,p)=>s+Math.abs(p.value),0);if(!sum)return <Empty/>;return <div className="bi-treemap">{list.map((p,i)=><div key={p.label} style={{flexGrow:Math.max(.3,Math.abs(p.value)/sum*10),background:rgba(colorAt(color,i),.12),borderColor:rgba(colorAt(color,i),.28)}}><span>{p.label}</span><b>{displayPoint(p)}</b></div>)}</div>}
function Heatmap({points,color}:{points:Point[];color:string}){const list=points.slice(0,28),max=Math.max(1,...list.map(p=>Math.abs(p.value)));if(!list.length)return <Empty/>;return <div className="bi-heatmap">{list.map(p=><div key={p.label} style={{background:rgba(color,.08+.7*Math.abs(p.value)/max)}}><span>{p.label}</span><b>{displayPoint(p)}</b></div>)}</div>}
function Waterfall({points,color}:{points:Point[];color:string}){const list=points.slice(0,12);if(!list.length)return <Empty/>;let acc=0;const vals=list.map(p=>{const before=acc;acc+=p.value;return {...p,before,after:acc}}),min=Math.min(0,...vals.flatMap(v=>[v.before,v.after])),max=Math.max(1,...vals.flatMap(v=>[v.before,v.after])),range=Math.max(1,max-min);return <div className="bi-waterfall">{vals.map(v=>{const bottom=(Math.min(v.before,v.after)-min)/range*100,height=Math.max(2,Math.abs(v.value)/range*100);return <div key={v.label}><div><i style={{bottom:`${bottom}%`,height:`${height}%`,background:v.value>=0?color:'#dc2626'}}/></div><span>{v.label}</span></div>)}</div>}
function Scatter({points,color}:{points:Point[];color:string}){const list=points.slice(0,20);if(!list.length)return <Empty/>;const max=Math.max(1,...list.map(p=>Math.abs(p.value)));return <div className="bi-scatter"><svg viewBox="0 0 660 235">{list.map((p,i)=><g key={`${p.label}-${i}`}><circle cx={32+(i+1)/(list.length+1)*590} cy={205-Math.abs(p.value)/max*170} r="7" fill={colorAt(color,i)} opacity=".82"/><title>{`${p.label}: ${displayPoint(p)}`}</title></g>)}</svg></div>}
function Radar({points,color}:{points:Point[];color:string}){const list=points.slice(0,8);if(list.length<3)return <Bar points={points} color={color}/>;const max=Math.max(1,...list.map(p=>Math.abs(p.value))),cx=160,cy=145,r=100,poly=list.map((p,i)=>{const a=-Math.PI/2+i*2*Math.PI/list.length,rr=Math.abs(p.value)/max*r;return `${cx+Math.cos(a)*rr},${cy+Math.sin(a)*rr}`}).join(' ');return <div className="bi-radar"><svg viewBox="0 0 320 290">{[.25,.5,.75,1].map(k=><polygon key={k} points={list.map((_,i)=>{const a=-Math.PI/2+i*2*Math.PI/list.length;return `${cx+Math.cos(a)*r*k},${cy+Math.sin(a)*r*k}`}).join(' ')} fill="none" stroke="var(--bi-grid)"/>)}<polygon points={poly} fill={rgba(color,.15)} stroke={color} strokeWidth="2.5"/>{list.map((p,i)=>{const a=-Math.PI/2+i*2*Math.PI/list.length;return <text key={p.label} x={cx+Math.cos(a)*(r+22)} y={cy+Math.sin(a)*(r+22)} textAnchor="middle" fontSize="9" fill="var(--bi-muted)">{p.label.slice(0,14)}</text>})}</svg></div>}

function Visual({chart,points,color}:{chart:ChartType;points:Point[];color:string}){
 if(chart==='bar')return <Bar points={points} color={color}/>;
 if(chart==='column')return <Columns points={points} color={color}/>;
 if(chart==='line')return <Line points={points} color={color}/>;
 if(chart==='area')return <Line points={points} color={color} area/>;
 if(chart==='spark')return <Line points={points} color={color} spark/>;
 if(chart==='donut')return <Circle points={points} color={color}/>;
 if(chart==='pie')return <Circle points={points} color={color} pie/>;
 if(chart==='table')return <Table points={points}/>;
 if(chart==='gauge')return <Gauge points={points} color={color}/>;
 if(chart==='radial')return <Gauge points={points} color={color} radial/>;
 if(chart==='funnel')return <Funnel points={points} color={color}/>;
 if(chart==='treemap')return <Treemap points={points} color={color}/>;
 if(chart==='heatmap')return <Heatmap points={points} color={color}/>;
 if(chart==='waterfall')return <Waterfall points={points} color={color}/>;
 if(chart==='scatter')return <Scatter points={points} color={color}/>;
 if(chart==='radar')return <Radar points={points} color={color}/>;
 if(chart==='combo')return <div className="bi-combo"><Columns points={points} color={color}/><Line points={points} color="#475569" spark/></div>;
 const total=points.reduce((s,p)=>s+p.value,0);return <Kpi info={{text:fmt(total,points[0]?.format),caption:`${points.length} ponto(s) consolidados`,value:total,previous:null,delta:null,available:true,format:points[0]?.format??'money'}} color={color}/>;
}

function detailFromRow(row:Row,primary:string,secondary:string[]=[]){const extra=secondary.map(k=>row[k]!=null?`${k.replaceAll('_',' ')}: ${number(row[k])}`:'').filter(Boolean).join(' · ');return extra||String(row[primary]??'')}

export function DashboardStudioV2({initial}:{initial:Data}){
 const [data,setData]=useState(initial);
 const [tiles,setTiles]=useState<TileConfig[]>(defaultTiles);
 const [start,setStart]=useState(String(initial.start??today()));
 const [end,setEnd]=useState(String(initial.end??today()));
 const [branch,setBranch]=useState('');
 const [refreshSeconds,setRefreshSeconds]=useState(60);
 const [gridColumns,setGridColumns]=useState(4);
 const [theme,setTheme]=useState<Theme>('light');
 const [editing,setEditing]=useState(false);
 const [selectedId,setSelectedId]=useState<TileId>('dailyRevenue');
 const [loading,setLoading]=useState(false);
 const [message,setMessage]=useState('');
 const [saving,setSaving]=useState(false);
 const [prefsLoaded,setPrefsLoaded]=useState(false);
 const [fullscreen,setFullscreen]=useState(false);
 const dragRef=useRef<TileId|null>(null);
 const stageRef=useRef<HTMLDivElement|null>(null);

 const sales=asData(data.sales),comparison=asData(data.comparison),finance=asData(data.finance),stock=asData(data.stock),people=asData(data.people),equipment=asData(data.equipment),alerts=asData(data.alerts),fiscal=asData(data.fiscal_summary),receivables=asData(data.term_receivables);
 const branches=asRows(data.branches),daily=asRows(data.daily_evolution),payments=asRows(data.payments),top=asRows(data.top_products),minute=asRows(data.minute),hourly=asRows(data.hourly),branchSales=asRows(data.branch_sales),pdv=asRows(data.pdv_flow),cashDaily=asRows(data.cash_daily),sellers=asRows(data.seller_performance);

 const load=useCallback(async(s=start,e=end,b=branch,announce=false)=>{setLoading(true);const r=await dashboardLoad(s,e,b||undefined);setLoading(false);if(r.ok){setData(r);if(announce)setMessage('Dashboard atualizado.')}else setMessage(String(r.error??'Falha ao atualizar o dashboard.'));},[start,end,branch]);

 useEffect(()=>{let alive=true;void dashboardPreferencesLoad().then(r=>{if(!alive)return;const stored=Array.isArray(r.layout)?r.layout as Row[]:[];if(stored.length){const base=new Map(defaultTiles.map(t=>[t.id,t]));const restored=stored.map(raw=>{const id=String(raw.id) as TileId,b=base.get(id);if(!b)return null;const chart=chartTypes.includes(String(raw.chart) as ChartType)?String(raw.chart) as ChartType:b.chart;const size=(['s','m','l','wide'].includes(String(raw.size))?String(raw.size):b.size) as Size;return {...b,title:String(raw.title??b.title),size,color:String(raw.color??b.color),chart,visible:raw.visible!==false}}).filter(Boolean) as TileConfig[];setTiles([...restored,...defaultTiles.filter(t=>!restored.some(r0=>r0.id===t.id))]);}
  const settings=asData(r.settings);const refresh=n(settings.refresh_seconds)||60;if(refreshOptions.some(([v])=>v===refresh))setRefreshSeconds(refresh);const cols=n(settings.grid_columns);if(cols>=2&&cols<=6)setGridColumns(cols);const th=String(settings.theme??'light') as Theme;if(th in themeLabels)setTheme(th);setPrefsLoaded(true);});return()=>{alive=false}},[]);
 useEffect(()=>{if(!prefsLoaded||refreshSeconds<=0)return;const timer=window.setInterval(()=>{if(document.visibilityState==='visible')void load(start,end,branch,false)},refreshSeconds*1000);return()=>window.clearInterval(timer)},[prefsLoaded,refreshSeconds,start,end,branch,load]);
 useEffect(()=>{const fn=()=>setFullscreen(document.fullscreenElement===stageRef.current);document.addEventListener('fullscreenchange',fn);return()=>document.removeEventListener('fullscreenchange',fn)},[]);

 const pointsFor=useCallback((id:TileId):Point[]=>{
  if(id==='dailyRevenue')return daily.map(r=>({label:shortDate(r.report_day),value:n(r.net_revenue),format:'money',detail:`Receita ${money(r.net_revenue)} · Lucro ${money(r.gross_profit)}`}));
  if(id==='dailyProfit')return daily.map(r=>({label:shortDate(r.report_day),value:n(r.gross_profit),format:'money',detail:`Margem ${percent(r.gross_margin)} · CMV ${money(r.cmv)}`}));
  if(id==='dailySales')return daily.map(r=>({label:shortDate(r.report_day),value:n(r.sales_count),format:'number',detail:`${number(r.sales_count)} vendas · ${number(r.items_quantity)} itens`}));
  if(id==='dailyTicket')return daily.map(r=>({label:shortDate(r.report_day),value:n(r.avg_ticket),format:'money',detail:`Ticket ${money(r.avg_ticket)}`}));
  if(id==='payments')return payments.map(r=>({label:paymentLabels[String(r.method)]??String(r.method??'Outros'),value:n(r.total),format:'money',detail:`${number(r.quantity)} trans. · ${money(r.total)}`}));
  if(id==='topProducts')return top.map(r=>({label:String(r.product??'Produto'),value:n(r.revenue),format:'money',detail:`${number(r.quantity)} un. · ${money(r.revenue)}`}));
  if(id==='minute')return minute.map(r=>({label:minuteLabel(r.report_minute),value:n(r.total),format:'money',detail:`${number(r.quantity)} venda(s) · ${money(r.total)}`}));
  if(id==='hourly')return hourly.map(r=>({label:`${String(r.report_hour??0).padStart(2,'0')}:00`,value:n(r.total),format:'money',detail:`${number(r.quantity)} vendas · ${money(r.total)}`}));
  if(id==='branchSales')return branchSales.map(r=>({label:String(r.branch??'Filial'),value:n(r.total),format:'money',detail:`${number(r.quantity)} vendas · ${money(r.total)}`}));
  if(id==='pdvFlow')return pdv.map(r=>({label:`${String(r.pos??'PDV')} · ${String(r.branch??'')}`,value:n(r.sales_total),format:'money',detail:`${number(r.sales_count)} vendas · Caixa ${money(r.expected_cash)} · ${number(r.sessions_open)} aberto(s)`}));
  if(id==='cashDaily')return cashDaily.map(r=>({label:shortDate(r.report_day),value:n(r.expected_cash),format:'money',detail:`Esperado ${money(r.expected_cash)} · Fechado ${money(r.closing_amount)} · Dif. ${money(r.difference)}`}));
  if(id==='sellers')return sellers.map(r=>({label:String(r.seller??'Operador'),value:n(r.revenue),format:'money',detail:`${number(r.sales_count)} vendas · Ticket ${money(r.avg_ticket)}`}));
  if(id==='finance')return [{label:'A receber hoje',value:n(finance.receivable_today),format:'money'},{label:'A pagar hoje',value:-n(finance.payable_today),format:'money'},{label:'Receber em aberto',value:n(finance.receivable_open),format:'money'},{label:'Pagar em aberto',value:-n(finance.payable_open),format:'money'},{label:'Vencido',value:n(finance.overdue),format:'money'}];
  if(id==='receivables')return [{label:'Em aberto',value:n(receivables.open),format:'money'},{label:'Vencido',value:n(receivables.overdue),format:'money'},{label:'Recebido',value:n(receivables.received),format:'money'},{label:'Crediário aberto',value:n(receivables.crediario_open),format:'money'},{label:'Boleto aberto',value:n(receivables.boleto_open),format:'money'}];
  if(id==='stock')return [{label:'Estoque baixo',value:n(stock.low),format:'number'},{label:'Sem estoque',value:n(stock.zero),format:'number'},{label:'Produtos ativos',value:n(stock.products),format:'number'}];
  if(id==='fiscal')return [{label:'Autorizadas',value:n(fiscal.authorized),format:'number'},{label:'Rejeitadas',value:n(fiscal.rejected),format:'number'},{label:'Canceladas',value:n(fiscal.cancelled),format:'number'},{label:'Pendentes',value:n(fiscal.pending),format:'number'}];
  if(id==='system')return [{label:'Clientes',value:n(people.customers),format:'number'},{label:'Fornecedores',value:n(people.suppliers),format:'number'},{label:'Usuários PDV',value:n(people.users_pdv),format:'number'},{label:'Usuários ADM',value:n(people.users_adm),format:'number'},{label:'PDVs ativos',value:n(equipment.pdvs),format:'number'},{label:'Caixas abertos',value:n(equipment.cash_open),format:'number'}];
  if(id==='alerts')return [{label:'Fiscal com erro',value:n(alerts.fiscal_open),format:'number'},{label:'Estoque baixo',value:n(alerts.stock_low),format:'number'},{label:'Financeiro vencido',value:n(alerts.finance_overdue),format:'number'},{label:'Tickets abertos',value:n(alerts.tickets_open),format:'number'}];
  const metric=metricInfo(id,data);if(metric?.value!==null){const points=[{label:'Período atual',value:metric.value,format:metric.format,detail:metric.text}];if(metric.previous!==null)points.unshift({label:'Período anterior',value:metric.previous,format:metric.format,detail:fmt(metric.previous,metric.format)});return points;}
  return [];
 },[daily,payments,top,minute,hourly,branchSales,pdv,cashDaily,sellers,finance,receivables,stock,fiscal,people,equipment,alerts,data]);

 function renderTile(tile:TileConfig){const metric=metricInfo(tile.id,data);if(metric&&tile.chart==='kpi')return <Kpi info={metric} color={tile.color}/>;return <Visual chart={tile.chart} points={pointsFor(tile.id)} color={tile.color}/>}
 function preset(kind:'today'|'7d'|'30d'|'month'){const e=new Date(),s=new Date(e);if(kind==='7d')s.setDate(e.getDate()-6);if(kind==='30d')s.setDate(e.getDate()-29);if(kind==='month')s.setDate(1);const si=isoDate(s),ei=isoDate(e);setStart(si);setEnd(ei);void load(si,ei,branch,true)}
 function updateTile(id:TileId,patch:Partial<TileConfig>){setTiles(cur=>cur.map(t=>t.id===id?{...t,...patch}:t))}
 function dropOn(target:TileId){const source=dragRef.current;if(!source||source===target)return;setTiles(cur=>{const from=cur.findIndex(t=>t.id===source),to=cur.findIndex(t=>t.id===target);if(from<0||to<0)return cur;const copy=[...cur],[item]=[copy[from]];copy.splice(from,1);copy.splice(to,0,item);return copy});dragRef.current=null}
 async function save(){setSaving(true);const r=await dashboardPreferencesSave(tiles,{refresh_seconds:refreshSeconds,grid_columns:gridColumns,theme});setSaving(false);setMessage(r.ok?'Dashboard pessoal salvo.':String(r.error??'Não foi possível salvar.'))}
 function reset(){setTiles(defaultTiles.map(t=>({...t})));setRefreshSeconds(60);setGridColumns(4);setTheme('light');setSelectedId('dailyRevenue')}
 async function toggleFullscreen(){try{if(document.fullscreenElement)await document.exitFullscreen();else await stageRef.current?.requestFullscreen()}catch{setMessage('O navegador não permitiu abrir em tela cheia.')}}

 const selected=tiles.find(t=>t.id===selectedId)??tiles[0];
 const visible=tiles.filter(t=>t.visible);
 const stageStyle={'--bi-columns':gridColumns} as CSSProperties;
 const spanFor=(size:Size)=>size==='wide'?gridColumns:size==='l'?Math.min(3,gridColumns):size==='m'?Math.min(2,gridColumns):1;
 const avg=asData(data.averages);
 const summary=useMemo(()=>[
  `Atualizado ${generatedAt(data.generated_at)}`,
  `${number(avg.period_days)} dia(s)`,
  branch?branches.find(b=>String(b.id)===branch)?.name??'Filial':'Todas as filiais',
 ],[data.generated_at,avg.period_days,branch,branches]);

 return <div ref={stageRef} className={`bi-stage theme-${theme} ${fullscreen?'is-fullscreen':''}`} style={stageStyle}>
  <div className="bi-topline"><div><span>THOR BI · EXECUTIVE STUDIO</span><h2>Visão integrada da operação</h2><p>Vendas, rentabilidade, PDV, caixa, financeiro, estoque, fiscal e equipe no mesmo painel.</p></div><div className="bi-fresh"><i className={loading?'loading':''}/><div><strong>{loading?'Atualizando…':'Dados sincronizados'}</strong>{summary.map((s,i)=><small key={i}>{String(s)}</small>)}</div></div></div>

  <div className="bi-toolbar">
   <div className="bi-presets"><button onClick={()=>preset('today')}>Hoje</button><button onClick={()=>preset('7d')}>7 dias</button><button onClick={()=>preset('30d')}>30 dias</button><button onClick={()=>preset('month')}>Mês</button></div>
   <label><span>De</span><input type="date" value={start} onChange={e=>setStart(e.target.value)}/></label>
   <label><span>Até</span><input type="date" value={end} onChange={e=>setEnd(e.target.value)}/></label>
   <label><span>Filial</span><select value={branch} onChange={e=>setBranch(e.target.value)}><option value="">Todas</option>{branches.map(b=><option value={String(b.id)} key={String(b.id)}>{String(b.name)}</option>)}</select></label>
   <label><span>Atualização</span><select value={refreshSeconds} onChange={e=>setRefreshSeconds(Number(e.target.value))}>{refreshOptions.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label>
   <label><span>Colunas</span><select value={gridColumns} onChange={e=>setGridColumns(Number(e.target.value))}>{[2,3,4,5,6].map(v=><option key={v} value={v}>{v} colunas</option>)}</select></label>
   <label><span>Tema</span><select value={theme} onChange={e=>setTheme(e.target.value as Theme)}>{Object.entries(themeLabels).map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label>
   <button className="bi-apply" onClick={()=>void load(start,end,branch,true)} disabled={loading}>↻ Atualizar</button>
   <button className="bi-fullscreen" onClick={()=>void toggleFullscreen()}>{fullscreen?'⤓ Sair da tela cheia':'⛶ Tela cheia'}</button>
   <button className={`bi-customize ${editing?'active':''}`} onClick={()=>setEditing(v=>!v)}>⚙ Personalizar</button>
  </div>
  {message?<div className="bi-message" onClick={()=>setMessage('')}>{message}<span>×</span></div>:null}

  <div className={`bi-canvas ${editing?'editing':''}`}>
   {visible.map(tile=><article key={tile.id} className="bi-card" style={{'--tile':tile.color,'--tile-soft':rgba(tile.color,.12),'--span':spanFor(tile.size)} as CSSProperties} draggable={editing} onDragStart={(e:DragEvent)=>{dragRef.current=tile.id;e.dataTransfer.effectAllowed='move'}} onDragOver={e=>{if(editing)e.preventDefault()}} onDrop={()=>dropOn(tile.id)}>
    <header><div><span>{tile.id==='pdvFlow'||tile.id==='cashDaily'?'OPERAÇÃO':tile.id==='finance'||tile.id==='receivables'?'FINANCEIRO':tile.id==='stock' || tile.id==='stockValue'?'ESTOQUE':tile.id==='fiscal'?'FISCAL':tile.id==='system'||tile.id==='alerts'?'SISTEMA':'ANÁLISE'}</span><h3>{tile.title}</h3></div>{editing?<div className="bi-card-tools"><button title="Editar" onClick={()=>{setSelectedId(tile.id);setEditing(true)}}>⚙</button><button title="Mover">⠿</button><button title="Ocultar" onClick={()=>updateTile(tile.id,{visible:false})}>×</button></div>:<i className="bi-dot"/>}</header>
    <div className="bi-body">{renderTile(tile)}</div>
   </article>)}
  </div>

  {editing?<aside className="bi-editor"><div className="bi-editor-head"><div><span>THOR BI</span><h3>Personalizar dashboard</h3></div><button onClick={()=>setEditing(false)}>×</button></div><div className="bi-editor-actions"><button onClick={reset}>Restaurar padrão</button><button className="primary" onClick={()=>void save()} disabled={saving}>{saving?'Salvando…':'Salvar layout'}</button></div>
   <div className="bi-editor-global"><h4>Layout global</h4><label><span>Quantidade de colunas</span><select value={gridColumns} onChange={e=>setGridColumns(Number(e.target.value))}>{[2,3,4,5,6].map(v=><option value={v} key={v}>{v} colunas</option>)}</select></label><label><span>Tema</span><select value={theme} onChange={e=>setTheme(e.target.value as Theme)}>{Object.entries(themeLabels).map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label></div>
   <h4>Indicadores e gráficos</h4><div className="bi-editor-list">{tiles.map(t=><div key={t.id} className={`bi-editor-row ${selectedId===t.id?'selected':''}`}><input type="checkbox" checked={t.visible} onChange={e=>updateTile(t.id,{visible:e.target.checked})}/><button onClick={()=>setSelectedId(t.id)}>{t.title}</button></div>)}</div>
   {selected?<div className="bi-properties"><h4>Card selecionado</h4><label><span>Título</span><input value={selected.title} onChange={e=>updateTile(selected.id,{title:e.target.value})}/></label><label><span>Visual</span><select value={selected.chart} onChange={e=>updateTile(selected.id,{chart:e.target.value as ChartType})}>{chartTypes.map(c=><option value={c} key={c}>{chartLabels[c]}</option>)}</select></label><label><span>Tamanho</span><select value={selected.size} onChange={e=>updateTile(selected.id,{size:e.target.value as Size})}>{Object.entries(sizeLabels).map(([v,l])=><option value={v} key={v}>{l}</option>)}</select></label><label><span>Cor principal</span><div className="bi-color"><input type="color" value={selected.color} onChange={e=>updateTile(selected.id,{color:e.target.value})}/><code>{selected.color}</code></div></label><p>Arraste os cards no canvas para reposicionar. Todos os 18 visuais podem ser usados em qualquer indicador.</p></div>:null}
  </aside>:null}
 </div>;
}
