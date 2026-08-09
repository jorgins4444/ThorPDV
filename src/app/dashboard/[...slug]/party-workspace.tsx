'use client';

import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { partyList, partySave } from './party-actions';
import styles from './party-workspace.module.css';

type Row = Record<string, unknown>;
type Resource = 'customers' | 'suppliers';
type PartyType = 'PF' | 'PJ';
type FormState = {
  id?: string; type: PartyType; name: string; trade_name: string; document: string; birth_date: string;
  state_registration: string; email: string; phone: string; postal_code: string; street: string; number: string;
  complement: string; district: string; city: string; state: string; ibge_city_code: string; active: boolean;
};

const EMPTY: FormState = { type:'PF',name:'',trade_name:'',document:'',birth_date:'',state_registration:'',email:'',phone:'',postal_code:'',street:'',number:'',complement:'',district:'',city:'',state:'',ibge_city_code:'',active:true };

function digits(value: unknown) { return String(value ?? '').replace(/\D/g, ''); }
function money(value: unknown) { return Number(value || 0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'}); }
function cpfValid(value: unknown) {
  const d=digits(value); if(d.length!==11||/^(\d)\1+$/.test(d))return false; let s=0;
  for(let i=0;i<9;i++)s+=Number(d[i])*(10-i); let x=(s*10)%11; if(x===10)x=0; if(x!==Number(d[9]))return false;
  s=0; for(let i=0;i<10;i++)s+=Number(d[i])*(11-i); x=(s*10)%11; if(x===10)x=0; return x===Number(d[10]);
}
function cnpjValid(value: unknown) {
  const d=digits(value); if(d.length!==14||/^(\d)\1+$/.test(d))return false;
  const calc=(base:string,weights:number[])=>{const sum=base.split('').reduce((a,n,i)=>a+Number(n)*weights[i],0);const r=sum%11;return r<2?0:11-r;};
  const d1=calc(d.slice(0,12),[5,4,3,2,9,8,7,6,5,4,3,2]); if(d1!==Number(d[12]))return false;
  return calc(d.slice(0,13),[6,5,4,3,2,9,8,7,6,5,4,3,2])===Number(d[13]);
}
function fmtDocument(value: unknown) { const d=digits(value); if(d.length<=11)return d.replace(/(\d{3})(\d{3})(\d{3})(\d{1,2})/,'$1.$2.$3-$4'); return d.slice(0,14).replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{1,2})/,'$1.$2.$3/$4-$5'); }
function fmtCep(value: unknown) { const d=digits(value).slice(0,8); return d.length>5?`${d.slice(0,5)}-${d.slice(5)}`:d; }
function rowToForm(row: Row, resource: Resource): FormState {
  return { ...EMPTY,id:String(row.id||''),type:String(row.type|| (resource==='suppliers'?'PJ':'PF')).toUpperCase()==='PJ'?'PJ':'PF',name:String(row.name||''),trade_name:String(row.trade_name||''),document:digits(row.document),birth_date:String(row.birth_date||''),state_registration:String(row.state_registration||''),email:String(row.email||''),phone:String(row.phone||''),postal_code:digits(row.postal_code),street:String(row.street||''),number:String(row.number||''),complement:String(row.complement||''),district:String(row.district||''),city:String(row.city||''),state:String(row.state||''),ibge_city_code:String(row.ibge_city_code||''),active:row.active!==false };
}

export function PartyWorkspace({ resource, initial }: { resource: Resource; initial: Row[] }) {
  const isCustomer=resource==='customers';
  const [rows,setRows]=useState<Row[]>(initial); const [search,setSearch]=useState(''); const [modal,setModal]=useState(false); const [form,setForm]=useState<FormState>({...EMPTY,type:isCustomer?'PF':'PJ'});
  const [saving,setSaving]=useState(false); const [message,setMessage]=useState(''); const [error,setError]=useState(false); const [docHint,setDocHint]=useState(''); const [cepHint,setCepHint]=useState('');
  const lastCnpj=useRef(''); const lastCep=useRef('');
  const activeCount=useMemo(()=>rows.filter(r=>r.active!==false).length,[rows]); const creditTotal=useMemo(()=>isCustomer?rows.reduce((s,r)=>s+Number(r.store_credit_balance||0),0):0,[rows,isCustomer]);
  const set=(key:keyof FormState,value:string|boolean)=>setForm(v=>({...v,[key]:value}));

  const refresh=async(q=search)=>{const r=await partyList(resource,q);if(r.ok)setRows(r.data);else{setError(true);setMessage(String(r.error||'Erro ao carregar registros.'));}};
  const openNew=()=>{setForm({...EMPTY,type:isCustomer?'PF':'PJ'});setDocHint('');setCepHint('');setMessage('');setModal(true);lastCnpj.current='';lastCep.current='';};
  const openEdit=(row:Row)=>{setForm(rowToForm(row,resource));setDocHint('');setCepHint('');setMessage('');setModal(true);lastCnpj.current='';lastCep.current='';};

  const lookupCep=async(raw=form.postal_code)=>{const cep=digits(raw); if(cep.length!==8){setCepHint(cep?'CEP deve possuir 8 dígitos.':'');return;} if(lastCep.current===cep)return; lastCep.current=cep; setCepHint('Consultando CEP...');
    try{const res=await fetch(`/api/lookup/cep?cep=${cep}`);const body=await res.json();if(!res.ok||!body.ok)throw new Error(body.error||'cep_not_found');const d=body.data||{};setForm(v=>({...v,postal_code:cep,street:d.street||v.street,complement:d.complement||v.complement,district:d.district||v.district,city:d.city||v.city,state:d.state||v.state,ibge_city_code:d.ibge_city_code||v.ibge_city_code}));setCepHint('Endereço localizado pelo CEP.');}catch{lastCep.current='';setCepHint('CEP não localizado. Você pode preencher o endereço manualmente.');}
  };
  const lookupCnpj=async(raw=form.document)=>{const cnpj=digits(raw);if(cnpj.length!==14||!cnpjValid(cnpj)){setDocHint(cnpj.length===14?'CNPJ inválido.':'');return;}if(lastCnpj.current===cnpj)return;lastCnpj.current=cnpj;setDocHint('Consultando dados do CNPJ...');
    try{const res=await fetch(`/api/lookup/cnpj?cnpj=${cnpj}`);const body=await res.json();if(!res.ok||!body.ok)throw new Error(body.error||'cnpj_not_found');const d=body.data||{};setForm(v=>({...v,document:cnpj,name:d.name||v.name,trade_name:d.trade_name||v.trade_name,email:d.email||v.email,phone:d.phone||v.phone,state_registration:d.state_registration||v.state_registration,postal_code:d.postal_code||v.postal_code,street:d.street||v.street,number:d.number||v.number,complement:d.complement||v.complement,district:d.district||v.district,city:d.city||v.city,state:d.state||v.state,ibge_city_code:d.ibge_city_code||v.ibge_city_code}));setDocHint('CNPJ válido e dados cadastrais preenchidos.');if(d.postal_code)lastCep.current=String(d.postal_code);}catch{lastCnpj.current='';setDocHint('CNPJ válido, mas a consulta cadastral não respondeu. Os campos podem ser preenchidos manualmente.');}
  };

  useEffect(()=>{const d=digits(form.document);if(form.type==='PJ'&&d.length===14&&cnpjValid(d)){const t=setTimeout(()=>lookupCnpj(d),350);return()=>clearTimeout(t);}if(form.type==='PF'&&d.length===11)setDocHint(cpfValid(d)?'CPF válido.':'CPF inválido.');},[form.document,form.type]);
  useEffect(()=>{const d=digits(form.postal_code);if(d.length===8){const t=setTimeout(()=>lookupCep(d),350);return()=>clearTimeout(t);}},[form.postal_code]);

  const submit=async(e:FormEvent)=>{e.preventDefault();setMessage('');setError(false);const d=digits(form.document);if(!form.name.trim()){setError(true);setMessage('Informe o nome ou razão social.');return;}if(form.type==='PF'&&!cpfValid(d)){setError(true);setMessage('CPF inválido. Corrija o documento antes de salvar.');return;}if(form.type==='PJ'&&!cnpjValid(d)){setError(true);setMessage('CNPJ inválido. Corrija o documento antes de salvar.');return;}if(form.postal_code&&digits(form.postal_code).length!==8){setError(true);setMessage('CEP inválido.');return;}
    setSaving(true);const result=await partySave(resource,{...form,document:d,postal_code:digits(form.postal_code),birth_date:form.type==='PF'&&isCustomer?form.birth_date:'',type:form.type});setSaving(false);
    if(result.ok){setModal(false);setMessage('Cadastro salvo com sucesso.');setError(false);await refresh();}else{setError(true);setMessage(String(result.error||'Não foi possível salvar.'));}
  };

  return <div className={styles.workspace}>
    <div className={styles.metrics}><article className={styles.metric}><span>Registros</span><strong>{rows.length}</strong></article><article className={styles.metric}><span>Ativos</span><strong>{activeCount}</strong></article><article className={styles.metric}><span>{isCustomer?'Crédito em loja':'Tipo de cadastro'}</span><strong>{isCustomer?money(creditTotal):'PF / PJ'}</strong></article><article className={styles.metric}><span>Integração</span><strong>Gestão + PDV</strong></article></div>
    <section className={styles.card}><div className={styles.toolbar}><form className={styles.search} onSubmit={async e=>{e.preventDefault();await refresh();}}><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Buscar por nome, CPF/CNPJ, telefone ou e-mail..."/><button className={styles.secondary}>Buscar</button></form><button className={styles.primary} onClick={openNew}>+ {isCustomer?'Novo Cliente':'Novo Fornecedor'}</button></div>
      {message&&<div className={`${styles.message} ${error?styles.errorMessage:''}`}>{message}</div>}
      <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Nome / Razão Social</th><th>CPF/CNPJ</th><th>Tipo</th><th>Contato</th><th>Cidade</th>{isCustomer&&<th>Crédito loja</th>}<th>Status</th><th></th></tr></thead><tbody>{rows.length?rows.map(row=><tr key={String(row.id)}><td><strong>{String(row.name||'')}</strong>{row.trade_name&&<small>{String(row.trade_name)}</small>}</td><td>{fmtDocument(row.document)}</td><td>{String(row.type||'')}</td><td>{String(row.phone||row.email||'—')}<small>{row.phone&&row.email?String(row.email):''}</small></td><td>{[row.city,row.state].filter(Boolean).join(' / ')||'—'}</td>{isCustomer&&<td className={styles.credit}>{money(row.store_credit_balance)}</td>}<td><span className={`${styles.pill} ${row.active===false?styles.off:''}`}>{row.active===false?'Inativo':'Ativo'}</span></td><td><button className={styles.rowAction} onClick={()=>openEdit(row)}>Editar</button></td></tr>):<tr><td colSpan={isCustomer?8:7} className={styles.empty}>Nenhum registro encontrado.</td></tr>}</tbody></table></div>
    </section>

    {modal&&<div className={styles.backdrop} onMouseDown={()=>setModal(false)}><div className={styles.modal} onMouseDown={e=>e.stopPropagation()}><div className={styles.modalHead}><div><h2>{form.id?'Editar':'Novo'} {isCustomer?'cliente':'fornecedor'}</h2><p>Documento validado, consulta cadastral e endereço completo integrado ao ThorPDV.</p></div><button className={styles.close} onClick={()=>setModal(false)}>×</button></div><form className={`${styles.form} ${saving?styles.loading:''}`} onSubmit={submit}>
      <section className={styles.section}><div className={styles.sectionTitle}><div><b>Identificação</b><small>Defina pessoa física ou jurídica.</small></div><span className={styles.tag}>{form.type}</span></div><div className={styles.typeSwitch}><button type="button" className={form.type==='PF'?styles.active:''} onClick={()=>{setForm(v=>({...v,type:'PF',trade_name:'',state_registration:'',birth_date:isCustomer?v.birth_date:'' ,document:''}));setDocHint('');lastCnpj.current='';}}>Pessoa Física</button><button type="button" className={form.type==='PJ'?styles.active:''} onClick={()=>{setForm(v=>({...v,type:'PJ',birth_date:'',document:''}));setDocHint('');lastCnpj.current='';}}>Pessoa Jurídica</button></div>
        <div className={styles.grid} style={{marginTop:12}}><label className={styles.field}><span>{form.type==='PF'?'Nome completo':'Razão social'}</span><input value={form.name} onChange={e=>set('name',e.target.value)} required/></label>{form.type==='PJ'&&<label className={styles.field}><span>Nome fantasia</span><input value={form.trade_name} onChange={e=>set('trade_name',e.target.value)}/></label>}
          <label className={styles.field}><span>{form.type==='PF'?'CPF':'CNPJ'}</span><div className={styles.lookupRow}><input value={fmtDocument(form.document)} onChange={e=>{const d=digits(e.target.value).slice(0,form.type==='PF'?11:14);set('document',d);lastCnpj.current='';}} onBlur={()=>form.type==='PJ'?lookupCnpj():setDocHint(cpfValid(form.document)?'CPF válido.':'CPF inválido.')} inputMode="numeric" required/>{form.type==='PJ'&&<button type="button" onClick={()=>lookupCnpj()}>Consultar CNPJ</button>}</div><small className={`${styles.hint} ${docHint.includes('inválido')?styles.error:docHint.includes('válido')?styles.ok:''}`}>{docHint}</small></label>
          {form.type==='PF'&&isCustomer&&<label className={styles.field}><span>Data de nascimento</span><input type="date" value={form.birth_date} onChange={e=>set('birth_date',e.target.value)}/></label>}{form.type==='PJ'&&<label className={styles.field}><span>Inscrição Estadual</span><input value={form.state_registration} onChange={e=>set('state_registration',e.target.value)}/></label>}
        </div></section>
      <section className={styles.section}><div className={styles.sectionTitle}><div><b>Contato</b><small>Dados para comunicação e documentos.</small></div><span className={styles.tag}>CONTATO</span></div><div className={styles.grid}><label className={styles.field}><span>E-mail</span><input type="email" value={form.email} onChange={e=>set('email',e.target.value)}/></label><label className={styles.field}><span>Telefone</span><input value={form.phone} onChange={e=>set('phone',e.target.value)}/></label></div></section>
      <section className={styles.section}><div className={styles.sectionTitle}><div><b>Endereço</b><small>Informe o CEP para completar automaticamente rua, bairro, cidade e UF.</small></div><span className={styles.tag}>CEP</span></div><div className={styles.grid}><label className={styles.field}><span>CEP</span><div className={styles.lookupRow}><input value={fmtCep(form.postal_code)} inputMode="numeric" onChange={e=>{set('postal_code',digits(e.target.value).slice(0,8));lastCep.current='';}} onBlur={()=>lookupCep()}/><button type="button" onClick={()=>lookupCep()}>Buscar CEP</button></div><small className={`${styles.hint} ${cepHint.includes('não')?styles.error:cepHint.includes('localizado')?styles.ok:''}`}>{cepHint}</small></label><label className={styles.field}><span>Rua / Logradouro</span><input value={form.street} onChange={e=>set('street',e.target.value)}/></label></div>
        <div className={styles.grid3}><label className={styles.field}><span>Bairro</span><input value={form.district} onChange={e=>set('district',e.target.value)}/></label><label className={styles.field}><span>Número</span><input value={form.number} onChange={e=>set('number',e.target.value)}/></label><label className={styles.field}><span>Complemento</span><input value={form.complement} onChange={e=>set('complement',e.target.value)}/></label></div>
        <div className={styles.grid} style={{marginTop:12}}><label className={styles.field}><span>Cidade</span><input value={form.city} onChange={e=>set('city',e.target.value)}/></label><label className={styles.field}><span>UF</span><input maxLength={2} value={form.state} onChange={e=>set('state',e.target.value.toUpperCase().slice(0,2))}/></label><label className={styles.field}><span>Código IBGE do município</span><input value={form.ibge_city_code} onChange={e=>set('ibge_city_code',e.target.value)}/></label><label className={styles.field}><span>Status</span><select value={form.active?'true':'false'} onChange={e=>set('active',e.target.value==='true')}><option value="true">Ativo</option><option value="false">Inativo</option></select></label></div></section>
      <div className={styles.statusLine}><span>✓</span><span><strong>Validação dupla:</strong> CPF/CNPJ é conferido na tela e novamente no servidor antes de gravar.</span></div>
      <div className={styles.modalActions}><button type="button" className={styles.secondary} onClick={()=>setModal(false)}>Cancelar</button><button className={styles.primary} disabled={saving}>{saving?'Salvando...':'Salvar cadastro'}</button></div>
    </form></div></div>}
  </div>;
}
