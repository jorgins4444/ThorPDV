'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { dashboardLoad, logout } from './actions';

type Row=Record<string,unknown>;
type Data=Record<string,unknown>;
type Tab='sales'|'finance'|'stock'|'people'|'equipment'|'open';

const money=(v:unknown)=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(v??0));
const number=(v:unknown)=>new Intl.NumberFormat('pt-BR',{maximumFractionDigits:2}).format(Number(v??0));
const pct=(v:unknown)=>`${new Intl.NumberFormat('pt-BR',{maximumFractionDigits:1}).format(Number(v??0))}%`;
const n=(o:Data|undefined,k:string)=>Number(o?.[k]??0);

const menu=[
 ['Dashboard','/dashboard','▣'],
 ['Pessoas','/dashboard/clientes','●'],
 ['Vendas','/dashboard/vendas','▰'],
 ['Pedidos de Venda','/dashboard/vendas/pedidos','▱'],
 ['Produtos','/dashboard/produtos','◆'],
 ['Tabela de Preços','/dashboard/tabelas-precos','◇'],
 ['Estoque','/dashboard/estoque','⬡'],
 ['Financeiro','/dashboard/financeiro/receber','▤'],
 ['Administrativo','/dashboard/administrativo/empresas','▧'],
 ['Relatórios','/dashboard/relatorios','▥'],
 ['Atendimento','/dashboard/atendimento','◉']
] as const;

const quick=[
 ['Nova venda','/dashboard/vendas/nova','▰'],
 ['Pedidos de venda','/dashboard/vendas/pedidos','▱'],
 ['Operações de caixa','/dashboard/vendas','PDV'],
 ['Novo produto','/dashboard/produtos/novo','+'],
 ['Novo cliente','/dashboard/clientes/novo','●'],
 ['Estoque','/dashboard/estoque','⬡'],
 ['Conta a receber','/dashboard/financeiro/receber/novo','↓'],
 ['Conta a pagar','/dashboard/financeiro/pagar/novo','↑'],
 ['Tabela de preços','/dashboard/tabelas-precos','◇'],
 ['Abrir caixa','/dashboard/pdv/caixa','PDV'],
 ['Ativar PDV Desktop','/dashboard/administrativo/pdv-desktop','PC']
] as const;

const tabs:[Tab,string,string][]=[
 ['sales','Vendas','▰'],
 ['finance','Financeiro','$'],
 ['stock','Estoque','⬡'],
 ['people','Pessoas','●'],
 ['equipment','Operação','▣'],
 ['open','Contas em aberto','▤']
];

function isoDate(d:Date){
 const y=d.getFullYear();const m=String(d.getMonth()+1).padStart(2,'0');const day=String(d.getDate()).padStart(2,'0');
 return `${y}-${m}-${day}`;
}
function today(){return isoDate(new Date())}
function formatDay(value:unknown){
 const raw=String(value??'');if(!raw)return '—';
 const [y,m,d]=raw.slice(0,10).split('-');return y&&m&&d?`${d}/${m}`:raw;
}
function generatedAt(value:unknown){
 if(!value)return 'agora';
 const d=new Date(String(value));
 return Number.isNaN(d.getTime())?'agora':d.toLocaleString('pt-BR',{timeZone:'America/Fortaleza',hour:'2-digit',minute:'2-digit',day:'2-digit',month:'2-digit'});
}
function compare(value:unknown){
 if(value===null||value===undefined||value==='')return {text:'Sem base anterior',tone:'neutral'};
 const v=Number(value);
 if(!Number.isFinite(v))return {text:'Sem base anterior',tone:'neutral'};
 if(Math.abs(v)<0.05)return {text:'Estável vs. período anterior',tone:'neutral'};
 return {text:`${v>0?'↑':'↓'} ${Math.abs(v).toLocaleString('pt-BR',{maximumFractionDigits:1})}% vs. período anterior`,tone:v>0?'up':'down'};
}

function TrendChart({rows}:{rows:Row[]}){
 const max=Math.max(1,...rows.flatMap(r=>[Math.abs(Number(r.net_revenue??0)),Math.abs(Number(r.cmv??0)),Math.abs(Number(r.gross_profit??0))]));
 if(!rows.length)return <div className="thor-empty-chart">Sem dados para o período selecionado.</div>;
 return <div className="thor-trend">
   <div className="thor-trend-legend"><span><i className="net"/>Receita líquida</span><span><i className="cost"/>CMV</span><span><i className="profit"/>Lucro bruto</span></div>
   <div className="thor-trend-scroll"><div className="thor-trend-bars">
    {rows.map((r,i)=><div className="thor-trend-day" key={String(r.report_day??i)}>
      <div className="thor-trend-columns" title={`${formatDay(r.report_day)} · Receita ${money(r.net_revenue)} · CMV ${money(r.cmv)} · Lucro ${money(r.gross_profit)}`}>
       <span className="thor-bar net" style={{height:`${Math.max(2,Math.abs(Number(r.net_revenue??0))/max*100)}%`}}/>
       <span className="thor-bar cost" style={{height:`${Math.max(2,Math.abs(Number(r.cmv??0))/max*100)}%`}}/>
       <span className={`thor-bar profit ${Number(r.gross_profit??0)<0?'negative':''}`} style={{height:`${Math.max(2,Math.abs(Number(r.gross_profit??0))/max*100)}%`}}/>
      </div>
      <small>{formatDay(r.report_day)}</small>
    </div>)}
   </div></div>
 </div>;
}

export function DashboardLive({identity,initial}:{identity:string;initial:Data}){
 const [data,setData]=useState(initial);
 const [tab,setTab]=useState<Tab>('sales');
 const [start,setStart]=useState(String(initial.start??today()));
 const [end,setEnd]=useState(String(initial.end??today()));
 const [branch,setBranch]=useState('');
 const [expanded,setExpanded]=useState('');
 const [loading,setLoading]=useState(false);
 const [collapsed,setCollapsed]=useState(false);
 const [message,setMessage]=useState('');

 const sales=data.sales as Data|undefined;
 const comparison=data.comparison as Data|undefined;
 const fin=data.finance as Data|undefined;
 const stock=data.stock as Data|undefined;
 const people=data.people as Data|undefined;
 const equipment=data.equipment as Data|undefined;
 const alerts=data.alerts as Data|undefined;
 const branches=(data.branches as Row[]|undefined)??[];
 const top=(data.top_products as Row[]|undefined)??[];
 const payments=(data.payments as Row[]|undefined)??[];
 const hourly=(data.hourly as Row[]|undefined)??[];
 const branchSales=(data.branch_sales as Row[]|undefined)??[];
 const trend=(data.trend as Row[]|undefined)??[];

 const ownerCards=useMemo(()=>{
   const values=[
    ['Receita líquida',money(sales?.net??sales?.gross),compare(comparison?.net_pct),'Vendas menos devoluções','revenue'],
    ['Lucro bruto',money(sales?.gross_profit),compare(comparison?.gross_profit_pct),'Receita líquida menos CMV','profit'],
    ['Margem bruta',pct(sales?.gross_margin),{text:`CMV ${money(sales?.cmv)}`,tone:n(sales,'gross_margin')>=25?'up':'neutral'},'Percentual da receita líquida','margin'],
    ['Ticket médio',money(sales?.avg_ticket),compare(comparison?.ticket_pct),`${number(sales?.count)} venda(s) concluída(s)`,'ticket'],
    ['Vendas',number(sales?.count),compare(comparison?.count_pct),`Período ${formatDay(data.start)}–${formatDay(data.end)}`,'sales']
   ] as const;
   return values;
 },[sales,comparison,data.start,data.end]);

 const cards=useMemo(()=>({
  sales:[
   ['Receita líquida',money(sales?.net??sales?.gross),'Vendas válidas menos devoluções','teal','R$'],
   ['Quantidade',String(n(sales,'count')),'Vendas concluídas no período','violet','#'],
   ['Devoluções',money(sales?.returns),'Abatidas da receita','amber','↩'],
   ['Cancelamentos',money(sales?.cancelled),'Vendas canceladas no período','coral','×']
  ],
  finance:[
   ['A receber hoje',money(fin?.receivable_today),'Vencimentos de hoje','teal','↓'],
   ['A pagar hoje',money(fin?.payable_today),'Compromissos de hoje','amber','↑'],
   ['Saldo previsto',money(n(fin,'receivable_open')-n(fin,'payable_open')),'Aberto a receber menos pagar','violet','Σ'],
   ['Inadimplência',money(fin?.overdue),'Recebíveis vencidos','coral','!']
  ],
  stock:[
   ['Itens em estoque',number(stock?.items),'Saldo disponível','teal','⬡'],
   ['Estoque baixo',String(n(stock,'low')),'Abaixo do mínimo','amber','!'],
   ['Sem estoque',String(n(stock,'zero')),'Produtos zerados','coral','0'],
   ['Capital em estoque',money(stock?.value),'Valorizado pelo custo','violet','R$']
  ],
  people:[
   ['Clientes',String(n(people,'customers')),'Ativos','teal','C'],
   ['Fornecedores',String(n(people,'suppliers')),'Ativos','amber','F'],
   ['Usuários PDV',String(n(people,'users_pdv')),'Operadores ativos','violet','P'],
   ['Usuários ADM',String(n(people,'users_adm')),'Administrativos ativos','coral','A']
  ],
  equipment:[
   ['PDVs ativos',String(n(equipment,'pdvs')),'Terminais cadastrados','teal','PDV'],
   ['Caixas abertos',String(n(equipment,'cash_open')),'Posição atual','amber','▰'],
   ['Fiscal no período',String(n(alerts,'fiscal_rejected')),'Rejeições/erros no filtro','coral','NF'],
   ['Chamados',String(n(alerts,'tickets_open')),'Escopo global do tenant','violet','?']
  ],
  open:[
   ['Contas vencidas',money(fin?.overdue),'Recebíveis vencidos','coral','!'],
   ['Vence hoje',money(fin?.receivable_today),'Recebíveis de hoje','amber','◷'],
   ['Próximos 7 dias',money(fin?.next7),'Recebíveis futuros','violet','7'],
   ['Total em aberto',money(fin?.receivable_open),'Saldo a receber','teal','R$']
  ],
 } as Record<Tab,string[][]>)[tab],[tab,sales,fin,stock,people,equipment,alerts]);

 async function load(s=start,e=end,b=branch){
   setLoading(true);setMessage('');
   const r=await dashboardLoad(s,e,b||undefined);
   setLoading(false);
   if(r.ok){setData(r);setMessage('Dados atualizados com a data comercial de Fortaleza.');}
   else setMessage(String(r.error??'Falha ao atualizar'));
 }
 async function apply(){await load()}
 function preset(kind:'today'|'7d'|'30d'|'month'){
   const e=new Date();let s=new Date(e);
   if(kind==='7d')s.setDate(e.getDate()-6);
   if(kind==='30d')s.setDate(e.getDate()-29);
   if(kind==='month')s=new Date(e.getFullYear(),e.getMonth(),1);
   const si=isoDate(s),ei=isoDate(e);setStart(si);setEnd(ei);void load(si,ei,branch);
 }

 function sectionData(title:string){
   if(title==='Produtos mais vendidos')return top.map(r=>[String(r.product),`${number(r.quantity)} un.`,money(r.revenue)]);
   if(title==='Formas de recebimento')return payments.map(r=>[String(r.method),`${String(r.quantity)} trans.`,money(r.total)]);
   if(title==='Vendas por hora')return hourly.map(r=>[`${String(r.report_hour).padStart(2,'0')}:00`,`${String(r.quantity)} vendas`,money(r.total)]);
   if(title==='Faturamento por filial')return branchSales.map(r=>[String(r.branch),`${String(r.quantity)} vendas`,money(r.total)]);
   return [];
 }
 const sections=tab==='sales'?['Produtos mais vendidos','Vendas por hora','Formas de recebimento','Faturamento por filial']:
   tab==='finance'?['Contas a receber','Contas a pagar','Fluxo de caixa','Conciliação']:
   tab==='stock'?['Estoque crítico','Movimentações','Inventários','Estoque por filial']:
   tab==='people'?['Clientes','Fornecedores','Usuários e perfis','Acessos']:
   tab==='equipment'?['PDV Desktop / Agentes','Caixas e PDVs','Fiscal','Integrações','Atendimento']:
   ['Títulos vencidos','Vencimentos de hoje','Próximos vencimentos','Resumo financeiro'];

 return <main className={`erp-shell ${collapsed?'erp-collapsed':''}`}>
  <header className="erp-header">
   <div className="erp-brand-wrap"><Link href="/dashboard" className="erp-logo"><span className="erp-bolt">ϟ</span><span>THOR<b>PDV</b></span></Link><button className="erp-icon-btn erp-menu-toggle" onClick={()=>setCollapsed(!collapsed)}>☰</button></div>
   <div className="erp-account"><span className="erp-avatar">SA</span><div className="erp-account-copy"><strong>THORPDV</strong><span>{identity}</span></div><form action={logout}><button className="erp-logout">Sair</button></form></div>
  </header>
  <aside className="erp-sidebar">
   <nav className="erp-nav">{menu.map(([label,href,icon],i)=><Link key={href} href={href} className={`erp-nav-item ${i===0?'is-active':''}`}><span className="erp-nav-icon">{icon}</span><span className="erp-nav-label">{label}</span></Link>)}</nav>
   <div className="erp-store-card"><span className="erp-nav-icon">▦</span><div className="erp-store-copy"><small>Loja atual</small><strong>{branch?String(branches.find(b=>String(b.id)===branch)?.name??'FILIAL'):'TODAS'}</strong></div></div>
  </aside>

  <section className="erp-main thor-owner-main">
   <div className="erp-page-heading thor-owner-heading">
    <div><p className="erp-eyebrow">Inteligência gerencial</p><h1>Visão do Dono</h1><p>Vendas, resultado, caixa e operação calculados a partir da mesma fonte de verdade.</p></div>
    <div className="thor-freshness"><span className="thor-freshness-dot"/><div><strong>Dados atualizados</strong><small>{generatedAt(data.generated_at)} · Fortaleza</small></div></div>
   </div>

   <section className="erp-filter-card thor-filter-card">
    <div className="thor-presets"><button onClick={()=>preset('today')}>Hoje</button><button onClick={()=>preset('7d')}>7 dias</button><button onClick={()=>preset('30d')}>30 dias</button><button onClick={()=>preset('month')}>Este mês</button></div>
    <label><span>Data inicial</span><input type="date" value={start} onChange={e=>setStart(e.target.value)}/></label>
    <label><span>Data final</span><input type="date" value={end} onChange={e=>setEnd(e.target.value)}/></label>
    <label className="erp-branch-filter"><span>Filial</span><select value={branch} onChange={e=>setBranch(e.target.value)}><option value="">Todas as filiais</option>{branches.map(b=><option value={String(b.id)} key={String(b.id)}>{String(b.name)}</option>)}</select></label>
    <button className="erp-dashboard-apply" onClick={apply} disabled={loading}>{loading?'Atualizando...':'Aplicar filtros'}</button>
   </section>
   {message&&<p className="erp-live-message">{message}</p>}

   <section className="thor-owner-kpis">
    {ownerCards.map(([label,value,delta,detail,tone])=><article className={`thor-owner-kpi tone-${tone}`} key={label}>
      <div className="thor-owner-kpi-top"><span>{label}</span><b>↗</b></div>
      <strong>{value}</strong>
      <div className={`thor-owner-delta ${delta.tone}`}>{delta.text}</div>
      <small>{detail}</small>
    </article>)}
   </section>

   <section className="thor-result-grid">
    <article className="erp-panel thor-result-card">
     <div className="erp-panel-header"><div><p className="erp-eyebrow">Resultado do período</p><h2>Da venda ao lucro bruto</h2><p>Valores auditáveis com custo histórico do item vendido.</p></div><Link className="thor-panel-link" href="/dashboard/relatorios/dre-gerencial">Abrir DRE →</Link></div>
     <div className="thor-waterfall">
      <div><span>Receita de vendas</span><strong>{money(sales?.gross)}</strong></div>
      <div className="deduction"><span>(−) Devoluções</span><strong>{money(sales?.returns)}</strong></div>
      <div className="subtotal"><span>Receita líquida</span><strong>{money(sales?.net)}</strong></div>
      <div className="deduction"><span>(−) CMV</span><strong>{money(sales?.cmv)}</strong></div>
      <div className={`total ${n(sales,'gross_profit')<0?'negative':''}`}><span>Lucro bruto</span><strong>{money(sales?.gross_profit)}</strong><em>Margem {pct(sales?.gross_margin)}</em></div>
     </div>
     <details className="thor-how"><summary>Como calculamos?</summary><p>Receita líquida = vendas concluídas − devoluções. Lucro bruto = receita líquida − CMV. O CMV usa o custo gravado no momento da venda quando disponível.</p><p><b>Importante:</b> este ainda não é o lucro líquido final. Taxas financeiras, impostos efetivos e todas as despesas operacionais serão abatidos na próxima camada da Central de Resultado.</p></details>
    </article>

    <article className="erp-panel thor-chart-card">
     <div className="erp-panel-header"><div><p className="erp-eyebrow">Evolução</p><h2>Receita × CMV × Lucro</h2><p>Data comercial America/Fortaleza.</p></div><Link className="thor-panel-link" href="/dashboard/relatorios/lucro-bruto">Detalhar →</Link></div>
     <TrendChart rows={trend}/>
    </article>
   </section>

   <section className="thor-management-links">
    <Link href="/dashboard/relatorios/margem-produto"><span>◆</span><div><strong>Margem por produto</strong><small>Veja quais produtos realmente geram resultado.</small></div><b>→</b></Link>
    <Link href="/dashboard/relatorios/cmv"><span>Σ</span><div><strong>CMV</strong><small>Acompanhe o custo das mercadorias vendidas.</small></div><b>→</b></Link>
    <Link href="/dashboard/relatorios/curva-abc"><span>ABC</span><div><strong>Curva ABC</strong><small>Concentração de faturamento por produto.</small></div><b>→</b></Link>
    <Link href="/dashboard/relatorios/fluxo-caixa"><span>$</span><div><strong>Fluxo de caixa</strong><small>Realizado e previsto no financeiro.</small></div><b>→</b></Link>
   </section>

   <div className="thor-section-title"><div><p className="erp-eyebrow">Operação</p><h2>Detalhes do negócio</h2></div><span>Indicadores de período e posição atual separados por contexto</span></div>
   <section className="erp-tab-card">{tabs.map(([key,label,icon])=><button key={key} onClick={()=>setTab(key)} className={tab===key?'is-active':''}><span>{icon}</span>{label}</button>)}</section>
   <section className="erp-kpi-grid">{cards.map(([label,value,detail,tone,icon])=><article className="erp-kpi-card" key={label}><div className={`erp-kpi-icon tone-${tone}`}>{icon}</div><div><strong>{value}</strong><h2>{label}</h2><p>{detail}</p></div></article>)}</section>

   <section className="erp-workspace-grid">
    <div className="erp-panel erp-quick-panel"><div className="erp-panel-header"><div><h2>Atalhos rápidos</h2><p>Fluxos operacionais integrados.</p></div><span className="erp-chip">Operação</span></div><div className="erp-quick-grid">{quick.map(([label,href,icon])=><Link href={href} className="erp-quick-action" key={href}><span>{icon}</span><strong>{label}</strong><small>Abrir módulo →</small></Link>)}</div></div>
    <div className="erp-panel erp-alert-panel"><div className="erp-panel-header"><div><h2>Central de atenção</h2><p>Pendências que exigem ação.</p></div></div><div className="erp-alert-list">
      <div><span className="erp-alert-dot danger"/><p><strong>Fiscal no período</strong><small>Rejeições/erros conforme o filtro.</small></p><b>{n(alerts,'fiscal_rejected')}</b></div>
      <div><span className="erp-alert-dot warning"/><p><strong>Estoque</strong><small>Produtos abaixo do mínimo.</small></p><b>{n(alerts,'stock_low')}</b></div>
      <div><span className="erp-alert-dot violet"/><p><strong>Financeiro</strong><small>Títulos vencidos em aberto.</small></p><b>{n(alerts,'finance_overdue')}</b></div>
      <div><span className="erp-alert-dot success"/><p><strong>Atendimento</strong><small>Chamados ativos no tenant.</small></p><b>{n(alerts,'tickets_open')}</b></div>
    </div></div>
   </section>

   <section className="erp-accordion-list">{sections.map(title=>{const open=expanded===title;const rows=sectionData(title);return <article className={`erp-accordion ${open?'is-expanded':''}`} key={title}><button onClick={()=>setExpanded(open?'':title)}><span className="erp-accordion-icon">◇</span><span><strong>{title}</strong><small>Clique para visualizar o detalhamento.</small></span><b>{open?'−':'+'}</b></button>{open?<div className="erp-live-detail">{title==='PDV Desktop / Agentes'?<p><Link href="/dashboard/administrativo/pdv-desktop">Abrir pareamento e gerar código de ativação →</Link></p>:rows.length?rows.map((r,i)=><div key={i}><strong>{r[0]}</strong><span>{r[1]}</span><b>{r[2]}</b></div>):<p>Abra o módulo correspondente para o detalhamento completo.</p>}</div>:null}</article>})}</section>
  </section>
 </main>;
}
