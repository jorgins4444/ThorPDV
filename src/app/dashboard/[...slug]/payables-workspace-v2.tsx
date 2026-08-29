'use client';

import { FormEvent, useMemo, useState } from 'react';
import { payableClassify, payableCreate, payableSettle, payablesFinancialContext, payablesList } from './payables-actions';
import { financialStructureGet } from './financial-structure-actions';

type Row=Record<string,unknown>;
type PayableRow=Row&{remaining:number;operational_status:string};
type Modal='new'|'settle'|'classify'|null;
const text=(v:unknown)=>v==null?'':String(v);
const num=(v:unknown)=>Number(v??0)||0;
const money=(v:unknown)=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(num(v));
const date=(v:unknown)=>v?new Date(`${text(v).slice(0,10)}T12:00:00`).toLocaleDateString('pt-BR'):'—';
const today=()=>new Date().toISOString().slice(0,10);
const statusLabel:Record<string,string>={open:'Em aberto',partial:'Parcial',paid:'Pago',overdue:'Vencido',cancelled:'Cancelado'};

export function PayablesWorkspaceV2({initial,suppliers,accounts,paymentMethods,categories,chartAccounts,costCenters,currentBranchId}:{initial:Row[];suppliers:Row[];accounts:Row[];paymentMethods:Row[];categories:Row[];chartAccounts:Row[];costCenters:Row[];currentBranchId:string}){
  const [rows,setRows]=useState(initial);
  const [financialAccounts,setFinancialAccounts]=useState(accounts);
  const [methods,setMethods]=useState(paymentMethods);
  const [financialCategories,setFinancialCategories]=useState(categories);
  const [managerialAccounts,setManagerialAccounts]=useState(chartAccounts);
  const [centers,setCenters]=useState(costCenters);
  const [modal,setModal]=useState<Modal>(null);
  const [selected,setSelected]=useState<Row|null>(null);
  const [query,setQuery]=useState('');
  const [status,setStatus]=useState('open');
  const [supplierId,setSupplierId]=useState('');
  const [categoryId,setCategoryId]=useState('');
  const [message,setMessage]=useState('');
  const [saving,setSaving]=useState(false);
  const [settlementAccount,setSettlementAccount]=useState('');
  const [settlementMethod,setSettlementMethod]=useState('');

  const activeAccounts=useMemo(()=>financialAccounts.filter(a=>a.active!==false),[financialAccounts]);
  const allowedMethods=useMemo(()=>methods.filter(m=>!['term_sale','store_credit','store_credit_voucher'].includes(text(m.code))),[methods]);
  const payableCategories=useMemo(()=>financialCategories.filter(c=>c.active!==false&&['payable','both'].includes(text(c.entry_type))),[financialCategories]);
  const postingAccounts=useMemo(()=>managerialAccounts.filter(a=>a.active!==false&&a.posting!==false&&['liability','cost','expense'].includes(text(a.account_type))),[managerialAccounts]);
  const activeCenters=useMemo(()=>centers.filter(c=>c.active!==false).slice().sort((a,b)=>{
    const rank=(c:Row)=>text(c.branch_id)===currentBranchId?0:!text(c.branch_id)?1:2;
    return rank(a)-rank(b)||text(a.name).localeCompare(text(b.name),'pt-BR');
  }),[centers,currentBranchId]);
  const defaultCategory=payableCategories.find(c=>text(c.code)==='ADMIN_GENERAL')??payableCategories[0];
  const defaultAccount=postingAccounts.find(a=>text(a.id)===text(defaultCategory?.default_chart_account_id))??postingAccounts[0];
  const defaultCenter=activeCenters.find(c=>text(c.branch_id)===currentBranchId&&c.is_default===true)
    ??activeCenters.find(c=>text(c.branch_id)===currentBranchId)
    ??activeCenters.find(c=>!text(c.branch_id)&&c.is_default===true)
    ??activeCenters[0];

  const enriched=useMemo<PayableRow[]>(()=>rows.map(r=>{
    const remaining=Math.max(num(r.amount)-num(r.paid_amount),0);
    const overdue=remaining>0.009&&text(r.status)!=='cancelled'&&Boolean(text(r.due_date))&&text(r.due_date)<today();
    return {...r,remaining,operational_status:overdue?'overdue':text(r.status)} as PayableRow;
  }),[rows]);

  const filtered=useMemo(()=>enriched.filter(r=>{
    const q=query.trim().toLowerCase();
    const matchQuery=!q||[r.description,r.supplier,r.due_date,r.category,r.account,r.cost_center].some(v=>text(v).toLowerCase().includes(q));
    const matchSupplier=!supplierId||text(r.supplier_id)===supplierId;
    const matchCategory=!categoryId||text(r.financial_category_id)===categoryId;
    const op=text(r.operational_status);
    const matchStatus=!status||(status==='open'?['open','partial','overdue'].includes(op):op===status);
    return matchQuery&&matchSupplier&&matchCategory&&matchStatus;
  }),[enriched,query,supplierId,categoryId,status]);

  const summary=useMemo(()=>{
    const live=enriched.filter(r=>text(r.status)!=='cancelled');
    return {
      open:live.filter(r=>['open','partial','overdue'].includes(text(r.operational_status))).reduce((s,r)=>s+num(r.remaining),0),
      overdue:live.filter(r=>text(r.operational_status)==='overdue').reduce((s,r)=>s+num(r.remaining),0),
      paid:live.filter(r=>text(r.status)==='paid').reduce((s,r)=>s+num(r.paid_amount),0),
      count:live.filter(r=>['open','partial','overdue'].includes(text(r.operational_status))).length,
    };
  },[enriched]);

  async function refresh(){
    const [list,context,structure]=await Promise.all([payablesList(),payablesFinancialContext(),financialStructureGet()]);
    if(list.ok)setRows(list.data);
    if(context.ok){setFinancialAccounts(context.accounts);setMethods(context.payment_methods);}
    if(structure.ok){setFinancialCategories(structure.categories);setManagerialAccounts(structure.accounts);setCenters(structure.cost_centers);}
  }

  function syncAccountFromCategory(select:HTMLSelectElement){
    const category=payableCategories.find(c=>text(c.id)===select.value);
    const account=select.form?.elements.namedItem('chart_account_id') as HTMLSelectElement|null;
    if(account&&category?.default_chart_account_id)account.value=text(category.default_chart_account_id);
  }

  function openNew(){setMessage('');setSelected(null);setModal('new');}
  function openClassify(row:Row){setMessage('');setSelected(row);setModal('classify');}
  function openSettle(row:Row){
    setMessage('');setSelected(row);setModal('settle');
    const bank=activeAccounts.find(a=>text(a.account_type)==='bank')??activeAccounts[0];
    setSettlementAccount(text(bank?.id));
    const preferred=allowedMethods.find(m=>text(m.code)==='pix')??allowedMethods[0];
    setSettlementMethod(text(preferred?.code));
  }

  async function createSubmit(e:FormEvent<HTMLFormElement>){
    e.preventDefault();setSaving(true);setMessage('');
    const fd=new FormData(e.currentTarget);
    const r=await payableCreate({
      description:text(fd.get('description')),
      supplier_id:text(fd.get('supplier_id'))||null,
      amount:Number(fd.get('amount')??0),
      due_date:text(fd.get('due_date')),
      financial_category_id:text(fd.get('financial_category_id')),
      chart_account_id:text(fd.get('chart_account_id')),
      cost_center_id:text(fd.get('cost_center_id'))||null,
    });
    setSaving(false);
    if(!r.ok){setMessage(`Não foi possível lançar a conta: ${text(r.error||'erro')}`);return;}
    await refresh();setModal(null);setMessage('Conta a pagar lançada com Plano de Contas e Centro de Custo alinhados ao cadastro atual.');
  }

  async function classifySubmit(e:FormEvent<HTMLFormElement>){
    e.preventDefault();if(!selected)return;setSaving(true);setMessage('');
    const fd=new FormData(e.currentTarget);
    const r=await payableClassify(text(selected.id),{
      financial_category_id:text(fd.get('financial_category_id')),
      chart_account_id:text(fd.get('chart_account_id')),
      cost_center_id:text(fd.get('cost_center_id'))||null,
    });
    setSaving(false);
    if(!r.ok){setMessage(`Não foi possível reclassificar: ${text(r.error||'erro')}`);return;}
    await refresh();setModal(null);setSelected(null);setMessage('Plano de Contas, categoria e centro de custo atualizados.');
  }

  async function settleSubmit(e:FormEvent<HTMLFormElement>){
    e.preventDefault();if(!selected)return;
    const fd=new FormData(e.currentTarget);
    const account=activeAccounts.find(a=>text(a.id)===text(fd.get('bank_account_id')));
    const method=text(fd.get('payment_method'));
    if(text(account?.account_type)==='internal_cash'&&method!=='cash'){
      setMessage('O Caixa Interno aceita pagamento em Dinheiro. Para PIX/cartão/transferência escolha uma conta bancária.');return;
    }
    setSaving(true);setMessage('');
    const r=await payableSettle(text(selected.id),{
      amount:Number(fd.get('amount')??0),payment_method:method,destination_type:'bank_account',bank_account_id:text(fd.get('bank_account_id')),settled_at:text(fd.get('settled_at')),notes:text(fd.get('notes')),
    });
    setSaving(false);
    if(!r.ok){setMessage(`Não foi possível registrar o pagamento: ${text(r.error||'erro')}`);return;}
    await refresh();setModal(null);setSelected(null);setMessage(`Pagamento registrado. Saldo restante: ${money(r.remaining)}.`);
  }

  const remaining=selected?Math.max(num(selected.amount)-num(selected.paid_amount),0):0;
  const selectedCategory=selected?payableCategories.find(c=>text(c.id)===text(selected.financial_category_id)):undefined;
  const selectedAccount=selected?postingAccounts.find(a=>text(a.id)===text(selected.chart_account_id)):undefined;

  return <div className="payables-v2">
    <section className="payables-hero">
      <article><span>Saldo a pagar</span><strong>{money(summary.open)}</strong><small>{summary.count} título(s) em aberto</small></article>
      <article className="danger"><span>Vencido</span><strong>{money(summary.overdue)}</strong><small>prioridade de pagamento</small></article>
      <article><span>Total já pago</span><strong>{money(summary.paid)}</strong><small>títulos carregados na consulta</small></article>
      <article><span>Plano de Contas</span><strong>{postingAccounts.length}</strong><small>contas analíticas disponíveis</small></article>
    </section>

    <section className="payables-card">
      <header className="payables-header"><div><small>FINANCEIRO / CONTAS A PAGAR</small><h2>Obrigações e pagamentos</h2><p>Categoria financeira, conta analítica do Plano de Contas e Centro de Custo usam o cadastro financeiro atual do ThorGestão.</p></div><div className="payables-actions"><button className="secondary" onClick={()=>void refresh()}>↻ Atualizar</button><button className="primary" onClick={openNew}>＋ Nova conta a pagar</button></div></header>
      {message&&<div className="payables-message">{message}<button onClick={()=>setMessage('')}>×</button></div>}
      <div className="payables-filters classified">
        <label className="search">Pesquisar<input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Descrição, fornecedor ou classificação..."/></label>
        <label>Situação<select value={status} onChange={e=>setStatus(e.target.value)}><option value="open">Pendentes</option><option value="overdue">Vencidas</option><option value="partial">Parciais</option><option value="paid">Pagas</option><option value="cancelled">Canceladas</option><option value="">Todas</option></select></label>
        <label>Fornecedor<select value={supplierId} onChange={e=>setSupplierId(e.target.value)}><option value="">Todos</option>{suppliers.filter(s=>s.active!==false).map(s=><option key={text(s.id)} value={text(s.id)}>{text(s.name)}</option>)}</select></label>
        <label>Categoria<select value={categoryId} onChange={e=>setCategoryId(e.target.value)}><option value="">Todas</option>{payableCategories.map(c=><option key={text(c.id)} value={text(c.id)}>{text(c.name)}</option>)}</select></label>
        <button onClick={()=>{setQuery('');setStatus('open');setSupplierId('');setCategoryId('')}}>Limpar</button>
      </div>
      <div className="payables-table-wrap"><table className="classified"><thead><tr><th>Vencimento</th><th>Fornecedor</th><th>Descrição</th><th>Categoria / Plano de Contas</th><th>Centro de custo</th><th>Valor</th><th>Saldo</th><th>Situação</th><th></th></tr></thead><tbody>
        {filtered.length===0?<tr><td colSpan={9} className="empty">Nenhuma conta encontrada.</td></tr>:filtered.map((r,i)=>{
          const op=text(r.operational_status);const canPay=['open','partial','overdue'].includes(op)&&num(r.remaining)>0.009;
          return <tr key={text(r.id)||String(i)} className={op==='overdue'?'overdue':''}><td><b>{date(r.due_date)}</b></td><td>{text(r.supplier)||'Sem fornecedor'}</td><td>{text(r.description)||'—'}</td><td><b>{text(r.category)||'Sem categoria'}</b><small>{text(r.account_code)} {text(r.account)}</small></td><td>{text(r.cost_center)||'Sem centro'}</td><td>{money(r.amount)}</td><td><strong>{money(r.remaining)}</strong></td><td><span className={`payables-status ${op}`}>{statusLabel[op]||op}</span></td><td><div className="row-actions"><button className="classify" onClick={()=>openClassify(r)}>Classificar</button>{canPay&&<button className="pay" onClick={()=>openSettle(r)}>Pagar</button>}</div></td></tr>;
        })}
      </tbody></table></div>
      <footer><span>{filtered.length} registro(s) exibido(s)</span><span>Plano de Contas e Centro de Custo refletem os cadastros financeiros atuais</span></footer>
    </section>

    {modal==='new'&&<div className="payables-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setModal(null)}}><section className="payables-modal"><header><div><small>NOVO LANÇAMENTO</small><h2>Conta a pagar classificada</h2><p>Selecione explicitamente Categoria, Plano de Contas e Centro de Custo cadastrados.</p></div><button onClick={()=>setModal(null)}>×</button></header><form onSubmit={createSubmit}><label className="wide">Descrição<input required name="description" placeholder="Ex.: Energia elétrica - Agosto"/></label><label className="wide">Fornecedor<select name="supplier_id"><option value="">Sem fornecedor / despesa interna</option>{suppliers.filter(s=>s.active!==false).map(s=><option key={text(s.id)} value={text(s.id)}>{text(s.name)}</option>)}</select></label><label>Valor<input required name="amount" type="number" min="0.01" step="0.01"/></label><label>Vencimento<input required name="due_date" type="date" defaultValue={today()}/></label><label className="wide">Categoria financeira<select required name="financial_category_id" defaultValue={text(defaultCategory?.id)} onChange={e=>syncAccountFromCategory(e.currentTarget)}><option value="">Selecione...</option>{payableCategories.map(c=><option key={text(c.id)} value={text(c.id)}>{text(c.code)} · {text(c.name)}</option>)}</select></label><label className="wide">Plano de Contas<select required name="chart_account_id" defaultValue={text(defaultAccount?.id)}><option value="">Selecione a conta analítica...</option>{postingAccounts.map(a=><option key={text(a.id)} value={text(a.id)}>{text(a.code)} · {text(a.name)}</option>)}</select></label><label className="wide">Centro de custo<select name="cost_center_id" defaultValue={text(defaultCenter?.id)}><option value="">Automático pela filial</option>{activeCenters.map(c=><option key={text(c.id)} value={text(c.id)}>{text(c.code)} · {text(c.name)}{text(c.branch)?` · ${text(c.branch)}`:' · Corporativo'}</option>)}</select></label><div className="modal-actions"><button type="button" onClick={()=>setModal(null)}>Cancelar</button><button className="primary" disabled={saving}>{saving?'Salvando...':'Lançar conta'}</button></div></form></section></div>}

    {modal==='classify'&&selected&&<div className="payables-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setModal(null)}}><section className="payables-modal"><header><div><small>CLASSIFICAÇÃO GERENCIAL</small><h2>{text(selected.description)}</h2><p>Atual: {text(selectedCategory?.name)||'Sem categoria'} · {text(selectedAccount?.code)} {text(selectedAccount?.name)}</p></div><button onClick={()=>setModal(null)}>×</button></header><form onSubmit={classifySubmit}><label className="wide">Categoria financeira<select required name="financial_category_id" defaultValue={text(selected.financial_category_id)} onChange={e=>syncAccountFromCategory(e.currentTarget)}>{payableCategories.map(c=><option key={text(c.id)} value={text(c.id)}>{text(c.code)} · {text(c.name)}</option>)}</select></label><label className="wide">Plano de Contas<select required name="chart_account_id" defaultValue={text(selected.chart_account_id)||text(defaultAccount?.id)}>{postingAccounts.map(a=><option key={text(a.id)} value={text(a.id)}>{text(a.code)} · {text(a.name)}</option>)}</select></label><label className="wide">Centro de custo<select name="cost_center_id" defaultValue={text(selected.cost_center_id)||text(defaultCenter?.id)}><option value="">Automático pela filial</option>{activeCenters.map(c=><option key={text(c.id)} value={text(c.id)}>{text(c.code)} · {text(c.name)}{text(c.branch)?` · ${text(c.branch)}`:' · Corporativo'}</option>)}</select></label><div className="modal-actions"><button type="button" onClick={()=>setModal(null)}>Cancelar</button><button className="primary" disabled={saving}>{saving?'Atualizando...':'Salvar classificação'}</button></div></form></section></div>}

    {modal==='settle'&&selected&&<div className="payables-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setModal(null)}}><section className="payables-modal settle"><header><div><small>BAIXA FINANCEIRA</small><h2>Registrar pagamento</h2><p>{text(selected.supplier)||'Sem fornecedor'} · {text(selected.category)} · vencimento {date(selected.due_date)}</p></div><button onClick={()=>setModal(null)}>×</button></header><div className="settle-summary"><span>Valor original <b>{money(selected.amount)}</b></span><span>Já pago <b>{money(selected.paid_amount)}</b></span><span>Saldo atual <strong>{money(remaining)}</strong></span></div><form onSubmit={settleSubmit}><label>Valor pago<input required name="amount" type="number" min="0.01" max={remaining} step="0.01" defaultValue={remaining.toFixed(2)}/></label><label>Data do pagamento<input required name="settled_at" type="datetime-local" defaultValue={`${today()}T12:00`}/></label><label className="wide">Conta de saída<select required name="bank_account_id" value={settlementAccount} onChange={e=>{setSettlementAccount(e.target.value);const a=activeAccounts.find(x=>text(x.id)===e.target.value);if(text(a?.account_type)==='internal_cash')setSettlementMethod('cash')}}><option value="">Selecione...</option>{activeAccounts.map(a=><option key={text(a.id)} value={text(a.id)}>{text(a.name)} · saldo {money(a.balance)}</option>)}</select></label><label className="wide">Forma de pagamento<select required name="payment_method" value={settlementMethod} onChange={e=>setSettlementMethod(e.target.value)}><option value="">Selecione...</option>{allowedMethods.map(m=><option key={text(m.code)} value={text(m.code)}>{text(m.name)}</option>)}</select></label><label className="wide">Observação<textarea name="notes" placeholder="Comprovante, referência bancária ou observação do pagamento"/></label><div className="modal-actions"><button type="button" onClick={()=>setModal(null)}>Cancelar</button><button className="primary" disabled={saving}>{saving?'Registrando...':'Confirmar pagamento'}</button></div></form></section></div>}
  </div>;
}
