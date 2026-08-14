'use client';

import { FiscalConfigurationWorkspace } from './fiscal-configuration-workspace';

type Row=Record<string,unknown>;
export type FiscalSection='emitente'|'nfce'|'series'|'caixas'|'danfe'|'cfops';

const labels:Record<FiscalSection,{eyebrow:string;title:string;desc:string}>={
  emitente:{eyebrow:'EMITENTE FISCAL',title:'Dados do emitente',desc:'Confira os dados fiscais da Matriz usados em NF-e e NFC-e. A edição cadastral continua centralizada no módulo Matriz.'},
  nfce:{eyebrow:'NFC-E / CSC',title:'Configuração da NFC-e',desc:'Ambiente de emissão, identificação CSC e token de segurança fornecido pela SEFAZ.'},
  series:{eyebrow:'SÉRIES FISCAIS',title:'Séries e numeração',desc:'Controle as séries de NF-e e NFC-e e a sequência numérica reservada pelo servidor.'},
  caixas:{eyebrow:'CAIXAS × SÉRIE',title:'Vínculo fiscal dos caixas',desc:'Associe cada caixa ou PDV à sua série de NFC-e, preservando exclusividade e integridade da numeração.'},
  danfe:{eyebrow:'DANFE / IMPRESSÃO',title:'Layout do DANFE',desc:'Defina apresentação dos itens, casas decimais, ordenação e formação do nome do produto.'},
  cfops:{eyebrow:'CFOPS',title:'Cadastro de CFOPs',desc:'Mantenha os CFOPs utilizados no cadastro tributário de produtos e operações fiscais.'},
};

export function FiscalConfigSectionWorkspace({settings,section}:{settings:Row;section:FiscalSection}){
  const info=labels[section];
  return <div className={`fiscal-section-page fiscal-section-${section}`}>
    <section className="fiscal-section-intro"><div><span>{info.eyebrow}</span><h2>{info.title}</h2><p>{info.desc}</p></div></section>
    <FiscalConfigurationWorkspace initialSettings={settings}/>
  </div>;
}
