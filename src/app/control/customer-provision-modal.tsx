'use client';

import { FormEvent, useMemo, useState } from 'react';
import { controlCreateCustomer } from './actions';

type Row=Record<string,unknown>;
const text=(v:unknown)=>v==null?'':String(v);
const num=(v:unknown)=>Number(v||0);
const digits=(v:string)=>v.replace(/\D/g,'');

const MODULES=[
 ['people','Pessoas','Clientes, fornecedores e usuários'],['sales','Vendas','Operações, vendas e caixas'],['products','Produtos','Cadastro e ficha técnica'],['pricing','Tabela de Preços','Tabelas, promoções e ajustes'],['stock','Estoque','Movimentações, inventário e transferências'],['purchases','Compras','Entradas e compras'],['finance','Financeiro','Receber, pagar e conciliação'],['fiscal','Fiscal','NF-e e NFC-e'],['production','Produção','Cozinha e produção sob demanda'],['reports','Relatórios','Relatórios gerenciais'],['administration','Administrativo','Empresa, Matriz e configurações'],['branches','Lojas / Filiais','Libera unidades adicionais além da Matriz'],['integrations','Integrações','Integrações externas'],['support','Atendimento','Chamados e mensagens'],['pdv','ThorPDV','Frente de caixa Desktop'],
] as const;

const blank={
 cnpj:'',legal_name:'',trade_name:'',state_registration:'',municipal_registration:'',tax_regime:'',company_email:'',phone:'',
 postal_code:'',street:'',number:'',complement:'',district:'',city:'',state:'',ibge_city_code:'',branch_name:'Matriz',
 admin_email:'',contact:'',responsible:'',license_status:'trial',management_user_limit:'5',pdv_terminal_limit:'1',branch_limit:'1',expires_at:'',notes:'',
};

const errors:Record<string,string>={
 invalid_cnpj:'CNPJ inválido.',cnpj_already_registered:'Este CNPJ já possui uma base cadastrada.',admin_email_already_in_use:'Este e-mail de administrador já está em uso.',
 admin_email_required:'Informe o e-mail do administrador.',legal_name_required:'Informe a razão social.',invalid_tax_regime:'Selecione um CRT válido.',invalid_postal_code:'CEP inválido.',invalid_state:'UF inválida.',
};

export default function CustomerProvisionModal({pricing,onClose,onCreated}:{pricing:Row;onClose:()=>void;onCreated:(result:Row)=>void}){
 const [form,setForm]=useState({...blank,management_user_limit:String(num(pricing.included_management_users)||5),pdv_terminal_limit:String(num(pricing.included_pdv_terminals)||1),branch_limit:String(num(pricing.included_branches)||1)});
 const [modules,setModules]=useState<Record<string,boolean>>(()=>Object.fromEntries(MODULES.map(([k])=>[k,k==='branches'?false:true])));
 const [busy,setBusy]=useState(false);const [lookup,setLookup]=useState('');const [message,setMessage]=useState('');
 const monthly=useMemo(()=>{const base=num(pricing.base_erp_price),iu=num(pricing.included_management_users)||5,ip=num(pricing.included_pdv_terminals)||1,ib=num(pricing.included_branches)||1;const branchTotal=modules.branches?Math.max(Number(form.branch_limit||1),1):1;return base+Math.max(Number(form.management_user_limit||0)-iu,0)*num(pricing.extra_management_user_price)+Math.max(Number(form.pdv_terminal_limit||0)-ip,0)*num(pricing.extra_pdv_terminal_price)+Math.max(branchTotal-ib,0)*num(pricing.extra_branch_price)},[form.management_user_limit,form.pdv_terminal_limit,form.branch_limit,modules.branches,pricing]);
 function set(name:string,value:string){setForm(f=>({...f,[name]:value}));}
 async function lookupCnpj(){const cnpj=digits(form.cnpj);if(cnpj.length!==14){setMessage('Digite os 14 dígitos do CNPJ.');return}setLookup('cnpj');setMessage('');try{const r=await fetch(`/api/lookup/cnpj?cnpj=${cnpj}`,{cache:'no-store'});const j=await r.json();if(!r.ok||!j.ok)throw new Error(j.error||'cnpj_lookup_failed');const d=j.data||{};setForm(f=>({...f,cnpj,legal_name:text(d.name)||f.legal_name,trade_name:text(d.trade_name)||f.trade_name,company_email:text(d.email)||f.company_email,admin_email:f.admin_email||text(d.email),phone:text(d.phone)||f.phone,postal_code:text(d.postal_code)||f.postal_code,street:text(d.street)||f.street,number:text(d.number)||f.number,complement:text(d.complement)||f.complement,district:text(d.district)||f.district,city:text(d.city)||f.city,state:text(d.state)||f.state,ibge_city_code:text(d.ibge_city_code)||f.ibge_city_code,branch_name:f.branch_name==='Matriz'?(text(d.trade_name)||'Matriz'):f.branch_name}));setMessage('Dados do CNPJ e endereço carregados. Revise antes de criar a base.');}catch{setMessage('Não foi possível consultar o CNPJ agora. Você ainda pode preencher os dados manualmente.');}finally{setLookup('')}}
 async function lookupCep(){const cep=digits(form.postal_code);if(cep.length!==8)return;setLookup('cep');try{const r=await fetch(`/api/lookup/cep?cep=${cep}`,{cache:'no-store'});const j=await r.json();if(r.ok&&j.ok){const d=j.data||{};setForm(f=>({...f,postal_code:cep,street:text(d.street)||f.street,complement:text(d.complement)||f.complement,district:text(d.district)||f.district,city:text(d.city)||f.city,state:text(d.state)||f.state,ibge_city_code:text(d.ibge_city_code)||f.ibge_city_code}));}}finally{setLookup('')}}
 async function submit(e:FormEvent<HTMLFormElement>){e.preventDefault();setBusy(true);setMessage('');try{const payload={...form,cnpj:digits(form.cnpj),postal_code:digits(form.postal_code),state:form.state.toUpperCase(),modules};const r=await controlCreateCustomer(payload);if(!r.ok)throw new Error(text(r.error||'customer_create_failed'));onCreated(r as Row);}catch(err){const code=String((err as Error).message||err);setMessage(errors[code]||`Não foi possível criar a base: ${code}`);}finally{setBusy(false)}}
 const input=(name:keyof typeof blank,label:string,props:Record<string,unknown>={})=><label>{label}<input name={name} value={form[name]} onChange={e=>set(name,e.target.value)} {...props}/></label>;
 return <div className="control-modal-bg"><form className="control-modal xwide customer-provision" onSubmit={submit}><header><div><small>NOVA BASE DE CLIENTE</small><h2>Cadastrar empresa, Matriz, acesso e licença</h2><p>O ThorControl cria a estrutura inicial que o cliente encontrará no Thor Gestão.</p></div><button type="button" onClick={onClose}>×</button></header>
  {message&&<div className="provision-message">{message}</div>}
  <div className="provision-grid">
   <section><div className="provision-section-title"><div><small>1. EMPRESA</small><h3>Identificação</h3></div><button type="button" className="lookup-button" onClick={lookupCnpj} disabled={lookup==='cnpj'}>{lookup==='cnpj'?'Consultando...':'Consultar CNPJ'}</button></div>
    <div className="form-grid">{input('cnpj','CNPJ *',{required:true,inputMode:'numeric',onBlur:()=>{if(digits(form.cnpj).length===14&&!form.legal_name)void lookupCnpj()}})}{input('legal_name','Razão social *',{required:true})}{input('trade_name','Nome fantasia')}{input('state_registration','Inscrição Estadual')}{input('municipal_registration','Inscrição Municipal')}<label>CRT / Regime tributário<select name="tax_regime" value={form.tax_regime} onChange={e=>set('tax_regime',e.target.value)}><option value="">Selecione...</option><option value="1">1 - Simples Nacional</option><option value="2">2 - Simples Nacional, excesso sublimite</option><option value="3">3 - Regime Normal</option><option value="4">4 - MEI</option></select></label>{input('company_email','E-mail da empresa',{type:'email'})}{input('phone','Telefone')}</div>
    <h3>Endereço da Matriz</h3><div className="form-grid">{input('postal_code','CEP',{inputMode:'numeric',onBlur:()=>void lookupCep()})}{input('street','Rua / Logradouro')}{input('number','Número')}{input('complement','Complemento')}{input('district','Bairro')}{input('city','Cidade')}{input('state','UF',{maxLength:2})}{input('ibge_city_code','Código IBGE')}{input('branch_name','Nome da filial inicial')}</div>
    <h3>Contato</h3><div className="form-grid">{input('contact','Contato principal')}{input('responsible','Responsável')}</div>
   </section>
   <section><small>2. ACESSO</small><h3>Administrador do Thor Gestão</h3><p className="muted">Este e-mail será usado no login. O ThorControl gera uma senha temporária e exige a troca no primeiro acesso.</p>{input('admin_email','E-mail do administrador *',{type:'email',required:true})}
    <small className="provision-step">3. LICENÇA</small><div className="form-grid"><label>Status inicial<select name="license_status" value={form.license_status} onChange={e=>set('license_status',e.target.value)}><option value="trial">Teste</option><option value="active">Ativa</option></select></label>{input('management_user_limit','Usuários Gestão',{type:'number',min:1})}{input('pdv_terminal_limit','Terminais ThorPDV',{type:'number',min:0})}<label>Total de lojas / unidades<input name="branch_limit" type="number" min="1" value={form.branch_limit} onChange={e=>{set('branch_limit',e.target.value);if(Number(e.target.value)>1)setModules(m=>({...m,branches:true}))}}/><small>Inclui a Matriz. 2 = Matriz + 1 filial.</small></label>{input('expires_at','Validade',{type:'date'})}</div>
    <div className="provision-price"><span>Mensalidade calculada</span><strong>{monthly.toLocaleString('pt-BR',{style:'currency',currency:'BRL'})}</strong></div>
    <h3>Módulos habilitados</h3><div className="module-grid compact">{MODULES.map(([k,n,d])=><label className={`module-choice ${modules[k]?'on':''}`} key={k}><input type="checkbox" checked={!!modules[k]} onChange={e=>setModules(m=>({...m,[k]:e.target.checked}))}/><span><strong>{n}</strong><small>{d}</small></span></label>)}</div>
    <label>Observações<textarea name="notes" rows={3} value={form.notes} onChange={e=>set('notes',e.target.value)} placeholder="Condições comerciais, implantação, observações internas..."/></label>
   </section>
  </div>
  <div className="provision-footnote">CNPJ, dados da empresa e endereço serão gravados na Matriz e reaproveitados nas telas de configuração do Thor Gestão e ThorFiscal.</div>
  <footer><button type="button" onClick={onClose}>Cancelar</button><button className="control-primary" disabled={busy}>{busy?'Criando base...':'Criar cliente e licença'}</button></footer>
 </form></div>;
}
