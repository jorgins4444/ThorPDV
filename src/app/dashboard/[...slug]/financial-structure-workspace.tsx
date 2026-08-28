'use client';

import Link from 'next/link';
import { FormEvent, useMemo, useState } from 'react';
import { financialStructureGet, financialStructureSave } from './financial-structure-actions';

type Row=Record<string,unknown>;
type Tab='accounts'|'categories'|'cost_centers';
type Modal={resource:'account'|'category'|'cost_center';row?:Row}|null;
const text=(v:unknown)=>v==null?'':String(v);
const yes=(v:unknown)=>v!==false&&v!=='false';
const typeLabel:Record<string,string>={asset:'Ativo',liability:'Passivo',equity:'Patrimônio Líquido',revenue:'Receita',cost:'Custo',expense:'Despesa'};

export function FinancialStructureWorkspace({activeTab,initialAccounts,initialCategories,initialCostCenters,branches}:{activeTab:Tab;initialAccounts:Row[];initialCategories:Row[];initialCostCenters:Row[];branches:Row[]}){
  const [accounts,setAccounts]=useState(initialAccounts);
  const [categories,setCategories]=useState(initialCategories);
  const [costCenters,setCostCenters]=useState(initialCostCenters);
  const [modal,setModal]=useState<Modal>(null);
  const [message,setMessage]=useState('');
  const [saving,setSaving]=useState(false);
  const postingAccounts=useMemo(()=>accounts.filter(a=>yes(a.active)&&yes(a.posting)),[accounts]);

  async function refresh(){
    const r=await financialStructureGet();
    if(r.ok){setAccounts(r.accounts);setCategories(r.categories);setCostCenters(r.cost_centers);}
  }

  async function submit(e:FormEvent<HTMLFormElement>){
    e.preventDefault();if(!modal)return;
    const fd=new FormData(e.currentTarget);
    const base={id:text(modal.row?.id)||undefined,code:text(fd.get('code')),name:text(fd.get('name')),active:fd.get('active')==='on'};
    let payload:Row=base;
    if(modal.resource==='account') payload={...base,parent_id:text(fd.get('parent_id'))||null,account_type:text(fd.get('account_type')),nature:text(fd.get('nature')),posting:fd.get('posting')==='on'};
    if(modal.resource==='category') payload={...base,entry_type:text(fd.get('entry_type')),default_chart_account_id:text(fd.get('default_chart_account_id'))||null};
    if(modal.resource==='cost_center') payload={...base,branch_id:text(fd.get('branch_id'))||null,description:text(fd.get('description')),is_default:fd.get('is_default')==='on'};
    setSaving(true);setMessage('');const r=await financialStructureSave(modal.resource,payload);setSaving(false);
    if(!r.ok){setMessage(`Não foi possível salvar: ${text(r.error||'erro')}`);return;}
    await refresh();setModal(null);setMessage('Estrutura financeira atualizada com sucesso.');
  }

  const currentTitle=activeTab==='accounts'?'Plano de Contas':activeTab==='categories'?'Categorias Financeiras':'Centros de Custo';
  const resource=activeTab==='accounts'?'account':activeTab==='categories'?'category':'cost_center';

  return <div className="financial-structure">
    <nav className="financial-tabs">
      <Link className={activeTab==='accounts'?'active':''} href="/dashboard/financeiro/plano-contas">Plano de Contas</Link>
      <Link className={activeTab==='categories'?'active':''} href="/dashboard/financeiro/categorias">Categorias Financeiras</Link>
      <Link className={activeTab==='cost_centers'?'active':''} href="/dashboard/financeiro/centros-custo">Centros de Custo</Link>
    </nav>
    <section className="financial-structure-card">
      <header><div><small>ESTRUTURA GERENCIAL</small><h2>{currentTitle}</h2><p>{activeTab==='accounts'?'Organize receitas, custos e despesas em contas hierárquicas usadas pela DRE gerencial.':activeTab==='categories'?'Padronize o motivo financeiro de cada entrada ou saída e associe-o a uma conta gerencial.':'Separe resultados e despesas por filial, departamento ou unidade de responsabilidade.'}</p></div><button className="primary" onClick={()=>setModal({resource})}>＋ Novo cadastro</button></header>
      {message&&<div className="financial-message">{message}<button onClick={()=>setMessage('')}>×</button></div>}

      {activeTab==='accounts'&&<div className="financial-table"><table><thead><tr><th>Código</th><th>Conta</th><th>Tipo</th><th>Natureza</th><th>Movimenta</th><th>Status</th><th></th></tr></thead><tbody>{accounts.map((r,i)=><tr key={text(r.id)||String(i)}><td><strong>{text(r.code)}</strong></td><td><span className={yes(r.posting)?'posting':'group'}>{text(r.name)}</span>{text(r.parent_name)&&<small>Grupo: {text(r.parent_code)} · {text(r.parent_name)}</small>}</td><td>{typeLabel[text(r.account_type)]||text(r.account_type)}</td><td>{text(r.nature)==='credit'?'Credora':'Devedora'}</td><td>{yes(r.posting)?'Sim':'Grupo'}</td><td><span className={`financial-pill ${yes(r.active)?'ok':'off'}`}>{yes(r.active)?'Ativa':'Inativa'}</span></td><td><button onClick={()=>setModal({resource:'account',row:r})}>Editar</button></td></tr>)}</tbody></table></div>}

      {activeTab==='categories'&&<div className="financial-table"><table><thead><tr><th>Código</th><th>Categoria</th><th>Aplicação</th><th>Conta padrão</th><th>Status</th><th></th></tr></thead><tbody>{categories.map((r,i)=><tr key={text(r.id)||String(i)}><td><strong>{text(r.code)}</strong></td><td>{text(r.name)}</td><td>{text(r.entry_type)==='payable'?'Saídas / Pagar':text(r.entry_type)==='receivable'?'Entradas / Receber':'Entradas e saídas'}</td><td>{text(r.account_code)} · {text(r.account_name)||'Sem conta'}</td><td><span className={`financial-pill ${yes(r.active)?'ok':'off'}`}>{yes(r.active)?'Ativa':'Inativa'}</span></td><td><button onClick={()=>setModal({resource:'category',row:r})}>Editar</button></td></tr>)}</tbody></table></div>}

      {activeTab==='cost_centers'&&<div className="financial-table"><table><thead><tr><th>Código</th><th>Centro de custo</th><th>Filial</th><th>Padrão</th><th>Status</th><th></th></tr></thead><tbody>{costCenters.map((r,i)=><tr key={text(r.id)||String(i)}><td><strong>{text(r.code)}</strong></td><td>{text(r.name)}{text(r.description)&&<small>{text(r.description)}</small>}</td><td>{text(r.branch)||'Corporativo'}</td><td>{yes(r.is_default)?'Sim':'Não'}</td><td><span className={`financial-pill ${yes(r.active)?'ok':'off'}`}>{yes(r.active)?'Ativo':'Inativo'}</span></td><td><button onClick={()=>setModal({resource:'cost_center',row:r})}>Editar</button></td></tr>)}</tbody></table></div>}
      <footer><span>{activeTab==='accounts'?accounts.length:activeTab==='categories'?categories.length:costCenters.length} cadastro(s)</span><span>A classificação alimenta Contas a Pagar, Compras e relatórios gerenciais.</span></footer>
    </section>

    {modal&&<div className="financial-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setModal(null)}}><section className="financial-modal"><header><div><small>{modal.row?'EDIÇÃO':'NOVO CADASTRO'}</small><h2>{modal.resource==='account'?'Conta gerencial':modal.resource==='category'?'Categoria financeira':'Centro de custo'}</h2></div><button onClick={()=>setModal(null)}>×</button></header><form onSubmit={submit}>
      <label>Código<input required name="code" defaultValue={text(modal.row?.code)} placeholder={modal.resource==='account'?'5.1.06':'EXEMPLO'}/></label>
      <label className="wide">Nome<input required name="name" defaultValue={text(modal.row?.name)}/></label>
      {modal.resource==='account'&&<><label className="wide">Conta superior<select name="parent_id" defaultValue={text(modal.row?.parent_id)}><option value="">Sem conta superior</option>{accounts.filter(a=>text(a.id)!==text(modal.row?.id)&&!yes(a.posting)).map(a=><option key={text(a.id)} value={text(a.id)}>{text(a.code)} · {text(a.name)}</option>)}</select></label><label>Tipo<select name="account_type" defaultValue={text(modal.row?.account_type)||'expense'}><option value="asset">Ativo</option><option value="liability">Passivo</option><option value="equity">Patrimônio Líquido</option><option value="revenue">Receita</option><option value="cost">Custo</option><option value="expense">Despesa</option></select></label><label>Natureza<select name="nature" defaultValue={text(modal.row?.nature)||'debit'}><option value="debit">Devedora</option><option value="credit">Credora</option></select></label><label className="check"><input type="checkbox" name="posting" defaultChecked={modal.row?yes(modal.row.posting):true}/> Conta de movimentação</label></>}
      {modal.resource==='category'&&<><label>Aplicação<select name="entry_type" defaultValue={text(modal.row?.entry_type)||'payable'}><option value="payable">Contas a pagar</option><option value="receivable">Contas a receber</option><option value="both">Ambos</option></select></label><label className="wide">Conta gerencial padrão<select required name="default_chart_account_id" defaultValue={text(modal.row?.default_chart_account_id)}><option value="">Selecione...</option>{postingAccounts.map(a=><option key={text(a.id)} value={text(a.id)}>{text(a.code)} · {text(a.name)}</option>)}</select></label></>}
      {modal.resource==='cost_center'&&<><label className="wide">Filial<select name="branch_id" defaultValue={text(modal.row?.branch_id)}><option value="">Corporativo / todas as filiais</option>{branches.map(b=><option key={text(b.id)} value={text(b.id)}>{text(b.name)}</option>)}</select></label><label className="wide">Descrição<textarea name="description" defaultValue={text(modal.row?.description)}/></label><label className="check"><input type="checkbox" name="is_default" defaultChecked={yes(modal.row?.is_default)}/> Centro padrão neste escopo</label></>}
      <label className="check"><input type="checkbox" name="active" defaultChecked={modal.row?yes(modal.row.active):true}/> Ativo</label>
      <div className="financial-modal-actions"><button type="button" onClick={()=>setModal(null)}>Cancelar</button><button className="primary" disabled={saving}>{saving?'Salvando...':'Salvar'}</button></div>
    </form></section></div>}
  </div>;
}
