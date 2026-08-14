'use client';

import { FormEvent,useState } from 'react';
import { erpFiscalCertificateDelete,erpFiscalCertificateUpload } from './fiscal-certificate-actions';

type Row=Record<string,unknown>;
const text=(v:unknown)=>v==null?'':String(v);
const dateOnly=(v:unknown)=>v?new Date(String(v)).toLocaleDateString('pt-BR'):'—';

export function FiscalCertificateWorkspace({settings}:{settings:Row}){
  const [certificate,setCertificate]=useState<Row|null>((settings.certificate&&typeof settings.certificate==='object'?settings.certificate:null) as Row|null);
  const [message,setMessage]=useState('');
  const [uploading,setUploading]=useState(false);
  const expired=Boolean(certificate?.expired);
  async function upload(e:FormEvent<HTMLFormElement>){e.preventDefault();const form=e.currentTarget;setUploading(true);setMessage('Validando certificado e senha...');const r=await erpFiscalCertificateUpload(new FormData(form));setUploading(false);if(r.ok){const cert=(r.certificate??null) as Row|null;setCertificate(cert?{...cert,expired:false}:null);form.reset();setMessage('Certificado A1 validado e armazenado com segurança.');}else setMessage(String(r.error??'Não foi possível salvar o certificado.'));}
  async function remove(){if(!confirm('Remover o certificado digital desta empresa?'))return;const r=await erpFiscalCertificateDelete();if(r.ok){setCertificate(null);setMessage('Certificado removido.');}else setMessage(String(r.error??'Falha ao remover certificado.'));}
  return <div className="fiscal-certificate-page">
    <section className="fiscal-section-intro"><div><span>CERTIFICADO DIGITAL</span><h2>Certificado A1</h2><p>Gerencie o PFX/P12 utilizado para assinatura dos documentos e comunicação segura com a SEFAZ.</p></div>{certificate?<span className={`fiscal-cert-status ${expired?'expired':'valid'}`}>{expired?'EXPIRADO':'VÁLIDO'}</span>:<span className="fiscal-cert-status missing">NÃO CONFIGURADO</span>}</section>
    {message&&<div className="erp-message">{message}</div>}
    <section className="erp-module-card fiscal-certificate-module">
      {certificate?<div className="fiscal-cert-summary"><div><small>Arquivo</small><strong>{text(certificate.filename)}</strong></div><div><small>Titular</small><strong>{text(certificate.subject_cn)||'—'}</strong></div><div><small>CNPJ identificado</small><strong>{text(certificate.subject_cnpj)||'—'}</strong></div><div><small>Validade</small><strong>{dateOnly(certificate.valid_from)} até {dateOnly(certificate.valid_to)}</strong></div><div className="fiscal-fingerprint"><small>Fingerprint SHA-256</small><code>{text(certificate.fingerprint_sha256)||'—'}</code></div><button type="button" className="erp-ghost fiscal-remove-cert" onClick={remove}>Remover certificado</button></div>:<div className="fiscal-cert-empty"><strong>Nenhum certificado configurado</strong><p>Anexe o certificado A1 da empresa para habilitar assinatura digital e comunicação mTLS com a SEFAZ.</p></div>}
      <form className="fiscal-cert-form fiscal-cert-form-focused" onSubmit={upload}><label>Arquivo do certificado<input name="certificate" type="file" accept=".pfx,.p12,application/x-pkcs12" required/></label><label>Senha do certificado<input name="password" type="password" autoComplete="new-password" required placeholder="Senha do PFX"/></label><button className="erp-primary" disabled={uploading}>{uploading?'Validando PFX...':certificate?'Substituir certificado':'Validar e salvar certificado'}</button></form>
      <div className="fiscal-security-panel"><b>Segurança</b><p>O arquivo fica cifrado no servidor. A senha e a chave privada não são exibidas novamente e não são enviadas ao PDV.</p></div>
    </section>
  </div>;
}
