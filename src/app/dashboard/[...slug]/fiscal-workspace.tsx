'use client';

import { FormEvent, useState } from 'react';
import { erpFiscalPrepare, erpFiscalSettingsSave, erpLoad } from './actions';
import { erpFiscalSend } from './fiscal-transmit-actions';
import { erpFiscalCertificateDelete, erpFiscalCertificateUpload } from './fiscal-certificate-actions';

type Row = Record<string, unknown>;
const money = (v: unknown) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(v ?? 0));
const dt = (v: unknown) => v ? new Date(String(v)).toLocaleString('pt-BR') : '—';
const dateOnly = (v: unknown) => v ? new Date(String(v)).toLocaleDateString('pt-BR') : '—';
const text = (v: unknown) => v == null ? '' : String(v);

export function FiscalWorkspace({ initialDocs, sales, settings, preselect = 'nfe' }: { initialDocs: Row[]; sales: Row[]; settings: Row; preselect?: 'nfe' | 'nfce' }) {
  const [docs, setDocs] = useState(initialDocs);
  const [sale, setSale] = useState('');
  const [docType, setDocType] = useState<'nfe' | 'nfce'>(preselect);
  const [message, setMessage] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const [environment, setEnvironment] = useState(String(settings.environment ?? 'homologation'));
  const [nfeSeries, setNfeSeries] = useState(String(settings.nfe_series ?? '1'));
  const [nfceSeries, setNfceSeries] = useState(String(settings.nfce_series ?? '1'));
  const [cscId, setCscId] = useState(String(settings.csc_id ?? ''));
  const [certificate, setCertificate] = useState<Row | null>((settings.certificate && typeof settings.certificate === 'object' ? settings.certificate : null) as Row | null);
  const [uploading, setUploading] = useState(false);
  const [sending, setSending] = useState<string | null>(null);

  async function refresh() {
    const r = await erpLoad('fiscal_documents');
    if (r.ok) setDocs(r.data);
  }

  async function saveSettings(e: FormEvent) {
    e.preventDefault();
    const r = await erpFiscalSettingsSave({ provider: 'svrs_direct', environment, nfe_series: nfeSeries, nfce_series: nfceSeries, csc_id: cscId });
    setMessage(r.ok ? 'Configuração fiscal salva para transmissão direta ThorFiscal → SVRS.' : String(r.error ?? 'Falha ao salvar configuração'));
  }

  async function uploadCertificate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    setUploading(true);
    setMessage('Validando certificado e senha...');
    const r = await erpFiscalCertificateUpload(new FormData(form));
    setUploading(false);
    if (r.ok) {
      const cert = (r.certificate ?? null) as Row | null;
      setCertificate(cert ? { ...cert, expired: false } : null);
      form.reset();
      setMessage('Certificado A1 validado e armazenado com segurança. O ThorFiscal já pode usá-lo para assinatura e mTLS.');
    } else setMessage(String(r.error ?? 'Não foi possível salvar o certificado.'));
  }

  async function removeCertificate() {
    if (!confirm('Remover o certificado digital desta empresa?')) return;
    const r = await erpFiscalCertificateDelete();
    if (r.ok) {
      setCertificate(null);
      setMessage('Certificado removido.');
    } else setMessage(String(r.error ?? 'Falha ao remover certificado.'));
  }

  async function prepare() {
    if (!sale) return;
    const r = await erpFiscalPrepare(sale, docType);
    if (r.ok) {
      const list = (r.validation_errors as string[] | undefined) ?? [];
      setErrors(list);
      setMessage(list.length ? `Rascunho ${docType.toUpperCase()} criado com ${list.length} pendência(s).` : `Rascunho ${docType.toUpperCase()} validado para o ThorFiscal/SVRS.`);
      setSale('');
      await refresh();
    } else setMessage(`Não foi possível preparar: ${String(r.error ?? 'erro')}`);
  }

  async function send(id: string) {
    setSending(id);
    setErrors([]);
    setMessage('Assinando XML e transmitindo para a SEFAZ...');
    const r = await erpFiscalSend(id);
    setSending(null);
    const list = (r.validation_errors as string[] | undefined) ?? [];
    setErrors(list);
    if (r.ok && (r.authorized || r.already_authorized)) {
      setMessage(`NFC-e autorizada${r.protocol ? ` · protocolo ${String(r.protocol)}` : ''}${r.access_key ? ` · chave ${String(r.access_key)}` : ''}.`);
    } else if (r.status === 'processing' && r.retryable) {
      setMessage('A transmissão ficou sem confirmação conclusiva. O XML e a chave foram preservados; use “Tentar novamente” para consultar/transmitir a mesma NFC-e sem duplicar a numeração.');
    } else {
      const labels: Record<string, string> = {
        certificate_not_configured: 'Anexe o certificado digital A1 antes de transmitir.',
        certificate_expired: 'O certificado digital configurado está expirado.',
        company_fiscal_data_incomplete: 'Complete CNPJ, Inscrição Estadual e regime tributário da empresa.',
        branch_fiscal_address_incomplete: 'Complete o endereço fiscal da filial e o código IBGE do município.',
        local_validation: 'Há dados tributários obrigatórios ausentes nos produtos. Revise NCM, CFOP, CSOSN/CST, PIS e COFINS.',
        sefaz_rejection: `SEFAZ rejeitou a NFC-e${r.cStat ? ` (${String(r.cStat)})` : ''}: ${String(r.message ?? r.detail ?? 'verifique os dados fiscais')}`,
      };
      setMessage(labels[String(r.error)] ?? `Transmissão não realizada: ${String(r.message ?? r.detail ?? r.error ?? 'erro')}`);
    }
    await refresh();
  }

  const expired = Boolean(certificate?.expired);

  return <div className="erp-fiscal-grid">
    <section className="erp-module-card erp-advanced-panel">
      <div className="fiscal-section-head"><div><h2>Ambiente fiscal</h2><p>Emissão direta pelo ThorFiscal nos Web Services da SVRS, sem provedor fiscal intermediário.</p></div><span className="fiscal-direct-badge">THORFISCAL → SVRS</span></div>
      <form className="erp-form-grid" onSubmit={saveSettings}>
        <label>Transmissão<input value="SVRS direta" readOnly /></label>
        <label>Ambiente<select value={environment} onChange={e => setEnvironment(e.target.value)}><option value="homologation">Homologação</option><option value="production">Produção</option></select></label>
        <label>Série NF-e<input value={nfeSeries} onChange={e => setNfeSeries(e.target.value)} /></label>
        <label>Série NFC-e<input value={nfceSeries} onChange={e => setNfceSeries(e.target.value)} /></label>
        <label>ID CSC (legado)<input value={cscId} onChange={e => setCscId(e.target.value)} placeholder="QR Code v3 online não utiliza CSC" /></label>
        <button className="erp-primary">Salvar configuração</button>
      </form>
    </section>

    <section className="erp-module-card erp-advanced-panel fiscal-certificate-card">
      <div className="fiscal-section-head"><div><h2>Certificado digital A1</h2><p>Anexe o arquivo PKCS#12 da empresa. A senha e o conteúdo do PFX não são exibidos novamente.</p></div>{certificate ? <span className={`fiscal-cert-status ${expired ? 'expired' : 'valid'}`}>{expired ? 'EXPIRADO' : 'VÁLIDO'}</span> : <span className="fiscal-cert-status missing">NÃO CONFIGURADO</span>}</div>
      {certificate ? <div className="fiscal-cert-summary"><div><small>Arquivo</small><strong>{text(certificate.filename)}</strong></div><div><small>Titular</small><strong>{text(certificate.subject_cn) || '—'}</strong></div><div><small>CNPJ identificado</small><strong>{text(certificate.subject_cnpj) || '—'}</strong></div><div><small>Validade</small><strong>{dateOnly(certificate.valid_from)} até {dateOnly(certificate.valid_to)}</strong></div><div className="fiscal-fingerprint"><small>Fingerprint SHA-256</small><code>{text(certificate.fingerprint_sha256) || '—'}</code></div><button type="button" className="erp-ghost fiscal-remove-cert" onClick={removeCertificate}>Remover certificado</button></div> : null}
      <form className="fiscal-cert-form" onSubmit={uploadCertificate}><label>Arquivo do certificado<input name="certificate" type="file" accept=".pfx,.p12,application/x-pkcs12" required /></label><label>Senha do certificado<input name="password" type="password" autoComplete="new-password" required placeholder="Senha do PFX" /></label><button className="erp-primary" disabled={uploading}>{uploading ? 'Validando PFX...' : certificate ? 'Substituir certificado' : 'Validar e salvar certificado'}</button></form>
      <p className="fiscal-security-note">🔒 O PFX fica cifrado no cofre. O PDV recebe apenas status/validade; a chave privada é materializada somente dentro do ThorFiscal durante assinatura e conexão mTLS com a SEFAZ.</p>
    </section>

    <section className="erp-module-card erp-advanced-panel">
      <h2>Preparar documento</h2><p>O ThorPDV cria o snapshot fiscal da venda e identifica pendências antes da assinatura e transmissão.</p>
      <label>Venda<select value={sale} onChange={e => setSale(e.target.value)}><option value="">Selecione uma venda...</option>{sales.filter(s => s.status === 'completed').map(s => <option value={String(s.id)} key={String(s.id)}>Venda #{String(s.number)} · {String(s.customer ?? 'Consumidor')} · {money(s.total)}</option>)}</select></label>
      <label>Documento<select value={docType} onChange={e => setDocType(e.target.value as 'nfe' | 'nfce')}><option value="nfe">NF-e</option><option value="nfce">NFC-e</option></select></label>
      <button className="erp-primary" disabled={!sale} onClick={prepare}>Validar e criar rascunho</button>
      {errors.length > 0 && <div className="erp-fiscal-errors"><strong>Pendências</strong>{errors.map((x, i) => <span key={i}>• {x}</span>)}</div>}
    </section>

    {message && <div className="erp-message erp-fiscal-message">{message}</div>}

    <section className="erp-module-card erp-fiscal-docs"><div className="erp-table-scroll"><table className="erp-data-table"><thead><tr><th>Data</th><th>Tipo</th><th>Número</th><th>Série</th><th>Ambiente</th><th>Status</th><th>Chave</th><th>Transmissão</th><th>Ação</th></tr></thead><tbody>{docs.length === 0 ? <tr><td colSpan={9} className="erp-empty">Nenhum documento fiscal preparado.</td></tr> : docs.map((d, i) => {
      const status = String(d.status ?? '');
      const retryable = ['draft', 'rejected', 'processing'].includes(status);
      return <tr key={String(d.id ?? i)}><td>{dt(d.created_at)}</td><td>{String(d.document_type).toUpperCase()}</td><td>{String(d.number ?? '—')}</td><td>{String(d.series ?? '—')}</td><td>{String(d.environment)}</td><td><span className={`erp-pill ${status === 'rejected' ? 'danger' : ''}`}>{status}</span></td><td>{String(d.access_key ?? '—')}</td><td>{d.provider === 'svrs_direct' ? 'SVRS direta' : String(d.provider ?? 'SVRS direta')}</td><td>{retryable ? <button className="erp-row-action" disabled={sending === String(d.id)} onClick={() => send(String(d.id))}>{sending === String(d.id) ? 'Transmitindo...' : status === 'draft' ? 'Transmitir' : 'Tentar novamente'}</button> : '—'}</td></tr>;
    })}</tbody></table></div></section>
  </div>;
}
