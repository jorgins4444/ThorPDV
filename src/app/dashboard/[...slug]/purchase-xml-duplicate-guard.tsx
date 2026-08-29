'use client';

import { ReactNode, useEffect } from 'react';
import { purchaseXmlPrecheck } from './purchase-actions';

function onlyDigits(value:unknown){return String(value??'').replace(/\D/g,'')}

function accessKeyFromXml(raw:string){
  const byId=raw.match(/\bId=["']NFe(\d{44})["']/i)?.[1];
  if(byId)return onlyDigits(byId);
  return onlyDigits(raw.match(/<chNFe>(\d{44})<\/chNFe>/i)?.[1]);
}

export function PurchaseXmlDuplicateGuard({children}:{children:ReactNode}){
  useEffect(()=>{
    const original=File.prototype.text;
    const guarded=async function(this:File){
      const raw=await original.call(this);
      if(!this.name.toLowerCase().endsWith('.xml'))return raw;

      const key=accessKeyFromXml(raw);
      if(key.length!==44)return raw;

      const result=await purchaseXmlPrecheck(key);
      if(!result.ok){
        throw new Error('Não foi possível verificar se esta NF-e já foi importada. Tente selecionar o XML novamente.');
      }
      if(result.already_imported){
        const purchaseNumber=String(result.purchase_number??'').trim();
        const documentNumber=String(result.document_number??'').trim();
        const detail=purchaseNumber
          ?` Ela já está registrada como compra nº ${purchaseNumber}${documentNumber?` (NF-e ${documentNumber})`:''}.`
          :'';
        throw new Error(`NF-e já importada.${detail} O XML não foi carregado novamente.`);
      }
      return raw;
    };

    File.prototype.text=guarded;
    return ()=>{if(File.prototype.text===guarded)File.prototype.text=original};
  },[]);

  return <>{children}</>;
}
