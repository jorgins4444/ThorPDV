'use client';

import Link from 'next/link';

type Row=Record<string,unknown>;
const txt=(v:unknown)=>v==null?'':String(v);
const bool=(v:unknown)=>Boolean(v);

export function FiscalCenterWorkspace({settings}:{settings:Row}){
  const issuer=(settings.issuer&&typeof settings.issuer==='object'?settings.issuer:{}) as Row;
  const series=(Array.isArray(settings.series)?settings.series:[]) as Row[];
  const pos=(Array.isArray(settings.pos_registers)?settings.pos_registers:[]) as Row[];
  const cfops=(Array.isArray(settings.cfops)?settings.cfops:[]) as Row[];
  const cert=(settings.certificate&&typeof settings.certificate==='object'?settings.certificate:null) as Row|null;
  const activeSeries=series.filter(s=>s.active!==false).length;
  const linkedPos=pos.filter(p=>bool(p.in_use)&&txt(p.fiscal_series_id)).length;
  const cards=[
    {icon:'🏢',title:'Emitente fiscal',desc:'CNPJ, IE, CRT e endereço fiscal utilizados na emissão.',href:'/dashboard/fiscal/emitente',status:txt(issuer.cnpj)?'Configurado':'Revisar',tone:txt(issuer.cnpj)?'ok':'warn',meta:txt(issuer.cnpj)||'CNPJ não informado'},
    {icon:'⚡',title:'NFC-e / CSC',desc:'Ambiente de emissão, ID CSC e token de segurança da NFC-e.',href:'/dashboard/fiscal/nfce-config',status:bool(settings.csc_token_configured)?'Configurado':'Pendente',tone:bool(settings.csc_token_configured)?'ok':'warn',meta:`Ambiente: ${txt(settings.environment)==='production'?'Produção':'Homologação'}`},
    {icon:'№',title:'Séries e numeração',desc:'Séries de NF-e e NFC-e, sequência e série padrão.',href:'/dashboard/fiscal/series',status:`${activeSeries} ativa(s)`,tone:activeSeries?'ok':'warn',meta:`${series.length} série(s) cadastrada(s)`},
    {icon:'▣',title:'Caixas × Série',desc:'Vínculo de cada terminal/PDV com sua série exclusiva de NFC-e.',href:'/dashboard/fiscal/caixas',status:`${linkedPos} vinculado(s)`,tone:linkedPos||pos.length===0?'ok':'warn',meta:`${pos.length} caixa(s) cadastrado(s)`},
    {icon:'▤',title:'DANFE / Impressão',desc:'Casas decimais, linhas, ordenação e formação do nome do produto.',href:'/dashboard/fiscal/danfe',status:'Configurar',tone:'neutral',meta:'Layout de impressão fiscal'},
    {icon:'↔',title:'CFOPs',desc:'Tabela de CFOPs disponível para produtos e operações fiscais.',href:'/dashboard/fiscal/cfops',status:`${cfops.filter(c=>c.active!==false).length} ativo(s)`,tone:'ok',meta:`${cfops.length} código(s) cadastrados`},
    {icon:'🔐',title:'Certificado Digital A1',desc:'Certificado PFX/P12 usado para assinatura e comunicação com a SEFAZ.',href:'/dashboard/fiscal/certificado',status:cert?(bool(cert.expired)?'Expirado':'Válido'):'Não configurado',tone:cert&&!bool(cert.expired)?'ok':'warn',meta:cert?txt(cert.subject_cn)||txt(cert.filename):'Anexe o certificado da empresa'},
    {icon:'🧾',title:'Emissão de NF-e',desc:'NF-e modelo 55 a partir das vendas, com validação fiscal, série, numeração e acompanhamento.',href:'/dashboard/fiscal/nfe',status:'Abrir emissão',tone:'primary',meta:'Fluxo dedicado para NF-e'},
    {icon:'📄',title:'Documentos Fiscais',desc:'Histórico de NF-e e NFC-e, XML, DANFE, protocolos, rejeições e cancelamentos.',href:'/dashboard/documentos-fiscais',status:'Abrir histórico',tone:'primary',meta:'Consulta centralizada dos documentos'},
  ];

  const ready=cards.slice(0,7).filter(c=>c.tone==='ok').length;
  return <div className="fiscal-center">
    <section className="fiscal-center-hero">
      <div><span>CENTRAL FISCAL</span><h2>Configurações fiscais organizadas por função</h2><p>Configure emitente e parâmetros em um só lugar, emita NF-e no fluxo dedicado e consulte NF-e/NFC-e no histórico centralizado.</p></div>
      <div className="fiscal-center-score"><strong>{ready}/7</strong><small>áreas em situação regular</small></div>
    </section>
    <section className="fiscal-center-grid">
      {cards.map(card=><Link href={card.href} className="fiscal-center-card" key={card.href}>
        <div className="fiscal-center-icon">{card.icon}</div>
        <div className="fiscal-center-copy"><div className="fiscal-center-title"><h3>{card.title}</h3><span className={`fiscal-center-status ${card.tone}`}>{card.status}</span></div><p>{card.desc}</p><small>{card.meta}</small></div>
        <b className="fiscal-center-arrow">›</b>
      </Link>)}
    </section>
  </div>;
}