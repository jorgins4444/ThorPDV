'use client';

import Link from 'next/link';
import { ReactNode, useEffect, useMemo, useState } from 'react';
import { logout } from '../actions';
import { erpLicenseGet } from './license-actions';

const menu: [string, [string,string][]][] = [
  ['Pessoas',[['Clientes','/dashboard/clientes'],['Fornecedores','/dashboard/fornecedores'],['Perfis PDV','/dashboard/perfis-pdv'],['Usuários PDV','/dashboard/usuarios-pdv'],['Perfis ADM','/dashboard/perfis-adm'],['Usuários ADM','/dashboard/usuarios-adm']]],
  ['Vendas',[['Operações de Caixa','/dashboard/vendas'],['Nova Venda','/dashboard/vendas/nova']]],
  ['Produtos',[['Produtos','/dashboard/produtos'],['Grupos','/dashboard/grupos'],['Classes','/dashboard/classes'],['Modificadores','/dashboard/modificadores']]],
  ['Tabela de Preços',[['Tabelas','/dashboard/tabelas-precos'],['Copiar','/dashboard/tabelas-precos/copiar'],['Ajustes Programados','/dashboard/tabelas-precos/ajustes'],['Promoções','/dashboard/promocoes']]],
  ['Estoque',[['Movimentações','/dashboard/estoque'],['Compras / Entradas','/dashboard/compras'],['Inventário','/dashboard/estoque/inventario'],['Produção / Cozinha','/dashboard/estoque/producao'],['Ajustes','/dashboard/estoque/ajustes'],['Transferências','/dashboard/estoque/transferencias']]],
  ['Financeiro',[['Contas a Receber','/dashboard/financeiro/receber'],['Contas a Pagar','/dashboard/financeiro/pagar'],['Fluxo de Caixa','/dashboard/financeiro/fluxo-caixa'],['Conciliação','/dashboard/financeiro/conciliacao']]],
  ['Administrativo',[['Empresas e Filiais','/dashboard/administrativo/empresas'],['Caixas e PDVs','/dashboard/administrativo/pdvs'],['PDV Desktop / Agentes','/dashboard/administrativo/pdv-desktop'],['Fiscal','/dashboard/fiscal'],['Integrações','/dashboard/integracoes'],['Configurações','/dashboard/configuracoes']]],
  ['Relatórios',[
    ['Central de Relatórios','/dashboard/relatorios'],['Fechamento de Caixa','/dashboard/relatorios/fechamento-caixa'],['Fechamento Detalhado','/dashboard/relatorios/fechamento-caixa-detalhado'],['Relatório de Estoque','/dashboard/relatorios/estoque'],['Posição de Estoque','/dashboard/relatorios/posicao-estoque'],['Relatório de Inventário','/dashboard/relatorios/inventario'],['Produtos sem Giro','/dashboard/relatorios/produtos-sem-giro'],['Estoque Parado','/dashboard/relatorios/estoque-parado'],['Ranking de Produtos','/dashboard/relatorios/ranking-produtos'],['Curva ABC','/dashboard/relatorios/curva-abc'],['Margem por Produto','/dashboard/relatorios/margem-produto'],['Produtos × Forma Pagamento','/dashboard/relatorios/produtos-forma-pagamento'],['Vendedores / Operadores','/dashboard/relatorios/vendedores'],['Comissão por Vendedor','/dashboard/relatorios/comissao-vendedor'],['Vendas por Hora / Dia','/dashboard/relatorios/vendas-horario'],['Ticket Médio','/dashboard/relatorios/ticket-medio'],['Formas de Pagamento','/dashboard/relatorios/formas-pagamento'],['DRE Gerencial','/dashboard/relatorios/dre-gerencial'],['CMV','/dashboard/relatorios/cmv'],['Lucro Bruto','/dashboard/relatorios/lucro-bruto'],['Demonstrativo Fluxo de Caixa','/dashboard/relatorios/fluxo-caixa'],['Contas a Receber','/dashboard/relatorios/contas-receber'],['Contas a Pagar','/dashboard/relatorios/contas-pagar'],['Balanço Patrimonial','/dashboard/relatorios/balanco-patrimonial'],['Vendas por CFOP','/dashboard/relatorios/vendas-cfop'],['Produtos por Tributação','/dashboard/relatorios/produtos-tributacao'],
  ]],
];
const groupModule:Record<string,string>={'Pessoas':'people','Vendas':'sales','Produtos':'products','Tabela de Preços':'pricing','Estoque':'stock','Financeiro':'finance','Administrativo':'administration','Relatórios':'reports'};
function itemModule(label:string,href:string){if(href.includes('/estoque/producao'))return 'production';if(href.includes('/compras'))return 'purchases';if(href.includes('/fiscal'))return 'fiscal';if(href.includes('/integracoes'))return 'integrations';if(href.includes('/administrativo/pdvs')||href.includes('/pdv-desktop'))return 'pdv';return groupModule[label]||'administration'}
function pathMatches(activePath:string,href:string){return activePath===href||activePath.startsWith(`${href}/`)}
function activeGroupForPath(groups:[string,[string,string][]][],activePath:string){return groups.find(([,items])=>items.some(([,href])=>pathMatches(activePath,href)))?.[0]??null}
function activeHrefForPath(items:[string,string][],activePath:string){return items.filter(([,href])=>pathMatches(activePath,href)).sort((a,b)=>b[1].length-a[1].length)[0]?.[1]??null}

export function AdvancedShell({ title, subtitle, activePath, children }: { title:string; subtitle:string; activePath:string; children:ReactNode }) {
  const [openGroup,setOpenGroup]=useState<string|null>(()=>activeGroupForPath(menu,activePath));
  const [licensed,setLicensed]=useState<Record<string,boolean>|null>(null);
  useEffect(()=>{let alive=true;void erpLicenseGet().then(r=>{if(!alive)return;const active=r.ok&&(r.status==='active'||r.status==='trial');setLicensed(active?r.modules:{})});return()=>{alive=false}},[]);
  const visibleMenu=useMemo(()=>menu.map(([label,items])=>[label,items.filter(([,href])=>licensed===null||licensed[itemModule(label,href)]!==false)] as [string,[string,string][]]).filter(([,items])=>items.length>0),[licensed]);
  useEffect(()=>{const activeGroup=activeGroupForPath(visibleMenu,activePath);if(activeGroup)setOpenGroup(activeGroup)},[activePath,visibleMenu]);

  return <main className="erp-module-shell"><aside className="erp-module-sidebar"><Link href="/dashboard" className="erp-module-logo"><span>ϟ</span> THOR<b>PDV</b></Link><nav><Link href="/dashboard">Dashboard</Link>{visibleMenu.map(([label,items])=>{const expanded=openGroup===label;const activeHref=activeHrefForPath(items,activePath);const groupActive=Boolean(activeHref);return <div className={`erp-module-group ${groupActive?'active-group':''}`} key={label}><button type="button" aria-expanded={expanded} onClick={()=>setOpenGroup(expanded?null:label)}><span>{label}</span><span>{expanded?'⌄':'›'}</span></button>{expanded&&<div className="erp-module-submenu">{items.map(([name,href])=><Link className={activeHref===href?'active':''} href={href} key={href}>{name}</Link>)}</div>}</div>})}</nav><div className="erp-module-branch"><small>Loja atual</small><strong>MATRIZ</strong><span>Teresina / PI</span></div></aside><section className="erp-module-main"><header className="erp-module-header"><div><Link href="/dashboard" className="erp-back">← Dashboard</Link><h1>{title}</h1><p>{subtitle}</p></div><div className="erp-module-user"><div className="erp-user-dot">SA</div><span><strong>ThorPDV</strong><small>Administrador</small></span><form action={logout}><button className="erp-ghost" type="submit">Sair</button></form></div></header>{children}</section></main>;
}
