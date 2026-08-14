'use client';

import { FormEvent, useMemo, useState, useTransition } from 'react';
import { controlBankProviderData, controlBankProviderSave, controlBankProviderTest } from './actions';

type Row=Record<string,unknown>;
const text=(v:unknown)=>v==null?'':String(v);
const dt=(v:unknown)=>v?new Date(String(v)).toLocaleString('pt-BR'):'—';
const SANDBOX_TOKEN='https://sandbox.devportal.itau.com.br/api/oauth/jwt';
const SANDBOX_API='https://sandbox.devportal.itau.com.br/itau-ep9-api-recebimentos-v1-externo/v1';

export default function ControlBankingClient({initial}:{initial:Record<string,unknown>}){
 const [providers,setProviders]=useState<Row[]>(Array.isArray(initial.providers)?initial.providers as Row[]:[]);
 const [message,setMessage]=useState('');const [pending,startTransition]=useTransition();
 const get=(env:string)=>providers.find(p=>text(p.provider)==='itau'&&text(p.environment)===env);
 async function refresh(){const r=await controlBankProviderData();if(r.ok)setProviders(Array.isArray(r.providers)?r.providers as Row[]:[])}
 function run(fn:()=>Promise<void>){startTransition(()=>{void fn()})}
 async function save(e:FormEvent<HTMLFormElement>,env:string){e.preventDefault();const fd=new FormData(e.currentTarget);const payload=Object.fromEntries(fd.entries());const r=await controlBankProviderSave({...payload,provider:'itau',environment:env,enabled:fd.get('enabled')==='on'});if(!r.ok){setMessage(`Falha ao salvar: ${text(r.error)}`);return}setMessage(`Configuração Itaú ${env==='sandbox'?'Sandbox':'Produção'} salva com segurança.`);await refresh()}
 async function test(env:string){const r=await controlBankProviderTest('itau',env);setMessage(r.ok?`Conexão Itaú ${env==='sandbox'?'Sandbox':'Produção'} validada. Token obtido com sucesso.`:`Falha no teste Itaú: ${text(r.error||r.detail||'não foi possível obter o token')} ${r.http_status?`(HTTP ${text(r.http_status)})`:''}`)}
 return <main className="bank-control-page">
  <header className="bank-control-hero"><div><a href="/control">← Voltar ao ThorControl</a><small>INTEGRAÇÕES BANCÁRIAS</small><h1>Itaú BoleCode Pix</h1><p>Credenciais globais da plataforma, separadas por ambiente. O segredo é criptografado no backend e nunca é devolvido pela interface.</p></div><div className="bank-control-badge">Primeiro provedor bancário do Thor</div></header>
  {message&&<div className="bank-control-message">{message}</div>}
  <section className="bank-control-summary"><article><span>Sandbox</span><strong>{get('sandbox')?.enabled?'Ativo':'Não configurado'}</strong><small>{get('sandbox')?.secret_configured?'Segredo armazenado':'Client Secret pendente'}</small></article><article><span>Produção</span><strong>{get('production')?.enabled?'Ativo':'Pendente'}</strong><small>{get('production')?.secret_configured?'Segredo armazenado':'Aguardando homologação'}</small></article><article><span>Produto</span><strong>BoleCode Pix</strong><small>Boleto registrado + QR Code Pix</small></article></section>
  <section className="bank-control-grid">
   {(['sandbox','production'] as const).map(env=>{const p=get(env);const isSandbox=env==='sandbox';return <form key={`${env}-${text(p?.updated_at)}`} className="bank-control-card" onSubmit={e=>run(()=>save(e,env))}>
    <div className="bank-control-card-head"><div><small>{isSandbox?'AMBIENTE DE TESTES':'AMBIENTE REAL'}</small><h2>{isSandbox?'Sandbox Itaú':'Produção Itaú'}</h2></div><span className={`bank-provider-status ${p?.enabled?'on':'off'}`}>{p?.enabled?'Ativo':'Inativo'}</span></div>
    <div className="bank-control-form">
     <label>Client ID<input name="client_id" defaultValue={text(p?.client_id)} autoComplete="off" placeholder="Informe o Client ID da aplicação"/></label>
     <label>Client Secret<input name="client_secret" type="password" autoComplete="new-password" placeholder={p?.secret_configured?'Já configurado — preencha somente para substituir':'Informe o Client Secret'}/><small>{p?.secret_configured?'O segredo atual continuará salvo se este campo ficar vazio.':'O valor será criptografado antes de ser armazenado.'}</small></label>
     <label>URL de autenticação<input name="token_url" defaultValue={text(p?.token_url)||(isSandbox?SANDBOX_TOKEN:'')} placeholder="Endpoint OAuth/token"/></label>
     <label>Base da API BoleCode<input name="api_base_url" defaultValue={text(p?.api_base_url)||(isSandbox?SANDBOX_API:'')} placeholder="URL base da API"/></label>
     <label className="wide">Observações<input name="notes" defaultValue={text(p?.notes)} placeholder="Ex.: Aplicação BoleCode Pix / homologação"/></label>
     <label className="bank-toggle wide"><input type="checkbox" name="enabled" defaultChecked={Boolean(p?.enabled)}/><span>Habilitar este ambiente para uso no Thor</span></label>
    </div>
    <div className="bank-control-actions"><button type="button" disabled={pending||!p?.secret_configured} onClick={()=>run(()=>test(env))}>Testar conexão</button><button className="primary" disabled={pending}>Salvar configuração</button></div>
    <footer>Última atualização: {dt(p?.updated_at)}</footer>
   </form>})}
  </section>
  <section className="bank-control-note"><strong>Segurança da integração</strong><p>O navegador nunca recebe Client Secret nem token do Itaú. O ThorControl apenas envia a alteração para o backend, que criptografa o segredo. As emissões do Thor Gestão são executadas no servidor usando essa credencial.</p></section>
 </main>;
}
