'use client';

import { FormEvent, useState, useTransition } from 'react';
import { controlBankProviderData, controlBankProviderSave, controlBankProviderTest } from './actions';

type Row=Record<string,unknown>;
const text=(v:unknown)=>v==null?'':String(v);
const dt=(v:unknown)=>v?new Date(String(v)).toLocaleString('pt-BR'):'—';
const bool=(v:unknown)=>v===true||String(v)==='true';
const SANDBOX_TOKEN='https://sandbox.devportal.itau.com.br/api/oauth/jwt';
const SANDBOX_API='https://sandbox.devportal.itau.com.br/itau-ep9-gtw-cash-management-ext-v2/v2';
const PROD_TOKEN='https://sts.itau.com.br/as/token.oauth2';
const PROD_API='https://api.gateway.itau.com.br/cash_management/v2';
const DEFAULTS:Row={api_family:'cash_management_v2',issue_path:'/boletos',consult_path:'/boletos',channel_code:'API',instrument:'boleto',wallet_default:'109',species_default:'01',boleto_type_default:'a vista',interest_type_default:'05',fine_type_default:'03',partial_payment_default:false,divergent_receipt_default:false,consult_view:'specific',user_agent:'ThorGestao/1.0'};

export default function ControlBankingClient({initial}:{initial:Record<string,unknown>}){
 const [providers,setProviders]=useState<Row[]>(Array.isArray(initial.providers)?initial.providers as Row[]:[]);
 const [message,setMessage]=useState('');
 const [diagnostic,setDiagnostic]=useState<Row|null>(null);
 const [pending,startTransition]=useTransition();
 const get=(env:string)=>providers.find(p=>text(p.provider)==='itau'&&text(p.environment)===env);
 const cfg=(p?:Row)=>({...DEFAULTS,...((p?.boleto_settings&&typeof p.boleto_settings==='object'&&!Array.isArray(p.boleto_settings))?p.boleto_settings as Row:{})});
 async function refresh(){const r=await controlBankProviderData();if(r.ok)setProviders(Array.isArray(r.providers)?r.providers as Row[]:[])}
 function run(fn:()=>Promise<void>){startTransition(()=>{void fn()})}
 async function save(e:FormEvent<HTMLFormElement>,env:string){
  e.preventDefault();const fd=new FormData(e.currentTarget);const payload=Object.fromEntries(fd.entries());
  const r=await controlBankProviderSave({...payload,provider:'itau',environment:env,enabled:fd.get('enabled')==='on',partial_payment_default:fd.get('partial_payment_default')==='on',divergent_receipt_default:fd.get('divergent_receipt_default')==='on'});
  if(!r.ok){
   const err=text(r.error);
   setMessage(err==='production_credentials_incomplete'?'Produção ainda não foi ativada: informe Client ID, Client Secret, certificado, chave privada, STS e a URL Cash Management v2.':err==='itau_wallet_invalid'?'Carteira padrão deve possuir 3 caracteres.':err==='itau_species_invalid'?'Espécie padrão deve possuir 2 caracteres.':`Falha ao salvar: ${err}`);
   await refresh();return;
  }
  setDiagnostic(null);setMessage(`Configuração Itaú ${env==='sandbox'?'Sandbox':'Produção'} salva. O Thor Gestão já passa a consumir estes parâmetros.`);await refresh();
 }
 async function test(env:string){
  const r=await controlBankProviderTest('itau',env);setDiagnostic({...r,environment:env});
  if(!r.ok){setMessage(`Falha no teste Itaú: ${text(r.error||r.detail||'não foi possível obter o token')} ${r.http_status?`(HTTP ${text(r.http_status)})`:''}`);return}
  setMessage(env==='production'?'mTLS de Produção validado e token OAuth obtido com sucesso.':'Conexão Sandbox validada. OAuth e configuração Cash Management carregados com sucesso.');
 }
 return <main className="bank-control-page">
  <header className="bank-control-hero"><div><a href="/control">← Voltar ao ThorControl</a><small>INTEGRAÇÕES BANCÁRIAS</small><h1>Itaú Boleto Registrado</h1><p>Central de configuração da API Cash Management v2. Sandbox e Produção ficam isolados, com endpoints, credenciais e regras padrão próprias para emissão e consulta de boletos.</p></div><div className="bank-control-badge">Cash Management v2 · Boleto Registrado</div></header>
  {message&&<div className="bank-control-message">{message}</div>}
  <section className="bank-control-summary"><article><span>Sandbox</span><strong>{get('sandbox')?.enabled?'Ativo':'Não configurado'}</strong><small>{get('sandbox')?.secret_configured?'OAuth configurado':'Client Secret pendente'}</small></article><article><span>Produção</span><strong>{get('production')?.production_ready?'Pronta':get('production')?.enabled?'Incompleta':'Pendente'}</strong><small>{get('production')?.mtls_configured?'mTLS configurado':'Certificado/chave pendentes'}</small></article><article><span>Produto</span><strong>Boleto Registrado</strong><small>Emissão, consulta e instruções · Cash Management v2</small></article></section>
  <section className="bank-control-grid">
   {(['sandbox','production'] as const).map(env=>{const p=get(env);const s=cfg(p);const isSandbox=env==='sandbox';const d=text(diagnostic?.environment)===env?diagnostic:null;const canTest=Boolean(p?.secret_configured)&&(isSandbox||Boolean(p?.mtls_configured));return <form key={`${env}-${text(p?.updated_at)}`} className="bank-control-card" onSubmit={e=>run(()=>save(e,env))}>
    <div className="bank-control-card-head"><div><small>{isSandbox?'AMBIENTE DE TESTES':'AMBIENTE REAL · mTLS'}</small><h2>{isSandbox?'Sandbox Itaú':'Produção Itaú'}</h2></div><span className={`bank-provider-status ${p?.enabled?'on':'off'}`}>{p?.production_ready?'Pronto':p?.enabled?'Ativo':'Inativo'}</span></div>
    {!isSandbox?<div className="bank-production-warning"><b>Produção protegida</b><span>Use credenciais produtivas próprias. A ativação exige Client ID, Client Secret, certificado, chave privada, STS e a URL Cash Management v2.</span></div>:null}
    <div className="bank-control-form">
     <div className="bank-control-section-title wide"><b>Autenticação e transporte</b><span>Parâmetros exclusivos deste ambiente.</span></div>
     <label>Client ID / x-itau-apikey<input name="client_id" defaultValue={text(p?.client_id)} autoComplete="off" placeholder="Client ID da aplicação"/><small>O mesmo Client ID é enviado no header x-itau-apikey.</small></label>
     <label>Client Secret<input name="client_secret" type="password" autoComplete="new-password" placeholder={p?.secret_configured?'Já configurado — preencha somente para substituir':'Informe o Client Secret'}/><small>{p?.secret_configured?'O segredo atual permanece se este campo ficar vazio.':'Armazenado de forma criptografada.'}</small></label>
     <label>URL OAuth / STS<input name="token_url" defaultValue={text(p?.token_url)||(isSandbox?SANDBOX_TOKEN:PROD_TOKEN)} placeholder="Endpoint de autenticação"/></label>
     <label>Base API Cash Management v2<input name="api_base_url" defaultValue={text(p?.api_base_url)||(isSandbox?SANDBOX_API:PROD_API)} placeholder="URL base da API"/><small>{isSandbox?'Sandbox oficial Cash Management v2.':'Base produtiva da API de boleto registrado.'}</small></label>

     <div className="bank-control-section-title wide"><b>Emissão e consulta de boleto</b><span>Fonte padrão consumida pelo Thor Gestão. Dados do beneficiário continuam vinculados à conta bancária.</span></div>
     <label>Família da API<input name="api_family" defaultValue={text(s.api_family)} readOnly/></label>
     <label>Canal de operação<input name="channel_code" defaultValue={text(s.channel_code)} placeholder="API"/></label>
     <label>Endpoint de emissão<input name="issue_path" defaultValue={text(s.issue_path)} placeholder="/boletos"/><small>POST para validação/efetivação.</small></label>
     <label>Endpoint de consulta<input name="consult_path" defaultValue={text(s.consult_path)} placeholder="/boletos"/><small>GET por beneficiário, carteira e Nosso Número.</small></label>
     <label>Instrumento<input name="instrument" defaultValue={text(s.instrument)} placeholder="boleto"/></label>
     <label>Tipo de boleto padrão<input name="boleto_type_default" defaultValue={text(s.boleto_type_default)} placeholder="a vista"/></label>
     <label>Carteira padrão<input name="wallet_default" maxLength={3} defaultValue={text(s.wallet_default)} placeholder="109"/><small>A conta bancária pode sobrescrever este padrão.</small></label>
     <label>Espécie padrão<input name="species_default" maxLength={2} defaultValue={text(s.species_default)} placeholder="01"/><small>A conta bancária pode sobrescrever este padrão.</small></label>
     <label>Código padrão de juros<input name="interest_type_default" defaultValue={text(s.interest_type_default)} placeholder="05"/><small>05 = sem juros no modelo atual.</small></label>
     <label>Código padrão de multa<input name="fine_type_default" defaultValue={text(s.fine_type_default)} placeholder="03"/><small>03 = sem multa no modelo atual.</small></label>
     <label>Visão padrão da consulta<input name="consult_view" defaultValue={text(s.consult_view)} placeholder="specific"/></label>
     <label>User-Agent<input name="user_agent" defaultValue={text(s.user_agent)} placeholder="ThorGestao/1.0"/></label>
     <label className="bank-toggle"><input type="checkbox" name="partial_payment_default" defaultChecked={bool(s.partial_payment_default)}/><span>Permitir pagamento parcial por padrão</span></label>
     <label className="bank-toggle"><input type="checkbox" name="divergent_receipt_default" defaultChecked={bool(s.divergent_receipt_default)}/><span>Permitir recebimento divergente por padrão</span></label>

     {!isSandbox?<>
      <div className="bank-control-section-title wide"><b>Certificado produtivo mTLS</b><span>Materiais privados usados apenas pelo backend.</span></div>
      <label className="wide">Certificado mTLS (.crt / PEM)<textarea name="certificate_pem" rows={6} autoComplete="off" placeholder={p?.certificate_configured?'Certificado já armazenado — cole somente para substituir':'-----BEGIN CERTIFICATE-----'} /><small>{p?.certificate_configured?'Certificado armazenado no cofre privado.':'Cole o certificado assinado pelo Itaú em PEM.'}</small></label>
      <label className="wide">Chave privada (.key / PEM)<textarea name="private_key_pem" rows={6} autoComplete="off" placeholder={p?.private_key_configured?'Chave privada já armazenada — cole somente para substituir':'-----BEGIN PRIVATE KEY-----'} /><small>{p?.private_key_configured?'Chave privada armazenada e nunca exibida novamente.':'Cole a chave correspondente ao certificado.'}</small></label>
      <label>Validade do certificado<input name="certificate_expires_at" type="date" defaultValue={text(p?.certificate_expires_at).slice(0,10)}/><small>Usada para alertas de renovação.</small></label>
      <div className="bank-mtls-state"><span>mTLS</span><b>{p?.mtls_configured?'Certificado + chave configurados':'Pendente'}</b><small>{p?.certificate_expires_at?`Validade registrada: ${dt(p.certificate_expires_at)}`:'Validade ainda não registrada'}</small></div>
     </>:null}
     <label className="wide">Observações<input name="notes" defaultValue={text(p?.notes)} placeholder={isSandbox?'Ex.: homologação Cash Management v2':'Ex.: contrato produtivo Itaú / boleto registrado'}/></label>
     <label className="bank-toggle wide"><input type="checkbox" name="enabled" defaultChecked={Boolean(p?.enabled)}/><span>{isSandbox?'Habilitar Sandbox para emissão e consulta no Thor Gestão':'Ativar Produção somente após concluir o mTLS e a homologação'}</span></label>
    </div>
    <div className="bank-control-actions"><button type="button" disabled={pending||!canTest} onClick={()=>run(()=>test(env))}>{isSandbox?'Testar OAuth':'Testar mTLS + OAuth'}</button><button className="primary" disabled={pending}>Salvar ambiente</button></div>
    {d?.ok?<div className="bank-token-diagnostic ok"><div><span>OAuth</span><b>HTTP {text(d.http_status)} · {text(d.token_type)||'Bearer'}</b></div><div><span>Validade</span><b>{text(d.expires_in)||'300'} segundos</b></div><div className="wide"><span>Scope retornado pelo Itaú</span><code>{text(d.scope)||'não informado'}</code></div><div><span>Família</span><b>{text(d.api_family)||text(s.api_family)}</b></div><div><span>Emissão / consulta</span><b>{text(d.issue_path)||text(s.issue_path)} · {text(d.consult_path)||text(s.consult_path)}</b></div><p className="wide">✓ Autenticação validada sem expor Client Secret nem access token.</p></div>:null}
    <footer>Última atualização: {dt(p?.updated_at)} · O Thor Gestão lê estas regras no momento de cada emissão e consulta.</footer>
   </form>})}
  </section>
  <section className="bank-control-note"><strong>Responsabilidade das configurações</strong><p>ThorControl define credenciais, endpoints e regras padrão por ambiente. Em Contas Bancárias ficam agência, conta, DAC e ID do beneficiário de cada empresa; carteira e espécie podem sobrescrever os padrões quando o contrato bancário exigir.</p></section>
 </main>;
}