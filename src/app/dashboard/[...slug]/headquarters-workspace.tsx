'use client';

import Link from 'next/link';
import { FormEvent, useState } from 'react';
import { headquartersGet, headquartersSave } from './headquarters-actions';

type Row=Record<string,unknown>;
const text=(v:unknown)=>v==null?'':String(v);
const obj=(v:unknown):Row=>v&&typeof v==='object'&&!Array.isArray(v)?v as Row:{};
const list=(v:unknown):unknown[]=>Array.isArray(v)?v:[];
const digits=(v:unknown)=>text(v).replace(/\D/g,'');
const crtLabel=(v:unknown)=>({1:'Simples Nacional',2:'Simples Nacional — excesso de sublimite',3:'Regime Normal',4:'MEI'} as Record<string,string>)[text(v)]||'Não definido';

export function HeadquartersWorkspace({initial}:{initial:Row}){
  const [data,setData]=useState(initial);
  const [message,setMessage]=useState('');
  const [saving,setSaving]=useState(false);
  const matrix=obj(data.matrix);
  const fiscal=obj(data.fiscal);
  const readiness=obj(fiscal.readiness);
  const missing=list(readiness.missing_fields).map(String);
  const series=list(fiscal.series).filter(x=>x&&typeof x==='object') as Row[];
  const nfceSeries=series.filter(s=>text(s.document_type)==='nfce'&&s.active!==false);
  const ready=readiness.ready===true;
  const addressReady=Boolean(text(matrix.street)&&text(matrix.number)&&text(matrix.district)&&text(matrix.city)&&/^[A-Za-z]{2}$/.test(text(matrix.state))&&digits(matrix.postal_code).length===8&&digits(matrix.ibge_city_code).length===7);

  async function refresh(success?:string){
    const r=await headquartersGet();
    if(r.ok){setData(r);if(success)setMessage(success);}
    else setMessage(`Não foi possível atualizar a Matriz: ${text(r.error)}`);
  }

  async function save(e:FormEvent<HTMLFormElement>){
    e.preventDefault();
    setSaving(true);
    setMessage('Salvando cadastro mestre da Matriz...');
    const fd=new FormData(e.currentTarget);const payload:Row={};
    for(const [k,v] of fd.entries())payload[k]=v;
    const r=await headquartersSave(payload);
    setSaving(false);
    if(r.ok)await refresh('Matriz salva. O ThorFiscal e o ThorPDV passam a usar estes dados como fonte do emitente.');
    else setMessage(`Não foi possível salvar: ${text(r.error)}`);
  }

  return <div className="matrix-stack">
    <section className="erp-module-card matrix-hero">
      <div><span>CADASTRO MESTRE</span><h2>{text(matrix.trade_name)||text(matrix.legal_name)||'Matriz'}</h2><p>Fonte única dos dados jurídicos, cadastrais e fiscais do estabelecimento principal. NFC-e, DANFE e PDV usam estas informações.</p></div>
      <div className={`matrix-readiness ${ready?'ready':'warning'}`}><strong>{ready?'Emitente fiscal pronto':'Cadastro fiscal incompleto'}</strong><span>{ready?'Dados da Matriz aptos para emissão.':`${missing.length} pendência(s) fiscal(is).`}</span></div>
    </section>

    {message&&<div className="erp-message matrix-message">{message}</div>}

    <form className="matrix-form" onSubmit={save}>
      <section className="erp-module-card matrix-card">
        <div className="matrix-section-head"><div><span>IDENTIFICAÇÃO</span><h3>Empresa / Matriz</h3><p>Identidade jurídica e comercial utilizada em todo o Thor Gestão.</p></div></div>
        <div className="matrix-grid cols3">
          <label className="span2">Razão Social<input name="legal_name" required defaultValue={text(matrix.legal_name)}/></label>
          <label>Nome Fantasia<input name="trade_name" defaultValue={text(matrix.trade_name)}/></label>
          <label>CNPJ<input name="cnpj" defaultValue={text(matrix.cnpj)} placeholder="00.000.000/0000-00"/></label>
          <label>Inscrição Estadual<input name="state_registration" defaultValue={text(matrix.state_registration)}/></label>
          <label>Inscrição Municipal<input name="municipal_registration" defaultValue={text(matrix.municipal_registration)}/></label>
          <label>Regime Tributário / CRT<select name="tax_regime" defaultValue={text(matrix.tax_regime)}><option value="">Selecione...</option><option value="1">1 - Simples Nacional</option><option value="2">2 - Simples excesso sublimite</option><option value="3">3 - Regime Normal</option><option value="4">4 - MEI</option></select></label>
          <label>Status<select name="status" defaultValue={text(matrix.status)||'active'}><option value="active">Ativa</option><option value="inactive">Inativa</option></select></label>
          <label>E-mail<input name="email" type="email" defaultValue={text(matrix.email)}/></label>
          <label>Telefone<input name="phone" defaultValue={text(matrix.phone)}/></label>
        </div>
      </section>

      <section className="erp-module-card matrix-card">
        <div className="matrix-section-head"><div><span>ENDEREÇO FISCAL</span><h3>Local do estabelecimento</h3><p>Este endereço é utilizado diretamente na identificação do emitente da NFC-e.</p></div><span className={`matrix-mini-status ${addressReady?'ok':'warn'}`}>{addressReady?'Completo':'Revisar'}</span></div>
        <div className="matrix-grid cols3">
          <label>CEP<input name="postal_code" defaultValue={text(matrix.postal_code)}/></label>
          <label className="span2">Logradouro<input name="street" defaultValue={text(matrix.street)}/></label>
          <label>Número<input name="number" defaultValue={text(matrix.number)}/></label>
          <label>Complemento<input name="complement" defaultValue={text(matrix.complement)}/></label>
          <label>Bairro<input name="district" defaultValue={text(matrix.district)}/></label>
          <label>Cidade<input name="city" defaultValue={text(matrix.city)}/></label>
          <label>UF<input name="state" maxLength={2} defaultValue={text(matrix.state)}/></label>
          <label>Código IBGE<input name="ibge_city_code" defaultValue={text(matrix.ibge_city_code)}/></label>
        </div>
      </section>

      <section className="erp-module-card matrix-card">
        <div className="matrix-section-head"><div><span>CONTATO E OPERAÇÃO</span><h3>Informações complementares</h3><p>Dados administrativos ligados à Matriz.</p></div></div>
        <div className="matrix-grid cols3">
          <label>Contato<input name="contact" defaultValue={text(matrix.contact)}/></label>
          <label>Responsável<input name="responsible" defaultValue={text(matrix.responsible)}/></label>
          <label>Celular<input name="mobile" defaultValue={text(matrix.mobile)}/></label>
          <label>Tipo de negócio<input name="business_type" defaultValue={text(matrix.business_type)} placeholder="Ex.: Varejo"/></label>
          <label className="span2">Detalhes do negócio<input name="business_detail" defaultValue={text(matrix.business_detail)} placeholder="Ex.: Mercado / minimercado"/></label>
          <label className="span3">Observações<textarea name="observations" rows={4} defaultValue={text(matrix.observations)}/></label>
        </div>
      </section>

      <section className="erp-module-card matrix-card matrix-fiscal-card">
        <div className="matrix-section-head"><div><span>THORFISCAL</span><h3>Integração com NFC-e</h3><p>Os dados do emitente vêm desta Matriz. Configurações de transmissão continuam no módulo Fiscal.</p></div><Link className="erp-primary" href="/dashboard/fiscal">Abrir Fiscal</Link></div>
        <div className="matrix-fiscal-grid">
          <article><small>CNPJ do emitente</small><strong>{text(matrix.cnpj)||'Não informado'}</strong></article>
          <article><small>IE</small><strong>{text(matrix.state_registration)||'Não informada'}</strong></article>
          <article><small>CRT</small><strong>{crtLabel(matrix.tax_regime)}</strong></article>
          <article><small>Ambiente</small><strong>{text(fiscal.environment)==='production'?'Produção':'Homologação'}</strong></article>
          <article><small>Certificado A1</small><strong>{fiscal.certificate_configured?(fiscal.certificate_expired?'Expirado':'Configurado'):'Não configurado'}</strong></article>
          <article><small>Séries NFC-e</small><strong>{nfceSeries.length}</strong></article>
        </div>
        {!ready&&<div className="matrix-pending"><b>Pendências para emissão:</b><span>{missing.join(', ')||'Verifique a configuração fiscal.'}</span></div>}
      </section>

      <div className="matrix-savebar"><div><strong>Fonte única de dados</strong><span>Salvar aqui sincroniza o cadastro jurídico e o registro interno usado pelo PDV/ThorFiscal.</span></div><button className="erp-primary" disabled={saving}>{saving?'Salvando Matriz...':'Salvar Matriz'}</button></div>
    </form>
  </div>;
}
