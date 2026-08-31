export type CfopRow=Record<string,unknown>;
export type CfopResolution={code:string;source:'rule'|'product_default'|'counterpart'|'none';reason:string;scope:'internal'|'interstate'|'foreign'|'';ruleName?:string};

const text=(v:unknown)=>v==null?'':String(v);
const digits=(v:unknown)=>text(v).replace(/\D/g,'');

export function destinationScope(emitterState:unknown,recipientState:unknown):CfopResolution['scope']{
  const emitter=text(emitterState).trim().toUpperCase();
  const recipient=text(recipientState).trim().toUpperCase();
  if(recipient==='EX')return 'foreign';
  if(!recipient)return '';
  if(emitter&&recipient===emitter)return 'internal';
  return 'interstate';
}

export function scopeLabel(scope:CfopResolution['scope']){
  return scope==='internal'?'mesma UF do emitente':scope==='interstate'?'outra UF':scope==='foreign'?'exterior':'destino ainda não identificado';
}

export function cfopPrefixForScope(scope:CfopResolution['scope']){
  return scope==='internal'?'5':scope==='interstate'?'6':scope==='foreign'?'7':'';
}

export function resolveCfopClient(args:{
  rules:CfopRow[];
  cfops:CfopRow[];
  productCfop?:unknown;
  purpose:unknown;
  presence:unknown;
  emitterState:unknown;
  recipientState:unknown;
  consumerFinal:boolean;
  indicatorIe:unknown;
}):CfopResolution{
  const scope=destinationScope(args.emitterState,args.recipientState);
  if(!scope)return {code:'',source:'none',reason:'Informe a UF do destinatário para o Thor identificar a operação.',scope};
  const purpose=text(args.purpose);
  const presence=text(args.presence);
  const indicatorIe=text(args.indicatorIe);
  const activeCfops=args.cfops.filter(row=>row.active!==false);
  const byId=new Map(activeCfops.map(row=>[text(row.id),row]));
  const matches=args.rules
    .filter(row=>row.active!==false&&text(row.destination_scope)===scope)
    .filter(row=>!text(row.purpose)||text(row.purpose)===purpose)
    .filter(row=>!text(row.presence)||text(row.presence)===presence)
    .filter(row=>row.consumer_final==null||Boolean(row.consumer_final)===args.consumerFinal)
    .filter(row=>!text(row.indicator_ie)||text(row.indicator_ie)===indicatorIe)
    .filter(row=>{const cfop=byId.get(text(row.cfop_id));return Boolean(cfop&&cfop.active!==false)})
    .sort((a,b)=>{
      const pa=Number(a.priority||100),pb=Number(b.priority||100);
      if(pa!==pb)return pa-pb;
      const sa=[a.purpose,a.presence,a.consumer_final,a.indicator_ie].filter(v=>v!==null&&v!==undefined&&v!=='').length;
      const sb=[b.purpose,b.presence,b.consumer_final,b.indicator_ie].filter(v=>v!==null&&v!==undefined&&v!=='').length;
      return sb-sa;
    });
  if(matches.length){
    const row=matches[0];
    const cfop=byId.get(text(row.cfop_id));
    if(cfop){
      const code=digits(cfop.code);
      return {code,source:'rule',ruleName:text(row.name),reason:`Regra “${text(row.name)}” · ${scopeLabel(scope)}`,scope};
    }
  }
  const prefix=cfopPrefixForScope(scope);
  const product=digits(args.productCfop);
  if(product.length===4){
    const same=activeCfops.find(row=>digits(row.code)===product&&digits(row.code).startsWith(prefix));
    if(same)return {code:product,source:'product_default',reason:`CFOP padrão do produto compatível com ${scopeLabel(scope)}.`,scope};
    const equivalent=`${prefix}${product.slice(1)}`;
    const counterpart=activeCfops.find(row=>digits(row.code)===equivalent);
    if(counterpart)return {code:equivalent,source:'counterpart',reason:`CFOP equivalente encontrado no catálogo geral para ${scopeLabel(scope)}.`,scope};
  }
  return {code:'',source:'none',reason:`Nenhuma regra automática ou CFOP equivalente foi encontrado para ${scopeLabel(scope)}.`,scope};
}
