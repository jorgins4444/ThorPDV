'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { fiscalPrepareV2 } from './fiscal-config-actions';
import { FiscalConfigurationWorkspace } from './fiscal-configuration-workspace';
import { erpFiscalCancel, erpFiscalDocuments, erpFiscalSend, erpFiscalXml } from './fiscal-transmit-actions';
import { erpFiscalCertificateDelete, erpFiscalCertificateUpload } from './fiscal-certificate-actions';

type Row = Record<string, unknown>;
const money = (v: unknown) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(v ?? 0));
const dt = (v: unknown) => v ? new Date(String(v)).toLocaleString('pt-BR') : '—';
const dateOnly = (v: unknown) => v ? new Date(String(v)).toLocaleDateString('pt-BR') : '—';
const text = (v: unknown) => v == null ? '' : String(v);
const remainingLabel = (milliseconds: number) => {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
};

export function FiscalWorkspace({ initialDocs, sales, settings, preselect = 'nfe' }: { initialDocs: Row[]; sales: Row[]; settings: Row; preselect?: 'nfe' | 'nfce' }) {
  const [docs, setDocs] = useState(initialDocs);
  const [sale, setSale] = useState('');
  const [docType, setDocType] = useState<'nfe' | 'nfce'>(preselect);
  const [seriesId, setSeriesId] = useState('');
  const [liveSettings,setLiveSettings]=useState<Row>(settings);
  const [message, setMessage] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const [certificate, setCertificate] = useState<Row | null>((settings.certificate && typeof settings.certificate === 'object' ? settings.certificate : null) as Row | null);
  const [uploading, setUploading] = useState(false);
  const [sending, setSending] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [cancelFlow,setCancelFlow]=useState<{id:string;number:string;phase:'validating'|'building'|'signing'|'sending'|'done'|'error';startedAt:number;error?:string;errorStage?:number;protocol?:string;cStat?:string}|null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const availableSeries=useMemo(()=>((Array.isArray(liveSettings.series)?liveSettings.series:[]) as Row[]).filter(s=>s.document_type===docType&&s.active!==false),[liveSettings,docType]);

  async function refresh() {
    const r = await erpFiscalDocuments();
    if (r.ok) setDocs(r.data);
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
    const r = await fiscalPrepareV2(sale, docType, seriesId||undefined);
    if (r.ok) {
      const list = (r.validation_errors as string[] | undefined) ?? [];
      setErrors(list);
      setMessage(list.length ? `Rascunho ${docType.toUpperCase()} criado na série ${String(r.series)} / número ${String(r.number)} com ${list.length} pendência(s).` : `Rascunho ${docType.toUpperCase()} nº ${String(r.number)} · série ${String(r.series)} reservado e validado.`);
      setSale('');setSeriesId('');
      await refresh();
    } else {
      const labels:Record<string,string>={fiscal_series_not_found:'A série selecionada não está disponível para esta filial.',fiscal_series_not_configured:'Cadastre uma série fiscal ativa antes de preparar o documento.',nfce_series_not_assigned_to_cash_register:'O caixa da venda não possui uma série NFC-e vinculada. Configure-a na seção Caixas.'};
      setMessage(`Não foi possível preparar: ${labels[String(r.error)]??String(r.error??'erro')}`);
    }
  }

  async function send(id: string) {
    const row=docs.find(d=>String(d.id)===id);
    if(row?.document_type==='nfe'){
      setMessage('A configuração e a numeração da NF-e estão disponíveis, mas a transmissão modelo 55 ainda não está habilitada no transporte ThorFiscal atual.');
      return;
    }
    setSending(id);
    setErrors([]);
    setMessage('Assinando XML e transmitindo a NFC-e para a SEFAZ...');
    const r = await erpFiscalSend(id);
    setSending(null);
    const list = (r.validation_errors as string[] | undefined) ?? [];
    setErrors(list);
    if (r.ok && (r.authorized || r.already_authorized)) {
      setMessage(`NFC-e autorizada${r.protocol ? ` · protocolo ${String(r.protocol)}` : ''}${r.access_key ? ` · chave ${String(r.access_key)}` : ''}.`);
    } else if (['processing', 'transmission_error'].includes(String(r.status)) && r.retryable) {
      setMessage(r.status === 'transmission_error'
        ? `Falha de comunicação com a SEFAZ${r.error_code ? ` (${String(r.error_code)})` : ''}. O XML assinado e a chave foram preservados; use “Tentar novamente” sem gerar outra numeração.`
        : 'A transmissão ficou sem confirmação conclusiva. O XML e a chave foram preservados; use “Tentar novamente” sem duplicar a numeração.');
    } else {
      const labels: Record<string, string> = {
        certificate_not_configured: 'Anexe o certificado digital A1 antes de transmitir.',certificate_expired: 'O certificado digital configurado está expirado.',company_fiscal_data_incomplete: 'Complete CNPJ, Inscrição Estadual e regime tributário da empresa.',branch_fiscal_address_incomplete: 'Complete o endereço fiscal da filial e o código IBGE do município.',local_validation: 'Há dados tributários obrigatórios ausentes nos produtos. Revise NCM, CFOP, CSOSN/CST, PIS e COFINS.',sefaz_rejection: `SEFAZ rejeitou a NFC-e${r.cStat ? ` (${String(r.cStat)})` : ''}: ${String(r.message ?? r.detail ?? 'verifique os dados fiscais')}`,
      };
      setMessage(labels[String(r.error)] ?? `Transmissão não realizada: ${String(r.message ?? r.detail ?? r.error ?? 'erro')}`);
    }
    await refresh();
  }

  async function cancelNfce(id: string, number: unknown) {
    const reason = window.prompt(`Justificativa para cancelar a NFC-e ${text(number)} (15 a 255 caracteres):`, '');
    if (!reason) return;
    const clean = reason.trim().replace(/\s+/g, ' ');
    if (clean.length < 15 || clean.length > 255) {
      setMessage('A justificativa deve ter entre 15 e 255 caracteres.');
      return;
    }
    if (!window.confirm(`Confirmar o envio do evento de cancelamento da NFC-e ${text(number)} para a SEFAZ?`)) return;
    setCancelling(id);
    setMessage('');
    const startedAt=Date.now();
    setCancelFlow({id,number:text(number),phase:'validating',startedAt});
    const timers=[
      window.setTimeout(()=>setCancelFlow(current=>current?.id===id&&current.phase!=='done'&&current.phase!=='error'?{...current,phase:'building'}:current),260),
      window.setTimeout(()=>setCancelFlow(current=>current?.id===id&&current.phase!=='done'&&current.phase!=='error'?{...current,phase:'signing'}:current),680),
      window.setTimeout(()=>setCancelFlow(current=>current?.id===id&&current.phase!=='done'&&current.phase!=='error'?{...current,phase:'sending'}:current),1120),
    ];
    const r = await erpFiscalCancel(id, clean);
    timers.forEach(t=>window.clearTimeout(t));
    setCancelling(null);
    if (r.ok && (r.cancelled || r.idempotent)) {
      setCancelFlow({id,number:text(number),phase:'done',startedAt,protocol:text(r.cancellation_protocol),cStat:text(r.cStat)});
      setMessage(`NFC-e cancelada na SEFAZ${r.cancellation_protocol ? ` · protocolo ${String(r.cancellation_protocol)}` : ''}${r.cStat ? ` · cStat ${String(r.cStat)}` : ''}.`);
    } else {
      const labels: Record<string, string> = {
        nfce_cancellation_window_expired: 'O prazo fiscal de 30 minutos para cancelamento desta NFC-e já encerrou.',
        nfce_cancellation_reason_invalid: 'A justificativa deve ter entre 15 e 255 caracteres.',
        nfce_cancellation_rejected: `A SEFAZ rejeitou o cancelamento${r.cStat ? ` (${String(r.cStat)})` : ''}: ${String(r.message ?? r.detail ?? 'verifique o retorno fiscal')}`,
        nfce_cancellation_transmission_error: `Falha de comunicação durante o cancelamento: ${String(r.message ?? r.detail ?? 'tente novamente enquanto estiver no prazo')}`,
      };
      const errorMessage=labels[String(r.error)] ?? `Cancelamento não realizado: ${String(r.message ?? r.detail ?? r.error ?? 'erro')}`;
      const errorStage=String(r.error)==='nfce_cancellation_window_expired'?0:String(r.error)==='nfce_cancellation_reason_invalid'?1:String(r.error)==='nfce_cancellation_rejected'?4:3;
      setCancelFlow({id,number:text(number),phase:'error',startedAt,error:errorMessage,errorStage,cStat:text(r.cStat)});
      setMessage(errorMessage);
    }
    await refresh();
  }

  async function downloadXml(id: string, number: unknown) {
    setDownloading(id);
    const r = await erpFiscalXml(id);
    setDownloading(null);
    if (!r.ok || !text(r.xml)) {
      setMessage(text(r.error === 'xml_not_available' ? 'XML autorizado ainda não está disponível.' : r.error ?? 'Não foi possível obter o XML.'));
      return;
    }
    const blob = new Blob([text(r.xml)], { type: 'application/xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = text(r.filename) || `NFCe-${text(number) || id}.xml`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  function openDanfe(id: string) {
    const win = window.open(`/api/pdv/fiscal/${encodeURIComponent(id)}/danfe`, '_blank', 'noopener,noreferrer');
    if (!win) setMessage('O navegador bloqueou a abertura do DANFE. Libere pop-ups para o Thor Gestão.');
  }

  const expired = Boolean(certificate?.expired);

  return <div className="erp-fiscal-grid">
    <FiscalConfigurationWorkspace initialSettings={settings} onConfigChange={next=>{setLiveSettings(next);const cert=(next.certificate&&typeof next.certificate==='object'?next.certificate:null) as Row|null;if(cert)setCertificate(cert);}}/>

    <section className="erp-module-card erp-advanced-panel fiscal-certificate-card">
      <div className="fiscal-section-head"><div><h2>Certificado digital A1</h2><p>Anexe o arquivo PKCS#12 da empresa. A senha e o conteúdo do PFX não são exibidos novamente.</p></div>{certificate ? <span className={`fiscal-cert-status ${expired ? 'expired' : 'valid'}`}>{expired ? 'EXPIRADO' : 'VÁLIDO'}</span> : <span className="fiscal-cert-status missing">NÃO CONFIGURADO</span>}</div>
      {certificate ? <div className="fiscal-cert-summary"><div><small>Arquivo</small><strong>{text(certificate.filename)}</strong></div><div><small>Titular</small><strong>{text(certificate.subject_cn) || '—'}</strong></div><div><small>CNPJ identificado</small><strong>{text(certificate.subject_cnpj) || '—'}</strong></div><div><small>Validade</small><strong>{dateOnly(certificate.valid_from)} até {dateOnly(certificate.valid_to)}</strong></div><div className="fiscal-fingerprint"><small>Fingerprint SHA-256</small><code>{text(certificate.fingerprint_sha256) || '—'}</code></div><button type="button" className="erp-ghost fiscal-remove-cert" onClick={removeCertificate}>Remover certificado</button></div> : null}
      <form className="fiscal-cert-form" onSubmit={uploadCertificate}><label>Arquivo do certificado<input name="certificate" type="file" accept=".pfx,.p12,application/x-pkcs12" required /></label><label>Senha do certificado<input name="password" type="password" autoComplete="new-password" required placeholder="Senha do PFX" /></label><button className="erp-primary" disabled={uploading}>{uploading ? 'Validando PFX...' : certificate ? 'Substituir certificado' : 'Validar e salvar certificado'}</button></form>
      <p className="fiscal-security-note">🔒 O PFX fica cifrado no cofre. O PDV recebe apenas status/validade; a chave privada é materializada somente dentro do ThorFiscal durante assinatura e conexão mTLS com a SEFAZ.</p>
    </section>

    <section className="erp-module-card erp-advanced-panel">
      <h2>Preparar documento fiscal</h2><p>Escolha a venda e, se necessário, uma série específica. Em “Automática”, NFC-e usa a série vinculada ao caixa e NF-e usa a série padrão da filial.</p>
      <label>Venda<select value={sale} onChange={e => setSale(e.target.value)}><option value="">Selecione uma venda...</option>{sales.filter(s => s.status === 'completed').map(s => <option value={String(s.id)} key={String(s.id)}>Venda #{String(s.number)} · {String(s.customer ?? 'Consumidor')} · {money(s.total)}</option>)}</select></label>
      <label>Documento<select value={docType} onChange={e => {setDocType(e.target.value as 'nfe' | 'nfce');setSeriesId('')}}><option value="nfe">NF-e</option><option value="nfce">NFC-e</option></select></label>
      <label>Série fiscal<select value={seriesId} onChange={e=>setSeriesId(e.target.value)}><option value="">Automática (caixa / série padrão)</option>{availableSeries.map(s=><option key={String(s.id)} value={String(s.id)}>Série {String(s.series).padStart(3,'0')} · última {String(s.last_number)} · próxima {String(s.next_number)}{s.is_default?' · padrão':''}</option>)}</select></label>
      <button className="erp-primary" disabled={!sale} onClick={prepare}>Validar e criar rascunho</button>
      {docType==='nfe'&&<p className="fiscal-security-note">A numeração e os parâmetros de DANFE da NF-e já ficam controlados no Gestão. A transmissão eletrônica modelo 55 ainda não está habilitada no transporte ThorFiscal atual; esta tela não marcará NF-e como autorizada sem esse suporte.</p>}
      {errors.length > 0 && <div className="erp-fiscal-errors"><strong>Pendências</strong>{errors.map((x, i) => <span key={i}>• {x}</span>)}</div>}
    </section>

    {cancelFlow && (()=>{
      const steps=['Validando prazo','Preparando evento','Assinando A1','Enviando à SEFAZ','Evento registrado'];
      const phaseIndex=cancelFlow.phase==='validating'?0:cancelFlow.phase==='building'?1:cancelFlow.phase==='signing'?2:cancelFlow.phase==='sending'?3:cancelFlow.phase==='done'?5:(cancelFlow.errorStage??3);
      const percent=cancelFlow.phase==='done'?100:cancelFlow.phase==='error'?Math.max(16,Math.min(88,(phaseIndex+1)*18)):[12,30,50,72,90][phaseIndex]??12;
      const title=cancelFlow.phase==='validating'?'Validando cancelamento da NFC-e':cancelFlow.phase==='building'?'Preparando evento 110111':cancelFlow.phase==='signing'?'Assinando evento com certificado A1':cancelFlow.phase==='sending'?'Enviando cancelamento para a SEFAZ':cancelFlow.phase==='done'?'Cancelamento registrado na SEFAZ':'Cancelamento interrompido';
      const subtitle=cancelFlow.phase==='validating'?'Conferindo prazo fiscal e dados da nota.':cancelFlow.phase==='building'?'Montando chave, protocolo e justificativa do evento.':cancelFlow.phase==='signing'?'Aplicando assinatura digital antes da transmissão.':cancelFlow.phase==='sending'?'Aguardando o retorno do autorizador.':cancelFlow.phase==='done'?'O evento foi registrado e vinculado à NFC-e.':cancelFlow.error||'Não foi possível concluir o cancelamento.';
      return <section className={`erp-module-card fiscal-cancel-flow ${cancelFlow.phase==='done'?'success':''} ${cancelFlow.phase==='error'?'error':''}`}>
        <div className="fiscal-cancel-flow-head"><div className={`fiscal-cancel-spinner ${cancelFlow.phase==='done'?'done':''} ${cancelFlow.phase==='error'?'failed':''}`}>{cancelFlow.phase==='done'?'✓':cancelFlow.phase==='error'?'!':''}</div><div><small>THORFISCAL / CANCELAMENTO</small><h3>{title}</h3><p>{subtitle}</p></div><span>{Math.max(0,(now-cancelFlow.startedAt)/1000).toFixed(1)}s</span></div>
        <div className="fiscal-cancel-flight"><i style={{width:`${percent}%`}}/><b style={{left:`${Math.max(percent-2,0)}%`}}/></div>
        <div className="fiscal-cancel-steps">{steps.map((label,index)=>{const done=cancelFlow.phase==='done'||index<phaseIndex;const active=cancelFlow.phase!=='done'&&cancelFlow.phase!=='error'&&index===phaseIndex;const failed=cancelFlow.phase==='error'&&index===phaseIndex;return <div key={label} className={`${done?'done':''} ${active?'active':''} ${failed?'failed':''}`}><i>{done?'✓':failed?'!':''}</i><span>{label}</span></div>})}</div>
        <div className="fiscal-cancel-meta"><span>NFC-e <b>{cancelFlow.number||'—'}</b></span>{cancelFlow.protocol&&<span>Protocolo <b>{cancelFlow.protocol}</b></span>}{cancelFlow.cStat&&<span>cStat <b>{cancelFlow.cStat}</b></span>}</div>
        {cancelFlow.phase==='error'&&<div className="fiscal-cancel-error"><b>Cancelamento não concluído</b><span>{cancelFlow.error}</span></div>}
        {(cancelFlow.phase==='done'||cancelFlow.phase==='error')&&<div className="fiscal-cancel-actions"><button type="button" className="erp-ghost" onClick={()=>setCancelFlow(null)}>Fechar</button></div>}
      </section>;
    })()}

    {message && <div className="erp-message erp-fiscal-message">{message}</div>}

    <section className="erp-module-card erp-fiscal-docs"><div className="erp-table-scroll"><table className="erp-data-table"><thead><tr><th>Data</th><th>Tipo</th><th>Número</th><th>Série</th><th>Ambiente</th><th>Status</th><th>Chave</th><th>Arquivos</th><th>Ação fiscal</th></tr></thead><tbody>{docs.length === 0 ? <tr><td colSpan={9} className="erp-empty">Nenhum documento fiscal preparado.</td></tr> : docs.map((d, i) => {
      const status = String(d.status ?? '');
      const isNfce=String(d.document_type)==='nfce';
      const retryable = isNfce&&['draft', 'rejected', 'processing', 'transmission_error'].includes(status);
      const assetReady = isNfce && ['authorized','cancelled'].includes(status);
      const deadlineMs = d.cancel_deadline ? new Date(String(d.cancel_deadline)).getTime() : 0;
      const remaining = deadlineMs ? deadlineMs - now : 0;
      const canCancel = isNfce && status === 'authorized' && remaining > 0;
      return <tr key={String(d.id ?? i)}><td>{dt(d.created_at)}</td><td>{String(d.document_type).toUpperCase()}</td><td>{String(d.number ?? '—')}</td><td>{String(d.series ?? '—')}</td><td>{String(d.environment)}</td><td><span className={`erp-pill ${['rejected', 'transmission_error'].includes(status) ? 'danger' : ''}`}>{status}</span></td><td>{String(d.access_key ?? '—')}</td><td>{assetReady ? <div className="fiscal-action-stack"><button type="button" className="erp-row-action" onClick={()=>openDanfe(String(d.id))}>DANFE</button><button type="button" className="erp-row-action" disabled={downloading===String(d.id)} onClick={()=>void downloadXml(String(d.id),d.number)}>{downloading===String(d.id)?'Baixando...':'XML'}</button></div> : '—'}</td><td>{retryable ? <button className="erp-row-action" disabled={sending === String(d.id)} onClick={() => send(String(d.id))}>{sending === String(d.id) ? 'Transmitindo...' : status === 'draft' ? 'Transmitir' : 'Tentar novamente'}</button> : canCancel ? <button className="erp-row-action fiscal-cancel-action" disabled={cancelling===String(d.id)} onClick={()=>void cancelNfce(String(d.id),d.number)}>{cancelling===String(d.id)?'Cancelando...':`Cancelar NFC-e · ${remainingLabel(remaining)}`}</button> : isNfce && status==='authorized' ? <span className="fiscal-window-ended">Prazo encerrado</span> : status==='cancelled' ? <span className="fiscal-cancelled-label">Cancelada{d.cancellation_protocol?` · ${String(d.cancellation_protocol)}`:''}</span> : isNfce?'—':'Configuração / numeração'}</td></tr>;
    })}</tbody></table></div></section>
  </div>;
}
