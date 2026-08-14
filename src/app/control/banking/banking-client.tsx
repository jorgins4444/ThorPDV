'use client';

import { FormEvent, useState, useTransition } from 'react';
import { controlBankProviderData, controlBankProviderSave, controlBankProviderTest } from './actions';

type Row=Record<string,unknown>;
const text=(v:unknown)=>v==null?'':String(v);
const dt=(v:unknown)=>v?new Date(String(v)).toLocaleString('pt-BR'):'—';
const SANDBOX_TOKEN='https://sandbox.devportal.itau.com.br/api/oauth/jwt';
const SANDBOX_API='https://sandbox.devportal.itau.com.br/itau-ep9-api-recebimentos-v1-externo/v1';
const PROD_TOKEN='https://sts.itau.com.br/as/token.oauth2';

export default function ControlBankingClient({initial}:{initial:Record<string,unknown>}){
 const [providers,setProviders]=useState<Row[]>(Array.isArray(initial.providers)?initial.providers as Row[]:[]);
 const [message,setMessage]=useState('');
 const [diagnostic,setDiagnostic]=useState<Row|null>(null);
 const [pending,startTransition]=useTransition();
 const get=(env:string)=>providers.find(p=>text(p.provider)==='itau'&&text(p.environment)===env);
 async function refresh(){const r=await controlBankProviderData();if(r.ok)setProviders(Array.isArray(r.providers)?r.providers as Row[]:[])}
 function run(fn:()=>Promise<void>){startTransition(()=>{void fn()})}
 async function save(e:FormEvent<HTMLFormElement>,env:string){
  e.preventDefault();const fd=new FormData(e.currentTarget);const payload=Object.fromEntries(fd.entries());
  const r=await controlBankProviderSave({...payload,provider:'itau',environment:env,enabled:fd.get('enabled')==='on'});
  if(!r.ok){setMessage(text(r.error)==='production_credentials_incomplete'?'Produção ainda não foi ativada: informe Client ID, Client Secret, certificado, chave privada e a URL produtiva do BoleCode.':`Falha ao salvar: ${text(r.error)}`);await refresh();return}
  setDiagnostic(null);setMessage(`Configuração Itaú ${env==='sandbox'?'Sandbox':'Produção'} salva com segurança.`);await refresh();
 }
 async function test(env:string){
  const r=await controlBankProviderTest('itau',env);setDiagnostic({...r,environment:env});
  if(!r.ok){setMessage(`Falha no teste Itaú: ${text(r.error||r.detail||'não foi possível obter o token')} ${r.http_status?`(HTTP ${text(r.http_status)})`:''}`);return}
  if(r.scope_mismatch){setMessage('Token gerado com sucesso, porém o escopo recebido é de consulta de boletos e não corresponde ao BoleCode Pix.');return}
  setMessage(env==='production'?'mTLS de Produção validado e token OAuth obtido com sucesso.':'Conexão Itaú Sandbox validada. Token Bearer obtido com sucesso.');
 }
 return <main className="bank-control-page">
  <header className="bank-control-hero"><div><a href="/control">← Voltar ao ThorControl</a><small>INTEGRAÇÕES BANCÁRIAS</small><h1>Itaú BoleCode Pix</h1><p>Sandbox e Produção isolados. Em Produção o Thor usa OAuth Client Credentials com certificado mTLS e nunca devolve segredo, certificado ou chave privada ao navegador.</p></div><div className="bank-control-badge">BoleCode Pix · mTLS pronto</div></header>
  {message&&<div className="bank-control-message">{message}</div>}
  <section className="bank-control-summary"><article><span>Sandbox</span><strong>{get('sandbox')?.enabled?'Ativo':'Não configurado'}</strong><small>{get('sandbox')?.secret_configured?'Segredo armazenado':'Client Secret pendente'}</small></article><article><span>Produção</span><strong>{get('production')?.production_ready?'Pronta':get('production')?.enabled?'Incompleta':'Pendente'}</strong><small>{get('production')?.mtls_configured?'Certificado mTLS armazenado':'Certificado/chave pendentes'}</small></article><article><span>Produto</span><strong>BoleCode Pix</strong><small>Boleto registrado + QR Code Pix</small></article></section>
  <section className="bank-control-grid">
   {(['sandbox','production'] as const).map(env=>{const p=get(env);const isSandbox=env==='sandbox';const d=text(diagnostic?.environment)===env?diagnostic:null;const canTest=Boolean(p?.secret_configured)&&(isSandbox||Boolean(p?.mtls_configured));return <form key={`${env}-${text(p?.updated_at)}`} className="bank-control-card" onSubmit={e=>run(()=>save(e,env))}>
    <div className="bank-control-card-head"><div><small>{isSandbox?'AMBIENTE DE TESTES':'AMBIENTE REAL · mTLS'}</small><h2>{isSandbox?'Sandbox Itaú':'Produção Itaú'}</h2></div><span className={`bank-provider-status ${p?.enabled?'on':'off'}`}>{p?.production_ready?'Pronto':p?.enabled?'Ativo':'Inativo'}</span></div>
    {!isSandbox?<div className="bank-production-warning"><b>Produção protegida</b><span>Não reutilize credenciais do Sandbox. A ativação só ocorre quando Client ID, Client Secret, certificado, chave privada, STS e URL do BoleCode estiverem completos.</span></div>:null}
    <div className="bank-control-form">
     <label>Client ID<input name="client_id" defaultValue={text(p?.client_id)} autoComplete="off" placeholder="Informe o Client ID da aplicação"/></label>
     <label>Client Secret<input name="client_secret" type="password" autoComplete="new-password" placeholder={p?.secret_configured?'Já configurado — preencha somente para substituir':'Informe o Client Secret'}/><small>{p?.secret_configured?'O segredo atual continuará salvo se este campo ficar vazio.':'O valor será criptografado antes de ser armazenado.'}</small></label>
     <label>URL de autenticação<input name="token_url" defaultValue={text(p?.token_url)||(isSandbox?SANDBOX_TOKEN:PROD_TOKEN)} placeholder="Endpoint OAuth/token"/></label>
     <label>Base da API BoleCode<input name="api_base_url" defaultValue={text(p?.api_base_url)||(isSandbox?SANDBOX_API:'')} placeholder={isSandbox?'URL base da API':'Cole a URL produtiva exata informada pelo Itaú'}/><small>{isSandbox?'Endpoint de testes.':'Não usamos URL presumida; informe a URL exata da especificação produtiva.'}</small></label>
     {!isSandbox?<>
      <label className="wide">Certificado mTLS (.crt / PEM)<textarea name="certificate_pem" rows={6} autoComplete="off" placeholder={p?.certificate_configured?'Certificado já armazenado — cole somente para substituir':'-----BEGIN CERTIFICATE-----'} /><small>{p?.certificate_configured?'Certificado armazenado no cofre privado.':'Cole o certificado assinado pelo Itaú em formato PEM.'}</small></label>
      <label className="wide">Chave privada (.key / PEM)<textarea name="private_key_pem" rows={6} autoComplete="off" placeholder={p?.private_key_configured?'Chave privada já armazenada — cole somente para substituir':'-----BEGIN PRIVATE KEY-----'} /><small>{p?.private_key_configured?'Chave privada armazenada e nunca exibida novamente.':'Cole a chave privada correspondente ao certificado.'}</small></label>
      <label>Validade do certificado<input name="certificate_expires_at" type="date" defaultValue={text(p?.certificate_expires_at).slice(0,10)}/><small>Opcional para alertas de renovação.</small></label>
      <div className="bank-mtls-state"><span>mTLS</span><b>{p?.mtls_configured?'Certificado + chave configurados':'Pendente'}</b><small>{p?.certificate_expires_at?`Validade registrada: ${dt(p.certificate_expires_at)}`:'Validade ainda não registrada'}</small></div>
     </>:null}
     <label className="wide">Observações<input name="notes" defaultValue={text(p?.notes)} placeholder={isSandbox?'Ex.: aplicação de testes':'Ex.: credencial produtiva BoleCode / contrato Itaú'}/></label>
     <label className="bank-toggle wide"><input type="checkbox" name="enabled" defaultChecked={Boolean(p?.enabled)}/><span>{isSandbox?'Habilitar este ambiente para uso no Thor':'Ativar Produção somente após concluir o mTLS e validar o token'}</span></label>
    </div>
    <div className="bank-control-actions"><button type="button" disabled={pending||!canTest} onClick={()=>run(()=>test(env))}>{isSandbox?'Testar conexão e escopo':'Testar mTLS + OAuth'}</button><button className="primary" disabled={pending}>Salvar configuração</button></div>
    {d?.ok?<div className={`bank-token-diagnostic ${d.scope_mismatch?'warning':'ok'}`}><div><span>OAuth</span><b>HTTP {text(d.http_status)} · {text(d.token_type)||'Bearer'}</b></div><div><span>Validade</span><b>{text(d.expires_in)||'300'} segundos</b></div><div className="wide"><span>Scope retornado pelo Itaú</span><code>{text(d.scope)||'não informado'}</code></div><div><span>Transporte</span><b>{isSandbox?'HTTPS':'mTLS'}</b></div><div><span>API produtiva</span><b>{isSandbox?'Sandbox':d.api_base_configured?'Configurada':'Pendente'}</b></div><p className="wide">{d.scope_mismatch?'⚠ Escopo incompatível com BoleCode Pix.':'✓ Autenticação validada sem expor o access token.'}</p></div>:null}
    <footer>Última atualização: {dt(p?.updated_at)} · O access token é renovado automaticamente e nunca é persistido.</footer>
   </form>})}
  </section>
  <section className="bank-control-note"><strong>Fluxo produtivo</strong><p>Thor Gestão → Edge mTLS privada → STS Itaú → token OAuth de 5 minutos → API BoleCode. Certificado, chave privada e Client Secret permanecem criptografados e só são lidos pelo backend privilegiado durante a chamada.</p></section>
 </main>;
}
