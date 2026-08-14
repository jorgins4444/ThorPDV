'use client';

import { FormEvent, useMemo, useState, useTransition } from 'react';
import { bankBillingsList, bankIntegrationsData, testItauBolecode } from './bank-integrations-actions';

type Row=Record<string,unknown>;
const text=(v:unknown)=>v==null?'':String(v);
const money=(v:unknown)=>Number(v||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const date=(v:unknown)=>v?new Date(`${String(v).slice(0,10)}T12:00:00`).toLocaleDateString('pt-BR'):'—';
const err:Record<string,string>={
 invalid_session:'Sessão inválida.',
 itau_integration_not_found:'A integração Itaú desta conta não foi encontrada ou está inativa.',
 itau_credentials_not_configured:'As credenciais Itaú ainda não foram configuradas no ThorControl.',
 itau_provider_not_ready:'O ambiente Itaú não está habilitado no ThorControl.',
 payer_document_invalid:'CPF/CNPJ do pagador inválido.',
 payer_name_required:'Informe o nome do pagador.',
 payer_postal_code_invalid:'CEP do pagador deve ter 8 dígitos.',
 amount_required:'Informe um valor maior que zero.',
 due_date_required:'Informe o vencimento.',
 itau_token_failed:'O Itaú recusou a autenticação.',
 itau_token_missing_in_response:'O token retornado pelo Itaú não foi reconhecido.',
 itau_bolecode_exception:'Falha interna durante a chamada do BoleCode.',
 itau_sandbox_scenario_unmapped:'A autenticação e o gateway Itaú responderam, mas o Sandbox não possui um cenário mock mapeado para esta chamada/aplicação.'
};

export function ItauBolecodeWorkspace({accountsInitial,integrationsInitial,billingsInitial}:{accountsInitial:Record<string,unknown>;integrationsInitial:Record<string,unknown>;billingsInitial:Record<string,unknown>}){
 const accounts=useMemo(()=>((accountsInitial.accounts as Row[])??[]).filter(a=>a.account_type==='bank'&&!a.is_system),[accountsInitial]);
 const [integrations,setIntegrations]=useState<Row[]>(Array.isArray(integrationsInitial.integrations)?integrationsInitial.integrations as Row[]:[]);
 const [billings,setBillings]=useState<Row[]>(Array.isArray(billingsInitial.billings)?billingsInitial.billings as Row[]:[]);
 const configured=useMemo(()=>integrations.filter(i=>text(i.provider)==='itau'&&text(i.product)==='bolecode_pix'),[integrations]);
 const [selectedIntegrationId,setSelectedIntegrationId]=useState(text(configured[0]?.id));
 const [message,setMessage]=useState('');
 const [result,setResult]=useState<Row|null>(null);
 const [pending,startTransition]=useTransition();
 const integration=configured.find(i=>text(i.id)===selectedIntegrationId)??configured[0];
 const selected=accounts.find(a=>text(a.id)===text(integration?.bank_account_id));
 const settings=(integration?.settings&&typeof integration.settings==='object'?integration.settings:{}) as Row;
 const isSandbox=text(integration?.environment)!=='production';
 const sandboxUnmapped=text(result?.error)==='itau_sandbox_scenario_unmapped';

 function run(fn:()=>Promise<void>){startTransition(()=>{void fn()})}
 async function refresh(){
  const [i,b]=await Promise.all([bankIntegrationsData(),bankBillingsList(100)]);
  if(i.ok)setIntegrations(Array.isArray(i.integrations)?i.integrations as Row[]:[]);
  if(b.ok)setBillings(Array.isArray(b.billings)?b.billings as Row[]:[]);
 }
 function applyResult(r:Row,success:string){
  setResult(r);
  if(r.ok)setMessage(success);
  else setMessage(err[text(r.error)]||text(r.api_message||r.error||r.detail||'Falha na API Itaú.'));
 }
 async function documentationExampleTest(){
  if(!integration)return;
  setMessage('');setResult(null);
  const r=await testItauBolecode(text(integration.id),{sandbox_scenario:'official'},true);
  applyResult(r as Row,'Exemplo da documentação processado pelo Sandbox Itaú.');
  await refresh();
 }
 async function customTest(e:FormEvent<HTMLFormElement>){
  e.preventDefault();if(!integration)return;
  setMessage('');setResult(null);
  const submitter=(e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement|null;
  const effective=submitter?.value==='effective';
  if(effective&&text(integration.environment)==='production'&&!window.confirm('Esta operação emitirá uma cobrança REAL no Itaú. Deseja continuar?'))return;
  const fd=new FormData(e.currentTarget);
  const payload={...Object.fromEntries(fd.entries()),sandbox_scenario:'custom'};
  const r=await testItauBolecode(text(integration.id),payload,effective);
  applyResult(r as Row,effective?'Payload personalizado enviado ao Sandbox Itaú.':'Simulação personalizada enviada ao Sandbox Itaú.');
  await refresh();
 }

 return <div className="itau-bank-workspace">
  <section className="itau-hero">
   <div><small>CENTRAL DE HOMOLOGAÇÃO</small><h2>Itaú BoleCode Pix</h2><p>Valide credenciais, comunicação com o gateway e acompanhe os retornos reais do Sandbox.</p></div>
   <div className="itau-state"><span className={integration?.active&&integration?.provider_ready?'on':'off'}/><div><strong>{integration?.active&&integration?.provider_ready?'OAuth pronto para chamadas':integration?'Integração requer atenção':'Nenhuma conta vinculada'}</strong><small>{integration?`${isSandbox?'Sandbox':'Produção'} · ${integration.provider_ready?'Credenciais validadas':'Credencial pendente no ThorControl'}`:'Configure boletos dentro de Contas Bancárias'}</small></div></div>
  </section>
  {message&&<div className="itau-message">{message}</div>}

  {configured.length===0?<section className="itau-card itau-empty-state"><div className="bank-provider-logo">Itaú</div><div><small>AINDA NÃO VINCULADO</small><h3>Configure o BoleCode dentro da conta bancária</h3><p>Volte para Contas Bancárias, abra uma conta Itaú e use <b>Configurar boletos bancários</b>.</p></div><a className="itau-primary" href="/dashboard/financeiro/contas-bancarias">Ir para Contas Bancárias</a></section>:<>
   <section className="itau-account-picker">
    <label>Integração para homologação<select value={text(integration?.id)} onChange={e=>{setSelectedIntegrationId(e.target.value);setResult(null);setMessage('')}}>{configured.map(i=><option key={text(i.id)} value={text(i.id)}>{text(i.account_name)} · {text(i.environment)==='production'?'Produção':'Sandbox'}</option>)}</select></label>
    <div><span>Conta beneficiária</span><strong>{text(selected?.name)||text(integration?.account_name)||'—'}</strong><small>Ag. {text(settings.agency)||'—'} · Conta {text(settings.account_number)||'—'} · DAC {text(settings.account_digit)||'—'}</small></div>
   </section>

   <section className="itau-card itau-linked-summary">
    <div className="itau-card-head"><div><small>VÍNCULO ATUAL</small><h3>{text(selected?.name)||text(integration?.account_name)}</h3></div><span className={`itau-pill ${integration?.provider_ready?'ready':''}`}>{integration?.provider_ready?'Credencial ativa':'Credencial pendente'}</span></div>
    <div className="itau-result-grid"><div><span>Ambiente</span><strong>{isSandbox?'Sandbox':'Produção'}</strong></div><div><span>Beneficiário da conta</span><strong>{text(settings.beneficiary_id)||'—'}</strong></div><div><span>Carteira</span><strong>{text(settings.wallet)||'109'}</strong></div><div><span>Status</span><strong>{integration?.active?'Ativa':'Inativa'}</strong></div></div>
    <div className="itau-linked-actions"><a href="/dashboard/financeiro/contas-bancarias">Editar na conta bancária</a><span>As credenciais permanecem centralizadas no ThorControl.</span></div>
   </section>

   <details className="itau-card itau-simulator">
    <summary><div><small>LABORATÓRIO SANDBOX</small><h3>Simulador BoleCode</h3><p>O Sandbox usa dados fictícios e cenários internos do Itaú. Os exemplos OpenAPI/Postman não são apresentados pelo banco como gatilhos garantidos.</p></div><span>Abrir simulador ↓</span></summary>
    <div className="itau-test">
     <section className="itau-official-scenario">
      <div className="itau-official-head"><div><small>EXEMPLO DA DOCUMENTAÇÃO</small><h4>Request mínimo BoleCode Pix</h4><p>Este teste replica os dados do exemplo fornecido no OpenAPI/Postman. Ele serve para verificar a comunicação, mas pode retornar “cenário não mapeado” se o mock não estiver habilitado para a aplicação.</p></div><span>Diagnóstico</span></div>
      <div className="itau-official-grid"><div><span>Beneficiário de exemplo</span><b>150000052061</b></div><div><span>Valor</span><b>R$ 1.234,56</b></div><div><span>Nosso Número</span><b>12345678</b></div><div><span>Vencimento</span><b>31/12/2026</b></div><div><span>Pagador</span><b>João da Silva</b></div><div><span>CEP</span><b>01310100</b></div></div>
      <div className="itau-official-action"><div><b>O que este teste verifica?</b><span>Obtenção do token, acesso ao endpoint, autorização do gateway, envio do JSON e interpretação da resposta.</span></div><button type="button" className="itau-primary" onClick={()=>run(documentationExampleTest)} disabled={pending||!isSandbox||!integration?.provider_ready||!integration?.active}>{pending?'Processando...':'Executar exemplo da documentação'}</button></div>
     </section>

     <details className="itau-custom-scenario">
      <summary><div><b>Payload personalizado</b><span>Avançado · depende de cenário disponível no Sandbox</span></div><strong>Abrir ↓</strong></summary>
      <form onSubmit={e=>run(()=>customTest(e))}>
       <div className="itau-custom-warning"><b>Atenção ao Sandbox</b><span>Dados livres podem receber HTTP 500 “Cenário de teste não mapeado”. Esse retorno indica limitação do mock, não falha de autenticação.</span></div>
       <div className="itau-form-grid"><label className="wide">Nome / Razão social<input required name="name" placeholder="Cliente de Teste"/></label><label>CPF/CNPJ<input required name="document" inputMode="numeric" placeholder="Somente números"/></label><label>Valor<input required name="amount" type="number" min="0.01" step="0.01" placeholder="100.00"/></label><label>Vencimento<input required name="due_date" type="date"/></label><label>CEP<input required name="postal_code" inputMode="numeric" maxLength={9}/></label><label className="wide">Logradouro<input required name="street" placeholder="Rua Exemplo"/></label><label>Número<input name="number" placeholder="100"/></label><label>Complemento<input name="complement"/></label><label>Bairro<input required name="district"/></label><label>Cidade<input required name="city"/></label><label>UF<input required name="state" maxLength={2} placeholder="PI"/></label></div>
       <div className="itau-test-actions"><button value="simulate" disabled={pending||!integration?.provider_ready||!integration?.active}>{pending?'Processando...':'Simular payload livre'}</button><button className="itau-primary" value="effective" disabled={pending||!integration?.provider_ready||!integration?.active||!isSandbox}>{isSandbox?'Emitir payload livre':'Produção bloqueada nesta fase'}</button></div>
      </form>
     </details>
    </div>
   </details>
  </>}

  {result?<section className="itau-card itau-result">
   <div className="itau-card-head"><div><small>RETORNO DA API</small><h3>{result.ok?'Operação aceita pelo Itaú':sandboxUnmapped?'Sandbox sem cenário mapeado':'Falha na operação'}</h3></div><span className={`itau-http ${result.ok?'ok':'error'}`}>HTTP {text(result.http_status)||'—'}</span></div>
   {text(result.sandbox_scenario)==='official'?<div className="itau-result-context"><b>Exemplo da documentação Itaú</b><span>Os valores abaixo são de referência do OpenAPI/Postman e não representam uma cobrança real.</span></div>:null}
   {sandboxUnmapped?<div className="itau-result-context"><b>Diagnóstico da integração</b><span>OAuth: OK · Gateway Itaú: OK · Endpoint BoleCode: alcançado · Cenário mock: não mapeado. Use o Correlation ID abaixo ao acionar o suporte Itaú.</span></div>:null}
   <div className="itau-result-grid"><div><span>Status</span><strong>{sandboxUnmapped?'Mock não mapeado':text(result.status)||text(result.error)||'—'}</strong></div><div><span>Nosso Número</span><strong>{text(result.our_number)||'—'}</strong></div><div><span>Correlation ID</span><strong>{text(result.correlation_id)||'—'}</strong></div><div><span>TXID Pix</span><strong>{text(result.pix_txid)||'—'}</strong></div></div>
   {result.digitable_line?<div className="itau-code"><span>Linha digitável</span><code>{text(result.digitable_line)}</code></div>:null}
   {result.pix_emv?<div className="itau-code"><span>Pix Copia e Cola</span><code>{text(result.pix_emv)}</code></div>:null}
   {result.pix_qr_base64?<img className="itau-qr" src={`data:image/png;base64,${text(result.pix_qr_base64)}`} alt="QR Code Pix retornado pelo Itaú"/>:null}
   {!result.ok?<><div className="itau-api-error"><b>{err[text(result.error)]||text(result.api_message)||'Falha retornada pelo Itaú.'}</b>{result.api_message?<span>{text(result.api_message)}</span>:null}</div><pre>{JSON.stringify(result.response??result,null,2)}</pre></>:null}
  </section>:null}

  <section className="itau-card itau-history"><div className="itau-card-head"><div><small>COBRANÇAS BANCÁRIAS</small><h3>Últimos testes e emissões</h3></div><span>{billings.length} registro(s)</span></div><div className="itau-table-wrap"><table><thead><tr><th>Data</th><th>Conta</th><th>Ambiente</th><th>Nosso Número</th><th>Vencimento</th><th>Valor</th><th>Status</th><th>HTTP</th></tr></thead><tbody>{billings.length===0?<tr><td colSpan={8}>Nenhuma cobrança testada ainda.</td></tr>:billings.map(b=><tr key={text(b.id)}><td>{new Date(text(b.created_at)).toLocaleString('pt-BR')}</td><td>{text(b.account)}</td><td>{text(b.environment)==='production'?'Produção':'Sandbox'}</td><td>{text(b.our_number)||'—'}</td><td>{date(b.due_date)}</td><td>{money(b.amount)}</td><td><span className={`itau-billing-status ${text(b.status)}`}>{text(b.status)}</span></td><td>{text(b.http_status)||'—'}</td></tr>)}</tbody></table></div></section>
 </div>;
}
