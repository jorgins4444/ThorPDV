'use client';

import { useMemo, useState } from 'react';
import { purchaseCancel, purchaseCreate, purchaseList } from './purchase-actions';

type Row=Record<string,unknown>;
type Item={product_id:string;name:string;quantity:number;unit_cost:number;discount:number};
type Installment={number:number;due_date:string;amount:number};

const text=(v:unknown)=>v==null?'':String(v);
const num=(v:unknown)=>Number(v??0)||0;
const money=(v:unknown)=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(num(v));
const date=(v:unknown)=>v?new Date(`${text(v).slice(0,10)}T12:00:00`).toLocaleDateString('pt-BR'):'—';
const today=()=>new Date().toISOString().slice(0,10);

function addMonths(value:string,offset:number){
  if(!value)return '';
  const [year,month,day]=value.split('-').map(Number);
  if(!year||!month||!day)return value;
  const absolute=year*12+(month-1)+offset;
  const targetYear=Math.floor(absolute/12);
  const targetMonth=absolute%12;
  const lastDay=new Date(targetYear,targetMonth+1,0).getDate();
  const targetDay=Math.min(day,lastDay);
  return `${targetYear}-${String(targetMonth+1).padStart(2,'0')}-${String(targetDay).padStart(2,'0')}`;
}

function buildInstallments(total:number,firstDue:string,count:number):Installment[]{
  if(total<=0||!firstDue)return [];
  const quantity=Math.max(1,Math.min(60,Math.trunc(count||1)));
  const totalCents=Math.round(total*100);
  const base=Math.floor(totalCents/quantity);
  const remainder=totalCents-base*quantity;
  return Array.from({length:quantity},(_,index)=>({
    number:index+1,
    due_date:addMonths(firstDue,index),
    amount:(base+(index<remainder?1:0))/100,
  }));
}

const purchaseError=(value:unknown)=>{
  const error=text(value)||'erro';
  const labels:Record<string,string>={
    supplier_not_found:'Selecione um fornecedor ativo.',
    purchase_without_items:'Adicione pelo menos um produto à compra.',
    invalid_financial_category:'Selecione uma categoria financeira válida.',
    invalid_chart_account:'A categoria financeira não possui uma conta gerencial válida.',
    invalid_cost_center:'Selecione um centro de custo válido.',
    invalid_payment_installments:'O parcelamento informado é inválido.',
    invalid_payment_installment:'Revise vencimento e valor das parcelas.',
    installments_total_mismatch:'A soma das parcelas não confere com o total da compra.',
    too_many_installments:'O limite é de 60 parcelas por compra.',
    purchase_has_payments:'A compra possui parcela paga ou baixada. Estorne as baixas financeiras antes de cancelar a entrada.',
    purchase_not_cancellable:'Esta compra não pode mais ser cancelada.',
    insufficient_stock_to_cancel:'Não há estoque disponível suficiente para estornar todos os itens desta compra.',
  };
  return labels[error]||error;
};

export function PurchaseWorkspace({initial,suppliers,products,categories,costCenters}:{initial:Row[];suppliers:Row[];products:Row[];categories:Row[];costCenters:Row[]}){
  const payableCategories=useMemo(()=>categories.filter(c=>c.active!==false&&['payable','both'].includes(text(c.entry_type))),[categories]);
  const activeCenters=useMemo(()=>costCenters.filter(c=>c.active!==false),[costCenters]);
  const defaultCategory=payableCategories.find(c=>text(c.code)==='PURCHASE_RESALE')??payableCategories[0];
  const defaultCenter=activeCenters.find(c=>c.is_default===true)??activeCenters[0];

  const [rows,setRows]=useState(initial);
  const [supplier,setSupplier]=useState('');
  const [documentNumber,setDocumentNumber]=useState('');
  const [issueDate,setIssueDate]=useState(today());
  const [dueDate,setDueDate]=useState('');
  const [installmentCount,setInstallmentCount]=useState(1);
  const [category,setCategory]=useState(text(defaultCategory?.id));
  const [costCenter,setCostCenter]=useState(text(defaultCenter?.id));
  const [freight,setFreight]=useState(0);
  const [docDiscount,setDocDiscount]=useState(0);
  const [notes,setNotes]=useState('');
  const [product,setProduct]=useState('');
  const [qty,setQty]=useState(1);
  const [cost,setCost]=useState(0);
  const [itemDiscount,setItemDiscount]=useState(0);
  const [items,setItems]=useState<Item[]>([]);
  const [message,setMessage]=useState('');
  const [saving,setSaving]=useState(false);

  const subtotal=useMemo(()=>items.reduce((sum,item)=>sum+item.quantity*item.unit_cost-item.discount,0),[items]);
  const total=Math.max(subtotal+freight-docDiscount,0);
  const installments=useMemo(()=>buildInstallments(total,dueDate,installmentCount),[total,dueDate,installmentCount]);

  async function refresh(){const r=await purchaseList();if(r.ok)setRows(r.data);}

  function add(){
    const p=products.find(x=>String(x.id)===product);
    if(!p)return;
    if(qty<=0||cost<0){setMessage('Quantidade ou custo inválido.');return;}
    if(itemDiscount>qty*cost){setMessage('Desconto do item não pode superar o valor bruto.');return;}
    setItems(v=>[...v,{product_id:String(p.id),name:String(p.name),quantity:qty,unit_cost:cost,discount:itemDiscount}]);
    setProduct('');setQty(1);setCost(0);setItemDiscount(0);setMessage('');
  }

  async function finish(){
    if(!supplier||!items.length){setMessage('Selecione o fornecedor e adicione pelo menos um item.');return;}
    if(!category){setMessage('Selecione a categoria financeira da compra.');return;}
    if(!dueDate){setMessage('Informe o vencimento da primeira parcela.');return;}
    if(installmentCount<1||installmentCount>60){setMessage('Informe entre 1 e 60 parcelas.');return;}
    if(docDiscount>subtotal+freight){setMessage('Desconto geral inválido.');return;}
    if(installments.length!==Math.trunc(installmentCount)){setMessage('Não foi possível montar o parcelamento. Revise os dados.');return;}

    setSaving(true);setMessage('');
    const r=await purchaseCreate({
      supplier_id:supplier,
      document_number:documentNumber,
      issue_date:issueDate,
      due_date:dueDate,
      financial_category_id:category,
      cost_center_id:costCenter||null,
      freight,
      discount:docDiscount,
      notes,
      payment_installments:installments.map(({due_date,amount})=>({due_date,amount})),
      items:items.map(({name,...item})=>item),
    });
    setSaving(false);
    if(!r.ok){setMessage(`Não foi possível registrar a compra: ${purchaseError(r.error)}`);return;}

    const generated=Number(r.installments??installments.length)||1;
    setMessage(`Compra nº ${String(r.number)} recebida por ${money(r.total)} com ${generated} parcela(s). Estoque, custo e contas a pagar foram atualizados.`);
    setItems([]);setSupplier('');setDocumentNumber('');setIssueDate(today());setDueDate('');setInstallmentCount(1);
    setCategory(text(defaultCategory?.id));setCostCenter(text(defaultCenter?.id));setFreight(0);setDocDiscount(0);setNotes('');
    await refresh();
  }

  async function cancel(id:string){
    if(!confirm('Cancelar esta compra? O estoque e todas as parcelas financeiras ainda não pagas serão estornados.'))return;
    const r=await purchaseCancel(id);
    if(r.ok){setMessage('Compra cancelada, estoque estornado e títulos financeiros cancelados.');await refresh();}
    else setMessage(`Não foi possível cancelar: ${purchaseError(r.error)}`);
  }

  return <div className="erp-purchase-workspace">
    <section className="erp-module-card erp-purchase-entry">
      <div className="erp-advanced-head"><h2>Entrada / Compra</h2><p>Fornecedor → estoque → custo → contas a pagar parceladas e classificadas, tudo em uma única operação.</p></div>

      <div className="erp-purchase-header">
        <label>Fornecedor<select required value={supplier} onChange={e=>setSupplier(e.target.value)}><option value="">Selecione...</option>{suppliers.filter(s=>s.active!==false).map(s=><option key={String(s.id)} value={String(s.id)}>{String(s.name)}</option>)}</select></label>
        <label>Documento / NF fornecedor<input value={documentNumber} onChange={e=>setDocumentNumber(e.target.value)}/></label>
        <label>Emissão<input type="date" value={issueDate} onChange={e=>setIssueDate(e.target.value)}/></label>
        <label>1º vencimento<input type="date" value={dueDate} onChange={e=>setDueDate(e.target.value)}/></label>
        <label>Parcelas<input type="number" min="1" max="60" step="1" value={installmentCount} onChange={e=>setInstallmentCount(Math.max(1,Math.min(60,Math.trunc(Number(e.target.value)||1))))}/></label>
        <label>Categoria financeira<select value={category} onChange={e=>setCategory(e.target.value)}><option value="">Selecione...</option>{payableCategories.map(c=><option key={text(c.id)} value={text(c.id)}>{text(c.code)} · {text(c.name)}</option>)}</select></label>
        <label>Centro de custo<select value={costCenter} onChange={e=>setCostCenter(e.target.value)}><option value="">Automático pela filial</option>{activeCenters.map(c=><option key={text(c.id)} value={text(c.id)}>{text(c.code)} · {text(c.name)}</option>)}</select></label>
      </div>

      <div className="erp-purchase-add">
        <label>Produto<select value={product} onChange={e=>{setProduct(e.target.value);const p=products.find(x=>String(x.id)===e.target.value);setCost(Number(p?.cost_price??0));}}><option value="">Selecione...</option>{products.filter(p=>p.active!==false).map(p=><option key={String(p.id)} value={String(p.id)}>{String(p.sku??'')} · {String(p.name)} · custo atual {money(p.cost_price)}</option>)}</select></label>
        <label>Quantidade<input type="number" min="0.001" step="0.001" value={qty} onChange={e=>setQty(Number(e.target.value))}/></label>
        <label>Custo unitário<input type="number" min="0" step="0.01" value={cost} onChange={e=>setCost(Number(e.target.value))}/></label>
        <label>Desconto item<input type="number" min="0" step="0.01" value={itemDiscount} onChange={e=>setItemDiscount(Number(e.target.value))}/></label>
        <button className="erp-primary" type="button" onClick={add} disabled={!product}>Adicionar item</button>
      </div>

      <div className="erp-table-scroll"><table className="erp-data-table"><thead><tr><th>Produto</th><th>Qtd.</th><th>Custo</th><th>Desconto</th><th>Total</th><th></th></tr></thead><tbody>{items.length===0?<tr><td colSpan={6} className="erp-empty">Adicione os produtos recebidos.</td></tr>:items.map((item,index)=><tr key={`${item.product_id}-${index}`}><td>{item.name}</td><td>{item.quantity}</td><td>{money(item.unit_cost)}</td><td>{money(item.discount)}</td><td><strong>{money(item.quantity*item.unit_cost-item.discount)}</strong></td><td><button className="erp-row-action" onClick={()=>setItems(v=>v.filter((_,i)=>i!==index))}>Remover</button></td></tr>)}</tbody></table></div>

      <div className="erp-purchase-totals">
        <label>Frete<input type="number" min="0" step="0.01" value={freight} onChange={e=>setFreight(Number(e.target.value))}/></label>
        <label>Desconto geral<input type="number" min="0" step="0.01" value={docDiscount} onChange={e=>setDocDiscount(Number(e.target.value))}/></label>
        <label>Observação<input value={notes} onChange={e=>setNotes(e.target.value)}/></label>
        <div><span>Subtotal</span><b>{money(subtotal)}</b></div>
        <div className="total"><span>Total</span><strong>{money(total)}</strong></div>
        <button className="erp-primary" disabled={!items.length||!supplier||!category||!dueDate||saving} onClick={finish}>{saving?'Processando...':'Receber compra'}</button>
      </div>

      <div className="erp-table-scroll">
        <table className="erp-data-table">
          <thead><tr><th colSpan={3}>Parcelamento financeiro gerado automaticamente</th></tr><tr><th>Parcela</th><th>Vencimento</th><th>Valor</th></tr></thead>
          <tbody>{installments.length===0?<tr><td colSpan={3} className="erp-empty">Informe o primeiro vencimento e tenha itens na compra para visualizar as parcelas.</td></tr>:installments.map(item=><tr key={item.number}><td>{item.number}/{installments.length}</td><td>{date(item.due_date)}</td><td><strong>{money(item.amount)}</strong></td></tr>)}</tbody>
          {installments.length>0&&<tfoot><tr><td colSpan={2}><strong>Total parcelado</strong></td><td><strong>{money(installments.reduce((sum,item)=>sum+item.amount,0))}</strong></td></tr></tfoot>}
        </table>
      </div>

      {message&&<p className="erp-message">{message}</p>}
    </section>

    <section className="erp-module-card">
      <div className="erp-table-scroll"><table className="erp-data-table"><thead><tr><th>Nº</th><th>Emissão</th><th>Fornecedor</th><th>Documento</th><th>Categoria / Conta</th><th>Centro de custo</th><th>Total</th><th>Financeiro</th><th>Status</th><th>Ação</th></tr></thead><tbody>{rows.length===0?<tr><td colSpan={10} className="erp-empty">Nenhuma compra recebida.</td></tr>:rows.map((r,index)=>{
        const count=Math.max(1,num(r.installment_count));
        const open=num(r.open_amount);
        const paid=num(r.financial_paid_amount);
        return <tr key={String(r.id??index)}><td>#{String(r.number)}</td><td>{date(r.issue_date)}</td><td>{String(r.supplier)}</td><td>{String(r.document_number??'—')}</td><td><b>{text(r.financial_category)||'—'}</b><small>{text(r.account_code)} {text(r.chart_account)}</small></td><td>{text(r.cost_center)||'—'}</td><td>{money(r.total)}</td><td><b>{count} parcela(s)</b><small>Próx.: {date(r.next_due_date)} · aberto {money(open)}{paid>0?` · pago ${money(paid)}`:''}</small></td><td><span className={`erp-pill ${r.status==='cancelled'?'danger':''}`}>{String(r.status)}</span></td><td>{r.status==='received'?<button className="erp-row-action" onClick={()=>cancel(String(r.id))}>Cancelar</button>:'—'}</td></tr>;
      })}</tbody></table></div>
    </section>
  </div>;
}
