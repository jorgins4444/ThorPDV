'use client';

// Build retry marker: 2026-08-15 product files module.
import { useState } from 'react';

type ProductRow={
  id?:string;
  product_code?:string|number|null;
  sku?:string|null;
  name?:string|null;
  price?:string|number|null;
  structure?:string|null;
  codes?:unknown;
};

type ExportData={
  ok?:boolean;
  error?:string;
  price_table_name?:string|null;
  product_count?:number;
  data?:ProductRow[];
};

type TerminalModel=''|'gertec'|'sweda';
type Tab='prices'|'scales';

type BuiltFile={content:string;filename:string;lines:number;skippedCodes:number;skippedPrices:number};

const scaleModels=['Filizola (SMART)','Toledo (MGV5)','Toledo (MGV6)','Toledo (MGV7)','Ramuza (Atena)','Urano (Integra)'];

function ascii(value:unknown){
  return String(value??'')
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .replace(/[^\x20-\x7E]/g,' ')
    .replace(/[|;]/g,' ')
    .trim();
}

function numericCodes(value:unknown){
  const source=Array.isArray(value)?value:[];
  return [...new Set(source.map(code=>String(code??'').trim()).filter(code=>/^\d+$/.test(code)))];
}

function priceNumber(value:unknown){
  const n=Number(value??0);
  return Number.isFinite(n)&&n>=0?n:0;
}

function buildFile(model:TerminalModel,products:ProductRow[]):BuiltFile{
  if(!model) return {content:'',filename:'',lines:0,skippedCodes:0,skippedPrices:0};
  const lines:string[]=[];
  let skippedCodes=0;
  let skippedPrices=0;

  for(const product of products){
    const name=ascii(product.name);
    const price=priceNumber(product.price);
    const codes=numericCodes(product.codes);
    for(const code of codes){
      if(model==='gertec'){
        lines.push(`${code}|${name}|${price.toFixed(2).replace('.',',')}|`);
        continue;
      }

      if(code.length>13){skippedCodes++;continue;}
      const cents=Math.round(price*100);
      if(cents>999999999999){skippedPrices++;continue;}
      const fixedCode=code.padStart(13,'0');
      const fixedName=name.slice(0,20).padEnd(20,' ');
      const fixedPrice=String(cents).padStart(12,'0');
      lines.push(`${fixedCode};${fixedName};${fixedPrice}`);
    }
  }

  return {
    content:lines.join('\r\n'),
    filename:model==='gertec'?'GERTEC_PRECOS.TXT':'SWEDA_PRECOS.TXT',
    lines:lines.length,
    skippedCodes,
    skippedPrices,
  };
}

function downloadText(file:BuiltFile){
  if(!file.content||!file.filename)return;
  const blob=new Blob([file.content],{type:'text/plain;charset=us-ascii'});
  const url=URL.createObjectURL(blob);
  const link=document.createElement('a');
  link.href=url;
  link.download=file.filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function ProductFilesWorkspace({initialData}:{initialData:ExportData}){
  const [tab,setTab]=useState<Tab>('prices');
  const [model,setModel]=useState<TerminalModel>('');
  const [scaleModel,setScaleModel]=useState('');
  const [generationMessage,setGenerationMessage]=useState('');
  const products=Array.isArray(initialData.data)?initialData.data:[];

  const generatePriceFile=()=>{
    setGenerationMessage('');
    const built=buildFile(model,products);
    if(built.lines===0){setGenerationMessage('Nenhum registro válido foi encontrado para gerar o arquivo.');return;}
    downloadText(built);
    const skipped=built.skippedCodes+built.skippedPrices;
    setGenerationMessage(`${built.lines.toLocaleString('pt-BR')} linha(s) gerada(s)${skipped?` • ${skipped.toLocaleString('pt-BR')} registro(s) ignorado(s) por limite do layout`:''}.`);
  };

  return <div className="product-files-studio">
    <div className="product-files-tabs" role="tablist" aria-label="Arquivos de produtos">
      <button type="button" className={tab==='prices'?'active':''} onClick={()=>setTab('prices')}>Preços de produtos</button>
      <button type="button" className={tab==='scales'?'active':''} onClick={()=>setTab('scales')}>Balanças</button>
    </div>

    {tab==='prices'?<section className="product-files-card">
      <div className="product-files-heading">
        <div><small>TERMINAIS DE CONSULTA</small><h2>Gerar arquivo de preços</h2><p>Exporte os produtos ativos do ThorGestão no formato aceito pelo software de consulta de preços.</p></div>
        <div className="product-files-kpi"><strong>{products.length}</strong><span>produtos disponíveis</span></div>
      </div>

      {!initialData.ok?<div className="product-files-alert error">Não foi possível carregar os produtos: {initialData.error||'erro desconhecido'}.</div>:null}

      <div className="product-files-form">
        <label>Modelo do terminal
          <select value={model} onChange={e=>{setModel(e.target.value as TerminalModel);setGenerationMessage('')}}>
            <option value="">Selecione</option>
            <option value="gertec">Gertec</option>
            <option value="sweda">Sweda</option>
          </select>
        </label>
        <button type="button" className="product-files-download" disabled={!model||!initialData.ok||products.length===0} onClick={generatePriceFile}>↓ Baixar arquivo</button>
      </div>

      <div className="product-files-source">
        <span>Preço utilizado</span><strong>{initialData.price_table_name||'Preço de venda do cadastro'}</strong>
        <em>Código interno + SKU numérico + códigos de barras, sem duplicação dentro do produto.</em>
      </div>
      {generationMessage?<div className="product-files-alert info">{generationMessage}</div>:null}
    </section>:<section className="product-files-card">
      <div className="product-files-heading">
        <div><small>BALANÇAS</small><h2>Exportar dados de produto para balança</h2><p>Esta área já está preparada para os layouts estruturais de balança que serão adicionados em seguida.</p></div>
        <div className="product-files-kpi pending"><strong>6</strong><span>modelos preparados</span></div>
      </div>
      <div className="product-files-form">
        <label>Modelo de balança
          <select value={scaleModel} onChange={e=>setScaleModel(e.target.value)}>
            <option value="">Selecione</option>
            {scaleModels.map(item=><option key={item} value={item}>{item}</option>)}
          </select>
        </label>
        <button type="button" className="product-files-download" disabled>Exportar agora</button>
      </div>
      <div className="product-files-alert info">Aguardando os arquivos-modelo de Filizola, Toledo, Ramuza e Urano para implementar cada posição/campo sem adivinhar o layout.</div>
    </section>}
  </div>;
}
