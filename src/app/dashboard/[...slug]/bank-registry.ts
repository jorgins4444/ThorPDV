export type BankCode='001'|'033'|'104'|'237'|'341';
export type BankLayout='cnab240'|'cnab400';

type BankDefinition={
  code:BankCode;
  name:string;
  shortName:string;
  layouts:BankLayout[];
  implementation:'ready'|'building'|'planned';
  officialLayoutPage:string;
  official240?:string;
  official400?:string;
  validator?:string;
};

export const bankRegistry:Record<BankCode,BankDefinition>={
  '341':{
    code:'341',name:'Itaú Unibanco',shortName:'Itaú',layouts:['cnab240','cnab400'],implementation:'ready',
    officialLayoutPage:'https://www.itau.com.br/empresas/recebimentos/cobranca',
  },
  '237':{
    code:'237',name:'Banco Bradesco',shortName:'Bradesco',layouts:['cnab240','cnab400'],implementation:'building',
    officialLayoutPage:'https://wspf.bradesco.com.br/wsValidadorUniversal/validadorgeral',
    official240:'https://assets.bradesco/content/dam/portal-bradesco/assets/pessoajuridica/pdf/MPO-Troca-Arquivos-Layout-240P.pdf',
    official400:'https://assets.bradesco/content/dam/portal-bradesco/assets/pessoajuridica/pdf/mpo_arquivos_layout_400P.pdf',
    validator:'https://wspf.bradesco.com.br/wsValidadorUniversal/validadorgeral',
  },
  '001':{
    code:'001',name:'Banco do Brasil',shortName:'Banco do Brasil',layouts:['cnab240','cnab400'],implementation:'planned',
    officialLayoutPage:'https://www.bb.com.br/site/pro-seu-negocio/aplicativos-leiautes-de-arquivos/',
  },
  '104':{
    code:'104',name:'Caixa Econômica Federal',shortName:'CAIXA',layouts:['cnab240','cnab400'],implementation:'planned',
    officialLayoutPage:'https://www.caixa.gov.br/empresa/contas/recebimentos/cobranca-bancaria/Paginas/default.aspx',
    official240:'https://www.caixa.gov.br/Downloads/cobranca-caixa/Manual_de_Leiaute_de_Arquivo_Eletronico_CNAB_240.pdf',
    official400:'https://www.caixa.gov.br/Downloads/cobranca-caixa/Manual_de_Leiaute_de_Arquivo_Eletronico_CNAB_400.pdf',
  },
  '033':{
    code:'033',name:'Banco Santander Brasil',shortName:'Santander',layouts:['cnab240','cnab400'],implementation:'planned',
    officialLayoutPage:'https://www.santander.com.br/layout-de-arquivos',
  },
};

export const bankOptions=Object.values(bankRegistry);
export const bankName=(code:unknown)=>bankRegistry[String(code) as BankCode]?.shortName||String(code||'Banco');
export const bankDefinition=(code:unknown)=>bankRegistry[String(code) as BankCode];
