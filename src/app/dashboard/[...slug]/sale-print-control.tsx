'use client';

import {useEffect,useState} from 'react';
import {erpFiscalPrepare,erpFiscalSend} from './actions';
import {salesOptionsGet} from './sales-options-actions';

type ReceiptItem={name:string;sku:string;quantity:number;price:number;discount:number};
type ReceiptData={sale_id?:string;number?:string|number;subtotal:number;discount:number;total:number;items:ReceiptItem[];payment?:string;customer?:string;date?:string;fiscal_status?:string};
type Model='pre_sale'|'nfce';
type Behavior='ask'|'always'|'never';
const KEY='thorgestao.sale.print.model';
const money=(v:number)=>new Intl.NumberFormat('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2}).format(v);
const fit=(s:string,n:number)=>{const x=(s||'').replace(/\s+/g,' ').trim();return x.length>n?x.slice(0,n):x.padEnd(n,' ')};
const right=(s:string,n:number)=>String(s).slice(-n).padStart(n,' ');

function build44(data:ReceiptData,model:Model){
 const W=44;const line='-'.repeat(W);const out:string[]=[];const center=(s:string)=>{const t=s.slice(0,W);return ' '.repeat(Math.max(0,Math.floor((W-t.length)/2)))+t};
 out.push(center(model==='nfce'?'NFC-e / CUPOM DE VENDA':'PRE-VENDA / CUPOM DE VENDA'));out.push(center('THORGESTAO'));out.push(line);out.push(`Venda: ${String(data.number??'—')}`);out.push(`Data : ${data.date??new Date().toLocaleString('pt-BR')}`);if(data.customer)out.push(`Cliente: ${data.customer}`.slice(0,W));out.push(line);out.push('ITEM  QTD   V.UNIT      TOTAL');out.push(line);
 data.items.forEach((i,idx)=>{out.push(`${String(idx+1).padStart(3,'0')} ${fit(i.name,40)}`.slice(0,W));const total=i.quantity*i.price-i.discount;out.push(`${right(String(i.quantity),7)} ${right(money(i.price),12)} ${right(money(total),14)}`.slice(0,W));if(i.discount>0)out.push(`    Desc. item: -${money(i.discount)}`.slice(0,W));});
 out.push(line);out.push(`${fit('SUBTOTAL',24)}${right(money(data.subtotal),20)}`);if(data.discount>0)out.push(`${fit('DESCONTO',24)}${right('-'+money(data.discount),20)}`);out.push(`${fit('TOTAL',24)}${right(money(data.total),20)}`);if(data.payment)out.push(`${fit('PAGAMENTO',24)}${right(data.payment,20)}`);out.push(line);out.push(center(model==='nfce'?'NFC-e: emissao fiscal validada':'Documento sem valor fiscal'));out.push(center('Obrigado pela preferencia!'));return out.join('\n');
}

function printText(text:string){
 const w=window.open('','_blank','width=420,height=720');if(!w)return false;
 w.document.write(`<!doctype html><html><head><title>Impressão de venda</title><style>@page{size:80mm auto;margin:3mm}html,body{margin:0;padding:0;background:#fff}pre{font-family:"Courier New",monospace;font-size:10px;line-height:1.15;white-space:pre-wrap;width:44ch;margin:0 auto;color:#000}</style></head><body><pre>${text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</pre><script>window.onload=()=>{window.print();setTimeout(()=>window.close(),800)}<\/script></body></html>`);w.document.close();return true;
}

export function SalePrintControl(){
 const [model,setModel]=useState<Model>('nfce');const [behavior,setBehavior]=useState<Behavior>('ask');const [config,setConfig]=useState(false);const [receipt,setReceipt]=useState<ReceiptData|null>(null);const [ask,setAsk]=useState(false);const [printing,setPrinting]=useState(false);const [error,setError]=useState('');const [autoPrint,setAutoPrint]=useState(false);
 useEffect(()=>{
   let active=true;
   const saved=localStorage.getItem(KEY);
   if(saved==='nfce'||saved==='pre_sale')setModel(saved);
   void salesOptionsGet().then(r=>{
     if(!active||!r.ok)return;
     const rules=(r.session_rules&&typeof r.session_rules==='object'&&!Array.isArray(r.session_rules)?r.session_rules:{}) as Record<string,unknown>;
     const centralModel=String(rules.print_document??'');
     const centralBehavior=String(rules.print_behavior??'');
     if(centralModel==='nfce'||centralModel==='pre_sale'){setModel(centralModel);localStorage.setItem(KEY,centralModel);}
     if(centralBehavior==='ask'||centralBehavior==='always'||centralBehavior==='never')setBehavior(centralBehavior);
   }).catch(()=>{});
   return()=>{active=false};
 },[]);
 useEffect(()=>{const handler=(e:Event)=>{const detail=(e as CustomEvent<ReceiptData>).detail;if(!detail)return;setReceipt(detail);setError('');if(behavior==='never'){setAsk(false);setAutoPrint(false);return;}if(behavior==='always'){setAsk(false);setAutoPrint(true);return;}setAutoPrint(false);setAsk(true)};window.addEventListener('thorgestao:sale-completed',handler);return()=>window.removeEventListener('thorgestao:sale-completed',handler)},[behavior]);
 useEffect(()=>{if(autoPrint&&receipt&&!printing){setAutoPrint(false);void doPrint();}},[autoPrint,receipt]);
 function save(next:Model){setModel(next);localStorage.setItem(KEY,next)}
 async function doPrint(){
   if(!receipt)return;setPrinting(true);setError('');
   if(model==='nfce'){
     if(!receipt.sale_id){setPrinting(false);setError('A venda não retornou um identificador fiscal válido.');setAsk(true);return}
     const prepared=await erpFiscalPrepare(receipt.sale_id,'nfce');
     if(!prepared.ok){setPrinting(false);setError(`Não foi possível preparar a NFC-e: ${String(prepared.error??'erro')}`);setAsk(true);return}
     if(Array.isArray(prepared.validation_errors)&&prepared.validation_errors.length){setPrinting(false);setError(`NFC-e com pendências: ${prepared.validation_errors.map(String).join(' · ')}`);setAsk(true);return}
     const documentId=String(prepared.id??'');
     if(!documentId){setPrinting(false);setError('A NFC-e foi preparada, mas o documento fiscal não retornou ID.');setAsk(true);return}
     const sent=await erpFiscalSend(documentId);
     if(!sent.ok){setPrinting(false);setError(String(sent.message??`Não foi possível autorizar a NFC-e: ${String(sent.error??'erro')}`));setAsk(true);return}
   }
   const opened=printText(build44(receipt,model));setPrinting(false);if(!opened){setError('O navegador bloqueou a janela de impressão. Libere pop-ups para o ThorGestão.');setAsk(true);return;}setAsk(false);
 }
 return <>
  <button type="button" className="erp-sale-print-config" onClick={()=>setConfig(true)}>⚙ Documento: {model==='nfce'?'NFC-e':'Pré-venda'} · {behavior==='ask'?'Perguntar':behavior==='always'?'Automático':'Sem impressão'}</button>
  {config&&<div className="erp-sale-print-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setConfig(false)}}><section className="erp-sale-print-modal"><header><div><small>IMPRESSÃO</small><h3>Modelo do documento</h3></div><button onClick={()=>setConfig(false)}>×</button></header><p>O modelo e o comportamento padrão são definidos em Opções de Vendas → Sessão. Aqui você pode trocar apenas o modelo nesta estação.</p><div className="erp-sale-doc-options"><button className={model==='pre_sale'?'active':''} onClick={()=>save('pre_sale')}><b>Pré-venda</b><span>Documento comercial sem valor fiscal</span></button><button className={model==='nfce'?'active':''} onClick={()=>save('nfce')}><b>NFC-e</b><span>Prepara e autoriza a NFC-e antes de imprimir</span></button></div><footer><button onClick={()=>setConfig(false)}>Concluir</button></footer></section></div>}
  {ask&&receipt&&<div className="erp-sale-print-backdrop"><section className="erp-sale-print-modal confirm"><header><div><small>VENDA CONCLUÍDA</small><h3>{model==='nfce'?'Deseja imprimir a NFC-e?':'Deseja imprimir a pré-venda?'}</h3></div></header><p>Venda nº <b>{String(receipt.number??'')}</b> concluída por <b>R$ {money(receipt.total)}</b>. Documento atual: <b>{model==='nfce'?'NFC-e':'Pré-venda'}</b>.</p><div className="erp-sale-print-preview"><pre>{build44(receipt,model)}</pre></div>{error&&<p className="erp-sale-print-error">{error}</p>}<footer><button className="secondary" disabled={printing} onClick={()=>setAsk(false)}>Não imprimir</button><button className="primary" disabled={printing} onClick={doPrint}>{printing?'Processando NFC-e...':'Selecionar impressora'}</button></footer></section></div>}
 </>;
}
