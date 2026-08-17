'use client';

import { useMemo, useState, useTransition } from 'react';
import type { FormEvent } from 'react';
import { erpManagementAudit } from './actions';

type Row=Record<string,unknown>;
type Props={initialEvents:Row[];initialSummary:Record<string,unknown>;branches:Row[];operators:Row[]};

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

export function ManagementAuditWorkspace({initialEvents,initialSummary,branches,operators}:Props){
  const today=useMemo(()=>new Date(),[]);
  const startDefault=useMemo(()=>{const d=new Date();d.setDate(d.getDate()-30);return isoDate(d);},[]);
  const [events,setEvents]=useState(initialEvents);
  const [summary,setSummary]=useState(initialSummary);
  const [filters,setFilters]=useState({start:startDefault,end:isoDate(today),branchId:'',operatorId:'',eventType:'',search:''});
  const [error,setError]=useState('');
  const [pending,startTransition]=useTransition();

  const update=(name:string,value:string)=>setFilters(current=>({...current,[name]:value}));
  const submit=(event?:FormEvent)=>{
    event?.preventDefault();setError('');
    startTransition(async()=>{
      const result=await erpManagementAudit(filters);
      if(!result.ok){setError(result.error||'Não foi possível consultar a auditoria.');return;}
      setEvents(result.data);setSummary(result.summary);
    });
  };
  const clear=()=>{
    const next={start:startDefault,end:isoDate(today),branchId:'',operatorId:'',eventType:'',search:''};
    setFilters(next);setError('');
    startTransition(async()=>{const result=await erpManagementAudit(next);if(result.ok){setEvents(result.data);setSummary(result.summary);}});
  };

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
      <label className="audit-search"><span>Pesquisa</span><input value={filters.search} onChange={e=>update('search',e.target.value)} placeholder="Nome, venda, responsável ou motivo"/></label>
      <button type="submit" disabled={pending}>{pending?'Consultando…':'Aplicar filtros'}</button>
      <button type="button" className="secondary" onClick={clear} disabled={pending}>Limpar</button>
    </form>

    {error?<div className="audit-error">{error}</div>:null}
    <section className="audit-list">
      <header><div><b>Linha do tempo gerencial</b><span>Quem fez, o que fez, em qual cadastro e quais dados foram modificados.</span></div><strong>{events.length} resultado(s)</strong></header>
      {events.length?<div className="audit-table-wrap"><table>
        <thead><tr><th>Data e hora</th><th>Ação</th><th>Registro afetado</th><th>Responsável</th><th>Motivo e alterações</th><th className="right">Impacto</th></tr></thead>
        <tbody>{events.map(row=>{
          const fields=auditFields(row);
          const operation=str(row.event_type);
          return <tr key={str(row.id)}>
            <td><b>{dateTime(row.occurred_at)}</b><small>{str(row.branch_name)||'Sem loja informada'}{row.device_name?` • ${str(row.device_name)}`:''}</small></td>
            <td><span className={`audit-badge ${str(row.severity)}`}>{labels[operation]||str(row.title)}</span><small>{str(row.title)}</small></td>
            <td><b className="audit-entity-name">{str(row.entity_name)||(row.sale_number?`Venda #${str(row.sale_number)}`:'Registro sem nome')}</b><small>{str(row.entity_label)||str(row.entity_type)}{row.entity_id?` • ID ${str(row.entity_id).slice(0,8)}`:''}</small></td>
            <td><b>{str(row.responsible_name)||str(row.operator_name)||'Sistema'}</b><small>{row.responsible_email&&str(row.responsible_email)!==str(row.responsible_name)?str(row.responsible_email):row.supervisor_name?`Autorizado por ${str(row.supervisor_name)}`:'Identidade confirmada'}</small></td>
            <td className="audit-reason"><span>{str(row.reason)||'Registro automático'}</span>
              {fields.length?<details className="audit-details"><summary>Ver detalhes ({fields.length} campo{fields.length===1?'':'s'})</summary>
                <div className="audit-change-list">{fields.map(field=><div className="audit-change" key={field.key}>
                  <b>{field.label}</b>
                  {operation==='record_created'?<span>{formatValue(field.after)}</span>:operation==='record_deleted'?<span>{formatValue(field.before)}</span>:<span><del>{formatValue(field.before)}</del><i>→</i><ins>{formatValue(field.after)}</ins></span>}
                </div>)}</div>
              </details>:null}
            </td>
            <td className="right"><b className={Number(row.amount_delta||0)<0?'negative':''}>{row.amount_delta==null?'—':money(row.amount_delta)}</b><small>{row.amount_before!=null&&row.amount_after!=null?`${money(row.amount_before)} → ${money(row.amount_after)}`:''}</small></td>
          </tr>;
        })}</tbody>
      </table></div>:<div className="audit-empty"><b>Nenhum evento encontrado</b><span>Ajuste os filtros ou aguarde novas operações auditáveis.</span></div>}
    </section>
  </div>;
}
