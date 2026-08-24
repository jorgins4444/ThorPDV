'use client';

import {useEffect,useState} from 'react';

type ReceiptItem={name:string;sku:string;quantity:number;price:number;discount:number};
type ReceiptData={sale_id?:string;number?:string|number;subtotal:number;discount:number;total:number;items:ReceiptItem[];payment?:string;customer?:string;date?:string};
type Model='pre_sale'|'nfce';
const KEY='thorgestao.sale.print.model';
const money=(v:number)=>new Intl.NumberFormat('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2}).format(v);
const fit=(s:string,n:number)=>{const x=(s||'').replace(/\s+/g,' ').trim();return x.length>n?x.slice(0,n):x.padEnd(n,' ')};
const right=(s:string,n:number)=>String(s).slice(-n).padStart(n,' ');

function build44(data:ReceiptData,model:Model){
 const W=44;const line='-'.repeat(W);const out:string[]=[];const center=(s:string)=>{const t=s.slice(0,W);return ' '.repeat(Math.max(0,Math.floor((W-t.length)/2)))+t};
 out.push(center(model==='nfce'?'NFC-e / CUPOM DE VENDA':'PRE-VENDA / CUPOM DE VENDA'));out.push(center('THORGESTAO'));out.push(line);out.push(`Venda: ${String(data.number??'—')}`);out.push(`Data : ${data.date??new Date().toLocaleString('pt-BR')}`);if(data.customer)out.push(`Cliente: ${data.customer}`.slice(0,W));out.push(line);out.push('ITEM  QTD   V.UNIT      TOTAL');out.push(line);
 data.items.forEach((i,idx)=>{out.push(`${String(idx+1).padStart(3,'0')} ${fit(i.name,40)}`.slice(0,W));const total=i.quantity*i.price-i.discount;out.push(`${right(String(i.quantity),7)} ${right(money(i.price),12)} ${right(money(total),14)}`.slice(0,W));if(i.discount>0)out.push(`    Desc. item: -${money(i.discount)}`.slice(0,W));});
 out.push(line);out.push(`${fit('SUBTOTAL',24)}${right(money(data.subtotal),20)}`);if(data.discount>0)out.push(`${fit('DESCONTO',24)}${right('-'+money(data.discount),20)}`);out.push(`${fit('TOTAL',24)}${right(money(data.total),20)}`);if(data.payment)out.push(`${fit('PAGAMENTO',24)}${right(data.payment,20)}`);out.push(line);out.push(center(model==='nfce'?'Documento fiscal conforme autorizacao':'Documento sem valor fiscal'));out.push(center('Obrigado pela preferencia!'));return out.join('\n');
}

function printText(text:string){
 const w=window.open('','_blank','width=420,height=720');if(!w)return false;
 w.document.write(`<!doctype html><html><head><title>Impressão de venda</title><style>@page{size:80mm auto;margin:3mm}html,body{margin:0;padding:0;background:#fff}pre{font-family:"Courier New",monospace;font-size:10px;line-height:1.15;white-space:pre-wrap;width:44ch;margin:0 auto;color:#000}</style></head><body><pre>${text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</pre><script>window.onload=()=>{window.print();setTimeout(()=>window.close(),800)}<\/script></body></html>`);w.document.close();return true;
}

export function SalePrintControl(){
 const [model,setModel]=useState<Model>('pre_sale');const [config,setConfig]=useState(false);const [receipt,setReceipt]=useState<ReceiptData|null>(null);const [ask,setAsk]=useState(false);
 useEffect(()=>{const saved=localStorage.getItem(KEY);if(saved==='nfce'||saved==='pre_sale')setModel(saved)},[]);
 useEffect(()=>{const handler=(e:Event)=>{const detail=(e as CustomEvent<ReceiptData>).detail;if(detail){setReceipt(detail);setAsk(true)}};window.addEventListener('thorgestao:sale-completed',handler);return()=>window.removeEventListener('thorgestao:sale-completed',handler)},[]);
 function save(next:Model){setModel(next);localStorage.setItem(KEY,next)}
 function doPrint(){if(!receipt)return;printText(build44(receipt,model));setAsk(false)}
 return <>
  <button type="button" className="erp-sale-print-config" onClick={()=>setConfig(true)}>⚙ Documento: {model==='nfce'?'NFC-e':'Pré-venda'}</button>
  {config&&<div className="erp-sale-print-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setConfig(false)}}><section className="erp-sale-print-modal"><header><div><small>IMPRESSÃO</small><h3>Modelo do documento</h3></div><button onClick={()=>setConfig(false)}>×</button></header><p>Escolha o modelo padrão usado após concluir a venda. A impressão é formatada para cupom térmico de 44 colunas.</p><div className="erp-sale-doc-options"><button className={model==='pre_sale'?'active':''} onClick={()=>save('pre_sale')}><b>Pré-venda</b><span>Documento comercial sem valor fiscal</span></button><button className={model==='nfce'?'active':''} onClick={()=>save('nfce')}><b>NFC-e</b><span>Modelo para venda fiscal / cupom NFC-e</span></button></div><footer><button onClick={()=>setConfig(false)}>Concluir</button></footer></section></div>}
  {ask&&receipt&&<div className="erp-sale-print-backdrop"><section className="erp-sale-print-modal confirm"><header><div><small>VENDA CONCLUÍDA</small><h3>Deseja imprimir a venda?</h3></div></header><p>Venda nº <b>{String(receipt.number??'')}</b> concluída por <b>R$ {money(receipt.total)}</b>. Modelo atual: <b>{model==='nfce'?'NFC-e':'Pré-venda'}</b>.</p><div className="erp-sale-print-preview"><pre>{build44(receipt,model)}</pre></div><footer><button className="secondary" onClick={()=>setAsk(false)}>Não imprimir</button><button className="primary" onClick={doPrint}>Selecionar impressora</button></footer></section></div>}
 </>;
}
