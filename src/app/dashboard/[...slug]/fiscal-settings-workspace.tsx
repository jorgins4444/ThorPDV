'use client';

import { FormEvent, useState } from 'react';
import { FiscalConfigurationWorkspace } from './fiscal-configuration-workspace';
import { erpFiscalCertificateDelete, erpFiscalCertificateUpload } from './fiscal-certificate-actions';

type Row=Record<string,unknown>;
const text=(v:unknown)=>v==null?'':String(v);
const dateOnly=(v:unknown)=>v?new Date(String(v)).toLocaleDateString('pt-BR'):'—';

export function FiscalSettingsWorkspace({settings}:{settings:Row}){
  const [liveSettings,setLiveSettings]=useState<Row>(settings);
  const [certificate,setCertificate]=useState<Row|null>((settings.certificate&&typeof settings.certificate==='object'?settings.certificate:null) as Row|null);
  const [message,setMessage]=useState('');
  const [uploading,setUploading]=useState(false);
  const expired=Boolean(certificate?.expired);

  async function uploadCertificate(e:FormEvent<HTMLFormElement>){
    e.preventDefault();
    const form=e.currentTarget;
    setUploading(true);setMessage('Validando certificado e senha...');
    const r=await erpFiscalCertificateUpload(new FormData(form));
    setUploading(false);
    if(r.ok){
      const cert=(r.certificate??null) as Row|null;
      setCertificate(cert?{...cert,expired:false}:null);
      form.reset();
      setMessage('Certificado A1 validado e armazenado com segurança.');
    }else setMessage(String(r.error??'Não foi possível salvar o certificado.'));
  }

  async function removeCertificate(){
    if(!confirm('Remover o certificado digital desta empresa?'))return;
    const r=await erpFiscalCertificateDelete();
    if(r.ok){setCertificate(null);setMessage('Certificado removido.');}
    else setMessage(String(r.error??'Falha ao remover certificado.'));
  }

  return <div className="fiscal-settings-only">
    <section className="fiscal-settings-intro">
      <div><span>CONFIGURAÇÃO FISCAL</span><h2>Parâmetros fiscais da operação</h2><p>Defina aqui somente os dados necessários para emissão e comunicação fiscal. Os documentos emitidos ficam no módulo Documentos Fiscais.</p></div>
      <a href="/dashboard/documentos-fiscais">Abrir Documentos Fiscais →</a>
    </section>

    {message&&<div className="erp-message fiscal-settings-message">{message}</div>}

    <FiscalConfigurationWorkspace initialSettings={liveSettings} onConfigChange={next=>{
      setLiveSettings(next);
      const cert=(next.certificate&&typeof next.certificate==='object'?next.certificate:null) as Row|null;
      if(cert)setCertificate(cert);
    }}/>

    <section className="erp-module-card erp-advanced-panel fiscal-certificate-card fiscal-settings-certificate">
      <div className="fiscal-section-head"><div><h2>Certificado digital A1</h2><p>Certificado usado para assinatura XML e comunicação mTLS com a SEFAZ.</p></div>{certificate?<span className={`fiscal-cert-status ${expired?'expired':'valid'}`}>{expired?'EXPIRADO':'VÁLIDO'}</span>:<span className="fiscal-cert-status missing">NÃO CONFIGURADO</span>}</div>
      {certificate?<div className="fiscal-cert-summary"><div><small>Arquivo</small><strong>{text(certificate.filename)}</strong></div><div><small>Titular</small><strong>{text(certificate.subject_cn)||'—'}</strong></div><div><small>CNPJ identificado</small><strong>{text(certificate.subject_cnpj)||'—'}</strong></div><div><small>Validade</small><strong>{dateOnly(certificate.valid_from)} até {dateOnly(certificate.valid_to)}</strong></div><div className="fiscal-fingerprint"><small>Fingerprint SHA-256</small><code>{text(certificate.fingerprint_sha256)||'—'}</code></div><button type="button" className="erp-ghost fiscal-remove-cert" onClick={removeCertificate}>Remover certificado</button></div>:null}
      <form className="fiscal-cert-form" onSubmit={uploadCertificate}><label>Arquivo do certificado<input name="certificate" type="file" accept=".pfx,.p12,application/x-pkcs12" required/></label><label>Senha do certificado<input name="password" type="password" autoComplete="new-password" required placeholder="Senha do PFX"/></label><button className="erp-primary" disabled={uploading}>{uploading?'Validando PFX...':certificate?'Substituir certificado':'Validar e salvar certificado'}</button></form>
      <p className="fiscal-security-note">🔒 O certificado permanece protegido no servidor e a chave privada não é exposta ao PDV.</p>
    </section>
  </div>;
}
