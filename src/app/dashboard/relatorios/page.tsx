import Link from 'next/link';
import { AdvancedShell } from '../[...slug]/advanced-shell';
import '../[...slug]/module.css';
import './reports-hub.css';
import '../[...slug]/management-shell.css';

const groups = [
  ['Caixa',[
    ['Fechamento de Caixa','/dashboard/relatorios/fechamento-caixa','Resumo por sessão, operador, PDV e diferenças.'],
    ['Fechamento Detalhado','/dashboard/relatorios/fechamento-caixa-detalhado','Formas de pagamento, conferência, suprimentos e sangrias.'],
    ['Formas de Pagamento','/dashboard/relatorios/formas-pagamento','Valores por dinheiro, PIX, cartões e demais meios.'],
  ]],
  ['Estoque',[
    ['Relatório de Estoque','/dashboard/relatorios/estoque','Histórico de todas as movimentações.'],
    ['Posição de Estoque','/dashboard/relatorios/posicao-estoque','Saldo atual, reserva, mínimo e valorização.'],
    ['Inventário','/dashboard/relatorios/inventario','Esperado, contado e diferenças.'],
    ['Produtos sem Giro','/dashboard/relatorios/produtos-sem-giro','Produtos sem venda dentro da janela selecionada.'],
    ['Estoque Parado','/dashboard/relatorios/estoque-parado','Capital imobilizado em produtos com saldo e sem giro.'],
  ]],
  ['Comercial',[
    ['Ranking de Produtos','/dashboard/relatorios/ranking-produtos','Produtos mais vendidos no período/mês.'],
    ['Produtos × Forma de Pagamento','/dashboard/relatorios/produtos-forma-pagamento','Rateio do faturamento por forma de pagamento.'],
    ['Vendedores / Operadores','/dashboard/relatorios/vendedores','Vendas, ticket, descontos e faturamento por operador.'],
    ['Curva ABC','/dashboard/relatorios/curva-abc','Classificação A/B/C pela participação no faturamento.'],
    ['Vendas por Hora / Dia','/dashboard/relatorios/vendas-horario','Horários e dias da semana de maior movimento.'],
    ['Ticket Médio','/dashboard/relatorios/ticket-medio','Ticket médio diário por filial.'],
    ['Comissão por Vendedor','/dashboard/relatorios/comissao-vendedor','Comissão calculada conforme percentual do operador.'],
  ]],
  ['Resultado / Rentabilidade',[
    ['DRE Gerencial','/dashboard/relatorios/dre-gerencial','Receita líquida, CMV, lucro bruto, despesas e resultado.'],
    ['Margem por Produto','/dashboard/relatorios/margem-produto','Receita, custo, lucro e margem por produto.'],
    ['CMV','/dashboard/relatorios/cmv','Custo das mercadorias vendidas por dia.'],
    ['Lucro Bruto','/dashboard/relatorios/lucro-bruto','Lucro bruto e margem ao longo do período.'],
  ]],
  ['Financeiro',[
    ['Demonstrativo de Fluxo de Caixa','/dashboard/relatorios/fluxo-caixa','Realizado, previsto, entradas e saídas.'],
    ['Contas a Receber','/dashboard/relatorios/contas-receber','Títulos, vencimentos, baixas e saldo aberto.'],
    ['Contas a Pagar','/dashboard/relatorios/contas-pagar','Fornecedores, vencimentos, baixas e saldo aberto.'],
    ['Balanço Patrimonial Gerencial','/dashboard/relatorios/balanco-patrimonial','Visão operacional de ativos, passivos e saldo patrimonial.'],
  ]],
  ['Fiscal / Tributário',[
    ['Vendas por CFOP','/dashboard/relatorios/vendas-cfop','Faturamento e quantidade por CFOP.'],
    ['Produtos por Tributação','/dashboard/relatorios/produtos-tributacao','NCM, CEST, CFOP e enquadramentos fiscais.'],
  ]],
] as const;

export default function ReportsHub(){
  return <AdvancedShell title="Central de Relatórios" subtitle="Relatórios integrados de caixa, estoque, vendas, rentabilidade, financeiro e fiscal." activePath="/dashboard/relatorios">
    <div className="reports-hub">{groups.map(([group,items])=><section className="erp-module-card reports-group" key={group}><div className="reports-group-head"><h2>{group}</h2><span>{items.length} relatório(s)</span></div><div className="reports-grid">{items.map(([title,href,desc])=><Link href={href} className="report-card" key={href}><div className="report-card-icon">▦</div><div><strong>{title}</strong><p>{desc}</p></div><span className="report-card-arrow">→</span></Link>)}</div></section>)}</div>
  </AdvancedShell>;
}
