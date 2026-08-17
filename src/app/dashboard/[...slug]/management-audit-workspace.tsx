'use client';

import { useMemo, useState, useTransition } from 'react';
import type { FormEvent } from 'react';
import { erpManagementAudit } from './actions';

type Row=Record<string,unknown>;
type Cursor={at:string;id:string}|null;
type Props={initialEvents:Row[];initialSummary:Record<string,unknown>;initialPagination:Record<string,unknown>;permissions:Record<string,unknown>;branches:Row[];operators:Row[]};

const labels:Record<string,string>={
  discount_applied:'Desconto aplicado',discount_changed:'Desconto alterado',sale_cancelled:'Venda cancelada',
  sale_return:'Devolução',return_cancelled:'Devolução cancelada',receivable_received:'Recebimento',
  receivable_reversed:'Estorno de recebimento',manager_authorization:'Autorização gerencial',
  cash_management_close:'Fechamento gerencial',cash_management_reopen:'Reabertura de caixa',
  cash_management_correct:'Correção de caixa',price_changed:'Alteração de preço',
  record_created:'Cadastro realizado',record_updated:'Cadastro alterado',record_deleted:'Cadastro excluído',
};
const fieldLabels:Record<string,string>={
  name:'Nome',trade_name:'Nome fantasia',full_name:'Nome completo',type:'Tipo',document:'CPF / CNPJ',
  state_registration:'Inscrição estadual',email:'E-mail',phone:'Telefone',birth_date:'Data de nascimento',
  postal_code:'CEP',street:'Endereço',number:'Número',complement:'Complemento',district:'Bairro',
  city:'Cidade',state:'UF',active:'Ativo',description:'Descrição',code:'Código',sale_price:'Preço de venda',
  cost_price:'Preço de custo',quantity:'Quantidade',status:'Situação',notes:'Observações',
};
const hiddenFields=new Set(['id','tenant_id','company_id','branch_id','created_at','updated_at','recorded_at']);
const money=(value:unknown)=>Number(value||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const dateTime=(value:unknown)=>value?new Date(String(value)).toLocaleString('pt-BR'):'—';
const str=(value:unknown)=>value==null?'':String(value);
const isoDate=(date:Date)=>date.toISOString().slice(0,10);
const friendlyReason=(row:Row)=>str(row.reason||row.title||'Registro automático').replaceAll('Usuário ERP',str(row.responsible_name||row.operator_name||'Usuário identificado'));
const record=(value:unknown):Row=>value&&typeof value==='object'&&!Array.isArray(value)?value as Row:{};
const formatValue=(value:unknown)=>{
  if(value==null||value==='')return 'Não informado';
  if(typeof value==='boolean')return value?'Sim':'Não';
  if(typeof value==='object')return JSON.stringify(value);
  return String(value);
};
const auditFields=(row:Row)=>{
  const before=record(row.before_data);
  const after=record(row.after_data);
  const metadata=record(row.metadata);
  const declared=Array.isArray(metadata.changed_fields)?metadata.changed_fields.map(str):[];
  const keys=(declared.length?declared:Array.from(new Set([...Object.keys(before),...Object.keys(after)])))
    .filter(key=>key&&!hiddenFields.has(key));
  return keys.map(key=>({key,label:fieldLabels[key]||key.replaceAll('_',' '),before:before[key],after:after[key]}));
};

export function ManagementAuditWorkspace({initialEvents,initialSummary,initialPagination,permissions,branches,operators}:Props){
  const today=useMemo(()=>new Date(),[]);
  const startDefault=useMemo(()=>{const d=new Date();d.setDate(d.getDate()-30);return isoDate(d);},[]);
  const [events,setEvents]=useState(initialEvents);
  const [summary,setSummary]=useState(initialSummary);
  const [pagination,setPagination]=useState(initialPagination);
  const [page,setPage]=useState(1);
  const [cursors,setCursors]=useState<Cursor[]>([null]);
  const [filters,setFilters]=useState({start:startDefault,end:isoDate(today),branchId:'',operatorId:'',eventType:'',risk:'',search:''});
  const [error,setError]=useState('');
  const [selected,setSelected]=useState<Row|null>(null);
  const [pending,startTransition]=useTransition();

  const update=(name:string,value:string)=>setFilters(current=>({...current,[name]:value}));
  const load=(nextFilters:typeof filters,cursor:Cursor,nextPage:number,resetHistory=false)=>{
    setError('');
    startTransition(async()=>{
      const result=await erpManagementAudit({...nextFilters,cursorAt:cursor?.at,cursorId:cursor?.id,pageSize:10});
      if(!result.ok){setError(result.error==='audit_forbidden'?'Seu perfil não possui permissão para visualizar a auditoria.':result.error||'Não foi possível consultar a auditoria.');return;}
      setEvents(result.data);setSummary(result.summary);setPagination(result.pagination);setPage(nextPage);
      if(resetHistory)setCursors([null]);
    });
  };
  const submit=(event?:FormEvent)=>{event?.preventDefault();load(filters,null,1,true);};
  const clear=()=>{
    const next={start:startDefault,end:isoDate(today),branchId:'',operatorId:'',eventType:'',risk:'',search:''};
    setFilters(next);load(next,null,1,true);
  };
  const nextPage=()=>{
    const cursor={at:str(pagination.next_cursor_at),id:str(pagination.next_cursor_id)};
    if(!cursor.at||!cursor.id)return;
    setCursors(current=>[...current.slice(0,page),cursor]);load(filters,cursor,page+1);
  };
  const previousPage=()=>{if(page<=1)return;const cursor=cursors[page-2]||null;load(filters,cursor,page-1);};

  return <div className="audit-workspace">
    <section className="audit-summary">
      <article><span>Eventos no período</span><b>{Number(summary.total_events||0)}</b><small>operações rastreadas</small></article>
      <article className="critical"><span>Eventos críticos</span><b>{Number(summary.critical_events||0)}</b><small>cancelamentos, estornos e reaberturas</small></article>
      <article><span>Autorizações</span><b>{Number(summary.authorizations||0)}</b><small>aprovações gerenciais</small></article>
      <article><span>Impacto monitorado</span><b>{money(summary.financial_impact)}</b><small>valor absoluto das ocorrências</small></article>
    </section>

    <form className="audit-filters" onSubmit={submit}>
      <label><span>Data inicial</span><input type="date" value={filters.start} onChange={e=>update('start',e.target.value)}/></label>
      <label><span>Data final</span><input type="date" value={filters.end} onChange={e=>update('end',e.target.value)}/></label>
      <label><span>Loja</span><select value={filters.branchId} onChange={e=>update('branchId',e.target.value)}><option value="">Todas as lojas</option>{branches.map(row=><option key={str(row.id)} value={str(row.id)}>{str(row.name)}</option>)}</select></label>
      <label><span>Operador</span><select value={filters.operatorId} onChange={e=>update('operatorId',e.target.value)}><option value="">Todos os operadores</option>{operators.map(row=><option key={str(row.id)} value={str(row.id)}>{str(row.name)}</option>)}</select></label>
      <label><span>Tipo de evento</span><select value={filters.eventType} onChange={e=>update('eventType',e.target.value)}><option value="">Todos os eventos</option>{Object.entries(labels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
      <label><span>Risco</span><select value={filters.risk} onChange={e=>update('risk',e.target.value)}><option value="">Todos os riscos</option><option value="critical">Crítico</option><option value="attention">Atenção</option><option value="info">Informativo</option></select></label>
      <label className="audit-search"><span>Pesquisa</span><input value={filters.search} onChange={e=>update('search',e.target.value)} placeholder="Nome, venda, responsável ou motivo"/></label>
      <button type="submit" disabled={pending}>{pending?'Consultando…':'Aplicar filtros'}</button>
      <button type="button" className="secondary" onClick={clear} disabled={pending}>Limpar</button>
    </form>

    {error?<div className="audit-error">{error}</div>:null}
    <section className="audit-list">
      <header><div><b>Linha do tempo gerencial</b><span>Quem fez, o que fez, em qual cadastro e quais dados foram modificados.</span></div><strong>Página {page} • {events.length} de {Number(summary.total_operations||summary.total_events||0)} operação(ões)</strong></header>
      {events.length?<div className="audit-table-wrap"><table>
        <thead><tr><th>Data e hora</th><th>Ação</th><th>Registro afetado</th><th>Responsável</th><th>Motivo e alterações</th><th className="right">Impacto</th><th>Detalhes</th></tr></thead>
        <tbody>{events.map(row=>{
          const fields=auditFields(row);
          const operation=str(row.event_type);
          return <tr key={str(row.id)}>
            <td><b>{dateTime(row.occurred_at)}</b><small>{str(row.branch_name)||'Sem loja informada'}{row.device_name?` • ${str(row.device_name)}`:''}</small></td>
            <td><span className={`audit-badge ${str(row.risk_level||row.severity)}`}>{labels[operation]||str(row.title)}</span><small>{str(row.title)}{Number(row.event_count||1)>1?` • ${Number(row.event_count)} eventos relacionados`:''}</small></td>
            <td><b className="audit-entity-name">{str(row.entity_name)||(row.sale_number?`Venda #${str(row.sale_number)}`:'Registro sem nome')}</b><small>{str(row.entity_label)||str(row.entity_type)}{row.entity_id?` • ID ${str(row.entity_id).slice(0,8)}`:''}</small></td>
            <td><b>{str(row.responsible_name)||str(row.operator_name)||'Sistema'}</b><small>{row.responsible_email&&str(row.responsible_email)!==str(row.responsible_name)?str(row.responsible_email):row.supervisor_name?`Autorizado por ${str(row.supervisor_name)}`:'Identidade confirmada'}</small></td>
            <td className="audit-reason"><span>{friendlyReason(row)}</span>
              {fields.length?<details className="audit-details"><summary>Ver detalhes ({fields.length} campo{fields.length===1?'':'s'})</summary>
                <div className="audit-change-list">{fields.map(field=><div className="audit-change" key={field.key}>
                  <b>{field.label}</b>
                  {operation==='record_created'?<span>{formatValue(field.after)}</span>:operation==='record_deleted'?<span>{formatValue(field.before)}</span>:<span><del>{formatValue(field.before)}</del><i>→</i><ins>{formatValue(field.after)}</ins></span>}
                </div>)}</div>
              </details>:null}
            </td>
            <td className="right"><b className={Number(row.amount_delta||0)<0?'negative':''}>{row.amount_delta==null?'—':money(row.amount_delta)}</b><small>{row.amount_before!=null&&row.amount_after!=null?`${money(row.amount_before)} → ${money(row.amount_after)}`:''}</small></td>
            <td>{permissions.details!==false?<button type="button" className="audit-view-button" onClick={()=>setSelected(row)}>Visualizar</button>:<small>Detalhes restritos</small>}</td>
          </tr>;
        })}</tbody>
      </table></div>:<div className="audit-empty"><b>Nenhum evento encontrado</b><span>Ajuste os filtros ou aguarde novas operações auditáveis.</span></div>}
    </section>
    <nav className="audit-pagination" aria-label="Paginação da auditoria">
      <button type="button" onClick={previousPage} disabled={pending||page<=1}>← Anterior</button>
      <span>Página <b>{page}</b> • 10 registros por página</span>
      <button type="button" onClick={nextPage} disabled={pending||!Boolean(pagination.has_more)}>Próxima →</button>
    </nav>
    {selected?<div className="audit-modal-backdrop" role="presentation" onMouseDown={()=>setSelected(null)}>
      <section className="audit-modal" role="dialog" aria-modal="true" aria-labelledby="audit-modal-title" onMouseDown={event=>event.stopPropagation()}>
        <header>
          <div><span>Auditoria completa</span><h2 id="audit-modal-title">{str(selected.entity_name)||str(selected.title)||'Detalhes da operação'}</h2><p>{str(selected.entity_label)||str(selected.entity_type)} • {labels[str(selected.event_type)]||str(selected.title)}</p></div>
          <button type="button" className="audit-modal-close" aria-label="Fechar detalhes" onClick={()=>setSelected(null)}>×</button>
        </header>
        <div className="audit-modal-facts">
          <article><span>Data e hora</span><b>{dateTime(selected.occurred_at)}</b></article>
          <article><span>Responsável</span><b>{str(selected.responsible_name)||str(selected.operator_name)||'Sistema'}</b><small>{str(selected.responsible_email)}</small></article>
          <article><span>Loja / terminal</span><b>{str(selected.branch_name)||'Sem loja informada'}</b><small>{str(selected.device_name)}</small></article>
          <article><span>Registro</span><b>{str(selected.entity_name)||'Sem nome disponível'}</b><small>ID {str(selected.entity_id)||'não informado'}</small></article>
        </div>
        <section className="audit-modal-reason"><span>O que foi feito</span><p>{friendlyReason(selected)}</p></section>
        <section className="audit-modal-changes">
          <div className="audit-modal-section-title"><span>Dados envolvidos na operação</span><strong>{auditFields(selected).length} campo(s)</strong></div>
          {auditFields(selected).length?<div className="audit-modal-change-list">{auditFields(selected).map(field=><div className="audit-modal-change" key={field.key}>
            <b>{field.label}</b>
            <div><span><small>Antes</small>{formatValue(field.before)}</span><i>→</i><span><small>Depois</small>{formatValue(field.after)}</span></div>
          </div>)}</div>:<p className="audit-modal-empty">Este evento não possui comparação de campos.</p>}
        </section>
        {Array.isArray(selected.related_events)&&selected.related_events.length>1?<section className="audit-related-events">
          <div className="audit-modal-section-title"><span>Eventos da mesma operação</span><strong>{selected.related_events.length} eventos</strong></div>
          <ol>{selected.related_events.map((item,index)=>{const related=record(item);return <li key={str(related.id)||index}><b>{labels[str(related.event_type)]||str(related.title)}</b><span>{str(related.entity_label)}{related.entity_name?` • ${str(related.entity_name)}`:''}</span><small>{dateTime(related.occurred_at)}</small></li>;})}</ol>
        </section>:null}
        {permissions.technical!==false?<details className="audit-technical">
          <summary>Informações técnicas e rastreabilidade</summary>
          <dl>
            <div><dt>ID do evento</dt><dd>{str(selected.id)}</dd></div>
            <div><dt>Tipo da ação</dt><dd>{str(selected.event_type)}</dd></div>
            <div><dt>Origem</dt><dd>{str(record(selected.metadata).source_type)||'ThorGestão'}</dd></div>
            <div><dt>Tabela de origem</dt><dd>{str(selected.source_entity_type)||str(record(selected.metadata).source_table)||str(selected.entity_type)}</dd></div>
            <div><dt>ID da venda</dt><dd>{str(selected.sale_id)||'Não vinculado'}</dd></div>
            <div><dt>ID do operador</dt><dd>{str(selected.operator_user_id)||str(record(selected.metadata).actor_id)||'Não informado'}</dd></div>
          </dl>
        </details>:null}
        <footer><span>Dados sensíveis permanecem protegidos na auditoria.</span><button type="button" onClick={()=>setSelected(null)}>Fechar</button></footer>
      </section>
    </div>:null}
  </div>;
}
