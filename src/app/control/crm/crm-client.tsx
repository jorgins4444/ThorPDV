'use client';

import Link from 'next/link';
import { useMemo, useState, useTransition } from 'react';
import { crmDashboard, updateCrmLead } from './actions';

type Row = Record<string, unknown>;
const text = (v: unknown) => v == null ? '' : String(v);
const num = (v: unknown) => Number(v || 0);
const labels: Record<string,string> = { new:'Novo', contacted:'Contatado', proposal:'Proposta', won:'Convertido', lost:'Perdido' };
const planLabels: Record<string,string> = { basic:'Básico · R$ 99,90', intermediate:'Intermediário · R$ 149,90', advanced:'Avançado · R$ 199,90' };

export function CrmClient({ initial }: { initial: Record<string,unknown> }) {
  const normalize = (r: Record<string,unknown>) => ({ leads: Array.isArray(r.leads) ? r.leads as Row[] : [], summary: (r.summary || {}) as Row });
  const [data,setData] = useState(normalize(initial));
  const [query,setQuery] = useState('');
  const [filter,setFilter] = useState('');
  const [selected,setSelected] = useState<Row|null>(null);
  const [message,setMessage] = useState('');
  const [pending,startTransition] = useTransition();
  const leads = useMemo(() => data.leads.filter(l => (!filter || text(l.status)===filter) && `${text(l.company_name)} ${text(l.cnpj)} ${text(l.owner_name)} ${text(l.phone)} ${text(l.email)} ${text(l.business_niche)}`.toLowerCase().includes(query.toLowerCase())), [data.leads,query,filter]);

  async function refresh(){const r=await crmDashboard();if(r.ok)setData(normalize(r))}
  function save(form: FormData){if(!selected)return;startTransition(async()=>{const r=await updateCrmLead(text(selected.id),text(form.get('status')),text(form.get('notes')));if(!r.ok){setMessage(r.error||'Falha ao atualizar.');return}setSelected(null);setMessage('Atendimento atualizado.');await refresh()})}

  return <main className="crm-shell">
    <aside><div className="crm-brand">ϟ <span>THOR CONTROL</span></div><Link href="/control">← Voltar ao painel</Link><nav><b>CRM Comercial</b><span>Leads da página pública</span></nav></aside>
    <section className="crm-main">
      <header><div><small>THORCONTROL · CRM</small><h1>Possíveis clientes</h1><p>Acompanhe cada empresa desde o primeiro interesse até a conversão.</p></div><Link className="crm-site-link" href="/" target="_blank">Ver página pública ↗</Link></header>
      {message && <div className="crm-message">{message}</div>}
      <div className="crm-kpis"><article><span>Total</span><strong>{num(data.summary.total)}</strong></article><article><span>Novos</span><strong>{num(data.summary.new)}</strong></article><article><span>Contatados</span><strong>{num(data.summary.contacted)}</strong></article><article><span>Propostas</span><strong>{num(data.summary.proposal)}</strong></article><article><span>Convertidos</span><strong>{num(data.summary.won)}</strong></article></div>
      <section className="crm-card">
        <div className="crm-toolbar"><input placeholder="Buscar empresa, CNPJ, responsável, telefone ou nicho..." value={query} onChange={e=>setQuery(e.target.value)}/><select value={filter} onChange={e=>setFilter(e.target.value)}><option value="">Todos os status</option>{Object.entries(labels).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></div>
        <div className="crm-table-wrap"><table><thead><tr><th>Recebido em</th><th>Empresa</th><th>Contato</th><th>Nicho / Plano</th><th>Status</th><th></th></tr></thead><tbody>{leads.length===0?<tr><td colSpan={6} className="crm-empty">Nenhum interessado encontrado.</td></tr>:leads.map(l=><tr key={text(l.id)}><td>{new Date(text(l.created_at)).toLocaleString('pt-BR')}</td><td><strong>{text(l.company_name)}</strong><small>{text(l.cnpj)}</small></td><td><strong>{text(l.owner_name)}</strong><small>{text(l.phone)} · {text(l.email)}</small></td><td><strong>{text(l.business_niche)}</strong><small>{planLabels[text(l.plan)]||text(l.plan)}</small></td><td><span className={`crm-status ${text(l.status)}`}>{labels[text(l.status)]||text(l.status)}</span></td><td><button onClick={()=>setSelected(l)}>Visualizar</button></td></tr>)}</tbody></table></div>
      </section>
    </section>
    {selected&&<div className="crm-modal-bg"><form className="crm-modal" action={save}><header><div><small>ATENDIMENTO COMERCIAL</small><h2>{text(selected.company_name)}</h2></div><button type="button" onClick={()=>setSelected(null)}>×</button></header><div className="crm-details"><div><span>CNPJ</span><strong>{text(selected.cnpj)}</strong></div><div><span>Proprietário</span><strong>{text(selected.owner_name)}</strong></div><div><span>Telefone</span><strong>{text(selected.phone)}</strong></div><div><span>E-mail</span><strong>{text(selected.email)}</strong></div><div><span>Nicho</span><strong>{text(selected.business_niche)}</strong></div><div><span>Plano desejado</span><strong>{planLabels[text(selected.plan)]}</strong></div></div><label>Status<select name="status" defaultValue={text(selected.status)}>{Object.entries(labels).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label><label>Anotações<textarea name="notes" rows={5} defaultValue={text(selected.notes)} placeholder="Registre contato, necessidades, proposta e próximos passos."/></label><footer><a href={`https://wa.me/55${text(selected.phone)}`} target="_blank" rel="noreferrer">Abrir WhatsApp</a><button type="button" onClick={()=>setSelected(null)}>Cancelar</button><button className="primary" disabled={pending}>Salvar atendimento</button></footer></form></div>}
  </main>;
}
