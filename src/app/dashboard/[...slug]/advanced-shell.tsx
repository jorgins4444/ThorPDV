'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import { logout } from '../actions';
import { erpLicenseGet } from './license-actions';
import { advancedMenu, type MenuGroup, type MenuItem } from './advanced-menu';

const groupModule:Record<string,string>={'Pessoas':'people','Vendas':'sales','Produtos':'products','Tabela de Preços':'pricing','Estoque':'stock','Financeiro':'finance','Administrativo':'administration','Relatórios':'reports'};
const LICENSE_CACHE_KEY='thor:license:modules:v1';
const LICENSE_CACHE_TTL=5*60*1000;
const prefetchedRoutes=new Set<string>();

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

type FastLinkProps={href:string;className?:string;children:ReactNode};

function FastLink({href,className,children}:FastLinkProps){
  const router=useRouter();
  const warm=useCallback(()=>{
    if(prefetchedRoutes.has(href))return;
    prefetchedRoutes.add(href);
    router.prefetch(href);
  },[href,router]);
  return <Link href={href} className={className} prefetch={false} onMouseEnter={warm} onFocus={warm} onTouchStart={warm}>{children}</Link>;
}

export function AdvancedShell({title,subtitle,activePath,children,backHref='/dashboard',backLabel='Dashboard'}:AdvancedShellProps){
  const [openGroup,setOpenGroup]=useState<string|null>(()=>activeGroupForPath(advancedMenu,activePath));
  const [licensed,setLicensed]=useState<Record<string,boolean>|null>(null);

  useEffect(()=>{
    try{
      const raw=sessionStorage.getItem(LICENSE_CACHE_KEY);
      if(raw){
        const cached=JSON.parse(raw) as {expires?:number;modules?:Record<string,boolean>};
        if((cached.expires??0)>Date.now()&&cached.modules){setLicensed(cached.modules);return;}
        sessionStorage.removeItem(LICENSE_CACHE_KEY);
      }
    }catch{}

    let alive=true;
    void erpLicenseGet().then(r=>{
      if(!alive)return;
      const active=r.ok&&(r.status==='active'||r.status==='trial');
      const modules=active?r.modules:{};
      setLicensed(modules);
      try{sessionStorage.setItem(LICENSE_CACHE_KEY,JSON.stringify({expires:Date.now()+LICENSE_CACHE_TTL,modules}));}catch{}
    });
    return()=>{alive=false};
  },[]);

  const visibleMenu=useMemo(()=>advancedMenu.map(([label,icon,items])=>[label,icon,items.filter(([,href])=>licensed===null||licensed[itemModule(label,href)]!==false)] as MenuGroup).filter(([, ,items])=>items.length>0),[licensed]);
  useEffect(()=>{const activeGroup=activeGroupForPath(visibleMenu,activePath);if(activeGroup)setOpenGroup(activeGroup)},[activePath,visibleMenu]);

  return <main className="erp-module-shell">
    <aside className="erp-module-sidebar">
      <FastLink href="/dashboard" className="erp-module-logo"><span>ϟ</span> THOR<b>PDV</b></FastLink>
      <nav>
        <FastLink href="/dashboard" className={activePath==='/dashboard'?'active':''}><span className="erp-menu-icon">⌂</span><span className="erp-menu-label">Dashboard</span></FastLink>
        {visibleMenu.map(([label,icon,items])=>{const expanded=openGroup===label;const activeHref=activeHrefForPath(items,activePath);const groupActive=Boolean(activeHref);return <div className={`erp-module-group ${groupActive?'active-group':''} ${expanded?'expanded':''}`} key={label}>
          <button type="button" aria-expanded={expanded} onClick={()=>setOpenGroup(expanded?null:label)}><span className="erp-menu-icon">{icon}</span><span className="erp-menu-label">{label}</span><span className="erp-menu-arrow">›</span></button>
          <div className={`erp-module-submenu-shell ${expanded?'open':''}`} aria-hidden={!expanded}><div className="erp-module-submenu-clip"><div className="erp-module-submenu">{items.map(([name,href])=><FastLink className={activeHref===href?'active':''} href={href} key={href}><span className="erp-submenu-dot"/>{name}</FastLink>)}</div></div></div>
        </div>})}
      </nav>
      <div className="erp-module-branch"><small>Estabelecimento</small><strong>MATRIZ</strong><span>Thor Gestão</span></div>
    </aside>
    <section className="erp-module-main">
      <header className="erp-module-header">
        <div><FastLink href={backHref} className="erp-back">← {backLabel}</FastLink><h1>{title}</h1><p>{subtitle}</p></div>
        <div className="erp-module-user"><div className="erp-user-dot">SA</div><span><strong>ThorPDV</strong><small>Administrador</small></span><form action={logout}><button className="erp-ghost" type="submit">Sair</button></form></div>
      </header>
      {children}
    </section>
  </main>;
}
