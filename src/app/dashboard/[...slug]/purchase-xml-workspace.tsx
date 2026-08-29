'use client';

import Link from 'next/link';
import { ChangeEvent, useMemo, useState } from 'react';
import { purchaseXmlImport } from './purchase-actions';

type Row=Record<string,unknown>;
type XmlRoot=Document|Element;
type PartyXml={document:string;name:string;trade_name:string;state_registration:string;email:string;phone:string;street:string;number:string;complement:string;district:string;city:string;state:string;postal_code:string;ibge_city_code:string};
type ParsedItem={itemNo:number;code:string;ean:string;name:string;ncm:string;cest:string;cfop:string;unit:string;quantity:number;unitPrice:number;grossTotal:number;discount:number;netTotal:number};
type ReviewItem=ParsedItem&{productId:string;createProduct:boolean;stockUnit:string;conversionFactor:number;salePrice:number;matchReason:string};
type Installment={number:string;due_date:string;amount:number};
type PaymentXml={code:string;amount:number};
type ParsedNfe={
  key:string;model:string;series:string;number:string;issueDate:string;
  ide:{nature:string;operationType:string;purpose:string;consumer:string};
  supplier:PartyXml;destination:PartyXml;
  transport:{freightMode:string;carrierName:string;carrierDocument:string;plate:string;uf:string};
  payments:PaymentXml[];items:ParsedItem[];installments:Installment[];
  totals:{products:number;discount:number;freight:number;insurance:number;other:number;invoice:number;taxAdjustment:number;icms:number;ipi:number;st:number};
  rawXml:string;
};

const text=(v:unknown)=>v==null?'':String(v);
const num=(v:unknown)=>{const n=Number(v??0);return Number.isFinite(n)?n:0};
const money=(v:unknown)=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(num(v));
const digits=(v:unknown)=>text(v).replace(/\D/g,'');
const round=(v:number)=>Math.round((v+Number.EPSILON)*100)/100;
const fmtDate=(v:string)=>v?new Date(`${v.slice(0,10)}T12:00:00`).toLocaleDateString('pt-BR'):'—';
const today=()=>new Date().toISOString().slice(0,10);
const fmtDoc=(value:unknown)=>{const d=digits(value);return d.length===14?d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/,'$1.$2.$3/$4-$5'):d.length===11?d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/,'$1.$2.$3-$4'):d||'—'};
const purposeLabel=(v:string)=>({1:'NF-e normal',2:'NF-e complementar',3:'NF-e de ajuste',4:'Devolução/retorno'}[v]||v||'—');
const operationLabel=(v:string)=>v==='0'?'Entrada':v==='1'?'Saída':v||'—';
const freightLabel=(v:string)=>({0:'Emitente',1:'Destinatário',2:'Terceiros',3:'Próprio remetente',4:'Próprio destinatário',9:'Sem frete'}[v]||v||'—');
function addDays(value:string,days:number){const d=new Date(`${value||today()}T12:00:00`);d.setDate(d.getDate()+days);return d.toISOString().slice(0,10)}
function xmlEl(root:XmlRoot,tag:string){return root.getElementsByTagNameNS('*',tag)[0]??root.getElementsByTagName(tag)[0]??null}
function xmlText(root:XmlRoot|null,tag:string){return root?text(xmlEl(root,tag)?.textContent).trim():''}
function xmlNumber(root:XmlRoot|null,tag:string){return num(xmlText(root,tag))}
function usableEan(v:string){const d=digits(v);return d.length>=8&&d.length<=14?d:''}
function purchaseUnits(row:Row){return Array.isArray(row.purchase_units)?row.purchase_units as Row[]:[]}
function parseParty(root:Element|null,addressTag:string):PartyXml{
  const ender=root?xmlEl(root,addressTag):null;
  return {document:digits(xmlText(root,'CNPJ')||xmlText(root,'CPF')),name:xmlText(root,'xNome'),trade_name:xmlText(root,'xFant'),state_registration:xmlText(root,'IE'),email:xmlText(root,'email'),phone:xmlText(ender,'fone'),street:xmlText(ender,'xLgr'),number:xmlText(ender,'nro'),complement:xmlText(ender,'xCpl'),district:xmlText(ender,'xBairro'),city:xmlText(ender,'xMun'),state:xmlText(ender,'UF'),postal_code:digits(xmlText(ender,'CEP')),ibge_city_code:xmlText(ender,'cMun')};
}

function parseNfe(rawXml:string):ParsedNfe{
  const doc=new DOMParser().parseFromString(rawXml,'application/xml');
  if(doc.getElementsByTagName('parsererror').length)throw new Error('O arquivo não contém um XML válido.');
  const inf=xmlEl(doc,'infNFe');
  if(!inf)throw new Error('Não encontrei a estrutura infNFe no arquivo. Selecione o XML autorizado da NF-e.');
  const ide=xmlEl(inf,'ide');const emit=xmlEl(inf,'emit');const dest=xmlEl(inf,'dest');const total=xmlEl(inf,'ICMSTot');const transp=xmlEl(inf,'transp');const transporta=transp?xmlEl(transp,'transporta'):null;const vehicle=transp?xmlEl(transp,'veicTransp'):null;
  const model=xmlText(ide,'mod');if(model&&model!=='55')throw new Error(`O documento é modelo ${model}. Esta rotina foi criada para NF-e modelo 55.`);
  const key=(text(inf.getAttribute('Id')).replace(/^NFe/i,'')||digits(xmlText(doc,'chNFe'))).trim();
  if(digits(key).length!==44)throw new Error('A chave de acesso da NF-e não pôde ser identificada.');
  const issueRaw=xmlText(ide,'dhEmi')||xmlText(ide,'dEmi')||today();const issueDate=issueRaw.slice(0,10);
  const supplier=parseParty(emit,'enderEmit');const destination=parseParty(dest,'enderDest');
  if(!destination.document)throw new Error('O XML não possui CNPJ/CPF do destinatário no grupo dest. A entrada foi bloqueada.');
  const dets=Array.from(inf.getElementsByTagNameNS('*','det'));
  const items=dets.map((det,index)=>{const prod=xmlEl(det,'prod');if(!prod)throw new Error(`O item ${index+1} não possui o grupo de produto.`);const gross=xmlNumber(prod,'vProd');const discount=xmlNumber(prod,'vDesc');return {itemNo:Number(det.getAttribute('nItem')||index+1),code:xmlText(prod,'cProd'),ean:usableEan(xmlText(prod,'cEAN')||xmlText(prod,'cEANTrib')),name:xmlText(prod,'xProd'),ncm:xmlText(prod,'NCM'),cest:xmlText(prod,'CEST'),cfop:xmlText(prod,'CFOP'),unit:xmlText(prod,'uCom')||xmlText(prod,'uTrib')||'UN',quantity:xmlNumber(prod,'qCom')||xmlNumber(prod,'qTrib'),unitPrice:xmlNumber(prod,'vUnCom')||xmlNumber(prod,'vUnTrib'),grossTotal:gross,discount,netTotal:round(gross-discount)} as ParsedItem});
  if(!items.length)throw new Error('A NF-e não possui itens de produto.');
  const products=xmlNumber(total,'vProd')||round(items.reduce((s,i)=>s+i.grossTotal,0));const discount=xmlNumber(total,'vDesc')||round(items.reduce((s,i)=>s+i.discount,0));const freight=xmlNumber(total,'vFrete');const insurance=xmlNumber(total,'vSeg');const other=xmlNumber(total,'vOutro');const invoice=xmlNumber(total,'vNF');if(invoice<=0)throw new Error('O total vNF da nota é inválido.');
  const netGoods=round(items.reduce((s,i)=>s+i.netTotal,0));const taxAdjustment=round(invoice-(netGoods+freight+insurance+other));
  const dupNodes=Array.from(inf.getElementsByTagNameNS('*','dup'));
  let installments=dupNodes.map((dup,index)=>({number:xmlText(dup,'nDup')||String(index+1),due_date:xmlText(dup,'dVenc')||addDays(issueDate,30*(index+1)),amount:xmlNumber(dup,'vDup')})).filter(x=>x.amount>0);
  if(!installments.length)installments=[{number:'1',due_date:addDays(issueDate,30),amount:invoice}];
  const paymentNodes=Array.from(inf.getElementsByTagNameNS('*','detPag'));
  const payments=paymentNodes.map(p=>({code:xmlText(p,'tPag'),amount:xmlNumber(p,'vPag')})).filter(p=>p.amount>0);
  return {
    key:digits(key),model:model||'55',series:xmlText(ide,'serie'),number:xmlText(ide,'nNF'),issueDate,
    ide:{nature:xmlText(ide,'natOp'),operationType:xmlText(ide,'tpNF'),purpose:xmlText(ide,'finNFe'),consumer:xmlText(ide,'indFinal')},
    supplier,destination,
    transport:{freightMode:xmlText(transp,'modFrete'),carrierName:xmlText(transporta,'xNome'),carrierDocument:digits(xmlText(transporta,'CNPJ')||xmlText(transporta,'CPF')),plate:xmlText(vehicle,'placa'),uf:xmlText(vehicle,'UF')},
    payments,items,installments,
    totals:{products,discount,freight,insurance,other,invoice,taxAdjustment,icms:xmlNumber(total,'vICMS'),ipi:xmlNumber(total,'vIPI'),st:xmlNumber(total,'vST')},rawXml,
  };
}

const importError=(value:unknown)=>{const e=text(value);const map:Record<string,string>={invalid_nfe_access_key:'Chave de acesso da NF-e inválida.',nfe_already_imported:'Esta NF-e já foi importada anteriormente.',branch_cnpj_not_configured:'A filial atual não possui CNPJ configurado. A entrada por XML foi bloqueada.',invalid_destination_cnpj:'O XML não possui um CNPJ de destinatário válido.',nfe_destination_mismatch:'O CNPJ do destinatário da NF-e não corresponde à filial atual.',supplier_not_found:'Não foi possível identificar ou cadastrar o fornecedor.',purchase_without_items:'A nota não possui itens válidos.',xml_item_product_required:'Há item sem produto vinculado ou marcado para cadastro.',xml_product_create_failed:'Não foi possível cadastrar um dos produtos do XML.',invalid_payment_installment:'Revise as parcelas e vencimentos.',installments_total_mismatch:'A soma das parcelas não confere com o total da NF-e.',invalid_financial_category:'Selecione uma categoria financeira válida.',invalid_chart_account:'Selecione uma conta analítica válida do Plano de Contas.',invalid_cost_center:'Selecione um centro de custo válido.',product_not_found:'Um produto vinculado não foi encontrado.'};return map[e]||e||'Erro não identificado.'};

export function PurchaseXmlWorkspace({suppliers,products,links,units,categories,chartAccounts,costCenters,currentBranchId,currentBranchName,currentBranchDocument,currentCompanyName}:{suppliers:Row[];products:Row[];links:Row[];units:Row[];categories:Row[];chartAccounts:Row[];costCenters:Row[];currentBranchId:string;currentBranchName:string;currentBranchDocument:string;currentCompanyName:string}){
  const [nfe,setNfe]=useState<ParsedNfe|null>(null);const [fileName,setFileName]=useState('');const [supplierId,setSupplierId]=useState('');const [items,setItems]=useState<ReviewItem[]>([]);const [installments,setInstallments]=useState<Installment[]>([]);const [message,setMessage]=useState('');const [saving,setSaving]=useState(false);
  const payableCategories=useMemo(()=>categories.filter(c=>c.active!==false&&['payable','both'].includes(text(c.entry_type))),[categories]);
  const postingAccounts=useMemo(()=>chartAccounts.filter(a=>a.active!==false&&a.posting!==false&&['liability','cost','expense'].includes(text(a.account_type))),[chartAccounts]);
  const activeCenters=useMemo(()=>costCenters.filter(c=>c.active!==false).slice().sort((a,b)=>{const rank=(c:Row)=>text(c.branch_id)===currentBranchId?0:!text(c.branch_id)?1:2;return rank(a)-rank(b)||text(a.name).localeCompare(text(b.name),'pt-BR')}),[costCenters,currentBranchId]);
  const defaultCategory=payableCategories.find(c=>text(c.code)==='PURCHASE_RESALE')??payableCategories[0];
  const [categoryId,setCategoryId]=useState(text(defaultCategory?.id));
  const [accountId,setAccountId]=useState(text(postingAccounts.find(a=>text(a.id)===text(defaultCategory?.default_chart_account_id))?.id??postingAccounts[0]?.id));
  const defaultCenter=activeCenters.find(c=>text(c.branch_id)===currentBranchId&&c.is_default===true)??activeCenters.find(c=>text(c.branch_id)===currentBranchId)??activeCenters.find(c=>!text(c.branch_id)&&c.is_default===true)??activeCenters[0];
  const [costCenterId,setCostCenterId]=useState(text(defaultCenter?.id));const [notes,setNotes]=useState('');
  const expectedRecipient=digits(currentBranchDocument);const branchCnpjReady=expectedRecipient.length===14;const recipientMatches=Boolean(nfe)&&branchCnpjReady&&nfe?.destination.document===expectedRecipient;

  function matchProduct(item:ParsedItem,supplier:string):ReviewItem{
    const link=links.find(l=>text(l.supplier_id)===supplier&&text(l.source_code)===item.code);
    let product=link?products.find(p=>text(p.id)===text(link.product_id)):undefined;let reason=product?'Vínculo salvo do fornecedor':'';
    if(!product&&item.ean){product=products.find(p=>digits(p.barcode)===item.ean||purchaseUnits(p).some(u=>digits(u.barcode)===item.ean));if(product)reason='Código de barras / GTIN';}
    if(!product&&item.code){product=products.find(p=>text(p.sku).trim().toLowerCase()===item.code.trim().toLowerCase());if(product)reason='Código/SKU coincidente';}
    const stockUnit=text(product?.unit)||((units.some(u=>text(u.code).toUpperCase()===item.unit.toUpperCase()))?item.unit.toUpperCase():'UN');
    const savedPurchaseUnit=product?purchaseUnits(product).find(u=>text(u.unit).toUpperCase()===item.unit.toUpperCase()):undefined;
    const factor=Math.max(num(link?.conversion_factor)||num(savedPurchaseUnit?.conversion_factor)||(item.unit.toUpperCase()===stockUnit.toUpperCase()?1:1),0.000001);
    const stockQty=item.quantity*factor;const cost=stockQty>0?item.netTotal/stockQty:0;
    return {...item,productId:text(product?.id),createProduct:!product,stockUnit,conversionFactor:factor,salePrice:num(product?.sale_price)>0?num(product?.sale_price):round(cost),matchReason:reason||'Novo produto / conferência necessária'};
  }

  async function loadXml(e:ChangeEvent<HTMLInputElement>){
    const file=e.target.files?.[0];if(!file)return;setMessage('');
    try{const raw=await file.text();const parsed=parseNfe(raw);const matchedSupplier=suppliers.find(s=>digits(s.document)===parsed.supplier.document);const sid=matchedSupplier?text(matchedSupplier.id):'__new__';setNfe(parsed);setFileName(file.name);setSupplierId(sid);setItems(parsed.items.map(i=>matchProduct(i,matchedSupplier?text(matchedSupplier.id):'')));setInstallments(parsed.installments);setNotes(`Entrada por XML da NF-e ${parsed.number} · chave ${parsed.key}`);if(!branchCnpjReady)setMessage('A filial atual não possui CNPJ configurado. O XML foi lido, mas a entrada está bloqueada.');else if(parsed.destination.document!==expectedRecipient)setMessage(`NF-e destinada a ${fmtDoc(parsed.destination.document)}. A filial atual usa ${fmtDoc(expectedRecipient)}; a entrada está bloqueada.`);}catch(err){setNfe(null);setItems([]);setInstallments([]);setFileName('');setMessage(err instanceof Error?err.message:'Não foi possível ler o XML.');}
    e.target.value='';
  }

  function changeSupplier(value:string){setSupplierId(value);if(nfe)setItems(nfe.items.map(i=>matchProduct(i,value==='__new__'?'':value)));}
  function patchItem(index:number,patch:Partial<ReviewItem>){setItems(current=>current.map((item,i)=>i===index?{...item,...patch}:item));}
  function chooseProduct(index:number,value:string){const current=items[index];if(!current)return;if(value==='__new__'){const stockUnit=units.some(u=>text(u.code).toUpperCase()===current.unit.toUpperCase())?current.unit.toUpperCase():'UN';patchItem(index,{productId:'',createProduct:true,stockUnit,conversionFactor:stockUnit===current.unit.toUpperCase()?1:current.conversionFactor,matchReason:'Cadastrar novo produto'});return;}const p=products.find(x=>text(x.id)===value);if(!p)return;const pu=purchaseUnits(p).find(u=>text(u.unit).toUpperCase()===current.unit.toUpperCase());patchItem(index,{productId:value,createProduct:false,stockUnit:text(p.unit)||'UN',conversionFactor:num(pu?.conversion_factor)||(current.unit.toUpperCase()===text(p.unit).toUpperCase()?1:current.conversionFactor),salePrice:num(p.sale_price)||current.salePrice,matchReason:'Vínculo manual'});}
  const stockQty=(i:ReviewItem)=>round(i.quantity*Math.max(i.conversionFactor,0));const unitCost=(i:ReviewItem)=>{const q=i.quantity*Math.max(i.conversionFactor,0);return q>0?i.netTotal/q:0};
  const itemsReady=items.length>0&&items.every(i=>(i.createProduct||Boolean(i.productId))&&i.conversionFactor>0&&stockQty(i)>0&&unitCost(i)>=0&&i.salePrice>0&&Boolean(i.stockUnit));
  const financialTotal=round(installments.reduce((s,i)=>s+num(i.amount),0));const financialDiff=round((nfe?.totals.invoice??0)-financialTotal);const financeReady=Boolean(nfe)&&Boolean(categoryId)&&Boolean(accountId)&&Boolean(costCenterId)&&installments.length>0&&installments.every(i=>Boolean(i.due_date)&&i.amount>0)&&Math.abs(financialDiff)<=0.01;
  const ready=Boolean(nfe)&&recipientMatches&&Boolean(supplierId)&&itemsReady&&financeReady;const matchedCount=items.filter(i=>!i.createProduct&&i.productId).length;const newCount=items.filter(i=>i.createProduct).length;

  function normalizeInstallments(){if(!nfe||!installments.length)return;setInstallments(current=>current.map((item,index)=>index===current.length-1?{...item,amount:round(item.amount+financialDiff)}:item));}
  function changeCategory(value:string){setCategoryId(value);const c=payableCategories.find(x=>text(x.id)===value);if(c?.default_chart_account_id)setAccountId(text(c.default_chart_account_id));}

  async function finish(){
    if(!nfe||!ready)return;setSaving(true);setMessage('');
    const r=await purchaseXmlImport({
      supplier_id:supplierId==='__new__'?null:supplierId,supplier:nfe.supplier,destination_document:nfe.destination.document,nfe_access_key:nfe.key,nfe_model:nfe.model,nfe_series:nfe.series,document_number:nfe.number,issue_date:nfe.issueDate,due_date:installments[0]?.due_date,
      financial_category_id:categoryId,chart_account_id:accountId,cost_center_id:costCenterId,freight:nfe.totals.freight,insurance:nfe.totals.insurance,other_expenses:nfe.totals.other,tax_adjustment:nfe.totals.taxAdjustment,notes,payment_installments:installments.map(i=>({due_date:i.due_date,amount:i.amount})),
      items:items.map(i=>({product_id:i.createProduct?null:i.productId,create_product:i.createProduct,source_item_no:i.itemNo,source_code:i.code,source_ean:i.ean,source_name:i.name,source_unit:i.unit,source_quantity:i.quantity,source_unit_cost:i.unitPrice,source_ncm:i.ncm,source_cest:i.cest,source_cfop:i.cfop,stock_unit:i.stockUnit,conversion_factor:i.conversionFactor,quantity:stockQty(i),unit_cost:unitCost(i),sale_price:i.salePrice})),
      xml_metadata:{file_name:fileName,raw_xml:nfe.rawXml,ide:nfe.ide,totals:nfe.totals,supplier:nfe.supplier,destination:nfe.destination,transport:nfe.transport,payments:nfe.payments,imported_from:'thorgestao_purchase_xml'},
    });
    setSaving(false);if(!r.ok){setMessage(`Não foi possível importar a NF-e: ${importError(r.error)}`);return;}
    setMessage(`NF-e ${nfe.number} importada com sucesso como compra nº ${text(r.number)}. Destinatário validado, estoque, custos, preços e ${text(r.installments)} título(s) a pagar foram atualizados.`);setNfe(null);setItems([]);setInstallments([]);setFileName('');setSupplierId('');
  }

  return <div className="pxml">
    <section className="pxml-progress">
      {['1 · XML','2 · Destinatário','3 · Fornecedor','4 · Produtos','5 · Financeiro','6 · Confirmar'].map((label,index)=>{const ok=index===0?Boolean(nfe):index===1?recipientMatches:index===2?Boolean(nfe&&supplierId):index===3?itemsReady:index===4?financeReady:ready;return <div key={label} className={ok?'done':''}><span>{ok?'✓':index+1}</span><b>{label.replace(/^\d · /,'')}</b></div>})}
    </section>

    <section className="pxml-card pxml-upload"><div><span>IMPORTAÇÃO DE NF-e</span><h2>Carregar XML da nota fiscal</h2><p>O XML é lido integralmente para conferência. Nenhuma entrada é efetivada antes da validação do destinatário e da confirmação final.</p></div><div className="pxml-upload-actions"><label className="pxml-file">Selecionar XML<input type="file" accept=".xml,text/xml,application/xml" onChange={loadXml}/></label><Link href="/dashboard/compras" className="pxml-secondary">Entrada manual</Link></div>{fileName&&<small>Arquivo carregado: <b>{fileName}</b></small>}</section>
    {message&&<div className="pxml-message">{message}</div>}

    {nfe&&<>
      <section className="pxml-card"><header className="pxml-title"><div><span>NF-e IDENTIFICADA</span><h3>Nota {nfe.number} · Série {nfe.series||'—'}</h3><p>{nfe.ide.nature||'Natureza não informada'} · {operationLabel(nfe.ide.operationType)} · {purposeLabel(nfe.ide.purpose)} · emissão {fmtDate(nfe.issueDate)}</p></div><span className="pxml-ok">XML lido</span></header><div className="pxml-kpis"><div><span>Produtos</span><b>{money(nfe.totals.products)}</b></div><div><span>Desconto</span><b>{money(nfe.totals.discount)}</b></div><div><span>Frete + seguro + outros</span><b>{money(nfe.totals.freight+nfe.totals.insurance+nfe.totals.other)}</b></div><div><span>Total NF-e</span><strong>{money(nfe.totals.invoice)}</strong></div></div><div className="pxml-taxline"><span>Chave: {nfe.key}</span><span>ICMS: {money(nfe.totals.icms)}</span><span>IPI: {money(nfe.totals.ipi)}</span><span>ST: {money(nfe.totals.st)}</span><span>Frete: {freightLabel(nfe.transport.freightMode)}{nfe.transport.carrierName?` · ${nfe.transport.carrierName}`:''}</span>{nfe.payments.length>0&&<span>Pagamentos informados no XML: {nfe.payments.map(p=>`${p.code} ${money(p.amount)}`).join(' · ')}</span>}</div></section>

      <section className={`pxml-card pxml-recipient ${recipientMatches?'valid':'invalid'}`}><header className="pxml-title"><div><span>DESTINATÁRIO DA NF-e</span><h3>{nfe.destination.name||'Destinatário sem razão social'}</h3><p>CNPJ/CPF {fmtDoc(nfe.destination.document)} · IE {nfe.destination.state_registration||'—'} · {nfe.destination.city||'—'}/{nfe.destination.state||'—'}</p></div><span className={recipientMatches?'pxml-ok':'pxml-danger'}>{recipientMatches?'Destinatário validado':'Entrada bloqueada'}</span></header><div className="pxml-recipient-check"><div><span>Filial atual</span><b>{currentBranchName||currentCompanyName||'—'}</b><small>CNPJ cadastrado: {fmtDoc(currentBranchDocument)}</small></div><div><span>Destinatário do XML</span><b>{nfe.destination.name||'—'}</b><small>CNPJ do XML: {fmtDoc(nfe.destination.document)}</small></div><div className={recipientMatches?'match':'mismatch'}><span>Validação</span><strong>{!branchCnpjReady?'CNPJ da filial não configurado':recipientMatches?'CNPJs correspondem':'CNPJs não correspondem'}</strong><small>{recipientMatches?'Esta NF-e pode seguir para conferência.':'A nota pode ser consultada, mas não poderá ser importada nesta filial.'}</small></div></div></section>

      <section className="pxml-card"><header className="pxml-title"><div><span>EMITENTE / FORNECEDOR</span><h3>{nfe.supplier.name}</h3><p>CNPJ/CPF {fmtDoc(nfe.supplier.document)} · IE {nfe.supplier.state_registration||'—'} · {nfe.supplier.city}/{nfe.supplier.state}</p></div></header><div className="pxml-form-grid"><label className="wide">Fornecedor no ThorGestão<select value={supplierId} onChange={e=>changeSupplier(e.target.value)}><option value="__new__">＋ Cadastrar fornecedor com os dados do XML</option>{suppliers.map(s=><option key={text(s.id)} value={text(s.id)}>{text(s.name)} · {text(s.document)}</option>)}</select><small>{supplierId==='__new__'?'Será cadastrado somente quando a entrada for confirmada.':'Fornecedor existente reconhecido/selecionado.'}</small></label></div></section>

      <section className="pxml-card"><header className="pxml-title"><div><span>ITENS DA NOTA</span><h3>Vínculo, conversão e preço de venda</h3><p>Exemplo: XML em CX com 10 caixas × fator 12 = entrada de 120 UN. O custo é recalculado por unidade de estoque.</p></div><div className="pxml-badges"><span>{matchedCount} vinculados</span><span>{newCount} novos</span></div></header><div className="pxml-table-wrap"><table><thead><tr><th>Item do XML</th><th>Produto ThorGestão</th><th>Conversão</th><th>Entrada no estoque</th><th>Custo unit.</th><th>Preço venda</th><th>Margem</th></tr></thead><tbody>{items.map((item,index)=>{const cost=unitCost(item);const margin=cost>0?(item.salePrice/cost-1)*100:0;return <tr key={`${item.itemNo}-${item.code}`} className={item.createProduct?'new-product':''}><td><b>{item.code} · {item.name}</b><small>GTIN {item.ean||'sem GTIN'} · NCM {item.ncm||'—'} · CEST {item.cest||'—'} · CFOP {item.cfop||'—'}</small><small>XML: {item.quantity} {item.unit} × {money(item.unitPrice)} · líquido {money(item.netTotal)}</small></td><td><select value={item.createProduct?'__new__':item.productId} onChange={e=>chooseProduct(index,e.target.value)}><option value="__new__">＋ Cadastrar novo produto</option>{products.map(p=><option key={text(p.id)} value={text(p.id)}>{text(p.product_code)||text(p.sku)} · {text(p.name)}{text(p.variant_label)?` · ${text(p.variant_label)}`:''} · {text(p.unit)}</option>)}</select><small>{item.matchReason}</small>{item.createProduct&&<label className="inline">Unidade estoque<select value={item.stockUnit} onChange={e=>patchItem(index,{stockUnit:e.target.value})}>{units.map(u=><option key={text(u.code)} value={text(u.code)}>{text(u.code)} · {text(u.name)}</option>)}</select></label>}</td><td><label>1 {item.unit} = <input type="number" min="0.000001" step="0.001" value={item.conversionFactor} onChange={e=>patchItem(index,{conversionFactor:Math.max(num(e.target.value),0)})}/> {item.stockUnit}</label>{item.unit.toUpperCase()!==item.stockUnit.toUpperCase()&&<small className="attention">Confira o fator de conversão.</small>}</td><td><b>{stockQty(item).toLocaleString('pt-BR')} {item.stockUnit}</b><small>Quantidade que será somada ao estoque</small></td><td><b>{money(cost)}</b><small>Custo líquido após conversão</small></td><td><input className="price" type="number" min="0.01" step="0.01" value={item.salePrice} onChange={e=>patchItem(index,{salePrice:num(e.target.value)})}/><small>{item.createProduct?'Preço inicial do novo produto':'Novo preço de venda'}</small></td><td><b className={margin<0?'negative':''}>{margin.toLocaleString('pt-BR',{maximumFractionDigits:2})}%</b></td></tr>})}</tbody></table></div></section>

      <section className="pxml-card"><header className="pxml-title"><div><span>FINANCEIRO</span><h3>Classificação e contas a pagar</h3><p>As duplicatas do XML são carregadas quando existem. Você pode revisar vencimentos e valores antes da entrada.</p></div><span className={financeReady?'pxml-ok':'pxml-warn'}>{financeReady?'Financeiro conferido':'Revisar financeiro'}</span></header><div className="pxml-form-grid"><label>Categoria financeira<select value={categoryId} onChange={e=>changeCategory(e.target.value)}>{payableCategories.map(c=><option key={text(c.id)} value={text(c.id)}>{text(c.code)} · {text(c.name)}</option>)}</select></label><label>Plano de Contas<select value={accountId} onChange={e=>setAccountId(e.target.value)}>{postingAccounts.map(a=><option key={text(a.id)} value={text(a.id)}>{text(a.code)} · {text(a.name)}</option>)}</select></label><label>Centro de custo<select value={costCenterId} onChange={e=>setCostCenterId(e.target.value)}>{activeCenters.map(c=><option key={text(c.id)} value={text(c.id)}>{text(c.code)} · {text(c.name)}{text(c.branch_id)===currentBranchId?' · filial atual':''}</option>)}</select><small>{currentBranchName?`Filial atual: ${currentBranchName}`:''}</small></label><label>Observação<input value={notes} onChange={e=>setNotes(e.target.value)}/></label></div><div className="pxml-installments"><table><thead><tr><th>Duplicata</th><th>Vencimento</th><th>Valor</th></tr></thead><tbody>{installments.map((inst,index)=><tr key={`${inst.number}-${index}`}><td>{inst.number||index+1}</td><td><input type="date" value={inst.due_date} onChange={e=>setInstallments(v=>v.map((x,i)=>i===index?{...x,due_date:e.target.value}:x))}/></td><td><input type="number" min="0.01" step="0.01" value={inst.amount} onChange={e=>setInstallments(v=>v.map((x,i)=>i===index?{...x,amount:num(e.target.value)}:x))}/></td></tr>)}</tbody><tfoot><tr><td colSpan={2}>Total financeiro</td><td><strong>{money(financialTotal)}</strong></td></tr></tfoot></table>{Math.abs(financialDiff)>0.01&&<div className="pxml-diff"><span>Diferença para o total da NF-e: <b>{money(financialDiff)}</b></span><button type="button" onClick={normalizeInstallments}>Ajustar na última parcela</button></div>}</div></section>

      <section className="pxml-card pxml-confirm"><div><span>CONFIRMAÇÃO FINAL</span><h3>Importar NF-e e efetivar a entrada</h3><p>Ao confirmar, o ThorGestão valida novamente o CNPJ do destinatário no banco, grava a chave da NF-e, atualiza estoque/custo/preço, memoriza as conversões e cria as contas a pagar.</p><ul><li>Destinatário: {recipientMatches?'validado para a filial atual':'NÃO validado — entrada bloqueada'}</li><li>Fornecedor: {supplierId==='__new__'?'será cadastrado pelo XML':'vinculado ao cadastro existente'}</li><li>Itens: {items.length} · {matchedCount} vinculados · {newCount} novos</li><li>Total NF-e: {money(nfe.totals.invoice)} · Financeiro: {money(financialTotal)}</li></ul></div><button className="pxml-import" disabled={!ready||saving} onClick={()=>void finish()}>{saving?'Importando NF-e...':recipientMatches?'✓ Importar nota fiscal':'Destinatário inválido'}</button></section>
    </>}
  </div>;
}
