import './erp.css';
import './forms.css';
import './organization.css';
import './fiscal.css';
import './fiscal-configuration.css';
import './fiscal-documents.css';
import './nfe-emission.css';
import './fiscal-center.css';
import './reconciliation.css';
import './cash.css';
import './products.css';
import './stock.css';
import './production.css';
import './price-tables.css';
import './audit.css';
import './sales-cash.css';
import './reports.css';
import './purchase-xml.css';
import { erpLoad } from './actions';
import { AdvancedShell } from './advanced-shell';
import { ModuleClient } from './module-client';
import { ProductMasterWorkspace } from './product-master-workspace';
import { ProductionWorkspace } from './production-workspace';
import { erpProductionOrders } from './production-actions';
import { ManagementAuditWorkspace } from './management-audit-workspace';
import { erpManagementAudit } from './audit-actions';
import { SalesCashWorkspace } from './sales-cash-workspace';
import { SaleWorkspace } from './sale-workspace-v070';
import { PdvProfileWorkspace } from './pdv-profile-workspace';
import { OperatorWorkspace } from './operator-workspace';
import { listPdvOperators } from './operator-actions';
import { PromotionWorkspace } from './promotion-workspace';
import { PriceAdjustmentWorkspace } from './price-adjustment-workspace';
import { StockWorkspace } from './stock-workspace';
import { StockTransferClient } from './stock-transfer-client';
import { InventoryClient } from './inventory-client';
import { PriceTableWorkspace } from './price-table-workspace';
import { HeadquartersWorkspace } from './headquarters-workspace';
import { headquartersGet } from './headquarters-actions';
import { BranchesWorkspace } from './branches-workspace';
import { erpLicenseGet } from './branch-license-actions';
import { BranchConfigWorkspace } from './branch-config-workspace';
import { SmartPosPairingPanel } from './smartpos-pairing-panel';
import { CashWorkspace } from './cash-workspace';
import { FiscalCenterWorkspace } from './fiscal-center-workspace';
import { FiscalConfigSectionWorkspace, type FiscalSection } from './fiscal-config-section-workspace';
import { FiscalCertificateWorkspace } from './fiscal-certificate-workspace';
import { FiscalDocumentsWorkspace } from './fiscal-documents-workspace';
import { NfeEmissionWorkspace } from './nfe-emission-workspace';
import { erpFiscalDocuments } from './fiscal-transmit-actions';
import { ReconciliationWorkspace } from './reconciliation-workspace';
import { reconciliationData } from './reconciliation-actions';
import { ReportsClient } from './reports-client';
import { erpFiscalSettingsGet } from './fiscal-settings-actions';
import { erpProductList } from './product-actions';
import { PurchaseXmlWorkspace } from './purchase-xml-workspace';
import { purchaseXmlContext } from './purchase-xml-actions';
import { financialStructureGet } from './financial-structure-actions';

const resourceBySlug:Record<string,string>={
  produtos:'products',clientes:'customers',fornecedores:'suppliers',grupos:'groups',classes:'classes',marcas:'brands','produtos/unidades':'units','produtos/atributos':'attributes',
  'tabelas-precos':'price_tables','tabelas-precos/copiar':'price_tables',promocoes:'promotions',
  estoque:'stock_movements','estoque/nova':'stock_movements','estoque/ajustes':'stock_movements','estoque/transferencias':'stock_movements','estoque/inventario':'stock_movements',
  vendas:'sales','vendas/nova':'sales','pedidos-venda':'sales_orders',
  compras:'purchases','compras/xml':'purchases','contas-receber':'receivables','contas-pagar':'payables',
  'financeiro/contas':'financial_accounts','financeiro/conciliacao':'reconciliation','financeiro/plano-contas':'financial_chart_accounts','financeiro/categorias':'financial_categories','financeiro/centros-custo':'cost_centers',
  'administrativo/filiais':'branches','administrativo/empresas':'companies','usuarios-pdv':'pdv_users','perfis-pdv':'profiles_pdv',
  'documentos-fiscais':'fiscal_documents',configuracoes:'settings',
};

const fiscalSectionBySlug:Record<string,{title:string;subtitle:string;section:FiscalSection}>={
  'fiscal/emitente':{title:'Emitente Fiscal',subtitle:'Dados cadastrais e fiscais utilizados na emissão.',section:'issuer'},
  'fiscal/nfce-config':{title:'NFC-e / CSC',subtitle:'Ambiente, CSC e parâmetros de segurança da NFC-e.',section:'nfce'},
  'fiscal/series':{title:'Séries e Numeração',subtitle:'Séries ativas de NF-e e NFC-e e sequência fiscal.',section:'series'},
  'fiscal/caixas':{title:'Caixas × Série',subtitle:'Vincule terminais/PDVs às séries NFC-e exclusivas.',section:'pos'},
  'fiscal/danfe':{title:'DANFE / Impressão',subtitle:'Parâmetros de impressão e formação da descrição dos produtos.',section:'danfe'},
  'fiscal/cfops':{title:'CFOPs',subtitle:'Tabela de CFOPs disponíveis no cadastro e nas operações fiscais.',section:'cfops'},
};

export default async function ModulePage({ params }: { params: Promise<{ slug: string[] }> }) {
  const resolved = await params;
  const slug = resolved.slug.join('/');
  const resource = resourceBySlug[slug] ?? 'products';
  const initial = await erpLoad(resource);
  const [products, customers, groups, classes, branches, profilesPdv, profilesAdm, priceTables, suppliers, modifiers] = await Promise.all([
    erpLoad('products'), erpLoad('customers'), erpLoad('groups'), erpLoad('classes'), erpLoad('branches'),
    erpLoad('profiles_pdv'), erpLoad('profiles_adm'), erpLoad('price_tables'), erpLoad('suppliers'), erpLoad('modifiers'),
  ]);

  if (slug === 'produtos' || slug === 'produtos/novo') {
    const productList = await erpProductList();
    return <AdvancedShell title="Cadastro de Produtos" subtitle="Cadastro completo integrado a preços, tributação, estoque, ficha técnica, produção, balança e PDV." activePath="/dashboard/produtos"><ProductMasterWorkspace initialProducts={productList.data} groups={groups.data} classes={classes.data} suppliers={suppliers.data} modifiers={modifiers.data} branches={branches.data}/></AdvancedShell>;
  }
  if (slug === 'estoque/producao') {
    const orders=await erpProductionOrders();
    return <AdvancedShell title="Produção / Cozinha" subtitle="Comandas geradas automaticamente pelas vendas de produtos configurados como produção sob demanda." activePath="/dashboard/estoque/producao"><ProductionWorkspace initial={orders.data}/></AdvancedShell>;
  }
  if (slug === 'administrativo/auditoria') {
    const audit=await erpManagementAudit({});
    return <AdvancedShell title="Auditoria Gerencial" subtitle="Rastreabilidade de descontos, cancelamentos, devoluções, estornos, autorizações, caixa e alterações de preço." activePath="/dashboard/administrativo/auditoria"><ManagementAuditWorkspace initialEvents={audit.data} initialSummary={audit.summary} initialPagination={audit.pagination} permissions={audit.permissions} branches={audit.branches} operators={audit.operators}/></AdvancedShell>;
  }
  if (slug === 'vendas') return <AdvancedShell title="Vendas" subtitle="Operações de caixa, vendas, fechamentos, histórico e correções por unidade, PDV e operador." activePath="/dashboard/vendas"><SalesCashWorkspace/></AdvancedShell>;
  if (slug === 'vendas/nova') return <AdvancedShell title="Nova Venda PDV" subtitle="Preço resolvido no servidor, baixa de estoque, pagamento, caixa e financeiro em uma única operação." activePath="/dashboard/vendas/nova"><SaleWorkspace customers={customers.data} priceTables={priceTables.data}/></AdvancedShell>;
  if (slug === 'perfis-pdv') return <AdvancedShell title="Perfis de Usuário PDV" subtitle="Alçadas e permissões sincronizadas com os operadores do ThorPDV Desktop." activePath="/dashboard/perfis-pdv"><PdvProfileWorkspace initialProfiles={profilesPdv.data}/></AdvancedShell>;
  if (slug === 'usuarios-pdv') {
    const operators=await listPdvOperators();
    return <AdvancedShell title="Usuários PDV / Operadores" subtitle="Cadastre operadores, associe perfis e unidades, defina PIN e comissão sobre vendas." activePath="/dashboard/usuarios-pdv"><OperatorWorkspace initialUsers={operators.data} profiles={profilesPdv.data} branches={branches.data}/></AdvancedShell>;
  }
  if (slug === 'promocoes') return <AdvancedShell title="Promoções" subtitle="Regras comerciais aplicadas automaticamente pelo motor de preço da venda." activePath="/dashboard/promocoes"><PromotionWorkspace initial={initial.data} products={products.data} groups={groups.data}/></AdvancedShell>;
  if (slug === 'tabelas-precos/ajustes') return <AdvancedShell title="Ajustes Programados" subtitle="Agende aumentos/reduções e execute imediatamente quando necessário." activePath="/dashboard/tabelas-precos/ajustes"><PriceAdjustmentWorkspace initial={initial.data} priceTables={priceTables.data}/></AdvancedShell>;
  if (slug === 'estoque' || slug === 'estoque/nova') return <AdvancedShell title="Gestão de Estoque" subtitle="Entradas, saídas, perdas e ajustes com validação de saldo." activePath="/dashboard/estoque"><StockWorkspace products={products.data} history={initial.data}/></AdvancedShell>;
  if (slug === 'estoque/ajustes') return <AdvancedShell title="Ajustes de Estoque" subtitle="Correções de saldo com histórico e rastreabilidade." activePath="/dashboard/estoque/ajustes"><StockWorkspace products={products.data} history={initial.data} mode="adjustment"/></AdvancedShell>;
  if (slug === 'estoque/transferencias') return <AdvancedShell title="Transferências de Estoque" subtitle="Movimente produtos entre unidades com dupla escrituração de estoque." activePath="/dashboard/estoque/transferencias"><StockTransferClient products={products.data} branches={branches.data} history={initial.data}/></AdvancedShell>;
  if (slug === 'estoque/inventario') return <AdvancedShell title="Inventários" subtitle="Contagem física, diferenças e ajuste automático de estoque." activePath="/dashboard/estoque/inventario"><InventoryClient inventories={initial.data}/></AdvancedShell>;
  if (slug === 'tabelas-precos' || slug === 'tabelas-precos/copiar') return <AdvancedShell title={slug.endsWith('copiar')?'Copiar Tabela de Preços':'Gestão de Tabelas de Preços'} subtitle="Preços específicos por produto, vigência, edição e cópia integral de tabelas." activePath={`/dashboard/${slug}`}><PriceTableWorkspace initialTables={priceTables.data} products={products.data} copyMode={slug.endsWith('copiar')}/></AdvancedShell>;
  if (slug === 'administrativo/empresas') {
    const matrix=await headquartersGet();
    return <AdvancedShell title="Matriz" subtitle="Cadastro mestre da empresa, do estabelecimento principal e do emitente fiscal utilizado pelo ThorPDV e ThorFiscal." activePath="/dashboard/administrativo/empresas"><HeadquartersWorkspace initial={matrix as Record<string,unknown>}/></AdvancedShell>;
  }
  if (slug === 'administrativo/filiais') {
    const license=await erpLicenseGet();
    return <AdvancedShell title="Lojas / Filiais" subtitle="Gerencie unidades adicionais conforme o limite contratado no ThorControl. A Matriz permanece como estabelecimento principal." activePath="/dashboard/administrativo/filiais"><BranchesWorkspace initialBranches={branches.data} license={license as unknown as Record<string,unknown>}/></AdvancedShell>;
  }
  if (slug === 'configuracoes') return <AdvancedShell title="Configurações da Operação" subtitle="Terminais, parâmetros do PDV, tributos operacionais, entrega, SmartPOS e integrações. Dados cadastrais do emitente ficam exclusivamente em Matriz." activePath="/dashboard/configuracoes"><div className="erp-org-grid">{branches.data.length?<><BranchConfigWorkspace branches={branches.data}/><SmartPosPairingPanel branches={branches.data}/></>:<section className="erp-module-card erp-advanced-panel"><h2>Nenhuma unidade cadastrada</h2><p>Configure a Matriz antes de habilitar a operação.</p></section>}</div></AdvancedShell>;
  if (slug === 'pdv/caixa') return <AdvancedShell title="Caixa / PDV" subtitle="Abertura, vendas vinculadas e fechamento com valor esperado e diferença por terminal." activePath="/dashboard/administrativo/pdvs"><CashWorkspace posRegisters={initial.data}/></AdvancedShell>;
  if (slug === 'fiscal') {
    const settings=await erpFiscalSettingsGet();
    return <AdvancedShell title="Fiscal" subtitle="Central das configurações fiscais da empresa e das filiais." activePath="/dashboard/fiscal"><FiscalCenterWorkspace settings={(settings.settings??{}) as Record<string,unknown>}/></AdvancedShell>;
  }
  if (fiscalSectionBySlug[slug]) {
    const target=fiscalSectionBySlug[slug];
    const settings=await erpFiscalSettingsGet();
    return <AdvancedShell title={target.title} subtitle={target.subtitle} activePath={`/dashboard/${slug}`} backHref="/dashboard/fiscal" backLabel="Fiscal"><FiscalConfigSectionWorkspace settings={(settings.settings??{}) as Record<string,unknown>} section={target.section}/></AdvancedShell>;
  }
  if (slug === 'fiscal/certificado') {
    const settings=await erpFiscalSettingsGet();
    return <AdvancedShell title="Certificado Digital A1" subtitle="Certificado utilizado para assinatura fiscal e comunicação segura com a SEFAZ." activePath="/dashboard/fiscal/certificado" backHref="/dashboard/fiscal" backLabel="Fiscal"><FiscalCertificateWorkspace settings={(settings.settings??{}) as Record<string,unknown>}/></AdvancedShell>;
  }
  if (slug === 'fiscal/nfe') {
    const [settings,sales,documents]=await Promise.all([erpFiscalSettingsGet(),erpLoad('sales'),erpFiscalDocuments()]);
    return <AdvancedShell title="Emissão de NF-e" subtitle="NF-e modelo 55 por venda ou preenchimento manual, com validação fiscal, série, destinatário, itens e acompanhamento." activePath="/dashboard/fiscal/nfe" backHref="/dashboard/fiscal" backLabel="Fiscal"><NfeEmissionWorkspace documents={documents.data as Record<string,unknown>[]} sales={sales.data as Record<string,unknown>[]} customers={customers.data as Record<string,unknown>[]} products={products.data as Record<string,unknown>[]} settings={(settings.settings??{}) as Record<string,unknown>}/></AdvancedShell>;
  }
  if (slug === 'documentos-fiscais' || slug === 'fiscal/nfce') {
    const [settings,sales,documents]=await Promise.all([erpFiscalSettingsGet(),erpLoad('sales'),erpFiscalDocuments()]);
    const initialType=slug.endsWith('/nfce')?'nfce':'all';
    return <AdvancedShell title="Documentos Fiscais" subtitle="Emissão e acompanhamento de NF-e e NFC-e, status SEFAZ, protocolos, XML, DANFE e cancelamentos." activePath="/dashboard/documentos-fiscais"><FiscalDocumentsWorkspace initialDocs={documents.data} sales={sales.data} settings={(settings.settings??{}) as Record<string,unknown>} initialType={initialType}/></AdvancedShell>;
  }
  if (slug === 'compras/xml') {
    const [context,structure]=await Promise.all([purchaseXmlContext(),financialStructureGet()]);
    return <AdvancedShell title="Entrada NF-e por XML" subtitle="Importe XML da NF-e, valide destinatário, converta unidades, defina preços e gere estoque e financeiro." activePath="/dashboard/compras/xml"><PurchaseXmlWorkspace context={context} categories={structure.categories} chartAccounts={structure.chart_accounts} costCenters={structure.cost_centers}/></AdvancedShell>;
  }
  if (slug === 'financeiro/conciliacao') {
    const reconciliation = await reconciliationData();
    return <AdvancedShell title="Conciliação Financeira" subtitle="Movimentos bancários conciliados com contas a receber/pagar e baixa automática dos títulos." activePath="/dashboard/financeiro/conciliacao"><ReconciliationWorkspace initial={reconciliation}/></AdvancedShell>;
  }
  if (slug === 'relatorios/vendas') return <AdvancedShell title="Relatório de Vendas PDV" subtitle="Faturamento e quantidade por produto, período e unidade." activePath="/dashboard/relatorios/vendas"><ReportsClient type="sales" branches={branches.data} initial={initial.data}/></AdvancedShell>;
  if (slug === 'relatorios/financeiro' || slug === 'financeiro/fluxo-caixa') return <AdvancedShell title={slug.startsWith('relatorios')?'Relatório Financeiro':'Fluxo de Caixa'} subtitle="Entradas, saídas, realizado e previsto por período e unidade." activePath={slug.startsWith('relatorios')?'/dashboard/relatorios/financeiro':'/dashboard/financeiro/fluxo-caixa'}><ReportsClient type="finance" branches={branches.data} initial={initial.data}/></AdvancedShell>;
  if (slug === 'relatorios/estoque') return <AdvancedShell title="Relatório de Estoque" subtitle="Saldo, estoque mínimo, custo e valor por unidade." activePath="/dashboard/relatorios/estoque"><ReportsClient type="stock" branches={branches.data} initial={initial.data}/></AdvancedShell>;

  return <ModuleClient slug={slug} resource={resource} initialData={initial.data} lookups={{
    products: products.data, customers: customers.data, groups: groups.data, classes: classes.data, branches: branches.data,
    profiles_pdv: profilesPdv.data, profiles_adm: profilesAdm.data, price_tables: priceTables.data, suppliers: suppliers.data,
  }} />;
}
