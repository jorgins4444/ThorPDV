function text(value){ return String(value ?? '').trim(); }
function sleep(ms){ return new Promise(resolve=>setTimeout(resolve,ms)); }
function htmlEscape(value){ return String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function center(value,width){
  const raw=text(value);
  const valueText=raw.length>width?raw.slice(0,width):raw;
  const left=Math.max(Math.floor((width-valueText.length)/2),0);
  return `${' '.repeat(left)}${valueText}`.padEnd(width,' ').slice(0,width);
}
function staffUsers(agent){
  try{
    if(typeof agent.staffUsers==='function'){
      const rows=agent.staffUsers();
      if(Array.isArray(rows)) return rows;
    }
  }catch{}
  try{
    const rows=JSON.parse(agent.store.get('staff_users','[]')||'[]');
    return Array.isArray(rows)?rows:[];
  }catch{return [];}
}
function currentOperator(agent){
  try{const op=agent.currentOperator?.();if(op?.id)return op;}catch{}
  const id=text(agent.store.get('current_operator_id',''));
  return staffUsers(agent).find(row=>text(row.id)===id)||null;
}
function sellerFor(agent,input,operator){
  const orderSeller=text(agent._commercialV070?.order?.seller_user_id);
  const configured=text(agent.store.get('sale_seller_user_id',''));
  const requested=orderSeller||text(input?.sellerUserId)||text(input?.seller_user_id)||configured||text(operator?.id);
  return staffUsers(agent).find(row=>text(row.id)===requested)||operator||null;
}
function receiptEventId(saleKey){
  const key=text(saleKey);
  return key.startsWith('local:')?key.slice(6):'';
}
function receiptServerNumber(agent,eventId){
  const row=agent.store.receiptByEvent(eventId);
  return text(row?.server_number);
}
function queuedSaleEvent(agent,eventId){
  const row=agent.store.db.prepare('select id,type,payload,state,last_error from queue where id=?').get(eventId);
  if(!row)return null;
  let payload={};
  try{payload=JSON.parse(row.payload||'{}');}catch{}
  return {...row,payload};
}
async function waitForServerNumber(agent,saleKey){
  const eventId=receiptEventId(saleKey);
  if(!eventId)return;
  if(receiptServerNumber(agent,eventId))return;

  // finalizeSale já dispara a sincronização em background. Damos uma janela curta
  // para aproveitar a resposta que já estiver chegando, sem iniciar outro ciclo completo.
  const graceDeadline=Date.now()+180;
  while(Date.now()<graceDeadline){
    if(receiptServerNumber(agent,eventId))return;
    const queued=queuedSaleEvent(agent,eventId);
    if(queued?.state==='rejected')throw new Error('sale_sync_rejected');
    await sleep(30);
  }

  // Caminho rápido da impressão direta: envia apenas o evento da venda. O endpoint
  // /push devolve o número sequencial na própria resposta e applyPushResults grava
  // server_number no recibo local. O servidor é idempotente pelo client_event_id,
  // então é seguro caso o sync de background esteja enviando a mesma venda.
  const queued=queuedSaleEvent(agent,eventId);
  if(queued?.state==='rejected')throw new Error('sale_sync_rejected');
  if(queued&&queued.state==='pending'&&queued.type==='sale_completed'&&typeof agent.sync?.pushEvents==='function'){
    try{
      await Promise.race([
        agent.sync.pushEvents([{id:eventId,type:queued.type,payload:queued.payload}]),
        sleep(2500).then(()=>{throw new Error('fast_sale_push_timeout');}),
      ]);
    }catch(error){
      // Se a rede estiver lenta, a sincronização de background pode concluir logo
      // depois. Não iniciamos sync.run(true), pois esse era justamente o delay.
      if(text(error?.message)==='sale_sync_rejected')throw error;
    }
  }

  if(receiptServerNumber(agent,eventId))return;
  const deadline=Date.now()+3500;
  while(Date.now()<deadline){
    if(receiptServerNumber(agent,eventId))return;
    const current=queuedSaleEvent(agent,eventId);
    if(current?.state==='rejected')throw new Error('sale_sync_rejected');
    await sleep(50);
  }
  throw new Error('sale_number_pending_sync');
}
function identityName(sale,kind){
  if(kind==='operator')return text(sale?.operator_name)||text(sale?.operator?.name)||text(sale?.operatorName);
  return text(sale?.seller_name)||text(sale?.seller?.name)||text(sale?.sellerName)||identityName(sale,'operator');
}
function saleNumber(sale){ return text(sale?.number)||text(sale?.server_number); }
function adjustText(raw,sale,columns,type){
  const width=Number(columns)===65?65:44;
  const lines=String(raw||'').split('\n');
  const number=saleNumber(sale);
  const operator=identityName(sale,'operator');
  const seller=identityName(sale,'seller');

  if(type!=='nfce'){
    const saleIndex=lines.findIndex(line=>/^VENDA\s/.test(line)||/^VENDA$/.test(line));
    if(saleIndex>=0) lines[saleIndex]=center(number?`VENDA ${number}`:'VENDA - AGUARDANDO SINCRONIZACAO',width);
    const dateIndex=lines.findIndex(line=>/^DATA\s/.test(line)||/^DATA$/.test(line));
    if(dateIndex>=0){
      const old=String(lines[dateIndex]);
      const dateValue=old.replace(/^DATA\s*/,'').trim();
      lines[dateIndex]=center(`DATA ${dateValue}`,width);
      const add=[];
      if(operator)add.push(`OPERADOR: ${operator}`.slice(0,width));
      if(seller)add.push(`VENDEDOR: ${seller}`.slice(0,width));
      if(add.length) lines.splice(dateIndex+1,0,...add);
    }
  }else{
    const emissionIndex=lines.findIndex(line=>String(line).trim().startsWith('EMISSAO:'));
    if(emissionIndex>=0){
      const add=[];
      if(operator)add.push(`OPERADOR: ${operator}`.slice(0,width));
      if(seller)add.push(`VENDEDOR: ${seller}`.slice(0,width));
      if(add.length) lines.splice(emissionIndex+1,0,...add);
    }
  }
  return lines.map(line=>String(line).slice(0,width)).join('\n');
}
function replacePre(html,body){
  if(!html)return html;
  return String(html).replace(/<pre>[\s\S]*?<\/pre>/i,`<pre>${htmlEscape(body)}</pre>`);
}

function installSaleIdentityV830(ThorAgent,Store){
  if(!ThorAgent||!Store||ThorAgent.prototype.__saleIdentityV830)return;

  if(!Store.prototype.__saleSellerSettingV830){
    const originalSettings=Store.prototype.settings;
    const originalSaveSettings=Store.prototype.saveSettings;
    Store.prototype.settings=function(...args){
      const base=originalSettings.apply(this,args);
      return {...base,saleSellerUserId:this.get('sale_seller_user_id','')||''};
    };
    Store.prototype.saveSettings=function(input={}){
      if(Object.prototype.hasOwnProperty.call(input,'saleSellerUserId')) this.set('sale_seller_user_id',text(input.saleSellerUserId));
      return originalSaveSettings.call(this,input);
    };
    Store.prototype.__saleSellerSettingV830=true;
  }

  const originalEvent=ThorAgent.prototype.event;
  ThorAgent.prototype.event=function(type,payload={}){
    if(type==='sale_completed'&&this.__saleIdentityContext){
      payload={...payload,
        operator_user_id:this.__saleIdentityContext.operator?.id||payload.operator_user_id||null,
        seller_user_id:this.__saleIdentityContext.seller?.id||payload.seller_user_id||this.__saleIdentityContext.operator?.id||null,
      };
    }
    return originalEvent.call(this,type,payload);
  };

  const originalFinalize=ThorAgent.prototype.finalizeSale;
  ThorAgent.prototype.finalizeSale=async function(input={}){
    const operator=currentOperator(this);
    const seller=sellerFor(this,input,operator);
    this.__saleIdentityContext={operator,seller};
    try{
      const result=await originalFinalize.call(this,input);
      if(result?.eventId){
        const receipt=this.store.receiptByEvent(result.eventId);
        if(receipt){
          const payload={...(receipt.payload||{}),operator:operator?{id:operator.id,name:operator.name}:null,seller:seller?{id:seller.id,name:seller.name}:null};
          this.store.db.prepare('update receipts set payload=? where event_id=?').run(JSON.stringify(payload),result.eventId);
          if(result.receipt)result.receipt={...result.receipt,operator:payload.operator,seller:payload.seller};
        }
      }
      return result;
    }finally{this.__saleIdentityContext=null;}
  };

  const originalDocumentData=ThorAgent.prototype.documentData;
  ThorAgent.prototype.documentData=function(saleKey,type='pre_sale'){
    const doc=originalDocumentData.call(this,saleKey,type);
    const columns=Number(doc.receiptColumns||this.settings?.().receiptColumns)===65?65:44;
    let sale={...(doc.sale||{})};
    const eventId=receiptEventId(saleKey)||text(sale.client_event_id);
    if(eventId){
      const receipt=this.store.receiptByEvent(eventId);
      if(receipt?.payload){
        sale={...sale,
          number:sale.number||receipt.server_number||null,
          operator:sale.operator||receipt.payload.operator||null,
          seller:sale.seller||receipt.payload.seller||null,
        };
      }
    }
    const adjusted=adjustText(doc.text,sale,columns,type);
    return {...doc,sale,text:adjusted,html:replacePre(doc.html,adjusted)};
  };

  const originalPrint=ThorAgent.prototype.printDocument;
  ThorAgent.prototype.printDocument=async function(saleKey,type='pre_sale'){
    await waitForServerNumber(this,saleKey);
    return originalPrint.call(this,saleKey,type);
  };

  ThorAgent.prototype.__saleIdentityV830=true;
}

module.exports={installSaleIdentityV830,waitForServerNumber,adjustText};
