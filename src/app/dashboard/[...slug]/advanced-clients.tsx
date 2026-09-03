'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import {
  erpCashClose,
  erpCashList,
  erpCashOpen,
  erpInventoryClose,
  erpInventoryCount,
  erpInventoryDetail,
  erpInventoryStart,
  erpPriceTableCopy,
  erpPriceTableDetail,
  erpPriceTableSetItem,
  erpReport,
  erpSave,
} from './actions';
import { ListPagination,useListPagination } from './list-pagination';

type Row = Record<string, unknown>;

const money = (value: unknown) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value ?? 0));
const datetime = (value: unknown) => value ? new Date(String(value)).toLocaleString('pt-BR') : '—';

function Message({ text }: { text: string }) {
  return text ? <p className="erp-message">{text}</p> : null;
}

export function StockTransferClient({ products, branches, history }: { products: Row[]; branches: Row[]; history: Row[] }) {
  const [productId, setProductId] = useState('');
  const [destination, setDestination] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [notes, setNotes] = useState('');
  const [rows] = useState(history.filter((r) => String(r.movement_type).startsWith('transfer_')));
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const pager=useListPagination(rows);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    const result = await erpSave('stock', {
      product_id: productId,
      destination_branch_id: destination,
      movement_type: 'transfer',
      quantity,
      notes,
    });
    setSaving(false);
    if (result.ok) {
      setMessage('Transferência concluída: saída na origem e entrada no destino foram registradas automaticamente.');
      setProductId(''); setDestination(''); setQuantity(1); setNotes('');
      location.reload();
    } else {
      setMessage(`Não foi possível transferir: ${String(result.error ?? 'erro desconhecido')}`);
    }
  }

  return <section className="erp-module-card">
    <div className="erp-advanced-head"><div><h2>Transferência entre filiais</h2><p>A operação gera <b>transfer_out</b> na origem e <b>transfer_in</b> no destino, atualizando os dois saldos.</p></div></div>
    <form className="erp-form-grid erp-advanced-form" onSubmit={submit}>
      <label>Produto<select required value={productId} onChange={(e)=>setProductId(e.target.value)}><option value="">Selecione...</option>{products.filter(p=>p.active!==false).map(p=><option key={String(p.id)} value={String(p.id)}>{String(p.name)} — saldo {String(p.stock ?? 0)}</option>)}</select></label>
      <label>Filial de destino<select required value={destination} onChange={(e)=>setDestination(e.target.value)}><option value="">Selecione...</option>{branches.map(b=><option key={String(b.id)} value={String(b.id)}>{String(b.name)} {b.city ? `— ${String(b.city)}/${String(b.state ?? '')}` : ''}</option>)}</select></label>
      <label>Quantidade<input required type="number" min="0.001" step="0.001" value={quantity} onChange={(e)=>setQuantity(Number(e.target.value))}/></label>
      <label>Observação<input value={notes} onChange={(e)=>setNotes(e.target.value)} placeholder="Motivo, documento ou responsável"/></label>
      <button className="erp-primary" disabled={saving}>{saving?'Transferindo...':'Confirmar transferência'}</button>
    </form>
    <Message text={message}/>
    <div className="erp-table-scroll"><table className="erp-data-table"><thead><tr><th>Data</th><th>Produto</th><th>Tipo</th><th>Quantidade</th><th>Filial</th><th>Observação</th></tr></thead><tbody>{rows.length===0?<tr><td className="erp-empty" colSpan={6}>Nenhuma transferência registrada.</td></tr>:pager.pageRows.map((r,i)=><tr key={String(r.id??`${pager.page}-${i}`)}><td>{datetime(r.created_at)}</td><td>{String(r.product??'')}</td><td><span className="erp-pill">{String(r.movement_type)}</span></td><td>{String(r.quantity??0)}</td><td>{String(r.branch??'')}</td><td>{String(r.notes??'—')}</td></tr>)}</tbody></table></div>
    <ListPagination page={pager.page} pageCount={pager.pageCount} total={pager.total} from={pager.from} to={pager.to} onPage={pager.setPage} label="transferência(s)"/>
  </section>;
}

export function PriceTablesClient({ tables, products, copyMode=false }: { tables: Row[]; products: Row[]; copyMode?: boolean }) {
  const [selected, setSelected] = useState(String(tables[0]?.id ?? ''));
  const [detail, setDetail] = useState<{table?:Row;items?:Row[]}>({});
  const [productId, setProductId] = useState('');
  const [price, setPrice] = useState(0);
  const [copyName, setCopyName] = useState('');
  const [message, setMessage] = useState('');
  const itemPager=useListPagination(detail.items??[]);

  async function load(tableId=selected) {
    if (!tableId) { setDetail({}); return; }
    const result = await erpPriceTableDetail(tableId);
    if (result.ok) setDetail({ table: result.table as Row, items: (result.items as Row[]) ?? [] });
    else setMessage(String(result.error??'Falha ao carregar tabela'));
  }
  useEffect(()=>{ itemPager.setPage(0); void load(selected); },[selected]);

  async function saveItem(e:FormEvent) {
    e.preventDefault();
    const result=await erpPriceTableSetItem(selected,productId,price);
    if(result.ok){setMessage('Preço do produto salvo na tabela.');setProductId('');setPrice(0);await load();} else setMessage(String(result.error??'Falha ao salvar preço'));
  }
  async function copy() {
    if(!selected)return;
    const result=await erpPriceTableCopy(selected,copyName);
    if(result.ok){setMessage('Tabela copiada com todos os itens. A nova cópia começa inativa para revisão.');setCopyName('');location.reload();} else setMessage(String(result.error??'Falha ao copiar'));
  }

  return <div className="erp-advanced-grid">
    <section className="erp-module-card erp-advanced-panel"><h2>{copyMode?'Copiar tabela de preços':'Itens da tabela de preços'}</h2><p>Selecione uma tabela para gerenciar seus preços específicos.</p><label>Tabela<select value={selected} onChange={e=>setSelected(e.target.value)}><option value="">Selecione...</option>{tables.map(t=><option key={String(t.id)} value={String(t.id)}>{String(t.name)} — {String(t.table_type)}</option>)}</select></label>
      {copyMode?<div className="erp-copy-box"><label>Nome da nova tabela<input value={copyName} onChange={e=>setCopyName(e.target.value)} placeholder="Ex.: Atacado - Setembro"/></label><button className="erp-primary" onClick={copy} disabled={!selected}>Copiar tabela + itens</button></div>:<form className="erp-price-item-form" onSubmit={saveItem}><label>Produto<select required value={productId} onChange={e=>{setProductId(e.target.value);const p=products.find(x=>String(x.id)===e.target.value);setPrice(Number(p?.sale_price??0));}}><option value="">Selecione...</option>{products.map(p=><option key={String(p.id)} value={String(p.id)}>{String(p.name)} — base {money(p.sale_price)}</option>)}</select></label><label>Preço nesta tabela<input required type="number" min="0" step="0.01" value={price} onChange={e=>setPrice(Number(e.target.value))}/></label><button className="erp-primary">Adicionar / atualizar preço</button></form>}
      <Message text={message}/>
    </section>
    <section className="erp-module-card"><div className="erp-table-scroll"><table className="erp-data-table"><thead><tr><th>Código</th><th>Produto</th><th>Preço base</th><th>Preço tabela</th><th>Diferença</th></tr></thead><tbody>{(detail.items??[]).length===0?<tr><td className="erp-empty" colSpan={5}>A tabela ainda não possui preços específicos.</td></tr>:itemPager.pageRows.map((r,i)=><tr key={String(r.product_id??`${itemPager.page}-${i}`)}><td>{String(r.sku??'—')}</td><td>{String(r.product??'')}</td><td>{money(r.base_price)}</td><td><strong>{money(r.price)}</strong></td><td>{money(Number(r.price??0)-Number(r.base_price??0))}</td></tr>)}</tbody></table></div><ListPagination page={itemPager.page} pageCount={itemPager.pageCount} total={itemPager.total} from={itemPager.from} to={itemPager.to} onPage={itemPager.setPage} label="item(ns)"/></section>
  </div>;
}

type InventoryDetail = { inventory?: Row; items?: Row[] };
export function InventoryClient({ inventories }: { inventories: Row[] }) {
  const [rows]=useState(inventories);
  const [selected,setSelected]=useState(String(inventories.find(i=>['open','counting'].includes(String(i.status)))?.id??inventories[0]?.id??''));
  const [detail,setDetail]=useState<InventoryDetail>({});
  const [counts,setCounts]=useState<Record<string,string>>({});
  const [message,setMessage]=useState('');
  const itemRows=detail.items??[];
  const itemPager=useListPagination(itemRows);

  async function load(id=selected){if(!id){setDetail({});return;}const r=await erpInventoryDetail(id);if(r.ok){const d={inventory:r.inventory as Row,items:(r.items as Row[])??[]};setDetail(d);setCounts(Object.fromEntries((d.items??[]).map(x=>[String(x.product_id),x.counted_quantity===null?'':String(x.counted_quantity)])));}else setMessage(String(r.error??'Falha ao abrir inventário'));}
  useEffect(()=>{itemPager.setPage(0);void load(selected);},[selected]);
  async function start(){const r=await erpInventoryStart('Inventário iniciado pelo ThorPDV');if(r.ok){setMessage('Inventário aberto e snapshot dos saldos criado.');location.reload();}else setMessage(String(r.error??'Falha ao iniciar inventário'));}
  async function saveCount(productId:string){const raw=counts[productId];if(raw==='')return;const r=await erpInventoryCount(selected,productId,Number(raw));setMessage(r.ok?'Contagem salva.':String(r.error??'Erro na contagem'));if(r.ok)await load();}
  async function close(){if(!confirm('Fechar o inventário e aplicar automaticamente todas as diferenças ao estoque?'))return;const r=await erpInventoryClose(selected);if(r.ok){setMessage('Inventário fechado. Diferenças foram lançadas como ajustes de estoque.');location.reload();}else setMessage(`Não foi possível fechar: ${String(r.error??'erro')}`);}
  const pending=itemRows.filter(i=>i.counted_quantity===null).length;
  return <div className="erp-advanced-grid"><section className="erp-module-card erp-advanced-panel"><h2>Inventários</h2><p>A abertura congela um snapshot esperado. O fechamento aplica apenas as diferenças.</p><button className="erp-primary" onClick={start}>+ Novo inventário</button><label>Inventário<select value={selected} onChange={e=>setSelected(e.target.value)}><option value="">Selecione...</option>{rows.map(i=><option key={String(i.id)} value={String(i.id)}>#{String(i.code)} — {String(i.status)} — {String(i.branch)}</option>)}</select></label><div className="erp-inventory-summary"><span>Itens: <b>{itemRows.length}</b></span><span>Pendentes: <b>{pending}</b></span><span>Status: <b>{String(detail.inventory?.status??'—')}</b></span></div><Message text={message}/>{selected&&['open','counting'].includes(String(detail.inventory?.status))&&<button className="erp-danger-btn" onClick={close}>Fechar e ajustar estoque</button>}</section><section className="erp-module-card"><div className="erp-table-scroll"><table className="erp-data-table"><thead><tr><th>Código</th><th>Produto</th><th>Esperado</th><th>Contado</th><th>Diferença</th><th></th></tr></thead><tbody>{itemRows.length===0?<tr><td className="erp-empty" colSpan={6}>Selecione ou abra um inventário.</td></tr>:itemPager.pageRows.map((r,i)=><tr key={String(r.product_id??`${itemPager.page}-${i}`)}><td>{String(r.sku??'—')}</td><td>{String(r.product??'')}</td><td>{String(r.expected_quantity??0)}</td><td><input className="erp-inline-input" type="number" step="0.001" value={counts[String(r.product_id)]??''} onChange={e=>setCounts(c=>({...c,[String(r.product_id)]:e.target.value}))}/></td><td>{String(r.difference??0)}</td><td><button className="erp-row-action" onClick={()=>saveCount(String(r.product_id))}>Salvar</button></td></tr>)}</tbody></table></div><ListPagination page={itemPager.page} pageCount={itemPager.pageCount} total={itemPager.total} from={itemPager.from} to={itemPager.to} onPage={itemPager.setPage} label="item(ns)"/></section></div>;
}

export function CashClient({ posRegisters }: { posRegisters: Row[] }) {
  const [sessions,setSessions]=useState<Row[]>([]);const [pos,setPos]=useState(String(posRegisters[0]?.id??''));const [opening,setOpening]=useState(0);const [closing,setClosing]=useState(0);const [message,setMessage]=useState('');
  const pager=useListPagination(sessions);
  async function load(){const r=await erpCashList();if(r.ok)setSessions(r.data);else setMessage(String(r.error??'Falha ao carregar caixas'));}
  useEffect(()=>{void load();},[]);
  async function open(){const r=await erpCashOpen(pos,opening);if(r.ok){setMessage('Caixa aberto com sucesso.');await load();}else setMessage(String(r.error??'Falha ao abrir caixa'));}
  async function close(id:string){const r=await erpCashClose(id,closing,'Fechamento pelo painel ThorPDV');if(r.ok){setMessage('Caixa fechado com sucesso.');await load();}else setMessage(String(r.error??'Falha ao fechar'));}
  return <section className="erp-module-card"><div className="erp-module-toolbar"><div className="erp-cash-controls"><label>PDV<select value={pos} onChange={e=>setPos(e.target.value)}><option value="">Selecione...</option>{posRegisters.map(p=><option key={String(p.id)} value={String(p.id)}>{String(p.name)} — {String(p.branch??'')}</option>)}</select></label><label>Fundo de troco<input type="number" step="0.01" value={opening} onChange={e=>setOpening(Number(e.target.value))}/></label><button className="erp-primary" disabled={!pos} onClick={open}>Abrir caixa</button></div></div><Message text={message}/><div className="erp-table-scroll"><table className="erp-data-table"><thead><tr><th>PDV</th><th>Filial</th><th>Abertura</th><th>Fundo</th><th>Status</th><th>Fechamento</th><th>Ação</th></tr></thead><tbody>{sessions.length===0?<tr><td className="erp-empty" colSpan={7}>Nenhuma sessão de caixa registrada.</td></tr>:pager.pageRows.map((s,i)=><tr key={String(s.id??`${pager.page}-${i}`)}><td>{String(s.pos??'')}</td><td>{String(s.branch??'')}</td><td>{datetime(s.opened_at)}</td><td>{money(s.opening_amount)}</td><td><span className="erp-pill">{String(s.status)}</span></td><td>{s.closed_at?datetime(s.closed_at):'—'}</td><td>{s.status==='open'?<div className="erp-close-cash"><input type="number" step="0.01" placeholder="Valor contado" onChange={e=>setClosing(Number(e.target.value))}/><button className="erp-row-action" onClick={()=>close(String(s.id))}>Fechar</button></div>:'—'}</td></tr>)}</tbody></table></div><ListPagination page={pager.page} pageCount={pager.pageCount} total={pager.total} from={pager.from} to={pager.to} onPage={pager.setPage} label="sessão(ões)"/></section>;
}

const reportColumns: Record<string,{key:string;label:string;money?:boolean}[]> = {
  sales:[{key:'sku',label:'Código'},{key:'product',label:'Produto'},{key:'group_name',label:'Grupo'},{key:'quantity',label:'Quantidade'},{key:'avg_unit_price',label:'Unitário médio',money:true},{key:'revenue',label:'Faturamento',money:true}],
  finance:[{key:'report_day',label:'Data'},{key:'entry_type',label:'Tipo'},{key:'total',label:'Total',money:true},{key:'paid',label:'Realizado',money:true},{key:'entries',label:'Lançamentos'}],
  stock:[{key:'sku',label:'Código'},{key:'name',label:'Produto'},{key:'stock',label:'Saldo'},{key:'minimum_stock',label:'Mínimo'},{key:'cost_price',label:'Custo',money:true},{key:'stock_value',label:'Valor estoque',money:true}],
};
export function ReportsClient({ type, branches, initial }: { type:'sales'|'finance'|'stock'; branches:Row[]; initial:Row[] }) {
  const now=new Date();const thirty=new Date(now);thirty.setDate(now.getDate()-30);
  const [start,setStart]=useState(thirty.toISOString().slice(0,10));const [end,setEnd]=useState(now.toISOString().slice(0,10));const [branch,setBranch]=useState('');const [rows,setRows]=useState(initial);const [message,setMessage]=useState('');
  const cols=reportColumns[type];const total=rows.reduce((s,r)=>s+Number(r.revenue??r.total??r.stock_value??0),0);const pager=useListPagination(rows);
  async function generate(){const r=await erpReport(type,start,end,branch);if(r.ok){setRows(r.data);pager.setPage(0);setMessage(`Relatório atualizado: ${r.data.length} linha(s).`);}else setMessage(String(r.error??'Falha ao gerar relatório'));}
  function csv(){const lines=[cols.map(c=>`"${c.label}"`).join(';'),...rows.map(r=>cols.map(c=>`"${String(r[c.key]??'').replaceAll('"','""')}"`).join(';'))];const blob=new Blob(['\ufeff'+lines.join('\n')],{type:'text/csv;charset=utf-8'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`thorpdv-relatorio-${type}.csv`;a.click();URL.revokeObjectURL(url);}
  return <section className="erp-module-card"><div className="erp-report-filter"><label>Início<input type="date" value={start} onChange={e=>setStart(e.target.value)}/></label><label>Fim<input type="date" value={end} onChange={e=>setEnd(e.target.value)}/></label><label>Filial<select value={branch} onChange={e=>setBranch(e.target.value)}><option value="">Todas as filiais</option>{branches.map(b=><option key={String(b.id)} value={String(b.id)}>{String(b.name)}</option>)}</select></label><button className="erp-primary" onClick={generate}>Gerar</button><button className="erp-ghost" onClick={csv}>Exportar CSV</button><button className="erp-ghost" onClick={()=>window.print()}>Imprimir / PDF</button></div><div className="erp-report-total"><span>Total consolidado</span><strong>{money(total)}</strong></div><Message text={message}/><div className="erp-table-scroll"><table className="erp-data-table"><thead><tr>{cols.map(c=><th key={c.key}>{c.label}</th>)}</tr></thead><tbody>{rows.length===0?<tr><td className="erp-empty" colSpan={cols.length}>Sem dados para o período.</td></tr>:pager.pageRows.map((r,i)=><tr key={`${pager.page}-${i}`}>{cols.map(c=><td key={c.key}>{c.money?money(r[c.key]):String(r[c.key]??'—')}</td>)}</tr>)}</tbody></table></div><ListPagination page={pager.page} pageCount={pager.pageCount} total={pager.total} from={pager.from} to={pager.to} onPage={pager.setPage} label="linha(s)"/></section>;
}
