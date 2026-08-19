const { Store } = require('./store');

function json(value,fallback){try{return JSON.parse(value||'')}catch{return fallback}}
function text(value){return String(value??'').trim()}
function num(value){const n=Number(value||0);return Number.isFinite(n)?n:0}

function installSalesOptionsV071(ThorAgent){
  const originalMigrate=Store.prototype.migrate;
  const originalApplyPull=Store.prototype.applyPull;
  const originalStatus=ThorAgent.prototype.status;
  const originalFinalizeSale=ThorAgent.prototype.finalizeSale;

  Store.prototype.migrate=function(){
    originalMigrate.call(this);
    this.db.exec(`
      create table if not exists sales_payment_methods_local(
        code text primary key,name text not null,category text,sort_order integer not null default 100,
        supports_card integer not null default 0,supports_installments integer not null default 0,payload text not null default '{}'
      );
      create table if not exists card_brands_local(code text primary key,name text not null,sort_order integer not null default 100,payload text not null default '{}');
      create table if not exists card_acquirers_local(cnpj text primary key,name text not null,preferred integer not null default 0,payload text not null default '{}');
      create table if not exists credit_installments_local(installments integer primary key,interest_percent real not null default 0,payload text not null default '{}');
    `);
  };

  Store.prototype.applyPull=function(data){
    originalApplyPull.call(this,data);
    const hasMethods=Array.isArray(data?.sales_payment_methods);
    const hasBrands=Array.isArray(data?.card_brands);
    const hasAcquirers=Array.isArray(data?.card_acquirers);
    const hasInstallments=Array.isArray(data?.credit_installments);
    if(!hasMethods&&!hasBrands&&!hasAcquirers&&!hasInstallments)return;
    const tx=this.db.transaction(()=>{
      if(hasMethods){this.db.prepare('delete from sales_payment_methods_local').run();const q=this.db.prepare('insert into sales_payment_methods_local(code,name,category,sort_order,supports_card,supports_installments,payload) values(?,?,?,?,?,?,?)');for(const x of data.sales_payment_methods)q.run(text(x.code),text(x.name),text(x.category),Number(x.sort_order||100),x.supports_card?1:0,x.supports_installments?1:0,JSON.stringify(x));}
      if(hasBrands){this.db.prepare('delete from card_brands_local').run();const q=this.db.prepare('insert into card_brands_local(code,name,sort_order,payload) values(?,?,?,?)');for(const x of data.card_brands)q.run(text(x.code),text(x.name),Number(x.sort_order||100),JSON.stringify(x));}
      if(hasAcquirers){this.db.prepare('delete from card_acquirers_local').run();const q=this.db.prepare('insert into card_acquirers_local(cnpj,name,preferred,payload) values(?,?,?,?)');for(const x of data.card_acquirers)q.run(text(x.cnpj),text(x.name),x.preferred?1:0,JSON.stringify(x));}
      if(hasInstallments){this.db.prepare('delete from credit_installments_local').run();const q=this.db.prepare('insert into credit_installments_local(installments,interest_percent,payload) values(?,?,?)');for(const x of data.credit_installments)q.run(Number(x.installments||1),num(x.interest_percent),JSON.stringify(x));}
    });tx();
  };

  Store.prototype.salesOptions=function(){
    const methods=this.db.prepare('select payload from sales_payment_methods_local order by sort_order,name').all().map(r=>json(r.payload,{}));
    const brands=this.db.prepare('select payload from card_brands_local order by sort_order,name').all().map(r=>json(r.payload,{}));
    const acquirers=this.db.prepare('select payload from card_acquirers_local order by preferred desc,name,cnpj').all().map(r=>json(r.payload,{}));
    const installments=this.db.prepare('select payload from credit_installments_local order by installments').all().map(r=>json(r.payload,{}));
    return {payment_methods:methods,card_brands:brands,card_acquirers:acquirers,credit_installments:installments,payment_terms:typeof this.paymentTerms==='function'?this.paymentTerms():[]};
  };
  ThorAgent.prototype.salesOptions=function(){return this.store.salesOptions()};

  ThorAgent.prototype.status=async function(){const r=await originalStatus.call(this);return {...r,salesOptions:this.salesOptions()};};

  ThorAgent.prototype.finalizeSale=async function(input={}){
    const options=this.salesOptions();
    const methods=new Set((options.payment_methods||[]).map(x=>text(x.code)));
    const brands=new Set((options.card_brands||[]).map(x=>text(x.code)));
    const acquirers=new Set((options.card_acquirers||[]).map(x=>text(x.cnpj)));
    const installments=new Set((options.credit_installments||[]).map(x=>Number(x.installments||1)));
    for(const p of input.payments||[]){
      const method=text(p.method);
      if(methods.size&&!methods.has(method))throw new Error('payment_method_not_enabled');
      if(method==='credit_card'||method==='debit_card'){
        const meta=p.metadata||{};const brand=text(meta.card_brand_code||p.cardBrandCode);const acquirer=text(meta.card_acquirer_cnpj||p.provider);const count=method==='credit_card'?Number(meta.card_installments||p.cardInstallments||1):1;
        if(brands.size&&!brands.has(brand))throw new Error('card_brand_required_or_not_enabled');
        if(acquirers.size&&!acquirers.has(acquirer))throw new Error('card_acquirer_required_or_not_enabled');
        if(method==='credit_card'&&installments.size&&!installments.has(count))throw new Error('credit_installment_not_enabled');
        p.provider=acquirer;p.metadata={...meta,card_brand_code:brand,card_acquirer_cnpj:acquirer,card_installments:count};
      }
    }
    return originalFinalizeSale.call(this,input);
  };
}

module.exports={installSalesOptionsV071};
