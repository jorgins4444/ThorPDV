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
type Step=0|1|2|3|4|5;

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
const steps=['XML','Fornecedor','Produtos','Preços','Financeiro','Confirmar'] as const;

function addDays(value:string,days:number){const d=new Date(`${value||today()}T12:00:00`);d.setDate(d.getDate()+days);return d.toISOString().slice(0,10)}
function xmlEl(root:XmlRoot,tag:string){return root.getElementsByTagNameNS('*',tag)[0]??root.getElementsByTagName(tag)[0]??null}
function xmlText(root:XmlRoot|null,tag:string){return root?text(xmlEl(root,tag)?.textContent).trim():''}
function xmlNumber(root:XmlRoot|null,tag:string){return num(xmlText(root,tag))}
function usableEan(v:string){const d=digits(v);return d.length>=8&&d.length<=14?d:''}
function purchaseUnits(row:Row){return Array.isArray(row.purchase_units)?row.purchase_units as Row[]:[]}

function parseParty(root:Element|null,addressTag:string):PartyXml{
  const ender=root?xmlEl(root,addressTag):null;
  return {
    document:digits(xmlText(root,'CNPJ')||xmlText(root,'CPF')),
    name:xmlText(root,'xNome'),trade_name:xmlText(root,'xFant'),state_registration:xmlText(root,'IE'),
    email:xmlText(root,'email'),phone:xmlText(ender,'fone'),street:xmlText(ender,'xLgr'),number:xmlText(ender,'nro'),
    complement:xmlText(ender,'xCpl'),district:xmlText(ender,'xBairro'),city:xmlText(ender,'xMun'),state:xmlText(ender,'UF'),
    postal_code:digits(xmlText(ender,'CEP')),ibge_city_code:xmlText(ender,'cMun')
  };
}

function parseNfe(rawXml:string):ParsedNfe{
  const doc=new DOMParser().parseFromString(rawXml,'application/xml');
  if(doc.getElementsByTagName('parsererror').length)throw new Error('O arquivo não contém um XML válido.');
  const inf=xmlEl(doc,'infNFe');
  if(!inf)throw new Error('Não encontrei a estrutura infNFe no arquivo. Selecione o XML autorizado da NF-e.');
  const ide=xmlEl(inf,'ide');
  const emit=xmlEl(inf,'emit');
  const dest=xmlEl(inf,'dest');
  const total=xmlEl(inf,'ICMSTot');
  const transp=xmlEl(inf,'transp');
  const transporta=transp?xmlEl(transp,'transporta'):null;
  const vehicle=transp?xmlEl(transp,'veicTransp'):null;
  const model=xmlText(ide,'mod');
  if(model&&model!=='55')throw new Error(`O documento é modelo ${model}. Esta rotina foi criada para NF-e modelo 55.`);
  const key=(text(inf.getAttribute('Id')).replace(/^NFe/i,'')||digits(xmlText(doc,'chNFe'))).trim();
  if(digits(key).length!==44)throw new Error('A chave de acesso da NF-e não pôde ser identificada.');
  const issueRaw=xmlText(ide,'dhEmi')||xmlText(ide,'dEmi')||today();
  const issueDate=issueRaw.slice(0,10);
  const supplier=parseParty(emit,'enderEmit');
  const destination=parseParty(dest,'enderDest');
  if(!destination.document)throw new Error('O XML não possui CNPJ do destinatário no grupo dest. O arquivo foi rejeitado.');

  const dets=Array.from(inf.getElementsByTagNameNS('*','det'));
  const items=dets.map((det,index)=>{
    const prod=xmlEl(det,'prod');
    if(!prod)throw new Error(`O item ${index+1} não possui o grupo de produto.`);
    const gross=xmlNumber(prod,'vProd');
    const discount=xmlNumber(prod,'vDesc');
    return {
      itemNo:Number(det.getAttribute('nItem')||index+1),code:xmlText(prod,'cProd'),
      ean:usableEan(xmlText(prod,'cEAN')||xmlText(prod,'cEANTrib')),name:xmlText(prod,'xProd'),
      ncm:xmlText(prod,'NCM'),cest:xmlText(prod,'CEST'),cfop:xmlText(prod,'CFOP'),
      unit:xmlText(prod,'uCom')||xmlText(prod,'uTrib')||'UN',
      quantity:xmlNumber(prod,'qCom')||xmlNumber(prod,'qTrib'),
      unitPrice:xmlNumber(prod,'vUnCom')||xmlNumber(prod,'vUnTrib'),
      grossTotal:gross,discount,netTotal:round(gross-discount)
    } as ParsedItem;
  });
  if(!items.length)throw new Error('A NF-e não possui itens de produto.');

  const products=xmlNumber(total,'vProd')||round(items.reduce((s,i)=>s+i.grossTotal,0));
  const discount=xmlNumber(total,'vDesc')||round(items.reduce((s,i)=>s+i.discount,0));
  const freight=xmlNumber(total,'vFrete');
  const insurance=xmlNumber(total,'vSeg');
  const other=xmlNumber(total,'vOutro');
  const invoice=xmlNumber(total,'vNF');
  if(invoice<=0)throw new Error('O total vNF da nota é inválido.');
  const netGoods=round(items.reduce((s,i)=>s+i.netTotal,0));
  const taxAdjustment=round(invoice-(netGoods+freight+insurance+other));

  const dupNodes=Array.from(inf.getElementsByTagNameNS('*','dup'));
  let installments=dupNodes
    .map((dup,index)=>({number:xmlText(dup,'nDup')||String(index+1),due_date:xmlText(dup,'dVenc')||addDays(issueDate,30*(index+1)),amount:xmlNumber(dup,'vDup')}))
    .filter(x=>x.amount>0);
  if(!installments.length)installments=[{number:'1',due_date:addDays(issueDate,30),amount:invoice}];

  const paymentNodes=Array.from(inf.getElementsByTagNameNS('*','detPag'));
  const payments=paymentNodes.map(p=>({code:xmlText(p,'tPag'),amount:xmlNumber(p,'vPag')})).filter(p=>p.amount>0);

  return {
    key:digits(key),model:model||'55',series:xmlText(ide,'serie'),number:xmlText(ide,'nNF'),issueDate,
    ide:{nature:xmlText(ide,'natOp'),operationType:xmlText(ide,'tpNF'),purpose:xmlText(ide,'finNFe'),consumer:xmlText(ide,'indFinal')},
    supplier,destination,
    transport:{freightMode:xmlText(transp,'modFrete'),carrierName:xmlText(transporta,'xNome'),carrierDocument:digits(xmlText(transporta,'CNPJ')||xmlText(transporta,'CPF')),plate:xmlText(vehicle,'placa'),uf:xmlText(vehicle,'UF')},
    payments,items,installments,
    totals:{products,discount,freight,insurance,other,invoice,taxAdjustment,icms:xmlNumber(total,'vICMS'),ipi:xmlNumber(total,'vIPI'),st:xmlNumber(total,'vST')},
    rawXml,
  };
}

const importError=(value:unknown)=>{
  const e=text(value);
  const map:Record<string,string>={
    invalid_nfe_access_key:'Chave de acesso da NF-e inválida.',
    nfe_already_imported:'Esta NF-e já foi importada anteriormente.',
    branch_cnpj_not_configured:'A filial atual não possui CNPJ configurado. A entrada por XML foi bloqueada.',
    invalid_destination_cnpj:'O XML não possui um CNPJ de destinatário válido.',
    nfe_destination_mismatch:'O CNPJ do destinatário da NF-e não corresponde à filial atual.',
    supplier_not_found:'Não foi possível identificar ou cadastrar o fornecedor.',
    purchase_without_items:'A nota não possui itens válidos.',
    xml_item_product_required:'Há item sem produto vinculado ou marcado para cadastro.',
    xml_product_create_failed:'Não foi possível cadastrar um dos produtos do XML.',
    invalid_payment_installment:'Revise as parcelas e vencimentos.',
    installments_total_mismatch:'A soma das parcelas não confere com o total da NF-e.',
    invalid_financial_category:'Selecione uma categoria financeira válida.',
    invalid_chart_account:'Selecione uma conta analítica válida do Plano de Contas.',
    invalid_cost_center:'Selecione um centro de custo válido.',
    product_not_found:'Um produto vinculado não foi encontrado.'
  };
  return map[e]||e||'Erro não identificado.';
};

export function PurchaseXmlWorkspace({
  suppliers,products,links,units,categories,chartAccounts,costCenters,
  currentBranchId,currentBranchName,currentBranchDocument,currentCompanyName
}:{
  suppliers:Row[];products:Row[];links:Row[];units:Row[];categories:Row[];chartAccounts:Row[];costCenters:Row[];
  currentBranchId:string;currentBranchName:string;currentBranchDocument:string;currentCompanyName:string
}){
  const [step,setStep]=useState<Step>(0);
  const [nfe,setNfe]=useState<ParsedNfe|null>(null);
  const [fileName,setFileName]=useState('');
  const [supplierId,setSupplierId]=useState('');
  const [items,setItems]=useState<ReviewItem[]>([]);
  const [installments,setInstallments]=useState<Installment[]>([]);
  const [message,setMessage]=useState('');
  const [saving,setSaving]=useState(false);
  const [completed,setCompleted]=useState<{number:string;purchaseNumber:string;installments:string}|null>(null);

  const payableCategories=useMemo(()=>categories.filter(c=>c.active!==false&&['payable','both'].includes(text(c.entry_type))),[categories]);
  const postingAccounts=useMemo(()=>chartAccounts.filter(a=>a.active!==false&&a.posting!==false&&['liability','cost','expense'].includes(text(a.account_type))),[chartAccounts]);
  const activeCenters=useMemo(()=>costCenters.filter(c=>c.active!==false).slice().sort((a,b)=>{
    const rank=(c:Row)=>text(c.branch_id)===currentBranchId?0:!text(c.branch_id)?1:2;
    return rank(a)-rank(b)||text(a.name).localeCompare(text(b.name),'pt-BR');
  }),[costCenters,currentBranchId]);

  const defaultCategory=payableCategories.find(c=>text(c.code)==='PURCHASE_RESALE')??payableCategories[0];
  const [categoryId,setCategoryId]=useState(text(defaultCategory?.id));
  const [accountId,setAccountId]=useState(text(postingAccounts.find(a=>text(a.id)===text(defaultCategory?.default_chart_account_id))?.id??postingAccounts[0]?.id));
  const defaultCenter=activeCenters.find(c=>text(c.branch_id)===currentBranchId&&c.is_default===true)
    ??activeCenters.find(c=>text(c.branch_id)===currentBranchId)
    ??activeCenters.find(c=>!text(c.branch_id)&&c.is_default===true)
    ??activeCenters[0];
  const [costCenterId,setCostCenterId]=useState(text(defaultCenter?.id));
  const [notes,setNotes]=useState('');

  const expectedRecipient=digits(currentBranchDocument);
  const branchCnpjReady=expectedRecipient.length===14;

  function resetDraft(keepMessage=false){
    setNfe(null);setFileName('');setSupplierId('');setItems([]);setInstallments([]);setNotes('');
    setCategoryId(text(defaultCategory?.id));
    setAccountId(text(postingAccounts.find(a=>text(a.id)===text(defaultCategory?.default_chart_account_id))?.id??postingAccounts[0]?.id));
    setCostCenterId(text(defaultCenter?.id));
    setCompleted(null);setStep(0);
    if(!keepMessage)setMessage('');
  }

  function matchProduct(item:ParsedItem,supplier:string):ReviewItem{
    const link=links.find(l=>text(l.supplier_id)===supplier&&text(l.source_code)===item.code);
    let product=link?products.find(p=>text(p.id)===text(link.product_id)):undefined;
    let reason=product?'Vínculo salvo do fornecedor':'';
    if(!product&&item.ean){
      product=products.find(p=>digits(p.barcode)===item.ean||purchaseUnits(p).some(u=>digits(u.barcode)===item.ean));
      if(product)reason='Código de barras / GTIN';
    }
    if(!product&&item.code){
      product=products.find(p=>text(p.sku).trim().toLowerCase()===item.code.trim().toLowerCase());
      if(product)reason='Código/SKU coincidente';
    }
    const stockUnit=text(product?.unit)||((units.some(u=>text(u.code).toUpperCase()===item.unit.toUpperCase()))?item.unit.toUpperCase():'UN');
    const savedPurchaseUnit=product?purchaseUnits(product).find(u=>text(u.unit).toUpperCase()===item.unit.toUpperCase()):undefined;
    const factor=Math.max(num(link?.conversion_factor)||num(savedPurchaseUnit?.conversion_factor)||(item.unit.toUpperCase()===stockUnit.toUpperCase()?1:1),0.000001);
    const stockQty=item.quantity*factor;
    const cost=stockQty>0?item.netTotal/stockQty:0;
    return {
      ...item,productId:text(product?.id),createProduct:!product,stockUnit,conversionFactor:factor,
      salePrice:num(product?.sale_price)>0?num(product?.sale_price):round(cost),
      matchReason:reason||'Novo produto / conferência necessária'
    };
  }

  async function loadXml(e:ChangeEvent<HTMLInputElement>){
    const file=e.target.files?.[0];
    if(!file)return;
    resetDraft();
    setMessage('');
    try{
      if(!branchCnpjReady)throw new Error(`A filial ${currentBranchName||currentCompanyName||'atual'} não possui CNPJ válido cadastrado. Não é possível carregar NF-e.`);
      const raw=await file.text();
      const parsed=parseNfe(raw);

      if(parsed.destination.document!==expectedRecipient){
        throw new Error(
          `NF-e rejeitada. O destinatário do XML é ${fmtDoc(parsed.destination.document)} (${parsed.destination.name||'sem razão social'}), `+
          `mas a filial atual é ${fmtDoc(expectedRecipient)} (${currentBranchName||currentCompanyName||'filial atual'}). Nenhum dado da nota foi carregado.`
        );
      }

      const matchedSupplier=suppliers.find(s=>digits(s.document)===parsed.supplier.document);
      const sid=matchedSupplier?text(matchedSupplier.id):'__new__';
      const preparedItems=parsed.items.map(i=>matchProduct(i,matchedSupplier?text(matchedSupplier.id):''));

      setNfe(parsed);
      setFileName(file.name);
      setSupplierId(sid);
      setItems(preparedItems);
      setInstallments(parsed.installments);
      setNotes(`Entrada por XML da NF-e ${parsed.number} · chave ${parsed.key}`);
      setMessage('');
      setStep(1);
    }catch(err){
      resetDraft(true);
      setMessage(err instanceof Error?err.message:'Não foi possível ler o XML.');
    }finally{
      e.target.value='';
    }
  }

  function changeSupplier(value:string){
    setSupplierId(value);
    if(nfe)setItems(nfe.items.map(i=>matchProduct(i,value==='__new__'?'':value)));
  }
  function patchItem(index:number,patch:Partial<ReviewItem>){setItems(current=>current.map((item,i)=>i===index?{...item,...patch}:item))}
  function chooseProduct(index:number,value:string){
    const current=items[index];
    if(!current)return;
    if(value==='__new__'){
      const stockUnit=units.some(u=>text(u.code).toUpperCase()===current.unit.toUpperCase())?current.unit.toUpperCase():'UN';
      patchItem(index,{productId:'',createProduct:true,stockUnit,conversionFactor:stockUnit===current.unit.toUpperCase()?1:current.conversionFactor,matchReason:'Cadastrar novo produto'});
      return;
    }
    const p=products.find(x=>text(x.id)===value);
    if(!p)return;
    const pu=purchaseUnits(p).find(u=>text(u.unit).toUpperCase()===current.unit.toUpperCase());
    patchItem(index,{
      productId:value,createProduct:false,stockUnit:text(p.unit)||'UN',
      conversionFactor:num(pu?.conversion_factor)||(current.unit.toUpperCase()===text(p.unit).toUpperCase()?1:current.conversionFactor),
      salePrice:num(p.sale_price)||current.salePrice,matchReason:'Vínculo manual'
    });
  }

  const stockQty=(i:ReviewItem)=>round(i.quantity*Math.max(i.conversionFactor,0));
  const unitCost=(i:ReviewItem)=>{const q=i.quantity*Math.max(i.conversionFactor,0);return q>0?i.netTotal/q:0};
  const supplierReady=Boolean(nfe&&supplierId);
  const productsReady=items.length>0&&items.every(i=>(i.createProduct||Boolean(i.productId))&&i.conversionFactor>0&&stockQty(i)>0&&unitCost(i)>=0&&Boolean(i.stockUnit));
  const pricesReady=productsReady&&items.every(i=>i.salePrice>0);
  const financialTotal=round(installments.reduce((s,i)=>s+num(i.amount),0));
  const financialDiff=round((nfe?.totals.invoice??0)-financialTotal);
  const financeReady=Boolean(nfe)&&Boolean(categoryId)&&Boolean(accountId)&&Boolean(costCenterId)&&installments.length>0
    &&installments.every(i=>Boolean(i.due_date)&&i.amount>0)&&Math.abs(financialDiff)<=0.01;
  const ready=Boolean(nfe)&&supplierReady&&pricesReady&&financeReady;
  const matchedCount=items.filter(i=>!i.createProduct&&i.productId).length;
  const newCount=items.filter(i=>i.createProduct).length;

  const unlocked=(target:Step)=>{
    if(target===0)return true;
    if(target===1)return Boolean(nfe);
    if(target===2)return supplierReady;
    if(target===3)return productsReady;
    if(target===4)return pricesReady;
    return financeReady;
  };
  function go(target:Step){if(unlocked(target)&&!saving)setStep(target)}
  function next(){
    if(step===0&&nfe)go(1);
    else if(step===1&&supplierReady)go(2);
    else if(step===2&&productsReady)go(3);
    else if(step===3&&pricesReady)go(4);
    else if(step===4&&financeReady)go(5);
  }

  function normalizeInstallments(){
    if(!nfe||!installments.length)return;
    setInstallments(current=>current.map((item,index)=>index===current.length-1?{...item,amount:round(item.amount+financialDiff)}:item));
  }
  function changeCategory(value:string){
    setCategoryId(value);
    const c=payableCategories.find(x=>text(x.id)===value);
    if(c?.default_chart_account_id)setAccountId(text(c.default_chart_account_id));
  }

  async function finish(){
    if(!nfe||!ready||completed)return;
    setSaving(true);setMessage('');
    const r=await purchaseXmlImport({
      supplier_id:supplierId==='__new__'?null:supplierId,
      supplier:nfe.supplier,
      destination_document:nfe.destination.document,
      nfe_access_key:nfe.key,nfe_model:nfe.model,nfe_series:nfe.series,
      document_number:nfe.number,issue_date:nfe.issueDate,due_date:installments[0]?.due_date,
      financial_category_id:categoryId,chart_account_id:accountId,cost_center_id:costCenterId,
      freight:nfe.totals.freight,insurance:nfe.totals.insurance,other_expenses:nfe.totals.other,tax_adjustment:nfe.totals.taxAdjustment,
      notes,payment_installments:installments.map(i=>({due_date:i.due_date,amount:i.amount})),
      items:items.map(i=>({
        product_id:i.createProduct?null:i.productId,create_product:i.createProduct,
        source_item_no:i.itemNo,source_code:i.code,source_ean:i.ean,source_name:i.name,source_unit:i.unit,
        source_quantity:i.quantity,source_unit_cost:i.unitPrice,source_ncm:i.ncm,source_cest:i.cest,source_cfop:i.cfop,
        stock_unit:i.stockUnit,conversion_factor:i.conversionFactor,quantity:stockQty(i),unit_cost:unitCost(i),sale_price:i.salePrice
      })),
      xml_metadata:{
        file_name:fileName,raw_xml:nfe.rawXml,ide:nfe.ide,totals:nfe.totals,supplier:nfe.supplier,
        destination:nfe.destination,transport:nfe.transport,payments:nfe.payments,imported_from:'thorgestao_purchase_xml'
      },
    });
    setSaving(false);
    if(!r.ok){setMessage(`Não foi possível importar a NF-e: ${importError(r.error)}`);return;}
    setCompleted({number:nfe.number,purchaseNumber:text(r.number),installments:text(r.installments)});
    setMessage('');
  }

  return <div className="pxml">
    <nav className="pxml-tabs" aria-label="Etapas da entrada de NF-e">
      {steps.map((label,index)=>{
        const target=index as Step;
        const available=unlocked(target);
        const done=step>target||Boolean(completed&&target===5);
        return <button
          type="button"
          key={label}
          className={`pxml-tab ${step===target?'active':''} ${done?'done':''} ${!available?'locked':''}`}
          onClick={()=>go(target)}
          disabled={!available||saving}
        >
          <span>{done?'✓':index+1}</span>
          <b>{label}</b>
        </button>;
      })}
    </nav>

    {nfe&&step>0&&<div className="pxml-summarybar">
      <div><span>NF-e</span><b>{nfe.number} · Série {nfe.series||'—'}</b></div>
      <div><span>Emitente</span><b>{nfe.supplier.name}</b></div>
      <div><span>Destinatário validado</span><b>{currentBranchName||currentCompanyName||'Filial atual'} · {fmtDoc(currentBranchDocument)}</b></div>
      <div><span>Total</span><strong>{money(nfe.totals.invoice)}</strong></div>
    </div>}

    {message&&<div className="pxml-message pxml-error" role="alert">{message}</div>}

    {step===0&&<section className="pxml-card pxml-stage pxml-upload-stage">
      <div className="pxml-stage-head">
        <span>ETAPA 1 DE 6</span>
        <h2>Selecionar XML da NF-e</h2>
        <p>O ThorGestão primeiro verifica o CNPJ do destinatário. Se a nota não pertencer à filial atual, o arquivo é rejeitado e nenhum dado é carregado.</p>
      </div>
      <div className="pxml-branch-lock">
        <div><span>Filial que receberá a nota</span><b>{currentBranchName||currentCompanyName||'—'}</b><small>CNPJ: {fmtDoc(currentBranchDocument)}</small></div>
        <div className={branchCnpjReady?'ok':'bad'}><strong>{branchCnpjReady?'Pronta para validar NF-e':'CNPJ da filial não configurado'}</strong><small>{branchCnpjReady?'Somente notas destinadas a este CNPJ serão aceitas.':'Cadastre o CNPJ da filial antes de importar.'}</small></div>
      </div>
      <div className="pxml-upload-actions">
        <label className={`pxml-file ${!branchCnpjReady?'disabled':''}`}>Selecionar XML<input disabled={!branchCnpjReady} type="file" accept=".xml,text/xml,application/xml" onChange={loadXml}/></label>
        <Link href="/dashboard/compras" className="pxml-secondary">Entrada manual</Link>
      </div>
    </section>}

    {step===1&&nfe&&<section className="pxml-card pxml-stage">
      <header className="pxml-title">
        <div><span>ETAPA 2 DE 6 · FORNECEDOR</span><h3>{nfe.supplier.name}</h3><p>CNPJ/CPF {fmtDoc(nfe.supplier.document)} · IE {nfe.supplier.state_registration||'—'} · {nfe.supplier.city}/{nfe.supplier.state}</p></div>
        <span className="pxml-ok">Destinatário validado</span>
      </header>
      <div className="pxml-nfe-overview">
        <div><span>Natureza</span><b>{nfe.ide.nature||'—'}</b></div>
        <div><span>Emissão</span><b>{fmtDate(nfe.issueDate)}</b></div>
        <div><span>Finalidade</span><b>{purposeLabel(nfe.ide.purpose)}</b></div>
        <div><span>Operação</span><b>{operationLabel(nfe.ide.operationType)}</b></div>
        <div><span>Itens</span><b>{nfe.items.length}</b></div>
        <div><span>Total NF-e</span><strong>{money(nfe.totals.invoice)}</strong></div>
      </div>
      <div className="pxml-form-grid">
        <label className="wide">Fornecedor no ThorGestão
          <select value={supplierId} onChange={e=>changeSupplier(e.target.value)}>
            <option value="__new__">＋ Cadastrar fornecedor com os dados do XML</option>
            {suppliers.map(s=><option key={text(s.id)} value={text(s.id)}>{text(s.name)} · {text(s.document)}</option>)}
          </select>
          <small>{supplierId==='__new__'?'O fornecedor será cadastrado somente na confirmação final.':'Fornecedor existente reconhecido/selecionado.'}</small>
        </label>
      </div>
      <div className="pxml-detail-strip">
        <span>Chave: {nfe.key}</span>
        <span>Frete: {freightLabel(nfe.transport.freightMode)}</span>
        <span>ICMS: {money(nfe.totals.icms)}</span>
        <span>IPI: {money(nfe.totals.ipi)}</span>
        <span>ST: {money(nfe.totals.st)}</span>
      </div>
      <div className="pxml-nav">
        <button className="pxml-secondary" type="button" onClick={()=>go(0)}>Trocar XML</button>
        <button className="pxml-primary" type="button" disabled={!supplierReady} onClick={next}>Avançar para produtos</button>
      </div>
    </section>}

    {step===2&&nfe&&<section className="pxml-card pxml-stage">
      <header className="pxml-title">
        <div><span>ETAPA 3 DE 6 · PRODUTOS E CONVERSÃO</span><h3>Relacionar os itens da NF-e ao estoque</h3><p>Defina o produto correspondente e a conversão da unidade comprada para a unidade usada no estoque.</p></div>
        <div className="pxml-badges"><span>{matchedCount} vinculados</span><span>{newCount} novos</span></div>
      </header>
      <div className="pxml-table-wrap">
        <table>
          <thead><tr><th>Item do XML</th><th>Produto ThorGestão</th><th>Conversão</th><th>Entrada no estoque</th><th>Custo unitário</th></tr></thead>
          <tbody>{items.map((item,index)=><tr key={`${item.itemNo}-${item.code}`} className={item.createProduct?'new-product':''}>
            <td><b>{item.code} · {item.name}</b><small>GTIN {item.ean||'sem GTIN'} · NCM {item.ncm||'—'} · CFOP {item.cfop||'—'}</small><small>NF-e: {item.quantity} {item.unit} × {money(item.unitPrice)}</small></td>
            <td>
              <select value={item.createProduct?'__new__':item.productId} onChange={e=>chooseProduct(index,e.target.value)}>
                <option value="__new__">＋ Cadastrar novo produto</option>
                {products.map(p=><option key={text(p.id)} value={text(p.id)}>{text(p.product_code)||text(p.sku)} · {text(p.name)}{text(p.variant_label)?` · ${text(p.variant_label)}`:''} · {text(p.unit)}</option>)}
              </select>
              <small>{item.matchReason}</small>
              {item.createProduct&&<label className="inline">Unidade estoque
                <select value={item.stockUnit} onChange={e=>patchItem(index,{stockUnit:e.target.value})}>
                  {units.map(u=><option key={text(u.code)} value={text(u.code)}>{text(u.code)} · {text(u.name)}</option>)}
                </select>
              </label>}
            </td>
            <td><label>1 {item.unit} = <input type="number" min="0.000001" step="0.001" value={item.conversionFactor} onChange={e=>patchItem(index,{conversionFactor:Math.max(num(e.target.value),0)})}/> {item.stockUnit}</label>{item.unit.toUpperCase()!==item.stockUnit.toUpperCase()&&<small className="attention">Confira o fator.</small>}</td>
            <td><b>{stockQty(item).toLocaleString('pt-BR')} {item.stockUnit}</b><small>Quantidade que entrará no estoque</small></td>
            <td><b>{money(unitCost(item))}</b><small>Custo líquido após conversão</small></td>
          </tr>)}</tbody>
        </table>
      </div>
      <div className="pxml-nav">
        <button className="pxml-secondary" type="button" onClick={()=>go(1)}>Voltar</button>
        <button className="pxml-primary" type="button" disabled={!productsReady} onClick={next}>Avançar para preços</button>
      </div>
    </section>}

    {step===3&&nfe&&<section className="pxml-card pxml-stage">
      <header className="pxml-title">
        <div><span>ETAPA 4 DE 6 · PRECIFICAÇÃO</span><h3>Revisar custos e definir preços de venda</h3><p>O custo vem da NF-e já convertido para a unidade de estoque. Defina o preço que ficará ativo após a entrada.</p></div>
        <span className={pricesReady?'pxml-ok':'pxml-warn'}>{pricesReady?'Preços conferidos':'Revisar preços'}</span>
      </header>
      <div className="pxml-price-grid">
        {items.map((item,index)=>{
          const cost=unitCost(item);
          const margin=cost>0?(item.salePrice/cost-1)*100:0;
          const selected=products.find(p=>text(p.id)===item.productId);
          return <article key={`${item.itemNo}-${item.code}`} className="pxml-price-card">
            <div className="pxml-price-name"><span>ITEM {item.itemNo}</span><h4>{item.name}</h4><small>{item.createProduct?'Novo produto':text(selected?.name)||'Produto vinculado'} · {stockQty(item).toLocaleString('pt-BR')} {item.stockUnit}</small></div>
            <div><span>Custo unitário</span><b>{money(cost)}</b></div>
            <div><span>Preço atual</span><b>{item.createProduct?'—':money(selected?.sale_price)}</b></div>
            <label>Preço de venda<input type="number" min="0.01" step="0.01" value={item.salePrice} onChange={e=>patchItem(index,{salePrice:num(e.target.value)})}/></label>
            <div><span>Margem</span><strong className={margin<0?'negative':''}>{margin.toLocaleString('pt-BR',{maximumFractionDigits:2})}%</strong></div>
          </article>;
        })}
      </div>
      <div className="pxml-nav">
        <button className="pxml-secondary" type="button" onClick={()=>go(2)}>Voltar</button>
        <button className="pxml-primary" type="button" disabled={!pricesReady} onClick={next}>Avançar para financeiro</button>
      </div>
    </section>}

    {step===4&&nfe&&<section className="pxml-card pxml-stage">
      <header className="pxml-title">
        <div><span>ETAPA 5 DE 6 · FINANCEIRO</span><h3>Classificação e contas a pagar</h3><p>Confira categoria, Plano de Contas, Centro de Custo e parcelas antes da confirmação final.</p></div>
        <span className={financeReady?'pxml-ok':'pxml-warn'}>{financeReady?'Financeiro conferido':'Revisar financeiro'}</span>
      </header>
      <div className="pxml-form-grid">
        <label>Categoria financeira<select value={categoryId} onChange={e=>changeCategory(e.target.value)}>{payableCategories.map(c=><option key={text(c.id)} value={text(c.id)}>{text(c.code)} · {text(c.name)}</option>)}</select></label>
        <label>Plano de Contas<select value={accountId} onChange={e=>setAccountId(e.target.value)}>{postingAccounts.map(a=><option key={text(a.id)} value={text(a.id)}>{text(a.code)} · {text(a.name)}</option>)}</select></label>
        <label>Centro de custo<select value={costCenterId} onChange={e=>setCostCenterId(e.target.value)}>{activeCenters.map(c=><option key={text(c.id)} value={text(c.id)}>{text(c.code)} · {text(c.name)}{text(c.branch_id)===currentBranchId?' · filial atual':''}</option>)}</select></label>
        <label>Observação<input value={notes} onChange={e=>setNotes(e.target.value)}/></label>
      </div>
      <div className="pxml-installments">
        <table>
          <thead><tr><th>Duplicata</th><th>Vencimento</th><th>Valor</th></tr></thead>
          <tbody>{installments.map((inst,index)=><tr key={`${inst.number}-${index}`}>
            <td>{inst.number||index+1}</td>
            <td><input type="date" value={inst.due_date} onChange={e=>setInstallments(v=>v.map((x,i)=>i===index?{...x,due_date:e.target.value}:x))}/></td>
            <td><input type="number" min="0.01" step="0.01" value={inst.amount} onChange={e=>setInstallments(v=>v.map((x,i)=>i===index?{...x,amount:num(e.target.value)}:x))}/></td>
          </tr>)}</tbody>
          <tfoot><tr><td colSpan={2}>Total financeiro</td><td><strong>{money(financialTotal)}</strong></td></tr></tfoot>
        </table>
        {Math.abs(financialDiff)>0.01&&<div className="pxml-diff"><span>Diferença para o total da NF-e: <b>{money(financialDiff)}</b></span><button type="button" onClick={normalizeInstallments}>Ajustar na última parcela</button></div>}
      </div>
      <div className="pxml-nav">
        <button className="pxml-secondary" type="button" onClick={()=>go(3)}>Voltar</button>
        <button className="pxml-primary" type="button" disabled={!financeReady} onClick={next}>Revisar e confirmar</button>
      </div>
    </section>}

    {step===5&&nfe&&<section className="pxml-card pxml-stage pxml-final-stage">
      {!completed?<>
        <header className="pxml-title"><div><span>ETAPA 6 DE 6 · CONFIRMAÇÃO</span><h3>Revisar a entrada antes de efetivar</h3><p>Nada será gravado até clicar em “Importar nota fiscal”. O backend revalida o CNPJ diretamente no XML bruto.</p></div><span className="pxml-ok">Pronta para importar</span></header>
        <div className="pxml-review-grid">
          <div><span>NF-e</span><b>{nfe.number} · Série {nfe.series||'—'}</b><small>{nfe.key}</small></div>
          <div><span>Destinatário</span><b>{nfe.destination.name}</b><small>{fmtDoc(nfe.destination.document)} · filial validada</small></div>
          <div><span>Fornecedor</span><b>{nfe.supplier.name}</b><small>{supplierId==='__new__'?'Será cadastrado':'Cadastro existente vinculado'}</small></div>
          <div><span>Produtos</span><b>{items.length} item(ns)</b><small>{matchedCount} vinculados · {newCount} novos</small></div>
          <div><span>Total NF-e</span><strong>{money(nfe.totals.invoice)}</strong><small>Financeiro: {money(financialTotal)}</small></div>
          <div><span>Classificação</span><b>{text(postingAccounts.find(a=>text(a.id)===accountId)?.code)} · {text(postingAccounts.find(a=>text(a.id)===accountId)?.name)}</b><small>{text(activeCenters.find(c=>text(c.id)===costCenterId)?.name)}</small></div>
        </div>
        <div className="pxml-nav">
          <button className="pxml-secondary" type="button" onClick={()=>go(4)}>Voltar</button>
          <button className="pxml-import" disabled={!ready||saving} onClick={()=>void finish()}>{saving?'Importando NF-e...':'✓ Importar nota fiscal'}</button>
        </div>
      </>:<div className="pxml-success">
        <span>✓</span>
        <h3>NF-e {completed.number} importada com sucesso</h3>
        <p>Compra nº {completed.purchaseNumber} criada. Estoque, custos, preços e {completed.installments} título(s) a pagar foram atualizados.</p>
        <div>
          <button type="button" className="pxml-primary" onClick={()=>resetDraft()}>Importar outra NF-e</button>
          <Link className="pxml-secondary" href="/dashboard/compras">Ver Compras / Entradas</Link>
        </div>
      </div>}
    </section>}
  </div>;
}
