'use client';

import Link from 'next/link';
import { ReactNode, useEffect, useMemo, useState } from 'react';
import { logout } from '../actions';
import { erpLicenseGet } from './license-actions';
import { advancedMenu, type MenuGroup, type MenuItem } from './advanced-menu';

const groupModule:Record<string,string>={'Pessoas':'people','Vendas':'sales','Produtos':'products','Tabela de Preços':'pricing','Estoque':'stock','Financeiro':'finance','Administrativo':'administration','Relatórios':'reports'};
function itemModule(label:string,href:string){if(href.includes('/administrativo/filiais'))return 'branches';if(href.includes('/estoque/producao'))return 'production';if(href.includes('/compras'))return 'purchases';if(href.includes('/fiscal')||href.includes('/documentos-fiscais'))return 'fiscal';if(href.includes('/integracoes'))return 'integrations';if(href.includes('/administrativo/pdvs')||href.includes('/pdv-desktop'))return 'pdv';return groupModule[label]||'administration'}
function pathMatches(activePath:string,href:string){return activePath===href||activePath.startsWith(`${href}/`)}
function activeGroupForPath(groups:MenuGroup[],activePath:string){return groups.find(([, ,items])=>items.some(([,href])=>pathMatches(activePath,href)))?.[0]??null}
function activeHrefForPath(items:MenuItem[],activePath:string){return items.filter(([,href])=>pathMatches(activePath,href)).sort((a,b)=>b[1].length-a[1].length)[0]?.[1]??null}

type AdvancedShellProps={
  title:string;
  subtitle:string;
  activePath:string;
  children:ReactNode;
  backHref?:string;
  backLabel?:string;
};

export function AdvancedShell({title,subtitle,activePath,children,backHref='/dashboard',backLabel='Dashboard'}:AdvancedShellProps){
  const [openGroup,setOpenGroup]=useState<string|null>(()=>activeGroupForPath(advancedMenu,activePath));
  const [licensed,setLicensed]=useState<Record<string,boolean>|null>(null);
  useEffect(()=>{let alive=true;void erpLicenseGet().then(r=>{if(!alive)return;const active=r.ok&&(r.status==='active'||r.status==='trial');setLicensed(active?r.modules:{})});return()=>{alive=false}},[]);
  const visibleMenu=useMemo(()=>advancedMenu.map(([label,icon,items])=>[label,icon,items.filter(([,href])=>licensed===null||licensed[itemModule(label,href)]!==false)] as MenuGroup).filter(([, ,items])=>items.length>0),[licensed]);
  useEffect(()=>{const activeGroup=activeGroupForPath(visibleMenu,activePath);if(activeGroup)setOpenGroup(activeGroup)},[activePath,visibleMenu]);

  return <main className="erp-module-shell">
    <aside className="erp-module-sidebar">
      <Link href="/dashboard" className="erp-module-logo"><span>ϟ</span> THOR<b>PDV</b></Link>
      <nav>
        <Link href="/dashboard" className={activePath==='/dashboard'?'active':''}><span className="erp-menu-icon">⌂</span><span className="erp-menu-label">Dashboard</span></Link>
        {visibleMenu.map(([label,icon,items])=>{const expanded=openGroup===label;const activeHref=activeHrefForPath(items,activePath);const groupActive=Boolean(activeHref);return <div className={`erp-module-group ${groupActive?'active-group':''} ${expanded?'expanded':''}`} key={label}>
          <button type="button" aria-expanded={expanded} onClick={()=>setOpenGroup(expanded?null:label)}><span className="erp-menu-icon">{icon}</span><span className="erp-menu-label">{label}</span><span className="erp-menu-arrow">›</span></button>
          <div className={`erp-module-submenu-shell ${expanded?'open':''}`} aria-hidden={!expanded}><div className="erp-module-submenu-clip"><div className="erp-module-submenu">{items.map(([name,href])=><Link className={activeHref===href?'active':''} href={href} key={href}><span className="erp-submenu-dot"/>{name}</Link>)}</div></div></div>
        </div>})}
      </nav>
      <div className="erp-module-branch"><small>Estabelecimento</small><strong>MATRIZ</strong><span>Thor Gestão</span></div>
    </aside>
    <section className="erp-module-main">
      <header className="erp-module-header">
        <div><Link href={backHref} className="erp-back">← {backLabel}</Link><h1>{title}</h1><p>{subtitle}</p></div>
        <div className="erp-module-user"><div className="erp-user-dot">SA</div><span><strong>ThorPDV</strong><small>Administrador</small></span><form action={logout}><button className="erp-ghost" type="submit">Sair</button></form></div>
      </header>
      {children}
    </section>
  </main>;
}
