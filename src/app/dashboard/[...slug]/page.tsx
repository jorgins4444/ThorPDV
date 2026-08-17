import './module.css';
import './advanced.css';
import './price-table.css';
import './sale.css';
import './promotion.css';
import './organization.css';
import './fiscal.css';
import './fiscal-configuration.css';
import './fiscal-documents.css';
import './fiscal-center.css';
import './reconciliation.css';
import './cash.css';
import './sales-cash.css';
import './management-audit.css';
import './operator-admin.css';
import './pdv-profile.css';
import './product-workspace.css';
import './product-master.css';
import './production.css';
import './branch-config.css';
import './branches-workspace.css';
import './receivables-print-fix.css';
import { ModuleClient } from './module-client';
import { AdvancedShell } from './advanced-shell';
import { InventoryClient, ReportsClient, StockTransferClient } from './advanced-clients';
import { PriceTableWorkspace } from './price-table-workspace';
import { PriceAdjustmentWorkspace } from './price-adjustment-workspace';
import { PromotionWorkspace } from './promotion-workspace';
import { SaleWorkspace } from './sale-workspace';
import { StockWorkspace } from './stock-workspace';
import { HeadquartersWorkspace } from './headquarters-workspace';
import { headquartersGet } from './headquarters-actions';
import { BranchConfigWorkspace } from './branch-config-workspace';
import { BranchesWorkspace } from './branches-workspace';
import { erpLicenseGet } from './license-actions';
import { SmartPosPairingPanel } from './smartpos-pairing-panel';
import { FiscalCenterWorkspace } from './fiscal-center-workspace';
import { FiscalConfigSectionWorkspace, type FiscalSection } from './fiscal-config-section-workspace';
import { FiscalCertificateWorkspace } from './fiscal-certificate-workspace';
import { FiscalDocumentsWorkspace } from './fiscal-documents-workspace';
import { erpFiscalDocuments } from './fiscal-transmit-actions';
import { ReconciliationWorkspace } from './reconciliation-workspace';
import { CashWorkspace } from './cash-workspace';
import { SalesCashWorkspace } from './sales-cash-workspace';
import { ManagementAuditWorkspace } from './management-audit-workspace';
import { OperatorWorkspace } from './operator-workspace';
import { PdvProfileWorkspace } from './pdv-profile-workspace';
import { ProductMasterWorkspace } from './product-master-workspace';
import { ProductionWorkspace } from './production-workspace';
import { reconciliationData } from './reconciliation-actions';
import { listPdvOperators } from './operator-actions';
import { erpFiscalSettingsGet, erpLoad, erpManagementAudit, erpProductList, erpProductionOrders } from './actions';

const resourceBySlug: Record<string, string> = {
  'clientes': 'customers', 'clientes/novo': 'customers', 'fornecedores': 'suppliers',
  'perfis-pdv': 'profiles_pdv', 'usuarios-pdv': 'users_pdv', 'perfis-adm': 'profiles_adm', 'usuarios-adm': 'users_adm',
  'produtos': 'products', 'produtos/novo': 'products', 'grupos': 'groups', 'classes': 'classes', 'modificadores': 'modifiers',
  'tabelas-precos': 'price_tables', 'tabelas-precos/copiar': 'price_tables', 'tabelas-precos/ajustes': 'price_adjustments', 'promocoes': 'promotions',
  'estoque': 'stock', 'estoque/nova': 'stock', 'estoque/inventario': 'inventory_counts', 'estoque/ajustes': 'stock', 'estoque/transferencias': 'stock', 'estoque/producao':'products',
  'financeiro/receber': 'finance', 'financeiro/receber/novo': 'finance', 'financeiro/pagar': 'finance', 'financeiro/pagar/novo': 'finance',
  'financeiro/fluxo-caixa': 'report_finance', 'financeiro/conciliacao': 'finance',
  'administrativo/empresas': 'companies', 'administrativo/filiais': 'branches', 'administrativo/pdvs': 'pos_registers',
  'fiscal': 'branches', 'fiscal/emitente':'branches', 'fiscal/nfce-config':'branches', 'fiscal/series':'branches', 'fiscal/caixas':'branches', 'fiscal/danfe':'branches', 'fiscal/cfops':'branches', 'fiscal/certificado':'branches',
  'documentos-fiscais':'fiscal_documents', 'fiscal/nfe':'fiscal_documents', 'fiscal/nfce':'fiscal_documents', 'integracoes': 'integrations', 'configuracoes': 'branches',
  'relatorios/financeiro': 'report_finance', 'relatorios/vendas': 'report_sales', 'relatorios/estoque': 'report_stock', 'relatorios/listagens': 'products',
  'atendimento': 'tickets', 'atendimento/mensagens': 'tickets', 'atendimento/sla': 'tickets',
  'vendas': 'sales', 'vendas/nova': 'sales', 'pdv/caixa': 'pos_registers', 'ajuda': 'companies',
};

const fiscalSectionBySlug:Record<string,{section:FiscalSection;title:string;subtitle:string}>={
  'fiscal/emitente':{section:'emitente',title:'Emitente Fiscal',subtitle:'Dados cadastrais e fiscais da Matriz utilizados na emissão de NF-e e NFC-e.'},
  'fiscal/nfce-config':{section:'nfce',title:'NFC-e / CSC',subtitle:'Ambiente de emissão, ID CSC e token de segurança fornecido pela SEFAZ.'},
  'fiscal/series':{section:'series',title:'Séries e Numeração',subtitle:'Séries fiscais de NF-e e NFC-e, sequência numérica, status e série padrão.'},
  'fiscal/caixas':{section:'caixas',title:'Caixas × Série Fiscal',subtitle:'Vincule cada terminal do PDV à série correta de NFC-e com exclusividade de numeração.'},
  'fiscal/danfe':{section:'danfe',title:'DANFE / Impressão',subtitle:'Parâmetros de apresentação e impressão dos itens no documento auxiliar.'},
  'fiscal/cfops':{section:'cfops',title:'CFOPs',subtitle:'Cadastro e manutenção dos CFOPs utilizados em produtos e operações fiscais.'},
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
    return <AdvancedShell title="Auditoria Gerencial" subtitle="Rastreabilidade de descontos, cancelamentos, devoluções, estornos, autorizações, caixa e alterações de preço." activePath="/dashboard/administrativo/auditoria"><ManagementAuditWorkspace initialEvents={audit.data} initialSummary={audit.summary} branches={audit.branches} operators={audit.operators}/></AdvancedShell>;
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
  if (slug === 'documentos-fiscais' || slug === 'fiscal/nfe' || slug === 'fiscal/nfce') {
    const [settings,sales,documents]=await Promise.all([erpFiscalSettingsGet(),erpLoad('sales'),erpFiscalDocuments()]);
    const initialType=slug.endsWith('/nfce')?'nfce':slug.endsWith('/nfe')?'nfe':'all';
    return <AdvancedShell title="Documentos Fiscais" subtitle="Emissão e acompanhamento de NF-e e NFC-e, status SEFAZ, protocolos, XML, DANFE e cancelamentos." activePath="/dashboard/documentos-fiscais"><FiscalDocumentsWorkspace initialDocs={documents.data} sales={sales.data} settings={(settings.settings??{}) as Record<string,unknown>} initialType={initialType}/></AdvancedShell>;
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