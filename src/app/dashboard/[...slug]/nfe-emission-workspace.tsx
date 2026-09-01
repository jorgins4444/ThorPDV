'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { FiscalDocumentsWorkspace } from './fiscal-documents-workspace';
import { fiscalCfopRulesGet, nfeManualDraftCreate, nfeSaleDraftCreate } from './fiscal-config-actions';
import {
  cfopPrefixForScope,
  deriveNatureOperation,
  destinationScope,
  operationLabel,
  operationScopeLabel,
  resolveCfopClient,
  type NfeOperationType,
} from './nfe-cfop-engine';
import { erpFiscalDocuments } from './fiscal-transmit-actions';

type Row = Record<string, unknown>;
type TopTab = 'new' | 'documents' | 'config';
type Mode = 'sale' | 'manual';
type ManualStep = 'data' | 'recipient' | 'products' | 'transport' | 'references' | 'payments' | 'review';
type TaxTab = 'icms' | 'ipi' | 'icms_st' | 'pis_cofins' | 'reform' | 'import' | 'simples' | 'additional';
type ReferenceType = 'nfe' | 'coupon' | 'model01' | 'rural';

type ManualItem = {
  key: string;
  product_id: string;
  code: string;
  description: string;
  product_type: string;
  unit: string;
  quantity: string;
  unit_price: string;
  discount: string;
  ncm: string;
  cest: string;
  cfop: string;
  cfop_default: string;
  cfop_manual: boolean;
  cfop_reason: string;
  origin: string;
  icms_code: string;
  ipi_cst: string;
  pis_cst: string;
  cofins_cst: string;
  reform_cst: string;
  reform_classification: string;
  note: string;
};

type FiscalReference = {
  key: string;
  type: ReferenceType;
  value: string;
  operation_type: string;
  issue_date: string;
};

type Props = {
  settings: Row;
  documents: Row[];
  sales: Row[];
  customers: Row[];
  products: Row[];
};

const txt = (value: unknown) => value == null ? '' : String(value);
const num = (value: unknown) => Number(value || 0);
const digits = (value: unknown) => txt(value).replace(/\D/g, '');
const money = (value: unknown) => num(value).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const isObject = (value: unknown): value is Row => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const obj = (value: unknown): Row => isObject(value) ? value : {};
const newKey = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const formatCep = (value: unknown) => {
  const clean = digits(value).slice(0, 8);
  return clean.length > 5 ? `${clean.slice(0, 5)}-${clean.slice(5)}` : clean;
};

const missingLabels: Record<string, string> = {
  company: 'Cadastro da empresa', branch: 'Cadastro da filial', cnpj: 'CNPJ do emitente',
  state_registration: 'Inscrição Estadual', tax_regime: 'Regime tributário / CRT', street: 'Logradouro',
  number: 'Número do endereço', district: 'Bairro', city: 'Município', state: 'UF', postal_code: 'CEP',
  ibge_city_code: 'Código IBGE do município', certificate: 'Certificado digital A1',
  certificate_expired: 'Certificado digital vencido', cnpj_certificate_mismatch: 'CNPJ do certificado diferente do emitente',
};

const stepLabels: { key: ManualStep; label: string; icon: string }[] = [
  { key: 'data', label: 'Dados gerais', icon: '▤' },
  { key: 'recipient', label: 'Destinatário', icon: '♙' },
  { key: 'products', label: 'Produtos', icon: '◇' },
  { key: 'transport', label: 'Transporte', icon: '▱' },
  { key: 'references', label: 'Referências', icon: '↗' },
  { key: 'payments', label: 'Pagamentos', icon: '▭' },
  { key: 'review', label: 'Revisão', icon: '✓' },
];

const taxTabs: { key: TaxTab; label: string }[] = [
  { key: 'icms', label: 'ICMS' }, { key: 'ipi', label: 'IPI' }, { key: 'icms_st', label: 'ICMS ST' },
  { key: 'pis_cofins', label: 'PIS/COFINS' }, { key: 'reform', label: 'Reforma tributária' },
  { key: 'import', label: 'Importação' }, { key: 'simples', label: 'Simples nacional' }, { key: 'additional', label: 'Informações adicionais' },
];

const productTypeLabels: Record<string, string> = {
  resale: 'Mercadoria para revenda', finished_product: 'Produto acabado / produção própria', raw_material: 'Matéria-prima',
  intermediate_product: 'Produto intermediário', packaging: 'Embalagem', use_consumption: 'Uso e consumo', fixed_asset: 'Ativo imobilizado', service: 'Serviço', other: 'Outros',
};

function productToItem(product: Row): ManualItem {
  const fiscal = obj(product.fiscal_profile);
  const icms = obj(fiscal.icms);
  const pis = obj(fiscal.pis);
  const cofins = obj(fiscal.cofins);
  const ipi = obj(fiscal.ipi);
  return {
    key: newKey(), product_id: txt(product.id), code: txt(product.sku || product.code), description: txt(product.name),
    product_type: txt(product.product_type || fiscal.product_type) || 'resale', unit: txt(product.unit) || 'UN', quantity: '1',
    unit_price: txt(product.sale_price || product.price || 0), discount: '0', ncm: digits(product.ncm || fiscal.ncm),
    cest: digits(product.cest || fiscal.cest), cfop: digits(product.cfop_default || fiscal.cfop || fiscal.cfop_default),
    cfop_default: digits(product.cfop_default || fiscal.cfop || fiscal.cfop_default), cfop_manual: false,
    cfop_reason: 'Aguardando identificação do destino da operação.', origin: txt(product.origin ?? fiscal.origin ?? fiscal.origem ?? 0),
    icms_code: txt(icms.cst || icms.csosn || fiscal.cst_icms || fiscal.csosn || fiscal.icms_cst),
    ipi_cst: txt(ipi.cst || fiscal.cst_ipi), pis_cst: txt(pis.cst || fiscal.cst_pis || fiscal.pis_cst),
    cofins_cst: txt(cofins.cst || fiscal.cst_cofins || fiscal.cofins_cst), reform_cst: txt(fiscal.reform_cst),
    reform_classification: txt(fiscal.reform_classification), note: '',
  };
}

function blankItem(): ManualItem {
  return {
    key: newKey(), product_id: '', code: '', description: '', product_type: 'resale', unit: 'UN', quantity: '1', unit_price: '0', discount: '0',
    ncm: '', cest: '', cfop: '', cfop_default: '', cfop_manual: false, cfop_reason: 'Aguardando identificação do destino da operação.',
    origin: '0', icms_code: '', ipi_cst: '', pis_cst: '', cofins_cst: '', reform_cst: '', reform_classification: '', note: '',
  };
}

export function NfeEmissionWorkspace({ settings, documents, sales, customers, products }: Props) {
  const [topTab, setTopTab] = useState<TopTab>('new');
  const [mode, setMode] = useState<Mode>('manual');
  const [manualStep, setManualStep] = useState<ManualStep>('data');
  const [taxTab, setTaxTab] = useState<TaxTab>('icms');
  const [docs, setDocs] = useState<Row[]>(documents);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const [saleId, setSaleId] = useState('');
  const [saleSeriesId, setSaleSeriesId] = useState('');
  const [seriesId, setSeriesId] = useState('');
  const [operationType, setOperationType] = useState<NfeOperationType>('sale');
  const [natureOperation, setNatureOperation] = useState('');
  const [purpose, setPurpose] = useState('1');
  const [presence, setPresence] = useState('1');
  const [consumerFinal, setConsumerFinal] = useState(true);
  const [useMarketplace, setUseMarketplace] = useState(false);
  const [marketplaceIntermediary, setMarketplaceIntermediary] = useState('');
  const [exitDate, setExitDate] = useState('');
  const [exitTime, setExitTime] = useState('');

  const [customerId, setCustomerId] = useState('');
  const [useConsumption, setUseConsumption] = useState(false);
  const [recipient, setRecipient] = useState({
    name: '', document: '', state_registration: '', email: '', phone: '', street: '', number: '', complement: '', district: '', city: '', state: '', postal_code: '', ibge_city_code: '', indicator_ie: '9',
  });
  const [cepState, setCepState] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [cepMessage, setCepMessage] = useState('');

  const [productId, setProductId] = useState('');
  const [items, setItems] = useState<ManualItem[]>([]);

  const [freightMode, setFreightMode] = useState('9');
  const [carrier, setCarrier] = useState({ name: '', document: '', state_registration: '', plate: '', state: '', rntrc: '' });
  const [volumes, setVolumes] = useState({ quantity: '', species: '', brand: '', numbering: '', gross_weight: '', net_weight: '', shipping_state: '', shipping_city: '' });

  const [referenceType, setReferenceType] = useState<ReferenceType>('nfe');
  const [referenceValue, setReferenceValue] = useState('');
  const [referenceOperation, setReferenceOperation] = useState('1');
  const [referenceDate, setReferenceDate] = useState('');
  const [references, setReferences] = useState<FiscalReference[]>([]);

  const [paymentMethod, setPaymentMethod] = useState('01');
  const [installments, setInstallments] = useState([{ key: newKey(), due_date: '', amount: '' }]);
  const [freight, setFreight] = useState('0');
  const [insurance, setInsurance] = useState('0');
  const [other, setOther] = useState('0');
  const [additionalInfo, setAdditionalInfo] = useState('');
  const [manualSuccess, setManualSuccess] = useState<Row | null>(null);
  const [cfopRules, setCfopRules] = useState<Row[]>([]);

  const readiness = isObject(settings.fiscal_readiness) ? settings.fiscal_readiness : {};
  const issuer = isObject(settings.issuer) ? settings.issuer : {};
  const certificate = isObject(settings.certificate) ? settings.certificate : null;
  const series = Array.isArray(settings.series) ? settings.series.filter(isObject) : [];
  const nfeSeries = series.filter((row) => row.document_type === 'nfe' && row.active !== false);
  const cfops = (Array.isArray(settings.cfops) ? settings.cfops : []) as Row[];
  const emitterState = txt(issuer.state).toUpperCase();
  const currentScope = destinationScope(emitterState, recipient.state);
  const currentPrefix = cfopPrefixForScope(currentScope);
  const operationBadge = operationScopeLabel(currentScope, emitterState, recipient.state);
  const cfopOptions = cfops.filter((row) => row.active !== false && ['5', '6', '7'].includes(txt(row.code).slice(0, 1)) && (!currentPrefix || txt(row.code).startsWith(currentPrefix)));
  const missing = Array.isArray(readiness.missing_fields) ? readiness.missing_fields.map(txt).filter(Boolean) : [];
  const baseReady = readiness.ready === true;
  const nfeNumberingReady = nfeSeries.length > 0;
  const operationalReady = baseReady && nfeNumberingReady;
  const environment = txt(settings.environment) === 'production' ? 'Produção' : 'Homologação';
  const certExpired = certificate?.expired === true;
  const completedSales = useMemo(() => sales.filter((sale) => txt(sale.status) === 'completed'), [sales]);
  const activeCustomers = useMemo(() => customers.filter((row) => row.active !== false), [customers]);
  const activeProducts = useMemo(() => products.filter((row) => row.active !== false), [products]);
  const productsTotal = useMemo(() => items.reduce((sum, item) => sum + Math.max(num(item.quantity) * num(item.unit_price) - num(item.discount), 0), 0), [items]);
  const grandTotal = productsTotal + num(freight) + num(insurance) + num(other);
  const documentKey = `${docs.length}-${txt(docs[0]?.id)}`;
  const automaticNature = deriveNatureOperation(operationType, purpose);
  const effectiveNature = natureOperation.trim() || automaticNature;
  const suggestedCfops = Array.from(new Set(items.map((item) => digits(item.cfop)).filter(Boolean)));

  useEffect(() => {
    let mounted = true;
    void fiscalCfopRulesGet().then((result) => {
      if (mounted && result.ok && Array.isArray(result.data)) setCfopRules(result.data as Row[]);
    });
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    setItems((current) => current.map((item) => {
      if (item.cfop_manual) return item;
      const resolution = resolveCfopClient({
        rules: cfopRules, cfops, productCfop: item.cfop_default, productType: item.product_type, operationType,
        purpose, presence, emitterState, recipientState: recipient.state, consumerFinal, indicatorIe: recipient.indicator_ie,
      });
      return { ...item, cfop: resolution.code || '', cfop_reason: resolution.reason };
    }));
  }, [purpose, presence, consumerFinal, operationType, recipient.state, recipient.indicator_ie, emitterState, cfopRules, cfops, items.length]);

  function changeOperation(next: NfeOperationType) {
    setOperationType(next);
    if (next === 'return') setPurpose('4');
    else if (purpose === '4') setPurpose('1');
  }

  function changePurpose(next: string) {
    setPurpose(next);
    if (next === '4') setOperationType('return');
    else if (operationType === 'return') setOperationType('sale');
  }

  function fillCustomer(id: string) {
    setCustomerId(id);
    const row = activeCustomers.find((customer) => txt(customer.id) === id);
    if (!row) return;
    setRecipient({
      name: txt(row.name), document: txt(row.document), state_registration: txt(row.state_registration), email: txt(row.email), phone: txt(row.phone || row.mobile),
      street: txt(row.street), number: txt(row.number), complement: txt(row.complement), district: txt(row.district), city: txt(row.city),
      state: txt(row.state).toUpperCase(), postal_code: formatCep(row.postal_code), ibge_city_code: digits(row.ibge_city_code).slice(0, 7),
      indicator_ie: txt(row.state_registration) ? '1' : '9',
    });
    setCepState('idle'); setCepMessage('');
  }

  async function lookupCep(raw?: string) {
    const clean = digits(raw ?? recipient.postal_code);
    if (clean.length !== 8) {
      if (clean.length) { setCepState('error'); setCepMessage('Informe um CEP com 8 dígitos.'); }
      return;
    }
    setCepState('loading'); setCepMessage('Consultando CEP...');
    try {
      const response = await fetch(`/api/cep/${clean}`);
      const data = await response.json() as Row;
      if (!response.ok || data.ok !== true) {
        setCepState('error'); setCepMessage(txt(data.error) || 'CEP não localizado. Preencha o endereço manualmente.'); return;
      }
      setRecipient((current) => ({
        ...current, postal_code: formatCep(data.postal_code), street: txt(data.street) || current.street,
        district: txt(data.district) || current.district, city: txt(data.city) || current.city,
        state: txt(data.state).toUpperCase() || current.state, ibge_city_code: digits(data.ibge_city_code).slice(0, 7) || current.ibge_city_code,
      }));
      setCepState('success'); setCepMessage('CEP localizado! Endereço, bairro, cidade, UF e código IBGE preenchidos automaticamente.');
    } catch {
      setCepState('error'); setCepMessage('Não foi possível consultar o CEP. O preenchimento manual continua disponível.');
    }
  }

  function addProduct() {
    const product = activeProducts.find((row) => txt(row.id) === productId);
    setItems((current) => [...current, product ? productToItem(product) : blankItem()]);
    setProductId('');
  }

  function updateItem(key: string, field: keyof ManualItem, value: string) {
    setItems((current) => current.map((item) => item.key === key ? {
      ...item, [field]: value,
      ...(field === 'cfop' ? { cfop_manual: true, cfop_reason: 'CFOP alterado manualmente. O Thor continuará validando o grupo 5/6/7 conforme a UF.' } : {}),
    } : item));
  }

  function resetItemCfop(key: string) {
    setItems((current) => current.map((item) => {
      if (item.key !== key) return item;
      const resolution = resolveCfopClient({
        rules: cfopRules, cfops, productCfop: item.cfop_default, productType: item.product_type, operationType,
        purpose, presence, emitterState, recipientState: recipient.state, consumerFinal, indicatorIe: recipient.indicator_ie,
      });
      return { ...item, cfop_manual: false, cfop: resolution.code || '', cfop_reason: resolution.reason };
    }));
  }

  function addReference() {
    const value = referenceValue.trim();
    if (!value) { setMessage('Informe a chave ou número do documento referenciado.'); return; }
    if (referenceType === 'nfe' && digits(value).length !== 44) { setMessage('A chave de NF-e/NFC-e/CF-e referenciada deve possuir 44 dígitos.'); return; }
    setReferences((current) => [...current, { key: newKey(), type: referenceType, value, operation_type: referenceOperation, issue_date: referenceDate }]);
    setReferenceValue(''); setReferenceDate(''); setMessage('Referência adicionada.');
  }

  async function refreshDocuments() {
    const result = await erpFiscalDocuments();
    if (result.ok) setDocs(result.data);
  }

  async function createFromSale() {
    if (!saleId) { setMessage('Selecione uma venda concluída.'); return; }
    setBusy(true); setMessage('Validando a venda e preparando a NF-e...');
    const result = await nfeSaleDraftCreate(saleId, saleSeriesId || undefined, {
      nature_operation: effectiveNature, operation_type: 'sale', purpose, presence, consumer_final: consumerFinal,
    });
    setBusy(false);
    if (!result.ok) { setMessage(txt(result.error) || 'Não foi possível preparar a NF-e.'); return; }
    setMessage(`NF-e ${txt(result.number)} série ${txt(result.series)} criada como rascunho.`);
    setSaleId(''); setSaleSeriesId(''); await refreshDocuments(); setTopTab('documents');
  }

  async function createManualDraft() {
    setBusy(true); setMessage('Validando destinatário, CFOPs e dados fiscais antes de reservar a numeração...');
    const payload: Row = {
      series_id: seriesId || null,
      operation: {
        nature_operation: effectiveNature, operation_type: operationType, purpose, presence, consumer_final: consumerFinal,
        destination_scope: currentScope, exit_date: exitDate || null, exit_time: exitTime || null,
        marketplace: useMarketplace, marketplace_intermediary: useMarketplace ? marketplaceIntermediary.trim() : '', use_consumption: useConsumption,
      },
      recipient: { ...recipient, document: digits(recipient.document), postal_code: digits(recipient.postal_code), ibge_city_code: digits(recipient.ibge_city_code) },
      items: items.map(({ key, ...item }) => ({
        ...item, ncm: digits(item.ncm), cest: digits(item.cest), cfop: digits(item.cfop), quantity: num(item.quantity),
        unit_price: num(item.unit_price), discount: num(item.discount), origin: num(item.origin),
      })),
      transport: { freight_mode: freightMode, carrier, volumes },
      references: references.map(({ key, ...reference }) => reference),
      billing: { payment_method: paymentMethod, installments: installments.map(({ key, ...row }) => ({ ...row, amount: num(row.amount) })) },
      totals: { freight: num(freight), insurance: num(insurance), other: num(other) },
      additional: { information: additionalInfo.trim() },
    };
    const result = await nfeManualDraftCreate(payload);
    setBusy(false);
    if (!result.ok) { setMessage(txt(result.error) || 'Não foi possível criar o rascunho da NF-e.'); return; }
    setManualSuccess(result); setMessage(`Rascunho NF-e ${txt(result.number)} série ${txt(result.series)} criado com sucesso.`); await refreshDocuments();
  }

  function resetManual() {
    setManualStep('data'); setSeriesId(''); setOperationType('sale'); setNatureOperation(''); setPurpose('1'); setPresence('1'); setConsumerFinal(true);
    setUseMarketplace(false); setMarketplaceIntermediary(''); setExitDate(''); setExitTime(''); setCustomerId(''); setUseConsumption(false);
    setRecipient({ name: '', document: '', state_registration: '', email: '', phone: '', street: '', number: '', complement: '', district: '', city: '', state: '', postal_code: '', ibge_city_code: '', indicator_ie: '9' });
    setCepState('idle'); setCepMessage(''); setProductId(''); setItems([]); setFreightMode('9');
    setCarrier({ name: '', document: '', state_registration: '', plate: '', state: '', rntrc: '' });
    setVolumes({ quantity: '', species: '', brand: '', numbering: '', gross_weight: '', net_weight: '', shipping_state: '', shipping_city: '' });
    setReferences([]); setReferenceType('nfe'); setReferenceValue(''); setReferenceOperation('1'); setReferenceDate('');
    setPaymentMethod('01'); setInstallments([{ key: newKey(), due_date: '', amount: '' }]); setFreight('0'); setInsurance('0'); setOther('0');
    setAdditionalInfo(''); setManualSuccess(null); setMessage('');
  }

  const stepIndex = stepLabels.findIndex((step) => step.key === manualStep);
  const goBack = () => { if (stepIndex > 0) setManualStep(stepLabels[stepIndex - 1].key); };
  const goNext = () => { if (stepIndex < stepLabels.length - 1) setManualStep(stepLabels[stepIndex + 1].key); };

  return <div className="nfe-emission-stack nfe-smart-emitter">
    <section className="nfe-smart-banner"><div><b>🛡 Menos erros fiscais, mais agilidade.</b><span>Regras fiscais automáticas validam destino, finalidade, operação, tipo de produto e sugerem CFOP por item.</span></div><span className="nfe-env-chip">{environment}</span></section>

    <nav className="nfe-main-tabs" aria-label="Áreas da emissão de NF-e">
      <button className={topTab === 'new' ? 'active' : ''} onClick={() => setTopTab('new')}><b>＋</b><span>Nova NF-e<small>Emissão guiada e inteligente</small></span></button>
      <button className={topTab === 'documents' ? 'active' : ''} onClick={() => setTopTab('documents')}><b>▤</b><span>Documentos<small>Rascunhos, autorizadas e rejeitadas</small></span></button>
      <button className={topTab === 'config' ? 'active' : ''} onClick={() => setTopTab('config')}><b>⚙</b><span>Configuração<small>Emitente, série, certificado e CFOP</small></span></button>
    </nav>

    {message && <div className="nfe-global-message">{message}</div>}

    {topTab === 'new' && <>
      <div className="nfe-mode-inline"><span>Origem da NF-e</span><button className={mode === 'manual' ? 'active' : ''} onClick={() => setMode('manual')}>Preenchimento manual</button><button className={mode === 'sale' ? 'active' : ''} onClick={() => setMode('sale')}>A partir de venda concluída</button></div>

      {mode === 'sale' && <section className="nfe-workspace-card"><div className="nfe-section-head"><div><span>VENDA CONCLUÍDA</span><h3>Gerar NF-e a partir de uma venda</h3><p>O Thor carrega cliente e itens, identifica a UF de destino e valida o CFOP antes de reservar a numeração.</p></div></div><div className="nfe-form-grid three">
        <label className="wide">Venda concluída<select value={saleId} onChange={(e) => setSaleId(e.target.value)}><option value="">Selecione...</option>{completedSales.map((sale) => <option key={txt(sale.id)} value={txt(sale.id)}>Venda #{txt(sale.number || sale.sale_number)} · {txt(sale.customer || sale.customer_name || 'Consumidor')} · {money(sale.total)}</option>)}</select></label>
        <label>Série<select value={saleSeriesId} onChange={(e) => setSaleSeriesId(e.target.value)}><option value="">Série padrão</option>{nfeSeries.map((row) => <option key={txt(row.id)} value={txt(row.id)}>Série {txt(row.series)}{row.is_default ? ' · padrão' : ''}</option>)}</select></label>
        <label>Finalidade<select value={purpose} onChange={(e) => changePurpose(e.target.value)}><option value="1">1 · Normal</option><option value="2">2 · Complementar</option><option value="3">3 · Ajuste</option><option value="4">4 · Devolução/Retorno</option></select></label>
        <label>Presença<select value={presence} onChange={(e) => setPresence(e.target.value)}><option value="0">Não se aplica</option><option value="1">Presencial</option><option value="2">Internet</option><option value="3">Teleatendimento</option><option value="5">Fora do estabelecimento</option><option value="9">Outros</option></select></label>
        <label className="nfe-check"><input type="checkbox" checked={consumerFinal} onChange={(e) => setConsumerFinal(e.target.checked)} /><span>Consumidor final</span></label>
        <div className="nfe-action-box wide"><button className="nfe-primary" disabled={busy || !saleId || !operationalReady} onClick={() => void createFromSale()}>{busy ? 'Preparando...' : 'Validar CFOPs e criar rascunho'}</button></div>
      </div></section>}

      {mode === 'manual' && <div className="nfe-emitter-layout">
        <aside className="nfe-emitter-sidebar">
          <h3>Emitir nota fiscal</h3>
          <nav>{stepLabels.map((step, index) => <button key={step.key} className={manualStep === step.key ? 'active' : index < stepIndex ? 'done' : ''} onClick={() => setManualStep(step.key)}><i>{index < stepIndex ? '✓' : step.icon}</i><span>{step.label}</span><b>›</b></button>)}</nav>
          <div className="nfe-sidebar-actions"><button className="nfe-secondary" onClick={() => setTopTab('documents')}>Ver DANFE / Documentos</button><button className="nfe-secondary" onClick={resetManual}>Limpar nota</button><button className="nfe-emit-button" onClick={() => setManualStep('review')}>✈ Emitir nota</button></div>
        </aside>

        <main className="nfe-emitter-main">
          {manualSuccess ? <div className="nfe-success-card"><div className="nfe-success-icon">✓</div><div><span>RASCUNHO CRIADO</span><h3>NF-e {txt(manualSuccess.number)} · Série {txt(manualSuccess.series)}</h3><p>Total {money(manualSuccess.total)}. O documento foi salvo e está pronto para conferência/transmissão conforme a disponibilidade do transporte SEFAZ.</p><div><button className="nfe-primary" onClick={() => setTopTab('documents')}>Ver documentos</button><button className="nfe-secondary" onClick={resetManual}>Criar outra NF-e</button></div></div></div> : <>
            <header className="nfe-screen-header"><div><span className="nfe-step-number">{Math.max(stepIndex + 1, 1)}</span><div><h2>{stepLabels[stepIndex]?.label}</h2><small>{manualStep === 'products' ? 'Inclua produtos e detalhe os impostos na mesma tela.' : 'Preencha os dados necessários para esta etapa da NF-e.'}</small></div></div><span className={`nfe-operation-badge ${currentScope ? 'ready' : ''}`}>{operationBadge}</span></header>

            {manualStep === 'data' && <section className="nfe-screen-card"><div className="nfe-form-grid three">
              <label>Local de estoque<input value={txt(issuer.trade_name || issuer.name || 'LOJA MATRIZ')} readOnly /></label>
              <label>Modelo<input value="Nota fiscal (NF-e modelo 55)" readOnly /></label>
              <label>Série<select value={seriesId} onChange={(e) => setSeriesId(e.target.value)}><option value="">Série padrão</option>{nfeSeries.map((row) => <option key={txt(row.id)} value={txt(row.id)}>Série {txt(row.series)}{row.is_default ? ' · padrão' : ''}</option>)}</select></label>
              <label>Finalidade<select value={purpose} onChange={(e) => changePurpose(e.target.value)}><option value="1">1 · Normal</option><option value="2">2 · Complementar</option><option value="3">3 · Ajuste</option><option value="4">4 · Devolução / Retorno</option></select></label>
              <label>Tipo de operação<select value={operationType} onChange={(e) => changeOperation(e.target.value as NfeOperationType)}><option value="sale">Venda</option><option value="return">Devolução</option><option value="transfer">Transferência</option><option value="shipment">Remessa</option><option value="return_shipment">Retorno</option><option value="bonus">Bonificação</option><option value="sample">Amostra grátis</option><option value="other">Outras</option></select></label>
              <label>Destino da operação<input value={currentScope === 'internal' ? '1 · Operação interna' : currentScope === 'interstate' ? '2 · Operação interestadual' : currentScope === 'foreign' ? '3 · Exterior' : 'Definido automaticamente pelo destinatário'} readOnly /></label>
              <label>Tipo de emissão<input value="Normal" readOnly /></label>
              <label>Presença do comprador<select value={presence} onChange={(e) => setPresence(e.target.value)}><option value="0">Não se aplica</option><option value="1">Presencial</option><option value="2">Internet</option><option value="3">Teleatendimento</option><option value="5">Fora do estabelecimento</option><option value="9">Outros</option></select></label>
              <label className="nfe-check"><input type="checkbox" checked={consumerFinal} onChange={(e) => setConsumerFinal(e.target.checked)} /><span>Consumidor final</span></label>
              <label className="nfe-check"><input type="checkbox" checked={useMarketplace} onChange={(e) => setUseMarketplace(e.target.checked)} /><span>Utiliza marketplace</span></label>
              <label className="wide">Marketplace intermediador<input disabled={!useMarketplace} value={marketplaceIntermediary} onChange={(e) => setMarketplaceIntermediary(e.target.value)} placeholder="Opcional" /></label>
              <label>Data de saída <em>(opcional)</em><input type="date" value={exitDate} onChange={(e) => setExitDate(e.target.value)} /></label>
              <label>Hora de saída <em>(opcional)</em><input type="time" value={exitTime} onChange={(e) => setExitTime(e.target.value)} /></label>
              <label className="wide">Natureza da operação <em>(opcional)</em><input value={natureOperation} onChange={(e) => setNatureOperation(e.target.value)} placeholder="Deixe em branco para preenchimento automático" /><small>Se não informado, o Thor usará: <b>{automaticNature}</b>.</small></label>
            </div>
            <div className="nfe-cfop-suggestion"><div><b>✣ CFOP sugerido pelo motor fiscal</b><small>A sugestão considera Finalidade, Tipo de operação, UF do destinatário, tipo fiscal do produto, consumidor final e indicador IE.</small></div>{suggestedCfops.length ? <strong>{suggestedCfops.join(', ')}</strong> : <strong>Aguardando destinatário e produtos</strong>}</div>
            <label className="nfe-textarea-label">Informações adicionais <em>(opcional)</em><textarea rows={3} value={additionalInfo} onChange={(e) => setAdditionalInfo(e.target.value)} placeholder="Informações complementares que não alteram o cálculo dos impostos." /></label></section>}

            {manualStep === 'recipient' && <section className="nfe-screen-card"><label className="nfe-catalog-select">Destinatário<select value={customerId} onChange={(e) => fillCustomer(e.target.value)}><option value="">Selecione um cliente ou preencha manualmente</option>{activeCustomers.map((customer) => <option key={txt(customer.id)} value={txt(customer.id)}>{txt(customer.name)} · {txt(customer.document)}</option>)}</select></label><div className="nfe-form-grid four">
              <label className="span2">Nome / Razão social<input value={recipient.name} onChange={(e) => setRecipient({ ...recipient, name: e.target.value })} /></label><label>CPF/CNPJ<input value={recipient.document} onChange={(e) => setRecipient({ ...recipient, document: e.target.value })} /></label><label>Tipo<select value={recipient.indicator_ie} onChange={(e) => setRecipient({ ...recipient, indicator_ie: e.target.value })}><option value="1">Contribuinte ICMS</option><option value="2">Contribuinte isento</option><option value="9">Não contribuinte</option></select></label>
              <label>CEP<div className="nfe-cep-field"><input inputMode="numeric" value={recipient.postal_code} onChange={(e) => { setRecipient({ ...recipient, postal_code: formatCep(e.target.value) }); setCepState('idle'); setCepMessage(''); }} onBlur={() => void lookupCep()} placeholder="00000-000" /><button type="button" onClick={() => void lookupCep()} disabled={cepState === 'loading'}>⌕</button></div>{cepMessage && <small className={`nfe-field-help ${cepState}`}>{cepMessage}</small>}</label>
              <label className="span2">Endereço<input value={recipient.street} onChange={(e) => setRecipient({ ...recipient, street: e.target.value })} /></label><label>Número<input value={recipient.number} onChange={(e) => setRecipient({ ...recipient, number: e.target.value })} /></label>
              <label className="span2">Complemento <em>(opcional)</em><input value={recipient.complement} onChange={(e) => setRecipient({ ...recipient, complement: e.target.value })} /></label><label>Bairro<input value={recipient.district} onChange={(e) => setRecipient({ ...recipient, district: e.target.value })} /></label><label>Inscrição Estadual<input value={recipient.state_registration} onChange={(e) => setRecipient({ ...recipient, state_registration: e.target.value })} /></label>
              <label>Estado<input maxLength={2} value={recipient.state} onChange={(e) => setRecipient({ ...recipient, state: e.target.value.toUpperCase() })} /></label><label className="span2">Cidade<input value={recipient.city} onChange={(e) => setRecipient({ ...recipient, city: e.target.value })} /></label><label>Código IBGE<input value={recipient.ibge_city_code} onChange={(e) => setRecipient({ ...recipient, ibge_city_code: digits(e.target.value).slice(0, 7) })} /></label>
              <label>Telefone <em>(opcional)</em><input value={recipient.phone} onChange={(e) => setRecipient({ ...recipient, phone: e.target.value })} /></label><label className="span2">E-mail <em>(opcional)</em><input value={recipient.email} onChange={(e) => setRecipient({ ...recipient, email: e.target.value })} /></label><label className="nfe-check"><input type="checkbox" checked={useConsumption} onChange={(e) => setUseConsumption(e.target.checked)} /><span>Uso e consumo</span></label>
            </div><div className="nfe-intelligence-box"><b>ⓘ Inteligência do CEP</b><span>Ao informar o CEP, logradouro, bairro, cidade, UF e código IBGE são preenchidos automaticamente. Número e complemento permanecem sob controle do usuário.</span></div></section>}

            {manualStep === 'products' && <section className="nfe-screen-card"><div className="nfe-add-product-bar"><select value={productId} onChange={(e) => setProductId(e.target.value)}><option value="">Selecione um produto ou adicione uma linha em branco</option>{activeProducts.map((product) => <option key={txt(product.id)} value={txt(product.id)}>{txt(product.sku)} · {txt(product.name)} · {money(product.sale_price)}</option>)}</select><button className="nfe-primary" onClick={addProduct}>＋ Adicionar produto</button></div>
              {items.length === 0 ? <div className="nfe-empty-state">Nenhum produto incluído.</div> : <div className="nfe-product-table-wrap"><table className="nfe-product-table"><thead><tr><th>#</th><th>Produto</th><th>NCM</th><th>CFOP</th><th>Un.</th><th>Qtd.</th><th>Vl. unit.</th><th>Desconto</th><th>Vl. total</th><th></th></tr></thead><tbody>{items.map((item, index) => <tr key={item.key}><td>{index + 1}</td><td><input value={item.description} onChange={(e) => updateItem(item.key, 'description', e.target.value)} /><small>{productTypeLabels[item.product_type] || item.product_type}</small></td><td><input value={item.ncm} onChange={(e) => updateItem(item.key, 'ncm', digits(e.target.value).slice(0, 8))} /></td><td><select value={item.cfop} onChange={(e) => updateItem(item.key, 'cfop', e.target.value)}><option value="">Selecione...</option>{cfopOptions.map((row) => <option key={txt(row.id)} value={txt(row.code)}>{txt(row.code)} · {txt(row.name)}</option>)}</select><small>{item.cfop_reason}</small>{item.cfop_manual && <button className="nfe-link-button" onClick={() => resetItemCfop(item.key)}>usar automático</button>}</td><td><input value={item.unit} onChange={(e) => updateItem(item.key, 'unit', e.target.value)} /></td><td><input type="number" step="0.001" value={item.quantity} onChange={(e) => updateItem(item.key, 'quantity', e.target.value)} /></td><td><input type="number" step="0.01" value={item.unit_price} onChange={(e) => updateItem(item.key, 'unit_price', e.target.value)} /></td><td><input type="number" step="0.01" value={item.discount} onChange={(e) => updateItem(item.key, 'discount', e.target.value)} /></td><td><b>{money(Math.max(num(item.quantity) * num(item.unit_price) - num(item.discount), 0))}</b></td><td><button className="nfe-remove-item" onClick={() => setItems((current) => current.filter((row) => row.key !== item.key))}>×</button></td></tr>)}</tbody></table></div>}
              <div className="nfe-tax-area"><nav className="nfe-tax-tabs">{taxTabs.map((tab) => <button key={tab.key} className={taxTab === tab.key ? 'active' : ''} onClick={() => setTaxTab(tab.key)}>{tab.label}</button>)}</nav>{items.length === 0 ? <div className="nfe-empty-state">Inclua um produto para detalhar os impostos.</div> : <div className="nfe-tax-items">{items.map((item, index) => <article key={item.key}><header><b>{index + 1}. {item.description || 'Produto sem descrição'}</b><span>NCM {item.ncm || '—'} · CFOP {item.cfop || '—'}</span></header>
                {taxTab === 'icms' && <div className="nfe-form-grid four"><label>Origem<select value={item.origin} onChange={(e) => updateItem(item.key, 'origin', e.target.value)}>{Array.from({ length: 9 }, (_, i) => <option value={String(i)} key={i}>{i}</option>)}</select></label><label>Situação tributária / CST-CSOSN<input value={item.icms_code} onChange={(e) => updateItem(item.key, 'icms_code', e.target.value)} /></label><label>CFOP<select value={item.cfop} onChange={(e) => updateItem(item.key, 'cfop', e.target.value)}><option value="">Selecione...</option>{cfopOptions.map((row) => <option key={txt(row.id)} value={txt(row.code)}>{txt(row.code)} · {txt(row.name)}</option>)}</select></label><label>Tipo do produto<input value={productTypeLabels[item.product_type] || item.product_type} readOnly /></label></div>}
                {taxTab === 'ipi' && <div className="nfe-form-grid three"><label>CST IPI<input value={item.ipi_cst} onChange={(e) => updateItem(item.key, 'ipi_cst', e.target.value)} /></label><label>NCM<input value={item.ncm} readOnly /></label><label>CEST<input value={item.cest} onChange={(e) => updateItem(item.key, 'cest', digits(e.target.value).slice(0, 7))} /></label></div>}
                {taxTab === 'icms_st' && <div className="nfe-form-grid three"><label>CEST<input value={item.cest} onChange={(e) => updateItem(item.key, 'cest', digits(e.target.value).slice(0, 7))} /></label><label>CST/CSOSN<input value={item.icms_code} onChange={(e) => updateItem(item.key, 'icms_code', e.target.value)} /></label><div className="nfe-intelligence-box compact"><b>Validação ST</b><span>O CEST e a situação tributária permanecem associados ao item para validação fiscal.</span></div></div>}
                {taxTab === 'pis_cofins' && <div className="nfe-form-grid three"><label>CST PIS<input value={item.pis_cst} onChange={(e) => updateItem(item.key, 'pis_cst', e.target.value)} /></label><label>CST COFINS<input value={item.cofins_cst} onChange={(e) => updateItem(item.key, 'cofins_cst', e.target.value)} /></label><label>CFOP<input value={item.cfop} readOnly /></label></div>}
                {taxTab === 'reform' && <div className="nfe-form-grid three"><label>CST IBS/CBS<input value={item.reform_cst} onChange={(e) => updateItem(item.key, 'reform_cst', e.target.value)} /></label><label className="span2">Classificação tributária (cClassTrib)<input value={item.reform_classification} onChange={(e) => updateItem(item.key, 'reform_classification', e.target.value)} /></label></div>}
                {taxTab === 'import' && <div className="nfe-intelligence-box"><b>Importação</b><span>Origem fiscal atual: {item.origin}. Para produtos importados, confira origem, DI/adição e demais dados exigidos no cadastro fiscal do produto.</span></div>}
                {taxTab === 'simples' && <div className="nfe-form-grid two"><label>CSOSN / situação tributária<input value={item.icms_code} onChange={(e) => updateItem(item.key, 'icms_code', e.target.value)} /></label><label>CFOP<input value={item.cfop} readOnly /></label></div>}
                {taxTab === 'additional' && <label className="nfe-textarea-label">Informações adicionais do item<textarea rows={3} value={item.note} onChange={(e) => updateItem(item.key, 'note', e.target.value)} /></label>}
              </article>)}</div>}</div>
              <div className="nfe-intelligence-box"><b>ⓘ CFOP protegido por contexto fiscal</b><span>O Thor cruza finalidade, operação, UF do destinatário e tipo de produto. Para devolução, transferência, remessa e outras operações, o equivalente 5/6/7 não é presumido sem regra explícita.</span></div></section>}

            {manualStep === 'transport' && <section className="nfe-screen-card"><div className="nfe-form-grid three">
              <label>Tipo de frete<select value={freightMode} onChange={(e) => setFreightMode(e.target.value)}><option value="9">9 · Sem ocorrência de transporte</option><option value="0">0 · Por conta do emitente</option><option value="1">1 · Por conta do destinatário</option><option value="2">2 · Por conta de terceiros</option><option value="3">3 · Próprio por conta do emitente</option><option value="4">4 · Próprio por conta do destinatário</option></select></label><label className="span2">Transportadora<input value={carrier.name} onChange={(e) => setCarrier({ ...carrier, name: e.target.value })} placeholder="Selecione ou digite a transportadora" /></label>
              <label>Placa do veículo<input value={carrier.plate} onChange={(e) => setCarrier({ ...carrier, plate: e.target.value.toUpperCase() })} /></label><label>UF do veículo<input maxLength={2} value={carrier.state} onChange={(e) => setCarrier({ ...carrier, state: e.target.value.toUpperCase() })} /></label><label>RNTRC <em>(opcional)</em><input value={carrier.rntrc} onChange={(e) => setCarrier({ ...carrier, rntrc: e.target.value })} /></label>
              <label>Quantidade de volumes<input type="number" value={volumes.quantity} onChange={(e) => setVolumes({ ...volumes, quantity: e.target.value })} /></label><label>Espécie dos volumes<input value={volumes.species} onChange={(e) => setVolumes({ ...volumes, species: e.target.value })} /></label><label>Marca dos volumes<input value={volumes.brand} onChange={(e) => setVolumes({ ...volumes, brand: e.target.value })} /></label>
              <label>Numeração dos volumes<input value={volumes.numbering} onChange={(e) => setVolumes({ ...volumes, numbering: e.target.value })} /></label><label>Peso bruto (kg)<input type="number" step="0.001" value={volumes.gross_weight} onChange={(e) => setVolumes({ ...volumes, gross_weight: e.target.value })} /></label><label>Peso líquido (kg)<input type="number" step="0.001" value={volumes.net_weight} onChange={(e) => setVolumes({ ...volumes, net_weight: e.target.value })} /></label>
              <label>Estado de embarque <em>(opcional)</em><input maxLength={2} value={volumes.shipping_state} onChange={(e) => setVolumes({ ...volumes, shipping_state: e.target.value.toUpperCase() })} /></label><label className="span2">Município de embarque <em>(opcional)</em><input value={volumes.shipping_city} onChange={(e) => setVolumes({ ...volumes, shipping_city: e.target.value })} /></label>
            </div></section>}

            {manualStep === 'references' && <section className="nfe-screen-card"><nav className="nfe-reference-tabs"><button className={referenceType === 'nfe' ? 'active' : ''} onClick={() => setReferenceType('nfe')}>NF-e / NFC-e / CF-e</button><button className={referenceType === 'coupon' ? 'active' : ''} onClick={() => setReferenceType('coupon')}>Cupom fiscal</button><button className={referenceType === 'model01' ? 'active' : ''} onClick={() => setReferenceType('model01')}>NF modelo 01/02</button><button className={referenceType === 'rural' ? 'active' : ''} onClick={() => setReferenceType('rural')}>NF de produtor rural</button></nav><div className="nfe-reference-form"><label>Chave / documento referenciado<input value={referenceValue} onChange={(e) => setReferenceValue(e.target.value)} placeholder={referenceType === 'nfe' ? 'Informe a chave de 44 dígitos' : 'Informe o documento'} /></label><label>Tipo de operação<select value={referenceOperation} onChange={(e) => setReferenceOperation(e.target.value)}><option value="1">1 · Entrada</option><option value="2">2 · Saída</option></select></label><label>Data de emissão<input type="date" value={referenceDate} onChange={(e) => setReferenceDate(e.target.value)} /></label><button className="nfe-primary" onClick={addReference}>Adicionar</button></div>
              <div className="nfe-reference-list"><h4>Referências adicionadas</h4>{references.length === 0 ? <div className="nfe-empty-state">Nenhum documento referenciado.</div> : <table><thead><tr><th>Tipo</th><th>Chave/documento</th><th>Operação</th><th>Data</th><th></th></tr></thead><tbody>{references.map((reference) => <tr key={reference.key}><td>{reference.type.toUpperCase()}</td><td>{reference.value}</td><td>{reference.operation_type === '1' ? 'Entrada' : 'Saída'}</td><td>{reference.issue_date || '—'}</td><td><button onClick={() => setReferences((current) => current.filter((row) => row.key !== reference.key))}>×</button></td></tr>)}</tbody></table>}</div></section>}

            {manualStep === 'payments' && <section className="nfe-screen-card"><div className="nfe-payment-summary"><b>Total da NF-e</b><strong>{money(grandTotal)}</strong></div><div className="nfe-form-grid four"><label>Forma de pagamento<select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}><option value="01">Dinheiro</option><option value="03">Cartão de crédito</option><option value="04">Cartão de débito</option><option value="15">Boleto</option><option value="16">Depósito bancário</option><option value="17">PIX dinâmico</option><option value="20">PIX estático</option><option value="90">Sem pagamento</option><option value="99">Outros</option></select></label><label>Valor do frete<input type="number" step="0.01" value={freight} onChange={(e) => setFreight(e.target.value)} /></label><label>Valor do seguro<input type="number" step="0.01" value={insurance} onChange={(e) => setInsurance(e.target.value)} /></label><label>Despesas acessórias<input type="number" step="0.01" value={other} onChange={(e) => setOther(e.target.value)} /></label></div><div className="nfe-installments"><header><div><strong>Duplicatas / parcelas</strong><small>Opcional.</small></div><button className="nfe-secondary" onClick={() => setInstallments((current) => [...current, { key: newKey(), due_date: '', amount: '' }])}>+ Parcela</button></header>{installments.map((row, index) => <div className="nfe-installment-row" key={row.key}><span>{index + 1}</span><input type="date" value={row.due_date} onChange={(e) => setInstallments((current) => current.map((it) => it.key === row.key ? { ...it, due_date: e.target.value } : it))} /><input type="number" step="0.01" placeholder="Valor" value={row.amount} onChange={(e) => setInstallments((current) => current.map((it) => it.key === row.key ? { ...it, amount: e.target.value } : it))} /><button onClick={() => setInstallments((current) => current.length === 1 ? current : current.filter((it) => it.key !== row.key))}>×</button></div>)}</div></section>}

            {manualStep === 'review' && <section className="nfe-screen-card"><div className="nfe-review-grid"><article><span>Operação</span><strong>{effectiveNature}</strong><small>{operationLabel(operationType)} · Finalidade {purpose} · {operationBadge}</small></article><article><span>Destinatário</span><strong>{recipient.name || 'Não informado'}</strong><small>{recipient.document || 'CPF/CNPJ não informado'} · {recipient.city || '—'}/{recipient.state || '—'}</small></article><article><span>Produtos</span><strong>{items.length} item(ns)</strong><small>{money(productsTotal)} · CFOPs {suggestedCfops.join(', ') || 'pendentes'}</small></article><article><span>Transporte</span><strong>Modalidade {freightMode}</strong><small>{carrier.name || 'Sem transportadora'}</small></article><article><span>Referências</span><strong>{references.length}</strong><small>Documento(s) vinculado(s)</small></article><article><span>Total da NF-e</span><strong>{money(grandTotal)}</strong><small>Frete {money(freight)} · Seguro {money(insurance)} · Outros {money(other)}</small></article></div><div className="nfe-review-warning"><b>Validação fiscal antes da numeração</b><span>O servidor valida endereço fiscal, NCM, CFOP por item e compatibilidade 5.xxx/6.xxx/7.xxx com a UF do destinatário. A natureza é gerada automaticamente quando o campo foi deixado em branco.</span></div><div className="nfe-final-actions"><button className="nfe-secondary" onClick={() => setManualStep('payments')}>← Voltar</button><button className="nfe-emit-button large" disabled={busy || !operationalReady} onClick={() => void createManualDraft()}>{busy ? 'Validando e salvando...' : '✈ Validar e criar NF-e'}</button></div></section>}

            {manualStep !== 'review' && <footer className="nfe-screen-footer"><button className="nfe-secondary" disabled={stepIndex === 0} onClick={goBack}>← Voltar</button><button className="nfe-primary" onClick={goNext}>Salvar informações e continuar →</button></footer>}
          </>}
        </main>
      </div>}
    </>}

    {topTab === 'documents' && <section className="nfe-documents-tab"><div className="nfe-section-head"><div><span>DOCUMENTOS</span><h3>Histórico de NF-e</h3><p>Consulte rascunhos, autorizações, rejeições, XML e DANFE.</p></div><button className="nfe-secondary" onClick={() => { setTopTab('new'); setMode('manual'); }}>+ Nova NF-e</button></div><FiscalDocumentsWorkspace key={documentKey} initialDocs={docs} sales={sales} settings={settings} initialType="nfe" /></section>}

    {topTab === 'config' && <div className="nfe-config-tab"><section className="nfe-readiness-grid" aria-label="Prontidão para emissão de NF-e"><article className={baseReady ? 'ok' : 'attention'}><span>Emitente</span><strong>{txt(issuer.cnpj) || 'CNPJ não informado'}</strong><small>{[txt(issuer.city), txt(issuer.state)].filter(Boolean).join(' / ') || 'Endereço fiscal incompleto'}</small></article><article className={certificate && !certExpired ? 'ok' : 'attention'}><span>Certificado A1</span><strong>{certificate && !certExpired ? 'Configurado' : certExpired ? 'Vencido' : 'Pendente'}</strong><small>{certificate ? txt(certificate.subject_cn) || txt(certificate.filename) : 'Necessário para assinatura digital'}</small></article><article className={nfeNumberingReady ? 'ok' : 'attention'}><span>Série NF-e</span><strong>{nfeNumberingReady ? `${nfeSeries.length} ativa(s)` : 'Não configurada'}</strong><small>{nfeNumberingReady ? `Padrão: ${txt(settings.nfe_series) || txt(nfeSeries[0]?.series)}` : 'Cadastre uma série do modelo 55'}</small></article><article className="info"><span>Ambiente</span><strong>{environment}</strong><small>{environment === 'Produção' ? 'Documentos com validade fiscal' : 'Ambiente seguro para testes'}</small></article><article className="transport"><span>Motor CFOP</span><strong>{cfopRules.length} regra(s)</strong><small>Destino + finalidade + operação + produto</small></article></section>{(!operationalReady || missing.length > 0) && <section className="nfe-pending-card"><div><span>PRONTIDÃO FISCAL</span><h3>Ajustes antes de emitir</h3></div><div className="nfe-pending-list">{missing.map((item) => <span key={item}>{missingLabels[item] || item}</span>)}{!nfeNumberingReady && <span>Série e numeração da NF-e</span>}</div></section>}<section className="nfe-config-links"><Link href="/dashboard/administrativo/empresas"><b>🏢</b><span><strong>Emitente / Matriz</strong><small>CNPJ, IE, CRT e endereço.</small></span></Link><Link href="/dashboard/fiscal/series"><b>№</b><span><strong>Séries e numeração</strong><small>Série padrão e última numeração.</small></span></Link><Link href="/dashboard/fiscal/certificado"><b>🔐</b><span><strong>Certificado A1</strong><small>Assinatura digital e validade.</small></span></Link><Link href="/dashboard/fiscal/cfops"><b>↔</b><span><strong>CFOPs e regras</strong><small>Automação por operação e produto.</small></span></Link><Link href="/dashboard/fiscal"><b>⚙</b><span><strong>Central Fiscal</strong><small>Demais configurações.</small></span></Link></section></div>}
  </div>;
}
