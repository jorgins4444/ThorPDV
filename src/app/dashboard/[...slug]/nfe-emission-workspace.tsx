'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { FiscalDocumentsWorkspace } from './fiscal-documents-workspace';
import { fiscalCfopRulesGet, fiscalPrepareV2, nfeManualDraftCreate } from './fiscal-config-actions';
import { cfopPrefixForScope, destinationScope, resolveCfopClient, scopeLabel } from './nfe-cfop-engine';
import { erpFiscalDocuments } from './fiscal-transmit-actions';

type Row = Record<string, unknown>;
type TopTab = 'new' | 'documents' | 'config';
type Mode = 'sale' | 'manual';
type ManualStep = 'data' | 'recipient' | 'items' | 'taxes' | 'transport' | 'billing' | 'review';
type ManualItem = {
  key: string;
  product_id: string;
  code: string;
  description: string;
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
  pis_cst: string;
  cofins_cst: string;
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
const money = (value: unknown) => num(value).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const isObject = (value: unknown): value is Row => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const obj = (value: unknown): Row => isObject(value) ? value : {};
const digits = (value: unknown) => txt(value).replace(/\D/g, '');
const newKey = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

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

const stepLabels: { key: ManualStep; label: string }[] = [
  { key: 'data', label: '1. Dados' },
  { key: 'recipient', label: '2. Destinatário' },
  { key: 'items', label: '3. Produtos' },
  { key: 'taxes', label: '4. Tributação' },
  { key: 'transport', label: '5. Transporte' },
  { key: 'billing', label: '6. Cobrança' },
  { key: 'review', label: '7. Revisão' },
];

function productToItem(product: Row): ManualItem {
  const fiscal = obj(product.fiscal_profile);
  const icms = obj(fiscal.icms);
  const pis = obj(fiscal.pis);
  const cofins = obj(fiscal.cofins);
  return {
    key: newKey(),
    product_id: txt(product.id),
    code: txt(product.sku || product.code),
    description: txt(product.name),
    unit: txt(product.unit) || 'UN',
    quantity: '1',
    unit_price: txt(product.sale_price || product.price || 0),
    discount: '0',
    ncm: digits(product.ncm || fiscal.ncm),
    cest: digits(product.cest || fiscal.cest),
    cfop: digits(product.cfop_default || fiscal.cfop || fiscal.cfop_default),
    cfop_default: digits(product.cfop_default || fiscal.cfop || fiscal.cfop_default),
    cfop_manual: false,
    cfop_reason: 'Aguardando identificação do destino da operação.',
    origin: txt(product.origin ?? fiscal.origin ?? fiscal.origem ?? 0),
    icms_code: txt(icms.cst || icms.csosn || fiscal.icms_cst || fiscal.csosn),
    pis_cst: txt(pis.cst || fiscal.pis_cst),
    cofins_cst: txt(cofins.cst || fiscal.cofins_cst),
  };
}

function blankItem(): ManualItem {
  return {
    key: newKey(), product_id: '', code: '', description: '', unit: 'UN', quantity: '1', unit_price: '0', discount: '0',
    ncm: '', cest: '', cfop: '', cfop_default: '', cfop_manual: false, cfop_reason: 'Aguardando identificação do destino da operação.', origin: '0', icms_code: '', pis_cst: '', cofins_cst: '',
  };
}

export function NfeEmissionWorkspace({ settings, documents, sales, customers, products }: Props) {
  const [topTab, setTopTab] = useState<TopTab>('new');
  const [mode, setMode] = useState<Mode>('sale');
  const [manualStep, setManualStep] = useState<ManualStep>('data');
  const [docs, setDocs] = useState<Row[]>(documents);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const [saleId, setSaleId] = useState('');
  const [saleSeriesId, setSaleSeriesId] = useState('');

  const [seriesId, setSeriesId] = useState('');
  const [natureOperation, setNatureOperation] = useState('VENDA DE MERCADORIA');
  const [purpose, setPurpose] = useState('1');
  const [presence, setPresence] = useState('1');
  const [consumerFinal, setConsumerFinal] = useState(true);
  const [customerId, setCustomerId] = useState('');
  const [recipient, setRecipient] = useState({
    name: '', document: '', state_registration: '', email: '', street: '', number: '', complement: '', district: '', city: '', state: '', postal_code: '', ibge_city_code: '', indicator_ie: '9',
  });
  const [productId, setProductId] = useState('');
  const [items, setItems] = useState<ManualItem[]>([]);
  const [freightMode, setFreightMode] = useState('9');
  const [carrier, setCarrier] = useState({ name: '', document: '', state_registration: '', plate: '', state: '' });
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
  const cfopOptions = cfops.filter((row) => row.active !== false && ['5','6','7'].includes(txt(row.code).slice(0,1)) && (!currentPrefix || txt(row.code).startsWith(currentPrefix)));
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
        rules: cfopRules, cfops, productCfop: item.cfop_default, purpose, presence, emitterState, recipientState: recipient.state, consumerFinal, indicatorIe: recipient.indicator_ie,
      });
      return { ...item, cfop: resolution.code || item.cfop_default, cfop_reason: resolution.reason };
    }));
  }, [purpose, presence, consumerFinal, recipient.state, recipient.indicator_ie, emitterState, cfopRules, cfops, items.length]);

  function fillCustomer(id: string) {
    setCustomerId(id);
    const row = activeCustomers.find((customer) => txt(customer.id) === id);
    if (!row) return;
    setRecipient({
      name: txt(row.name), document: txt(row.document), state_registration: txt(row.state_registration), email: txt(row.email),
      street: txt(row.street), number: txt(row.number), complement: txt(row.complement), district: txt(row.district), city: txt(row.city),
      state: txt(row.state).toUpperCase(), postal_code: txt(row.postal_code), ibge_city_code: txt(row.ibge_city_code),
      indicator_ie: txt(row.state_registration) ? '1' : '9',
    });
  }

  function addProduct() {
    if (!productId) { setItems((current) => [...current, blankItem()]); return; }
    const product = activeProducts.find((row) => txt(row.id) === productId);
    if (!product) return;
    setItems((current) => [...current, productToItem(product)]);
    setProductId('');
  }

  function updateItem(key: string, field: keyof ManualItem, value: string) {
    setItems((current) => current.map((item) => item.key === key ? { ...item, [field]: value, ...(field === 'cfop' ? { cfop_manual: true, cfop_reason: 'CFOP alterado manualmente a partir do catálogo geral.' } : {}) } : item));
  }

  function resetItemCfop(key: string) {
    setItems((current) => current.map((item) => {
      if (item.key !== key) return item;
      const resolution = resolveCfopClient({ rules: cfopRules, cfops, productCfop: item.cfop_default, purpose, presence, emitterState, recipientState: recipient.state, consumerFinal, indicatorIe: recipient.indicator_ie });
      return { ...item, cfop_manual: false, cfop: resolution.code || item.cfop_default, cfop_reason: resolution.reason };
    }));
  }

  async function refreshDocuments() {
    const result = await erpFiscalDocuments();
    if (result.ok) setDocs(result.data);
  }

  async function createFromSale() {
    if (!saleId) { setMessage('Selecione uma venda concluída.'); return; }
    setBusy(true); setMessage('Validando a venda e preparando a NF-e...');
    const result = await fiscalPrepareV2(saleId, 'nfe', saleSeriesId || undefined);
    setBusy(false);
    if (!result.ok) { setMessage(txt(result.error) || 'Não foi possível preparar a NF-e.'); return; }
    setMessage(`NF-e ${txt(result.number)} série ${txt(result.series)} criada como rascunho.`);
    setSaleId(''); setSaleSeriesId('');
    await refreshDocuments();
    setTopTab('documents');
  }

  async function createManualDraft() {
    setBusy(true); setMessage('Validando todos os dados antes de reservar a numeração...');
    const payload: Row = {
      series_id: seriesId || null,
      operation: {
        nature_operation: natureOperation.trim(), purpose, presence, consumer_final: consumerFinal,
      },
      recipient: { ...recipient, document: digits(recipient.document), postal_code: digits(recipient.postal_code), ibge_city_code: digits(recipient.ibge_city_code) },
      items: items.map(({ key, ...item }) => ({
        ...item,
        ncm: digits(item.ncm), cest: digits(item.cest), cfop: digits(item.cfop),
        quantity: num(item.quantity), unit_price: num(item.unit_price), discount: num(item.discount), origin: num(item.origin),
      })),
      transport: { freight_mode: freightMode, carrier },
      billing: { payment_method: paymentMethod, installments: installments.map(({ key, ...row }) => ({ ...row, amount: num(row.amount) })) },
      totals: { freight: num(freight), insurance: num(insurance), other: num(other) },
      additional: { information: additionalInfo.trim() },
    };
    const result = await nfeManualDraftCreate(payload);
    setBusy(false);
    if (!result.ok) { setMessage(txt(result.error) || 'Não foi possível criar o rascunho da NF-e.'); return; }
    setManualSuccess(result);
    setMessage(`Rascunho NF-e ${txt(result.number)} série ${txt(result.series)} criado com sucesso.`);
    await refreshDocuments();
  }

  function resetManual() {
    setManualStep('data'); setSeriesId(''); setNatureOperation('VENDA DE MERCADORIA'); setPurpose('1'); setPresence('1'); setConsumerFinal(true);
    setCustomerId(''); setRecipient({ name: '', document: '', state_registration: '', email: '', street: '', number: '', complement: '', district: '', city: '', state: '', postal_code: '', ibge_city_code: '', indicator_ie: '9' });
    setProductId(''); setItems([]); setFreightMode('9'); setCarrier({ name: '', document: '', state_registration: '', plate: '', state: '' });
    setPaymentMethod('01'); setInstallments([{ key: newKey(), due_date: '', amount: '' }]); setFreight('0'); setInsurance('0'); setOther('0'); setAdditionalInfo(''); setManualSuccess(null); setMessage('');
  }

  return <div className="nfe-emission-stack">
    <section className="nfe-emission-hero">
      <div><span className="nfe-emission-eyebrow">THORFISCAL · NF-e MODELO 55</span><h2>Emissão de NF-e</h2><p>Emita por uma venda já concluída ou monte uma NF-e do zero em um fluxo guiado, sem misturar cadastro, histórico e configuração na mesma tela.</p></div>
      <div className={`nfe-emission-state ${operationalReady ? 'ready' : 'warning'}`}><b>{operationalReady ? 'Estrutura fiscal pronta' : 'Configuração pendente'}</b><small>{operationalReady ? `${environment} · série e certificado disponíveis` : 'Revise a configuração fiscal antes da emissão.'}</small></div>
    </section>

    <nav className="nfe-main-tabs" aria-label="Áreas da emissão de NF-e">
      <button className={topTab === 'new' ? 'active' : ''} onClick={() => setTopTab('new')}><b>＋</b><span>Nova NF-e<small>Venda ou preenchimento manual</small></span></button>
      <button className={topTab === 'documents' ? 'active' : ''} onClick={() => setTopTab('documents')}><b>▤</b><span>Documentos<small>Rascunhos, autorizadas e rejeitadas</small></span></button>
      <button className={topTab === 'config' ? 'active' : ''} onClick={() => setTopTab('config')}><b>⚙</b><span>Configuração<small>Emitente, série, A1 e ambiente</small></span></button>
    </nav>

    {message && <div className="nfe-global-message">{message}</div>}

    {topTab === 'new' && <section className="nfe-workspace-card">
      <div className="nfe-section-head"><div><span>NOVA NF-e</span><h3>Como deseja iniciar?</h3><p>Escolha a origem dos dados. Os dois caminhos geram o mesmo documento fiscal modelo 55.</p></div></div>
      <div className="nfe-mode-grid">
        <button className={mode === 'sale' ? 'active' : ''} onClick={() => { setMode('sale'); setMessage(''); }}><b>🛒</b><span><strong>A partir de uma venda</strong><small>Cliente, produtos, valores e pagamentos vêm da venda concluída.</small></span></button>
        <button className={mode === 'manual' ? 'active' : ''} onClick={() => { setMode('manual'); setMessage(''); }}><b>📝</b><span><strong>NF-e do zero</strong><small>Preencha destinatário, produtos, tributos, transporte e cobrança manualmente.</small></span></button>
      </div>

      {mode === 'sale' && <div className="nfe-sale-origin">
        <div className="nfe-form-grid three">
          <label className="wide">Venda concluída<select value={saleId} onChange={(e) => setSaleId(e.target.value)}><option value="">Selecione...</option>{completedSales.map((sale) => <option key={txt(sale.id)} value={txt(sale.id)}>Venda #{txt(sale.number || sale.sale_number)} · {txt(sale.customer || sale.customer_name || 'Consumidor')} · {money(sale.total)}</option>)}</select></label>
          <label>Série<select value={saleSeriesId} onChange={(e) => setSaleSeriesId(e.target.value)}><option value="">Série padrão</option>{nfeSeries.map((row) => <option key={txt(row.id)} value={txt(row.id)}>Série {txt(row.series)}{row.is_default ? ' · padrão' : ''}</option>)}</select></label>
          <div className="nfe-action-box"><button className="nfe-primary" disabled={busy || !saleId || !operationalReady} onClick={() => void createFromSale()}>{busy ? 'Preparando...' : 'Validar e criar rascunho'}</button><small>A numeração só é consumida depois das validações fiscais.</small></div>
        </div>
      </div>}

      {mode === 'manual' && <div className="nfe-manual-workspace">
        {manualSuccess ? <div className="nfe-success-card"><div className="nfe-success-icon">✓</div><div><span>RASCUNHO CRIADO</span><h3>NF-e {txt(manualSuccess.number)} · Série {txt(manualSuccess.series)}</h3><p>Total {money(manualSuccess.total)}. O documento foi salvo sem venda vinculada e está pronto para conferência.</p><div><button className="nfe-primary" onClick={() => setTopTab('documents')}>Ver documentos</button><button className="nfe-secondary" onClick={resetManual}>Criar outra NF-e</button></div></div></div> : <>
          <nav className="nfe-step-tabs">{stepLabels.map((step) => <button key={step.key} className={manualStep === step.key ? 'active' : ''} onClick={() => setManualStep(step.key)}>{step.label}</button>)}</nav>

          {manualStep === 'data' && <div className="nfe-step-panel"><div className="nfe-section-head compact"><div><span>DADOS DA NOTA</span><h3>Operação fiscal</h3></div></div><div className="nfe-form-grid three">
            <label className="wide">Natureza da operação<input value={natureOperation} onChange={(e) => setNatureOperation(e.target.value)} placeholder="Ex.: Venda de mercadoria" /></label>
            <label>Série<select value={seriesId} onChange={(e) => setSeriesId(e.target.value)}><option value="">Série padrão</option>{nfeSeries.map((row) => <option key={txt(row.id)} value={txt(row.id)}>Série {txt(row.series)}{row.is_default ? ' · padrão' : ''}</option>)}</select></label>
            <label>Finalidade<select value={purpose} onChange={(e) => setPurpose(e.target.value)}><option value="1">1 · Normal</option><option value="2">2 · Complementar</option><option value="3">3 · Ajuste</option><option value="4">4 · Devolução/Retorno</option></select></label>
            <label>Presença do comprador<select value={presence} onChange={(e) => setPresence(e.target.value)}><option value="0">Não se aplica</option><option value="1">Operação presencial</option><option value="2">Não presencial · Internet</option><option value="3">Não presencial · Teleatendimento</option><option value="5">Presencial · fora do estabelecimento</option><option value="9">Não presencial · outros</option></select></label>
            <label className="nfe-check"><input type="checkbox" checked={consumerFinal} onChange={(e) => setConsumerFinal(e.target.checked)} /><span>Consumidor final</span></label>
          </div><div className="nfe-step-footer"><span></span><button className="nfe-primary" onClick={() => setManualStep('recipient')}>Continuar →</button></div></div>}

          {manualStep === 'recipient' && <div className="nfe-step-panel"><div className="nfe-section-head compact"><div><span>DESTINATÁRIO</span><h3>Cliente e endereço fiscal</h3><p>Você pode carregar um cliente cadastrado e ajustar apenas o necessário para esta NF-e.</p></div></div><label className="nfe-catalog-select">Carregar cliente cadastrado<select value={customerId} onChange={(e) => fillCustomer(e.target.value)}><option value="">Preencher manualmente</option>{activeCustomers.map((customer) => <option key={txt(customer.id)} value={txt(customer.id)}>{txt(customer.name)} · {txt(customer.document)}</option>)}</select></label><div className="nfe-form-grid four">
            <label className="span2">Nome / Razão Social<input value={recipient.name} onChange={(e) => setRecipient({ ...recipient, name: e.target.value })} /></label><label>CPF/CNPJ<input value={recipient.document} onChange={(e) => setRecipient({ ...recipient, document: e.target.value })} /></label><label>Inscrição Estadual<input value={recipient.state_registration} onChange={(e) => setRecipient({ ...recipient, state_registration: e.target.value })} /></label>
            <label className="span2">Logradouro<input value={recipient.street} onChange={(e) => setRecipient({ ...recipient, street: e.target.value })} /></label><label>Número<input value={recipient.number} onChange={(e) => setRecipient({ ...recipient, number: e.target.value })} /></label><label>Complemento<input value={recipient.complement} onChange={(e) => setRecipient({ ...recipient, complement: e.target.value })} /></label>
            <label>Bairro<input value={recipient.district} onChange={(e) => setRecipient({ ...recipient, district: e.target.value })} /></label><label>Município<input value={recipient.city} onChange={(e) => setRecipient({ ...recipient, city: e.target.value })} /></label><label>UF<input maxLength={2} value={recipient.state} onChange={(e) => setRecipient({ ...recipient, state: e.target.value.toUpperCase() })} /></label><label>CEP<input value={recipient.postal_code} onChange={(e) => setRecipient({ ...recipient, postal_code: e.target.value })} /></label>
            <label>Código IBGE<input value={recipient.ibge_city_code} onChange={(e) => setRecipient({ ...recipient, ibge_city_code: e.target.value })} /></label><label>Indicador IE<select value={recipient.indicator_ie} onChange={(e) => setRecipient({ ...recipient, indicator_ie: e.target.value })}><option value="1">Contribuinte ICMS</option><option value="2">Contribuinte isento</option><option value="9">Não contribuinte</option></select></label><label className="span2">E-mail<input value={recipient.email} onChange={(e) => setRecipient({ ...recipient, email: e.target.value })} /></label>
          </div><div className="nfe-step-footer"><button className="nfe-secondary" onClick={() => setManualStep('data')}>← Voltar</button><button className="nfe-primary" onClick={() => setManualStep('items')}>Continuar →</button></div></div>}

          {manualStep === 'items' && <div className="nfe-step-panel"><div className="nfe-section-head compact"><div><span>PRODUTOS</span><h3>Itens da NF-e</h3><p>Carregue produtos do cadastro ou inclua uma linha em branco.</p></div><strong className="nfe-total-chip">Produtos: {money(productsTotal)}</strong></div><div className="nfe-add-line"><select value={productId} onChange={(e) => setProductId(e.target.value)}><option value="">Linha em branco / selecione produto</option>{activeProducts.map((product) => <option key={txt(product.id)} value={txt(product.id)}>{txt(product.sku)} · {txt(product.name)} · {money(product.sale_price)}</option>)}</select><button className="nfe-secondary" onClick={addProduct}>+ Adicionar item</button></div><div className="nfe-items-list">{items.length === 0 ? <div className="nfe-empty-state">Nenhum produto incluído.</div> : items.map((item, index) => <article className="nfe-item-card" key={item.key}><header><b>Item {index + 1}</b><button onClick={() => setItems((current) => current.filter((row) => row.key !== item.key))}>Remover</button></header><div className="nfe-form-grid six"><label className="span2">Descrição<input value={item.description} onChange={(e) => updateItem(item.key, 'description', e.target.value)} /></label><label>Código<input value={item.code} onChange={(e) => updateItem(item.key, 'code', e.target.value)} /></label><label>Unidade<input value={item.unit} onChange={(e) => updateItem(item.key, 'unit', e.target.value)} /></label><label>Quantidade<input type="number" step="0.001" value={item.quantity} onChange={(e) => updateItem(item.key, 'quantity', e.target.value)} /></label><label>Valor unitário<input type="number" step="0.01" value={item.unit_price} onChange={(e) => updateItem(item.key, 'unit_price', e.target.value)} /></label><label>Desconto<input type="number" step="0.01" value={item.discount} onChange={(e) => updateItem(item.key, 'discount', e.target.value)} /></label><label>NCM<input value={item.ncm} onChange={(e) => updateItem(item.key, 'ncm', e.target.value)} /></label><label>CEST<input value={item.cest} onChange={(e) => updateItem(item.key, 'cest', e.target.value)} /></label><label>CFOP<select value={item.cfop} onChange={(e) => updateItem(item.key, 'cfop', e.target.value)}><option value="">Selecione...</option>{cfopOptions.map((row) => <option key={txt(row.id)} value={txt(row.code)}>{txt(row.code)} · {txt(row.name)}</option>)}</select><small>{item.cfop_reason || `Destino: ${scopeLabel(currentScope)}`}</small>{item.cfop_manual && <button type="button" className="nfe-cfop-auto-reset" onClick={() => resetItemCfop(item.key)}>Usar automático</button>}</label><div className="nfe-line-total"><span>Total do item</span><strong>{money(Math.max(num(item.quantity) * num(item.unit_price) - num(item.discount), 0))}</strong></div></div></article>)}</div><div className="nfe-step-footer"><button className="nfe-secondary" onClick={() => setManualStep('recipient')}>← Voltar</button><button className="nfe-primary" onClick={() => setManualStep('taxes')}>Continuar →</button></div></div>}

          {manualStep === 'taxes' && <div className="nfe-step-panel"><div className="nfe-section-head compact"><div><span>TRIBUTAÇÃO</span><h3>Classificação fiscal por item</h3><p>Os valores carregados do produto continuam editáveis para a operação atual.</p></div></div><div className="nfe-items-list">{items.length === 0 ? <div className="nfe-empty-state">Inclua produtos antes de revisar a tributação.</div> : items.map((item, index) => <article className="nfe-item-card tax" key={item.key}><header><div><b>{index + 1}. {item.description || 'Item sem descrição'}</b><small>NCM {item.ncm || '—'} · CFOP {item.cfop || '—'}</small></div></header><div className="nfe-form-grid five"><label>Origem<select value={item.origin} onChange={(e) => updateItem(item.key, 'origin', e.target.value)}>{Array.from({ length: 9 }, (_, i) => <option value={String(i)} key={i}>{i}</option>)}</select></label><label>ICMS CST / CSOSN<input value={item.icms_code} onChange={(e) => updateItem(item.key, 'icms_code', e.target.value)} placeholder="Ex.: 00 ou 102" /></label><label>PIS CST<input value={item.pis_cst} onChange={(e) => updateItem(item.key, 'pis_cst', e.target.value)} placeholder="Ex.: 01" /></label><label>COFINS CST<input value={item.cofins_cst} onChange={(e) => updateItem(item.key, 'cofins_cst', e.target.value)} placeholder="Ex.: 01" /></label><label>CFOP<select value={item.cfop} onChange={(e) => updateItem(item.key, 'cfop', e.target.value)}><option value="">Selecione...</option>{cfopOptions.map((row) => <option key={txt(row.id)} value={txt(row.code)}>{txt(row.code)} · {txt(row.name)}</option>)}</select><small>{item.cfop_reason || `Destino: ${scopeLabel(currentScope)}`}</small>{item.cfop_manual && <button type="button" className="nfe-cfop-auto-reset" onClick={() => resetItemCfop(item.key)}>Usar automático</button>}</label></div></article>)}</div><div className="nfe-note"><b>CFOP automático:</b> o Thor cruza finalidade, presença, consumidor final e UF do destinatário com as regras cadastradas em Fiscal → CFOPs. Se não houver regra, tenta manter o CFOP padrão do produto ou localizar o equivalente 5.xxx/6.xxx/7.xxx no catálogo geral. A troca manual continua disponível por item.</div><div className="nfe-step-footer"><button className="nfe-secondary" onClick={() => setManualStep('items')}>← Voltar</button><button className="nfe-primary" onClick={() => setManualStep('transport')}>Continuar →</button></div></div>}

          {manualStep === 'transport' && <div className="nfe-step-panel"><div className="nfe-section-head compact"><div><span>TRANSPORTE</span><h3>Frete e transportadora</h3></div></div><div className="nfe-form-grid four"><label>Modalidade do frete<select value={freightMode} onChange={(e) => setFreightMode(e.target.value)}><option value="0">0 · Emitente</option><option value="1">1 · Destinatário</option><option value="2">2 · Terceiros</option><option value="3">3 · Próprio por conta do emitente</option><option value="4">4 · Próprio por conta do destinatário</option><option value="9">9 · Sem transporte</option></select></label><label className="span2">Transportadora<input value={carrier.name} onChange={(e) => setCarrier({ ...carrier, name: e.target.value })} /></label><label>CNPJ/CPF<input value={carrier.document} onChange={(e) => setCarrier({ ...carrier, document: e.target.value })} /></label><label>IE<input value={carrier.state_registration} onChange={(e) => setCarrier({ ...carrier, state_registration: e.target.value })} /></label><label>Placa<input value={carrier.plate} onChange={(e) => setCarrier({ ...carrier, plate: e.target.value.toUpperCase() })} /></label><label>UF veículo<input maxLength={2} value={carrier.state} onChange={(e) => setCarrier({ ...carrier, state: e.target.value.toUpperCase() })} /></label></div><div className="nfe-step-footer"><button className="nfe-secondary" onClick={() => setManualStep('taxes')}>← Voltar</button><button className="nfe-primary" onClick={() => setManualStep('billing')}>Continuar →</button></div></div>}

          {manualStep === 'billing' && <div className="nfe-step-panel"><div className="nfe-section-head compact"><div><span>COBRANÇA</span><h3>Pagamento, parcelas e valores acessórios</h3></div><strong className="nfe-total-chip">Total: {money(grandTotal)}</strong></div><div className="nfe-form-grid four"><label>Forma de pagamento<select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}><option value="01">Dinheiro</option><option value="03">Cartão de crédito</option><option value="04">Cartão de débito</option><option value="15">Boleto</option><option value="16">Depósito bancário</option><option value="17">PIX dinâmico</option><option value="20">PIX estático</option><option value="90">Sem pagamento</option><option value="99">Outros</option></select></label><label>Frete<input type="number" step="0.01" value={freight} onChange={(e) => setFreight(e.target.value)} /></label><label>Seguro<input type="number" step="0.01" value={insurance} onChange={(e) => setInsurance(e.target.value)} /></label><label>Outras despesas<input type="number" step="0.01" value={other} onChange={(e) => setOther(e.target.value)} /></label></div><div className="nfe-installments"><header><div><strong>Duplicatas / parcelas</strong><small>Opcional no rascunho fiscal.</small></div><button className="nfe-secondary" onClick={() => setInstallments((current) => [...current, { key: newKey(), due_date: '', amount: '' }])}>+ Parcela</button></header>{installments.map((row, index) => <div className="nfe-installment-row" key={row.key}><span>{index + 1}</span><input type="date" value={row.due_date} onChange={(e) => setInstallments((current) => current.map((it) => it.key === row.key ? { ...it, due_date: e.target.value } : it))} /><input type="number" step="0.01" placeholder="Valor" value={row.amount} onChange={(e) => setInstallments((current) => current.map((it) => it.key === row.key ? { ...it, amount: e.target.value } : it))} /><button onClick={() => setInstallments((current) => current.length === 1 ? current : current.filter((it) => it.key !== row.key))}>×</button></div>)}</div><label className="nfe-textarea-label">Informações adicionais<textarea rows={4} value={additionalInfo} onChange={(e) => setAdditionalInfo(e.target.value)} placeholder="Informações complementares de interesse do contribuinte ou do Fisco." /></label><div className="nfe-step-footer"><button className="nfe-secondary" onClick={() => setManualStep('transport')}>← Voltar</button><button className="nfe-primary" onClick={() => setManualStep('review')}>Revisar NF-e →</button></div></div>}

          {manualStep === 'review' && <div className="nfe-step-panel"><div className="nfe-section-head compact"><div><span>REVISÃO FINAL</span><h3>Conferência antes de reservar número</h3><p>Nenhuma numeração foi consumida até este momento.</p></div></div><div className="nfe-review-grid"><article><span>Operação</span><strong>{natureOperation || '—'}</strong><small>Finalidade {purpose} · {consumerFinal ? 'Consumidor final' : 'Não consumidor final'}</small></article><article><span>Destinatário</span><strong>{recipient.name || '—'}</strong><small>{recipient.document || 'Documento não informado'} · {recipient.city || '—'}/{recipient.state || '—'}</small></article><article><span>Produtos</span><strong>{items.length} item(ns)</strong><small>{money(productsTotal)}</small></article><article><span>Transporte</span><strong>Modalidade {freightMode}</strong><small>{carrier.name || 'Sem transportadora informada'}</small></article><article><span>Total da NF-e</span><strong>{money(grandTotal)}</strong><small>Frete {money(freight)} · Seguro {money(insurance)} · Outros {money(other)}</small></article><article><span>Ambiente</span><strong>{environment}</strong><small>Série {txt(nfeSeries.find((row) => txt(row.id) === seriesId)?.series || settings.nfe_series || nfeSeries[0]?.series || '—')}</small></article></div><div className="nfe-review-warning"><b>Transmissão SEFAZ modelo 55 ainda bloqueada.</b><span>Esta ação cria o rascunho completo e reserva série/número. O envio será liberado somente após o transporte NF-e passar pela homologação técnica.</span></div><div className="nfe-step-footer"><button className="nfe-secondary" onClick={() => setManualStep('billing')}>← Voltar</button><button className="nfe-primary" disabled={busy || !operationalReady} onClick={() => void createManualDraft()}>{busy ? 'Validando e salvando...' : 'Criar rascunho da NF-e'}</button></div></div>}
        </>}
      </div>}
    </section>}

    {topTab === 'documents' && <section className="nfe-documents-tab"><div className="nfe-section-head"><div><span>DOCUMENTOS</span><h3>Histórico de NF-e</h3><p>Consulte rascunhos manuais, notas originadas de vendas, autorizações, rejeições e arquivos fiscais.</p></div><button className="nfe-secondary" onClick={() => { setTopTab('new'); setMode('manual'); }}>+ Nova NF-e</button></div><FiscalDocumentsWorkspace key={documentKey} initialDocs={docs} sales={sales} settings={settings} initialType="nfe" /></section>}

    {topTab === 'config' && <div className="nfe-config-tab">
      <section className="nfe-readiness-grid" aria-label="Prontidão para emissão de NF-e">
        <article className={baseReady ? 'ok' : 'attention'}><span>Emitente</span><strong>{txt(issuer.cnpj) || 'CNPJ não informado'}</strong><small>{[txt(issuer.city), txt(issuer.state)].filter(Boolean).join(' / ') || 'Endereço fiscal incompleto'}</small></article>
        <article className={certificate && !certExpired ? 'ok' : 'attention'}><span>Certificado A1</span><strong>{certificate && !certExpired ? 'Configurado' : certExpired ? 'Vencido' : 'Pendente'}</strong><small>{certificate ? txt(certificate.subject_cn) || txt(certificate.filename) : 'Necessário para assinatura digital'}</small></article>
        <article className={nfeNumberingReady ? 'ok' : 'attention'}><span>Série NF-e</span><strong>{nfeNumberingReady ? `${nfeSeries.length} ativa(s)` : 'Não configurada'}</strong><small>{nfeNumberingReady ? `Padrão: ${txt(settings.nfe_series) || txt(nfeSeries[0]?.series)}` : 'Cadastre uma série do modelo 55'}</small></article>
        <article className="info"><span>Ambiente</span><strong>{environment}</strong><small>{environment === 'Produção' ? 'Documentos com validade fiscal' : 'Ambiente seguro para testes'}</small></article>
        <article className="transport"><span>Transmissão SEFAZ</span><strong>Modelo 55 em homologação técnica</strong><small>O ThorGestão mantém NF-e separada do transporte NFC-e.</small></article>
      </section>
      {(!operationalReady || missing.length > 0) && <section className="nfe-pending-card"><div><span>PRONTIDÃO FISCAL</span><h3>Ajustes antes de emitir</h3></div><div className="nfe-pending-list">{missing.map((item) => <span key={item}>{missingLabels[item] || item}</span>)}{!nfeNumberingReady && <span>Série e numeração da NF-e</span>}</div></section>}
      <section className="nfe-config-links"><Link href="/dashboard/administrativo/empresas"><b>🏢</b><span><strong>Emitente / Matriz</strong><small>CNPJ, IE, CRT e endereço.</small></span></Link><Link href="/dashboard/fiscal/series"><b>№</b><span><strong>Séries e numeração</strong><small>Série padrão e última numeração.</small></span></Link><Link href="/dashboard/fiscal/certificado"><b>🔐</b><span><strong>Certificado A1</strong><small>Assinatura digital e validade.</small></span></Link><Link href="/dashboard/fiscal/cfops"><b>↔</b><span><strong>CFOPs</strong><small>Tabela de operações fiscais.</small></span></Link><Link href="/dashboard/fiscal"><b>⚙</b><span><strong>Central Fiscal</strong><small>Demais configurações do ThorFiscal.</small></span></Link></section>
    </div>}
  </div>;
}
