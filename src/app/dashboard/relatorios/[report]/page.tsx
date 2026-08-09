import { notFound } from 'next/navigation';
import { AdvancedShell } from '../../[...slug]/advanced-shell';
import { ReportWorkspace } from '../../[...slug]/report-workspace';
import { erpReportV2 } from '../../[...slug]/report-actions';
import { erpLoad } from '../../[...slug]/actions';
import '../../[...slug]/module.css';
import '../../[...slug]/report-v2.css';
import '../../[...slug]/management-shell.css';

const reports: Record<string,{type:string;title:string;subtitle:string}> = {
  'fechamento-caixa':{type:'cash_closures',title:'Relatório de Fechamento de Caixa',subtitle:'Resumo por sessão, operador, PDV, vendas, movimentações e diferença de caixa.'},
  'fechamento-caixa-detalhado':{type:'cash_closures_detailed',title:'Relatório Detalhado de Fechamento de Caixa',subtitle:'Conferência das formas de pagamento, suprimentos, sangrias, devoluções e valores contados.'},
  'estoque':{type:'stock_movements',title:'Relatório de Estoque',subtitle:'Histórico de entradas, saídas, vendas, perdas, ajustes e transferências.'},
  'posicao-estoque':{type:'stock_position',title:'Posição de Estoque',subtitle:'Saldo físico, reservado, disponível, mínimo e valorização atual por filial.'},
  'inventario':{type:'inventory',title:'Relatório de Inventário',subtitle:'Esperado, contado e diferenças registradas nos inventários.'},
  'ranking-produtos':{type:'product_ranking',title:'Ranking de Produtos Mais Vendidos',subtitle:'Ranking por quantidade, vendas e faturamento no período.'},
  'produtos-forma-pagamento':{type:'product_payment',title:'Produtos × Forma de Pagamento',subtitle:'Distribuição do faturamento dos produtos entre dinheiro, PIX, cartões e outras formas.'},
  'vendedores':{type:'sellers',title:'Relatório de Vendedores',subtitle:'Desempenho por operador: vendas, itens, faturamento, descontos e ticket médio.'},
  'formas-pagamento':{type:'payment_methods',title:'Relatório de Formas de Pagamento',subtitle:'Transações e valores por dinheiro, PIX, débito, crédito, voucher e demais formas.'},
  'fluxo-caixa':{type:'cash_flow',title:'Demonstrativo de Fluxo de Caixa',subtitle:'Entradas, saídas, realizado, previsto e saldo diário.'},
  'contas-receber':{type:'receivables',title:'Relatório de Contas a Receber',subtitle:'Títulos, clientes, vencimentos, baixas e saldos em aberto.'},
  'contas-pagar':{type:'payables',title:'Relatório de Contas a Pagar',subtitle:'Títulos, fornecedores, vencimentos, pagamentos e saldos em aberto.'},
  'balanco-patrimonial':{type:'balance_sheet',title:'Balanço Patrimonial Gerencial',subtitle:'Visão operacional de caixa, bancos, recebíveis, estoques, obrigações e saldo patrimonial.'},
  'vendas-cfop':{type:'sales_cfop',title:'Relatório de Vendas por CFOP',subtitle:'Quantidade, vendas e faturamento agrupados pelo CFOP efetivamente usado na operação.'},
  'produtos-tributacao':{type:'products_taxation',title:'Relatório de Produtos por Tributação',subtitle:'NCM, CEST, CFOP, origem e enquadramentos tributários cadastrados nos produtos.'},

  'dre-gerencial':{type:'dre_managerial',title:'DRE Gerencial',subtitle:'Receita, devoluções, descontos, CMV, lucro bruto, despesas e resultado operacional.'},
  'margem-produto':{type:'product_margin',title:'Margem de Lucro por Produto',subtitle:'Receita, CMV, lucro bruto e margem percentual por produto.'},
  'curva-abc':{type:'abc_curve',title:'Curva ABC de Produtos',subtitle:'Classificação A/B/C conforme participação acumulada no faturamento.'},
  'cmv':{type:'cmv',title:'CMV',subtitle:'Custo das mercadorias vendidas, receita e lucro bruto por dia.'},
  'lucro-bruto':{type:'gross_profit',title:'Lucro Bruto por Período',subtitle:'Receita líquida, CMV, lucro bruto e margem diária.'},
  'vendas-horario':{type:'sales_timing',title:'Vendas por Hora / Dia da Semana',subtitle:'Identifique horários e dias de maior movimento e faturamento.'},
  'ticket-medio':{type:'average_ticket',title:'Ticket Médio',subtitle:'Ticket médio diário por filial, com vendas, itens e faturamento.'},
  'produtos-sem-giro':{type:'no_movement_products',title:'Produtos sem Giro',subtitle:'Produtos sem venda na janela selecionada, com estoque e valor imobilizado.'},
  'estoque-parado':{type:'stagnant_stock',title:'Estoque Parado',subtitle:'Capital parado em produtos com saldo positivo e sem giro no período.'},
  'comissao-vendedor':{type:'seller_commission',title:'Comissão por Vendedor',subtitle:'Base líquida, devoluções, percentual configurado e comissão calculada por operador.'},

  'vendas':{type:'product_ranking',title:'Relatório de Vendas por Produto',subtitle:'Produtos vendidos, quantidade e faturamento no período.'},
  'financeiro':{type:'cash_flow',title:'Relatório Financeiro / Fluxo de Caixa',subtitle:'Entradas, saídas e saldos financeiros por período.'},
  'listagens':{type:'products_taxation',title:'Listagem de Produtos',subtitle:'Produtos e principais dados fiscais cadastrados.'},
};

export default async function ReportPage({ params }: { params: Promise<{report:string}> }) {
  const { report } = await params;
  const meta=reports[report];
  if(!meta) notFound();
  const [branches,initial]=await Promise.all([erpLoad('branches'),erpReportV2(meta.type)]);
  return <AdvancedShell title={meta.title} subtitle={meta.subtitle} activePath={`/dashboard/relatorios/${report}`}>
    <ReportWorkspace report={meta.type} branches={branches.data} initial={initial}/>
  </AdvancedShell>;
}
