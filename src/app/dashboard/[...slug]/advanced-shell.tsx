'use client';

import Link from 'next/link';
import { ReactNode, useState } from 'react';
import { logout } from '../actions';

const menu: [string, [string,string][]][] = [
  ['Pessoas',[['Clientes','/dashboard/clientes'],['Fornecedores','/dashboard/fornecedores'],['Perfis PDV','/dashboard/perfis-pdv'],['Usuários PDV','/dashboard/usuarios-pdv'],['Perfis ADM','/dashboard/perfis-adm'],['Usuários ADM','/dashboard/usuarios-adm']]],
  ['Vendas',[['Operações de Caixa','/dashboard/vendas'],['Nova Venda','/dashboard/vendas/nova']]],
  ['Produtos',[['Produtos','/dashboard/produtos'],['Grupos','/dashboard/grupos'],['Classes','/dashboard/classes'],['Modificadores','/dashboard/modificadores']]],
  ['Tabela de Preços',[['Tabelas','/dashboard/tabelas-precos'],['Copiar','/dashboard/tabelas-precos/copiar'],['Ajustes Programados','/dashboard/tabelas-precos/ajustes'],['Promoções','/dashboard/promocoes']]],
  ['Estoque',[['Movimentações','/dashboard/estoque'],['Compras / Entradas','/dashboard/compras'],['Inventário','/dashboard/estoque/inventario'],['Produção / Cozinha','/dashboard/estoque/producao'],['Ajustes','/dashboard/estoque/ajustes'],['Transferências','/dashboard/estoque/transferencias']]],
  ['Financeiro',[['Contas a Receber','/dashboard/financeiro/receber'],['Contas a Pagar','/dashboard/financeiro/pagar'],['Fluxo de Caixa','/dashboard/financeiro/fluxo-caixa'],['Conciliação','/dashboard/financeiro/conciliacao']]],
  ['Administrativo',[['Empresas e Filiais','/dashboard/administrativo/empresas'],['Caixas e PDVs','/dashboard/administrativo/pdvs'],['PDV Desktop / Agentes','/dashboard/administrativo/pdv-desktop'],['Fiscal','/dashboard/fiscal'],['Integrações','/dashboard/integracoes'],['Configurações','/dashboard/configuracoes']]],
  ['Relatórios',[
    ['Central de Relatórios','/dashboard/relatorios'],
    ['Fechamento de Caixa','/dashboard/relatorios/fechamento-caixa'],
    ['Fechamento Detalhado','/dashboard/relatorios/fechamento-caixa-detalhado'],
    ['Relatório de Estoque','/dashboard/relatorios/estoque'],
    ['Posição de Estoque','/dashboard/relatorios/posicao-estoque'],
    ['Relatório de Inventário','/dashboard/relatorios/inventario'],
    ['Produtos sem Giro','/dashboard/relatorios/produtos-sem-giro'],
    ['Estoque Parado','/dashboard/relatorios/estoque-parado'],
    ['Ranking de Produtos','/dashboard/relatorios/ranking-produtos'],
    ['Curva ABC','/dashboard/relatorios/curva-abc'],
    ['Margem por Produto','/dashboard/relatorios/margem-produto'],
    ['Produtos × Forma Pagamento','/dashboard/relatorios/produtos-forma-pagamento'],
    ['Vendedores / Operadores','/dashboard/relatorios/vendedores'],
    ['Comissão por Vendedor','/dashboard/relatorios/comissao-vendedor'],
    ['Vendas por Hora / Dia','/dashboard/relatorios/vendas-horario'],
    ['Ticket Médio','/dashboard/relatorios/ticket-medio'],
    ['Formas de Pagamento','/dashboard/relatorios/formas-pagamento'],
    ['DRE Gerencial','/dashboard/relatorios/dre-gerencial'],
    ['CMV','/dashboard/relatorios/cmv'],
    ['Lucro Bruto','/dashboard/relatorios/lucro-bruto'],
    ['Demonstrativo Fluxo de Caixa','/dashboard/relatorios/fluxo-caixa'],
    ['Contas a Receber','/dashboard/relatorios/contas-receber'],
    ['Contas a Pagar','/dashboard/relatorios/contas-pagar'],
    ['Balanço Patrimonial','/dashboard/relatorios/balanco-patrimonial'],
    ['Vendas por CFOP','/dashboard/relatorios/vendas-cfop'],
    ['Produtos por Tributação','/dashboard/relatorios/produtos-tributacao'],
  ]],
];

export function AdvancedShell({ title, subtitle, activePath, children }: { title:string; subtitle:string; activePath:string; children:ReactNode }) {
  const [open,setOpen]=useState<string[]>(menu.map(([m])=>m));
  return <main className="erp-module-shell"><aside className="erp-module-sidebar"><Link href="/dashboard" className="erp-module-logo"><span>ϟ</span> THOR<b>PDV</b></Link><nav><Link href="/dashboard">Dashboard</Link>{menu.map(([label,items])=>{const expanded=open.includes(label);return <div className="erp-module-group" key={label}><button type="button" onClick={()=>setOpen(v=>expanded?v.filter(x=>x!==label):[...v,label])}><span>{label}</span><span>{expanded?'⌄':'›'}</span></button>{expanded&&<div className="erp-module-submenu">{items.map(([name,href])=><Link className={activePath===href?'active':''} href={href} key={href}>{name}</Link>)}</div>}</div>})}</nav><div className="erp-module-branch"><small>Loja atual</small><strong>MATRIZ</strong><span>Teresina / PI</span></div></aside><section className="erp-module-main"><header className="erp-module-header"><div><Link href="/dashboard" className="erp-back">← Dashboard</Link><h1>{title}</h1><p>{subtitle}</p></div><div className="erp-module-user"><div className="erp-user-dot">SA</div><span><strong>ThorPDV</strong><small>Administrador</small></span><form action={logout}><button className="erp-ghost" type="submit">Sair</button></form></div></header>{children}</section></main>;
}
