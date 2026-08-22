function htmlEscape(value){
  return String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function dedupeIdentityLines(raw){
  const lines=String(raw||'').split('\n');
  let operatorSeen=false;
  let sellerSeen=false;
  const out=[];
  for(const line of lines){
    const normalized=String(line||'').trim().toUpperCase();
    if(normalized.startsWith('OPERADOR:')){
      if(operatorSeen) continue;
      operatorSeen=true;
    }
    if(normalized.startsWith('VENDEDOR:')){
      if(sellerSeen) continue;
      sellerSeen=true;
    }
    out.push(line);
  }
  return out.join('\n');
}

function replacePre(html,body){
  if(!html)return html;
  return String(html).replace(/<pre>[\s\S]*?<\/pre>/i,`<pre>${htmlEscape(body)}</pre>`);
}

function installReceiptIdentityDedupeV0915(ThorAgent){
  if(!ThorAgent||ThorAgent.prototype.__receiptIdentityDedupeV0915)return;
  const originalDocumentData=ThorAgent.prototype.documentData;
  ThorAgent.prototype.documentData=function(...args){
    const doc=originalDocumentData.apply(this,args);
    if(!doc||typeof doc.text!=='string')return doc;
    const text=dedupeIdentityLines(doc.text);
    return {...doc,text,html:replacePre(doc.html,text)};
  };
  ThorAgent.prototype.__receiptIdentityDedupeV0915=true;
}

module.exports={installReceiptIdentityDedupeV0915,dedupeIdentityLines};
