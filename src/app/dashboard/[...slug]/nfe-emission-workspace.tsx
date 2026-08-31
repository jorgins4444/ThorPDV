import Link from 'next/link';
import { FiscalDocumentsWorkspace } from './fiscal-documents-workspace';

type Row = Record<string, unknown>;

type Props = {
  settings: Row;
  documents: Row[];
  sales: Row[];
};

const txt = (value: unknown) => value == null ? '' : String(value);
const isObject = (value: unknown): value is Row => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const missingLabels: Record<string, string> = {
  company: 'Cadastro da empresa',
  branch: 'Cadastro da filial',
  cnpj: 'CNPJ do emitente',
  state_registration: 'Inscrição Estadual',
  tax_regime: 'Regime tributário / CRT',
  street: 'Logradouro',
  number: 'Número do endereço',
  district: 'Bairro',
  city: 'Município',
  state: 'UF',
  postal_code: 'CEP',
  ibge_city_code: 'Código IBGE do município',
  certificate: 'Certificado digital A1',
  certificate_expired: 'Certificado digital vencido',
  cnpj_certificate_mismatch: 'CNPJ do certificado diferente do emitente',
};

export function NfeEmissionWorkspace({ settings, documents, sales }: Props) {
  const readiness = isObject(settings.fiscal_readiness) ? settings.fiscal_readiness : {};
  const issuer = isObject(settings.issuer) ? settings.issuer : {};
  const certificate = isObject(settings.certificate) ? settings.certificate : null;
  const series = Array.isArray(settings.series) ? settings.series.filter(isObject) : [];
  const nfeSeries = series.filter((row) => row.document_type === 'nfe' && row.active !== false);
  const missing = Array.isArray(readiness.missing_fields) ? readiness.missing_fields.map(txt).filter(Boolean) : [];
  const baseReady = readiness.ready === true;
  const nfeNumberingReady = nfeSeries.length > 0;
  const operationalReady = baseReady && nfeNumberingReady;
  const environment = txt(settings.environment) === 'production' ? 'Produção' : 'Homologação';
  const certExpired = certificate?.expired === true;

  return <div className="nfe-emission-stack">
    <section className="nfe-emission-hero">
      <div>
        <span className="nfe-emission-eyebrow">THORFISCAL · MODELO 55</span>
        <h2>Emissão de NF-e</h2>
        <p>Prepare a nota a partir de uma venda, valide emitente, destinatário e tributação, reserve série e número e acompanhe o documento fiscal até a autorização.</p>
      </div>
      <div className={`nfe-emission-state ${operationalReady ? 'ready' : 'warning'}`}>
        <b>{operationalReady ? 'Estrutura fiscal pronta' : 'Configuração pendente'}</b>
        <small>{operationalReady ? 'Emitente, certificado e numeração NF-e estão disponíveis.' : 'Conclua os itens indicados antes da transmissão.'}</small>
      </div>
    </section>

    <section className="nfe-readiness-grid" aria-label="Prontidão para emissão de NF-e">
      <article className={baseReady ? 'ok' : 'attention'}>
        <span>Emitente</span>
        <strong>{txt(issuer.cnpj) || 'CNPJ não informado'}</strong>
        <small>{[txt(issuer.city), txt(issuer.state)].filter(Boolean).join(' / ') || 'Endereço fiscal incompleto'}</small>
      </article>
      <article className={certificate && !certExpired ? 'ok' : 'attention'}>
        <span>Certificado A1</span>
        <strong>{certificate && !certExpired ? 'Configurado' : certExpired ? 'Vencido' : 'Pendente'}</strong>
        <small>{certificate ? txt(certificate.subject_cn) || txt(certificate.filename) : 'Necessário para assinatura digital'}</small>
      </article>
      <article className={nfeNumberingReady ? 'ok' : 'attention'}>
        <span>Série NF-e</span>
        <strong>{nfeNumberingReady ? `${nfeSeries.length} série${nfeSeries.length > 1 ? 's' : ''} ativa${nfeSeries.length > 1 ? 's' : ''}` : 'Não configurada'}</strong>
        <small>{nfeNumberingReady ? `Padrão atual: ${txt(settings.nfe_series) || txt(nfeSeries[0]?.series)}` : 'Cadastre uma série do modelo 55'}</small>
      </article>
      <article className="info">
        <span>Ambiente</span>
        <strong>{environment}</strong>
        <small>{environment === 'Produção' ? 'Documentos com validade fiscal' : 'Ambiente seguro para testes'}</small>
      </article>
      <article className="transport">
        <span>Transmissão SEFAZ</span>
        <strong>Modelo 55 em homologação técnica</strong>
        <small>O ThorGestão não reutiliza o transporte NFC-e como se fosse NF-e.</small>
      </article>
    </section>

    {(!operationalReady || missing.length > 0) && <section className="nfe-pending-card">
      <div><span>PRONTIDÃO FISCAL</span><h3>Ajustes antes de emitir</h3></div>
      <div className="nfe-pending-list">
        {missing.map((item) => <span key={item}>{missingLabels[item] || item}</span>)}
        {!nfeNumberingReady && <span>Série e numeração da NF-e</span>}
      </div>
      <div className="nfe-quick-links">
        <Link href="/dashboard/administrativo/empresas">Revisar emitente</Link>
        <Link href="/dashboard/fiscal/certificado">Certificado A1</Link>
        <Link href="/dashboard/fiscal/series">Séries e numeração</Link>
      </div>
    </section>}

    <section className="nfe-flow-card">
      <div className="nfe-flow-head"><div><span>FLUXO OPERACIONAL</span><h3>Da venda até a NF-e</h3></div><Link href="/dashboard/fiscal">Central Fiscal</Link></div>
      <div className="nfe-flow-grid">
        <div><b>1</b><strong>Selecionar venda</strong><small>Use uma venda existente como origem do documento.</small></div>
        <div><b>2</b><strong>Validar destinatário</strong><small>Cliente, CPF/CNPJ e endereço entram na validação fiscal.</small></div>
        <div><b>3</b><strong>Conferir tributação</strong><small>NCM, CFOP, ICMS, PIS, COFINS e campos IBS/CBS do cadastro.</small></div>
        <div><b>4</b><strong>Gerar NF-e 55</strong><small>Reserva de série e número feita pelo servidor, sem duplicidade.</small></div>
        <div><b>5</b><strong>Transmitir e acompanhar</strong><small>XML assinado, protocolo, rejeições, DANFE e histórico fiscal.</small></div>
      </div>
    </section>

    <FiscalDocumentsWorkspace initialDocs={documents} sales={sales} settings={settings} initialType="nfe" />
  </div>;
}
