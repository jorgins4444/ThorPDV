'use client';

import { useEffect, useMemo, useState } from 'react';
import { consultReceivableItauBoleto, issueReceivableItauBoleto, receivableBankBillings, receivableCustomerBillingSnapshot } from './receivables-bolecode-actions';

type Row=Record<string,unknown>;
type Props={receivables:Row[];customers:Row[];integrations:Row[];initialBillings:Row[]};

const money=(value:unknown)=>Number(value||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const date=(value:unknown)=>{if(!value)return '—';const raw=String(value);const d=new Date(raw.length===10?`${raw}T12:00:00`:raw);return Number.isNaN(d.getTime())?raw:d.toLocaleDateString('pt-BR')};
const clean=(value:unknown)=>String(value??'').replace(/\D/g,'');
const doc=(value:unknown)=>{const d=clean(value);if(d.length===11)return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/,'$1.$2.$3-$4');if(d.length===14)return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/,'$1.$2.$3/$4-$5');return String(value||'—')};
const statusLabel=(value:unknown)=>({issued:'Emitido',processing:'Processando',simulated:'Validado',failed:'Falhou',paid:'Pago',cancelled:'Cancelado'}[String(value)]||String(value||'—'));
const fieldLabels:Record<string,string>={name:'Nome',document:'CPF/CNPJ',street:'Logradouro',district:'Bairro',city:'Cidade',state:'UF',postal_code:'CEP'};

const itfPatterns:Record<string,string>={
  '0':'nnwwn','1':'wnnnw','2':'nwnnw','3':'wwnnn','4':'nnwnw','5':'wnwnn','6':'nwwnn','7':'nnnww','8':'wnnwn','9':'nwnwn',
};

function ItfBarcode({value}:{value:string}){
  const digits=clean(value);
  if(!digits||digits.length%2!==0)return <div className="thor-barcode-invalid">Código de barras indisponível</div>;
  const rects:{x:number;width:number}[]=[];
  let x=12;
  const narrow=2,wide=6,height=58;
  const add=(isBar:boolean,width:number)=>{if(isBar)rects.push({x,width});x+=width};
  [narrow,narrow,narrow,narrow].forEach((w,i)=>add(i%2===0,w));
  for(let i=0;i<digits.length;i+=2){
    const bars=itfPatterns[digits[i]];
    const spaces=itfPatterns[digits[i+1]];
    for(let j=0;j<5;j++){
      add(true,bars[j]==='w'?wide:narrow);
      add(false,spaces[j]==='w'?wide:narrow);
    }
  }
  [wide,narrow,narrow].forEach((w,i)=>add(i%2===0,w));
  const total=x+12;
  return <svg className="thor-itf-barcode" viewBox={`0 0 ${total} ${height}`} role="img" aria-label="Código de barras do boleto" preserveAspectRatio="none">
    <rect width={total} height={height} fill="white"/>
    {rects.map((r,i)=><rect key={i} x={r.x} y="0" width={r.width} height={height} fill="black"/>)}
  </svg>;
}

function BoletoPrint({billing,onClose}:{billing:Row;onClose:()=>void}){
  const response=(billing.response_payload as Row|undefined)??{};
  const responseValue=(response.value as Row|undefined)??{};
  const responseData=((response.data as Row|undefined)??(responseValue.data as Row|undefined)??response) as Row;
  const beneficiaryData=(responseData.beneficiario as Row|undefined)??{};
  const settings=(billing.integration_settings as Row|undefined)??{};
  const beneficiary=String(billing.beneficiary_name||beneficiaryData.nome_cobranca||billing.account_name||'Beneficiário Itaú');
  const customerAddress=[billing.customer_street,billing.customer_number,billing.customer_complement].filter(Boolean).join(', ');
  const customerCity=[billing.customer_city,billing.customer_state].filter(Boolean).join(' / ');
  const line=String(billing.digitable_line||'');
  const barcode=String(billing.barcode||'');

  return <div className="erp-bolecode-print-backdrop" role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget)onClose()}}>
    <section className="erp-bolecode-print-shell" role="dialog" aria-modal="true" aria-label="Boleto Itaú registrado">
      <div className="erp-bolecode-print-actions"><button type="button" className="erp-ghost" onClick={onClose}>Fechar</button><button type="button" className="erp-primary" onClick={()=>window.print()}>🖨 Imprimir boleto</button></div>
      <article className="thor-boleto-print">
        <header className="thor-boleto-bankline"><div className="thor-boleto-bank"><strong>ITAÚ</strong><span>341-7</span></div><div className="thor-boleto-line">{line||'Linha digitável não retornada pelo Itaú'}</div></header>

        <section className="thor-boleto-receipt">
          <div className="thor-boleto-section-title">Recibo do Pagador</div>
          <div className="thor-boleto-grid">
            <div className="span-2"><small>Beneficiário</small><b>{beneficiary}</b></div>
            <div><small>Agência / Conta</small><b>{String(billing.agency||settings.agency||'—')} / {String(billing.account_number||settings.account_number||'—')}</b></div>
            <div><small>Nosso Número</small><b>{String(billing.our_number||'—')}</b></div>
            <div className="span-2"><small>Pagador</small><b>{String(billing.customer_name||'—')} · {doc(billing.customer_document)}</b></div>
            <div><small>Vencimento</small><b>{date(billing.due_date)}</b></div>
            <div><small>Valor do documento</small><b>{money(billing.amount)}</b></div>
            <div className="span-2"><small>Endereço do pagador</small><b>{customerAddress||'—'}</b><span>{[billing.customer_district,customerCity,billing.customer_postal_code].filter(Boolean).join(' · ')}</span></div>
            <div><small>Carteira</small><b>{String(settings.wallet||'109')}</b></div>
            <div><small>Espécie</small><b>{String(settings.species||'01')}</b></div>
          </div>
        </section>

        <section className="thor-boleto-compensation">
          <div className="thor-boleto-section-title">Ficha de Compensação</div>
          <div className="thor-boleto-mini-grid">
            <div><small>Beneficiário</small><b>{beneficiary}</b></div><div><small>Vencimento</small><b>{date(billing.due_date)}</b></div>
            <div><small>Nosso Número</small><b>{String(billing.our_number||'—')}</b></div><div><small>Valor</small><b>{money(billing.amount)}</b></div>
          </div>
          <div className="thor-boleto-copy-line"><small>Linha digitável</small><strong>{line||'—'}</strong></div>
          <ItfBarcode value={barcode}/>
          <div className="thor-boleto-barcode-number">{barcode||'Código de barras não retornado pelo Itaú'}</div>
        </section>

        <footer className="thor-boleto-footer">Boleto registrado via Itaú Cash Management v2 · ThorGestão · ID {String(billing.external_id||billing.id||'—')}</footer>
      </article>
    </section>
  </div>;
}

export function ReceivablesBolecodePanel({receivables,customers,integrations,initialBillings}:Props){
  const eligible=useMemo(()=>receivables.filter(r=>!['paid','cancelled'].includes(String(r.status||''))&&Number(r.remaining??Math.max(Number(r.amount||0)-Number(r.paid_amount||0),0))>0),[receivables]);
  const itauIntegrations=useMemo(()=>integrations.filter(i=>i.active!==false&&i.provider==='itau'),[integrations]);
  const [entryId,setEntryId]=useState(()=>String(eligible[0]?.id||''));
  const [integrationId,setIntegrationId]=useState(()=>String(itauIntegrations[0]?.id||''));
  const [billings,setBillings]=useState<Row[]>(initialBillings);
  const [customerRows,setCustomerRows]=useState<Row[]>(customers);
  const [customerRefreshing,setCustomerRefreshing]=useState(false);
  const [busy,setBusy]=useState<'simulate'|'issue'|'consult'|''>('');
  const [message,setMessage]=useState('');
  const [printBilling,setPrintBilling]=useState<Row|null>(null);

  const selected=eligible.find(r=>String(r.id)===entryId)??null;
  const selectedCustomerId=String(selected?.customer_id||'');
  const customer=customerRows.find(c=>String(c.id)===selectedCustomerId)??null;
  const integration=itauIntegrations.find(i=>String(i.id)===integrationId)??null;
  const selectedBillings=billings.filter(b=>String(b.financial_entry_id)===entryId);
  const latestPrintable=selectedBillings.find(b=>Boolean(b.digitable_line)&&Boolean(b.barcode)&&['issued','paid'].includes(String(b.status)));
  const latest=selectedBillings[0];
  const providerReady=Boolean(integration?.provider_ready);

  useEffect(()=>{
    let active=true;
    if(!selectedCustomerId)return;
    setCustomerRefreshing(true);
    receivableCustomerBillingSnapshot(selectedCustomerId).then(result=>{
      if(!active)return;
      if(result.ok&&result.customer&&typeof result.customer==='object'&&!Array.isArray(result.customer)){
        const fresh=result.customer as Row;
        setCustomerRows(current=>[fresh,...current.filter(row=>String(row.id)!==selectedCustomerId)]);
      }
      setCustomerRefreshing(false);
    }).catch(()=>{if(active)setCustomerRefreshing(false)});
    return()=>{active=false};
  },[selectedCustomerId]);

  const customerIssues=useMemo(()=>{
    if(!customer)return ['Cliente não localizado'];
    const issues:string[]=[];
    if(!String(customer.name||'').trim())issues.push('Nome');
    if(![11,14].includes(clean(customer.document).length))issues.push('CPF/CNPJ');
    if(!String(customer.street||'').trim())issues.push('Logradouro');
    if(!String(customer.district||'').trim())issues.push('Bairro');
    if(!String(customer.city||'').trim())issues.push('Cidade');
    if(String(customer.state||'').trim().length!==2)issues.push('UF');
    if(clean(customer.postal_code).length!==8)issues.push('CEP');
    return issues;
  },[customer]);

  async function refresh(entry?:string){
    const result=await receivableBankBillings(entry);
    if(result.ok&&Array.isArray(result.data)){
      if(entry){
        const current=billings.filter(b=>String(b.financial_entry_id)!==entry);
        setBillings([...(result.data as Row[]),...current]);
      }else setBillings(result.data as Row[]);
    }
    return result;
  }

  async function run(simulate:boolean){
    if(!selected||!integrationId)return;
    setBusy(simulate?'simulate':'issue');setMessage('');
    if(selectedCustomerId){
      const snapshot=await receivableCustomerBillingSnapshot(selectedCustomerId);
      if(snapshot.ok&&snapshot.customer&&typeof snapshot.customer==='object'&&!Array.isArray(snapshot.customer)){
        const fresh=snapshot.customer as Row;
        setCustomerRows(current=>[fresh,...current.filter(row=>String(row.id)!==selectedCustomerId)]);
      }
    }
    const result=await issueReceivableItauBoleto(String(selected.id),integrationId,simulate);
    setBusy('');
    await refresh();
    if(result.ok){
      if(result.status==='simulated')setMessage('✓ Validação concluída pelo Itaú. A etapa de validação não registra o boleto.');
      else if(result.status==='issued')setMessage('✓ Boleto registrado pelo Itaú. Linha digitável e código de barras foram vinculados ao título.');
      else if(result.status==='processing')setMessage('O Itaú recebeu a emissão e respondeu 202. Use “Consultar no Itaú” para atualizar o processamento.');
      else setMessage('Operação aceita pelo Itaú.');
      if(result.billing_id){
        const refreshed=await receivableBankBillings(String(selected.id));
        const rows=refreshed.ok&&Array.isArray(refreshed.data)?refreshed.data as Row[]:[];
        const printed=rows.find(b=>String(b.id)===String(result.billing_id)&&Boolean(b.digitable_line)&&Boolean(b.barcode));
        if(printed)setPrintBilling(printed);
      }
      return;
    }
    const error=String(result.error||'');
    if(error==='customer_billing_data_incomplete'){
      const missing=Array.isArray(result.missing_fields)?result.missing_fields.map(v=>fieldLabels[String(v)]||String(v)).join(', '):'dados cadastrais';
      setMessage(`Não foi possível emitir: complete no cadastro do cliente: ${missing}.`);
    }else if(error==='receivable_billing_already_active'){
      setMessage('Este título já possui um boleto Itaú ativo ou em processamento. Use a cobrança existente para evitar duplicidade.');
    }else if(error==='production_receivable_issue_not_enabled'){
      setMessage('Produção permanece protegida: a emissão pelo Contas a Receber só será liberada depois da homologação mTLS do Itaú.');
    }else setMessage(String(result.detail||result.api_message||result.error||'Falha ao executar a cobrança no Itaú.'));
  }

  async function consultLatest(){
    if(!latest?.id)return;
    setBusy('consult');setMessage('');
    const result=await consultReceivableItauBoleto(String(latest.id));
    const refreshed=await refresh(entryId);
    setBusy('');
    if(!result.ok){setMessage(String(result.api_message||result.error||'Não foi possível consultar o boleto no Itaú.'));return;}
    const rows=refreshed.ok&&Array.isArray(refreshed.data)?refreshed.data as Row[]:[];
    const current=rows.find(b=>String(b.id)===String(latest.id));
    if(current&&Boolean(current.digitable_line)&&Boolean(current.barcode)){
      setMessage(`✓ Boleto atualizado no Itaú: ${statusLabel(current.status)}.`);
      if(['issued','paid'].includes(String(current.status)))setPrintBilling(current);
    }else setMessage('Consulta concluída. O Itaú ainda não retornou linha digitável e código de barras para esta cobrança.');
  }

  return <>
    <section className="erp-module-card erp-bolecode-hub">
      <div className="erp-bolecode-head">
        <div><span>COBRANÇA BANCÁRIA</span><h2>Itaú Boleto Registrado</h2><p>Emita boletos registrados pela API Cash Management v2 usando os dados do título e do cadastro do cliente.</p></div>
        <div className="erp-bolecode-badge">ITAÚ · 341</div>
      </div>

      {!eligible.length?<p className="erp-empty">Não há títulos com saldo em aberto para emissão bancária.</p>:<div className="erp-bolecode-grid">
        <label>Título a receber<select value={entryId} onChange={e=>{setEntryId(e.target.value);setMessage('')}}>{eligible.map(r=><option key={String(r.id)} value={String(r.id)}>{String(r.customer||'Cliente')} · {date(r.due_date)} · {money(r.remaining??r.amount)}</option>)}</select></label>
        <label>Conta / integração<select value={integrationId} onChange={e=>setIntegrationId(e.target.value)}><option value="">Selecione...</option>{itauIntegrations.map(i=><option key={String(i.id)} value={String(i.id)}>{String(i.account_name||'Itaú')} · {String(i.environment||'sandbox').toUpperCase()}</option>)}</select></label>
        <div className="erp-bolecode-kpi"><span>Saldo a cobrar</span><b>{money(selected?.remaining??selected?.amount)}</b><small>Vencimento {date(selected?.due_date)}</small></div>
        <div className="erp-bolecode-kpi"><span>API</span><b>Cash Management v2</b><small>{providerReady?'Credencial configurada':'Credencial não pronta'}</small></div>
      </div>}

      {selected&&<div className="erp-bolecode-customer-preview">
        <div><span>PAGADOR</span><b>{String(customer?.name||selected.customer||'Cliente')}</b><small>{doc(customer?.document)}</small></div>
        <div><span>ENDEREÇO</span><b>{[customer?.street,customer?.number].filter(Boolean).join(', ')||'Não informado'}</b><small>{[customer?.district,customer?.city,customer?.state].filter(Boolean).join(' · ')}</small></div>
        <div className={customerIssues.length?'has-issues':'is-ready'}><span>CADASTRO</span><b>{customerRefreshing?'Atualizando cadastro...':customerIssues.length?'Dados incompletos':'Pronto para cobrança'}</b><small>{customerRefreshing?'Buscando os dados mais recentes do cliente':customerIssues.length?customerIssues.join(', '):`CEP ${String(customer?.postal_code||'')}`}</small></div>
      </div>}

      {latest&&<div className={`erp-bolecode-last status-${String(latest.status)}`}><div><span>ÚLTIMA COBRANÇA DESTE TÍTULO</span><b>{statusLabel(latest.status)} · Nosso Número {String(latest.our_number||'—')}</b><small>{latest.http_status?`HTTP ${String(latest.http_status)}`:'Sem HTTP'} · {date(latest.created_at)}</small></div><div>{latestPrintable&&<button type="button" className="erp-row-action" onClick={()=>setPrintBilling(latestPrintable)}>Visualizar / imprimir</button>}{String(latest.status)==='processing'&&<button type="button" className="erp-row-action" disabled={busy!==''} onClick={()=>void consultLatest()}>{busy==='consult'?'Consultando...':'Consultar no Itaú'}</button>}</div></div>}

      {message&&<p className="erp-bolecode-message">{message}</p>}
      <div className="erp-bolecode-actions">
        <button type="button" className="erp-row-action" disabled={!selected||!integrationId||!providerReady||busy!==''||customerRefreshing||customerIssues.length>0} onClick={()=>void run(true)}>{busy==='simulate'?'Validando...':'Validar no Itaú'}</button>
        <button type="button" className="erp-primary" disabled={!selected||!integrationId||!providerReady||busy!==''||customerRefreshing||customerIssues.length>0} onClick={()=>void run(false)}>{busy==='issue'?'Emitindo...':'Gerar boleto'}</button>
        {latestPrintable&&<button type="button" className="erp-bolecode-print-button" onClick={()=>setPrintBilling(latestPrintable)}>🖨 Imprimir boleto</button>}
      </div>
      <p className="erp-bolecode-footnote">“Validar no Itaú” usa a etapa <b>validacao</b> e não registra o título. “Gerar boleto” usa <b>efetivacao</b>. Em retorno 202, use “Consultar no Itaú” para recuperar o boleto quando o processamento terminar.</p>
    </section>
    {printBilling&&<BoletoPrint billing={printBilling} onClose={()=>setPrintBilling(null)}/>} 
  </>;
}
