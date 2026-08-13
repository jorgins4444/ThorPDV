import type { ChartType, Format } from './dashboard-visuals-v2';

export type Row=Record<string,unknown>;
export type Data=Record<string,unknown>;
export type Size='s'|'m'|'l'|'wide';
export type Theme='light'|'midnight'|'graphite'|'ocean'|'emerald'|'wine';
export type TileId='netSales'|'grossProfit'|'netProfit'|'avgTicket'|'salesCount'|'grossMargin'|'avgDailyRevenue'|'avgDailySales'|'avgDailyProfit'|'avgHourlyRevenue'|'itemsPerSale'|'stockValue'|'dailyRevenue'|'dailyProfit'|'dailySales'|'dailyTicket'|'payments'|'topProducts'|'minute'|'hourly'|'branchSales'|'pdvFlow'|'cashDaily'|'sellers'|'finance'|'receivables'|'stock'|'fiscal'|'system'|'alerts';
export type TileConfig={id:TileId;title:string;size:Size;color:string;chart:ChartType;visible:boolean};
export type MetricInfo={text:string;caption:string;value:number|null;previous:number|null;delta:number|null;available:boolean;format:Format};

export const money=(v:unknown)=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(v??0));
export const number=(v:unknown)=>new Intl.NumberFormat('pt-BR',{maximumFractionDigits:2}).format(Number(v??0));
export const percent=(v:unknown)=>`${new Intl.NumberFormat('pt-BR',{maximumFractionDigits:1}).format(Number(v??0))}%`;
export const asData=(v:unknown)=>(v&&typeof v==='object'&&!Array.isArray(v)?v as Data:{});
export const asRows=(v:unknown)=>(Array.isArray(v)?v as Row[]:[]);
export const n=(v:unknown)=>Number(v??0);
export const fmt=(v:number,format:Format='money')=>format==='money'?money(v):format==='percent'?percent(v):number(v);
export const paymentLabels:Record<string,string>={cash:'Dinheiro',pix:'PIX',credit:'Crédito',credit_card:'Crédito',debit:'Débito',debit_card:'Débito',voucher:'Voucher',store_credit:'Crediário',cashback:'Cashback',bank_slip:'Boleto',term_sale:'Venda a prazo'};
export const chartTypes:ChartType[]=['kpi','bar','column','line','area','donut','pie','table','gauge','radial','funnel','treemap','heatmap','waterfall','combo','scatter','radar','spark'];
export const chartLabels:Record<ChartType,string>={kpi:'Indicador',bar:'Barras horizontais',column:'Colunas',line:'Linha',area:'Área',donut:'Rosca',pie:'Pizza',table:'Tabela',gauge:'Velocímetro',radial:'Radial',funnel:'Funil',treemap:'Mapa de árvore',heatmap:'Mapa de calor',waterfall:'Cascata',combo:'Combinado',scatter:'Dispersão',radar:'Radar',spark:'Sparkline'};
export const sizeLabels:Record<Size,string>={s:'Pequeno',m:'Médio',l:'Grande',wide:'Largura total'};
export const themeLabels:Record<Theme,string>={light:'Claro executivo',midnight:'Midnight',graphite:'Grafite',ocean:'Oceano',emerald:'Esmeralda',wine:'Vinho'};
export const refreshOptions=[[0,'Manual'],[15,'15 segundos'],[30,'30 segundos'],[60,'1 minuto'],[300,'5 minutos'],[900,'15 minutos'],[3600,'1 hora']] as const;

export const defaultTiles:TileConfig[]=[
 {id:'netSales',title:'Vendas líquidas',size:'m',color:'#6d28d9',chart:'kpi',visible:true},{id:'grossProfit',title:'Lucro bruto',size:'m',color:'#059669',chart:'kpi',visible:true},{id:'avgTicket',title:'Ticket médio',size:'s',color:'#d97706',chart:'kpi',visible:true},{id:'salesCount',title:'Quantidade de vendas',size:'s',color:'#2563eb',chart:'kpi',visible:true},{id:'grossMargin',title:'Margem bruta',size:'s',color:'#0891b2',chart:'gauge',visible:true},
 {id:'avgDailyRevenue',title:'Média de vendas por dia',size:'s',color:'#7c3aed',chart:'kpi',visible:true},{id:'avgDailySales',title:'Média de cupons por dia',size:'s',color:'#2563eb',chart:'kpi',visible:true},{id:'avgDailyProfit',title:'Média de lucro bruto/dia',size:'s',color:'#059669',chart:'kpi',visible:true},{id:'avgHourlyRevenue',title:'Média por hora ativa',size:'s',color:'#0e7490',chart:'kpi',visible:true},{id:'itemsPerSale',title:'Média de itens por venda',size:'s',color:'#9333ea',chart:'kpi',visible:true},
 {id:'dailyRevenue',title:'Evolução diária das vendas',size:'wide',color:'#6d28d9',chart:'area',visible:true},{id:'dailyProfit',title:'Evolução diária do lucro bruto',size:'l',color:'#10b981',chart:'line',visible:true},{id:'dailySales',title:'Evolução diária da quantidade de vendas',size:'l',color:'#2563eb',chart:'column',visible:true},{id:'dailyTicket',title:'Evolução diária do ticket médio',size:'l',color:'#d97706',chart:'line',visible:true},
 {id:'payments',title:'Vendas por forma de pagamento',size:'l',color:'#0ea5e9',chart:'donut',visible:true},{id:'topProducts',title:'Produtos mais vendidos',size:'l',color:'#10b981',chart:'bar',visible:true},{id:'minute',title:'Vendas por minuto · últimos 60 min',size:'wide',color:'#2563eb',chart:'area',visible:true},{id:'hourly',title:'Vendas por hora',size:'l',color:'#8b5cf6',chart:'column',visible:true},{id:'branchSales',title:'Vendas por filial',size:'l',color:'#f59e0b',chart:'bar',visible:true},
 {id:'pdvFlow',title:'Detalhamento de fluxo por PDV',size:'wide',color:'#7c3aed',chart:'table',visible:true},{id:'cashDaily',title:'Fluxo diário de caixa',size:'wide',color:'#0f766e',chart:'combo',visible:true},{id:'sellers',title:'Desempenho de vendedores / operadores',size:'l',color:'#6366f1',chart:'bar',visible:true},{id:'finance',title:'Posição financeira',size:'m',color:'#ef4444',chart:'waterfall',visible:true},{id:'receivables',title:'Recebíveis a prazo',size:'m',color:'#f59e0b',chart:'donut',visible:true},{id:'stock',title:'Situação do estoque',size:'m',color:'#64748b',chart:'donut',visible:true},{id:'stockValue',title:'Valor do estoque a custo',size:'s',color:'#475569',chart:'kpi',visible:true},{id:'fiscal',title:'Saúde fiscal / NFC-e',size:'m',color:'#0ea5e9',chart:'radial',visible:true},{id:'system',title:'Operação do sistema',size:'m',color:'#7c3aed',chart:'treemap',visible:true},{id:'alerts',title:'Alertas operacionais',size:'m',color:'#dc2626',chart:'bar',visible:true},{id:'netProfit',title:'Lucro líquido',size:'m',color:'#0f766e',chart:'kpi',visible:false}
];

export function isoDate(d:Date){const y=d.getFullYear(),m=String(d.getMonth()+1).padStart(2,'0'),day=String(d.getDate()).padStart(2,'0');return `${y}-${m}-${day}`}
export const today=()=>isoDate(new Date());
export function shortDate(v:unknown){const s=String(v??'');if(!s)return '—';const [y,m,d]=s.slice(0,10).split('-');return y&&m&&d?`${d}/${m}`:s}
export function minuteLabel(v:unknown){const d=new Date(String(v??''));return Number.isNaN(d.getTime())?'—':d.toLocaleTimeString('pt-BR',{timeZone:'America/Fortaleza',hour:'2-digit',minute:'2-digit'})}
export function generatedAt(v:unknown){const d=new Date(String(v??''));return Number.isNaN(d.getTime())?'agora':d.toLocaleTimeString('pt-BR',{timeZone:'America/Fortaleza',hour:'2-digit',minute:'2-digit',second:'2-digit'})}
export function rgba(hex:string,alpha:number){const clean=hex.replace('#','');const full=clean.length===3?clean.split('').map(x=>x+x).join(''):clean;const num=parseInt(full,16);if(!Number.isFinite(num))return `rgba(109,40,217,${alpha})`;return `rgba(${(num>>16)&255},${(num>>8)&255},${num&255},${alpha})`}
const pctDelta=(current:number,previous:number|null)=>previous&&previous!==0?(current-previous)/Math.abs(previous)*100:null;

export function metricInfo(id:TileId,data:Data):MetricInfo|null{
 const sales=asData(data.sales),comparison=asData(data.comparison),prev=asData(comparison.previous),avg=asData(data.averages),stock=asData(data.stock);
 const make=(value:number,caption:string,format:Format='money',previous:number|null=null,forced:number|null=null):MetricInfo=>({text:fmt(value,format),caption,value,previous,delta:forced??pctDelta(value,previous),available:true,format});
 if(id==='netSales')return make(n(sales.net??sales.gross),'Vendas válidas menos devoluções','money',n(prev.net),comparison.net_pct==null?null:n(comparison.net_pct));
 if(id==='grossProfit')return make(n(sales.gross_profit),`Receita líquida − CMV (${money(sales.cmv)})`,'money',n(prev.gross_profit),comparison.gross_profit_pct==null?null:n(comparison.gross_profit_pct));
 if(id==='avgTicket')return make(n(sales.avg_ticket),'Valor médio por venda','money',n(prev.avg_ticket),comparison.ticket_pct==null?null:n(comparison.ticket_pct));
 if(id==='salesCount')return make(n(sales.count),'Vendas concluídas','number',n(prev.count),comparison.count_pct==null?null:n(comparison.count_pct));
 if(id==='grossMargin')return make(n(sales.gross_margin),'Lucro bruto ÷ receita líquida','percent',prev.gross_margin==null?null:n(prev.gross_margin));
 if(id==='avgDailyRevenue')return make(n(avg.daily_net_revenue),`Média em ${number(avg.period_days)} dia(s)`);
 if(id==='avgDailySales')return make(n(avg.daily_sales_count),'Cupons por dia no período','number');
 if(id==='avgDailyProfit')return make(n(avg.daily_gross_profit),'Lucro bruto médio diário');
 if(id==='avgHourlyRevenue')return make(n(avg.hourly_revenue),`${number(avg.active_hours)} hora(s) com venda`);
 if(id==='itemsPerSale')return make(n(avg.items_per_sale),'Itens líquidos por cupom','number');
 if(id==='stockValue')return make(n(stock.value),'Estoque atual valorizado a custo');
 if(id==='netProfit'){const ok=Boolean(sales.net_profit_available);return {text:ok?money(sales.net_profit):'N/D',caption:ok?'Resultado líquido auditável':'Aguardando DRE completa com impostos, taxas, comissões e despesas por competência',value:ok?n(sales.net_profit):null,previous:null,delta:null,available:ok,format:'money'}}
 return null;
}
