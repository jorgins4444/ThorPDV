function json(value,fallback={}){try{return JSON.parse(value||'')}catch{return fallback}}
function text(value){return String(value??'').trim()}
function obj(value){return value&&typeof value==='object'&&!Array.isArray(value)?value:{}}

function installSalesSessionV107(ThorAgent){
  const originalStatus=ThorAgent.prototype.status;
  const originalSetCommercialContext=ThorAgent.prototype.setCommercialContext;
  const originalFinalizeSale=ThorAgent.prototype.finalizeSale;

  ThorAgent.prototype.salesSessionRules=function(){
    const context=json(this.store.get('context','{}'),{});
    const params=obj(context.pdv_parameters);
    const rules=obj(params.sales_session);
    return {
      require_seller:Boolean(rules.require_seller),
      require_customer:Boolean(rules.require_customer),
      customer_mode:['default','fixed'].includes(text(rules.customer_mode))?text(rules.customer_mode):'free',
      default_customer:obj(rules.default_customer),
      updated_at:text(rules.updated_at)||null,
    };
  };

  ThorAgent.prototype.status=async function(...args){
    const result=await originalStatus.apply(this,args);
    return {...result,salesSessionRules:this.salesSessionRules()};
  };

  ThorAgent.prototype.setCommercialContext=function(input={}){
    if(input&&input.salesSessionContext===true){
      this._salesSessionV107={
        sellerUserId:text(input.sellerUserId)||null,
        sellerName:text(input.sellerName)||null,
        customerId:text(input.customerId)||null,
        customerName:text(input.customerName)||null,
        setAt:new Date().toISOString(),
      };
      return {ok:true,salesSessionContext:this._salesSessionV107};
    }
    return originalSetCommercialContext.call(this,input);
  };

  ThorAgent.prototype.finalizeSale=async function(input={}){
    const session=this._salesSessionV107||{};
    const rules=this.salesSessionRules();
    const order=this._commercialV070?.order||null;
    const defaultCustomer=obj(rules.default_customer);
    let customerId=text(input.customerId)||null;
    let sellerUserId=text(input.sellerUserId)||text(session.sellerUserId)||null;
    let sellerName=text(session.sellerName)||'';

    if(order){
      customerId=text(order.customer_id)||customerId;
      sellerUserId=text(order.seller_user_id)||sellerUserId;
    }else if(rules.customer_mode==='fixed'){
      customerId=text(defaultCustomer.id)||null;
      if(!customerId)throw new Error('fixed_customer_not_configured');
    }else if(rules.customer_mode==='default'&&!customerId){
      customerId=text(defaultCustomer.id)||null;
    }

    if(rules.require_seller&&!sellerUserId)throw new Error('seller_required');
    if(rules.require_customer&&!customerId)throw new Error('customer_required_by_sales_rule');

    if(sellerUserId){
      const seller=(typeof this.staffUsers==='function'?this.staffUsers():[]).find(row=>text(row.id)===sellerUserId&&row.active!==false);
      if(!seller)throw new Error('invalid_seller');
      sellerName=text(seller.name)||sellerName;
    }

    try{
      const result=await originalFinalizeSale.call(this,{...input,customerId});
      if(result?.eventId){
        const row=this.store.db.prepare('select payload from queue where id=?').get(result.eventId);
        if(row){
          const payload={...json(row.payload,{}),seller_user_id:sellerUserId||null};
          this.store.db.prepare('update queue set payload=?,updated_at=? where id=?').run(JSON.stringify(payload),new Date().toISOString(),result.eventId);
        }
        const receipt=this.store.receiptByEvent?.(result.eventId);
        if(receipt){
          const payload={...receipt.payload,seller:sellerUserId?{id:sellerUserId,name:sellerName}:null,customerId:customerId||null};
          this.store.db.prepare('update receipts set payload=? where event_id=?').run(JSON.stringify(payload),result.eventId);
          if(result.receipt)result.receipt={...result.receipt,seller:payload.seller,customerId:customerId||null};
        }
      }
      return {...result,sellerUserId:sellerUserId||null,sellerName:sellerName||null,customerId:customerId||null};
    }finally{
      this._salesSessionV107=null;
    }
  };
}

module.exports={installSalesSessionV107};
