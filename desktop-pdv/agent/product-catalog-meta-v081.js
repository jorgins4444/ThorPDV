'use strict';

function installProductCatalogMetaV081(Store){
  if(!Store||Store.prototype.__thorProductCatalogMetaV081)return;
  Store.prototype.__thorProductCatalogMetaV081=true;

  const originalMigrate=Store.prototype.migrate;
  Store.prototype.migrate=function productCatalogMetaMigrateV081(...args){
    const result=originalMigrate.apply(this,args);
    try{
      const cols=new Set(this.db.prepare('pragma table_info(products)').all().map((row)=>row.name));
      if(!cols.has('ncm'))this.db.exec("alter table products add column ncm text not null default ''");
      if(!cols.has('brand_name'))this.db.exec("alter table products add column brand_name text not null default ''");
      if(!cols.has('cost_price'))this.db.exec('alter table products add column cost_price real not null default 0');
      if(!cols.has('last_sale_at'))this.db.exec("alter table products add column last_sale_at text not null default ''");
      if(!cols.has('stock_locations'))this.db.exec("alter table products add column stock_locations text not null default '[]'");
    }catch(error){
      try{this.metric?.('catalog.meta.migrate_error',0,{message:String(error?.message||error)});}catch{}
    }
    return result;
  };

  const originalApplyPull=Store.prototype.applyPull;
  Store.prototype.applyPull=function productCatalogMetaApplyPullV081(data){
    const result=originalApplyPull.call(this,data);
    try{
      const byLocation=new Map();
      for(const item of data?.inventory||[]){
        const productId=String(item?.product_id||'');
        if(!productId)continue;
        const locationName=String(item?.location_name||item?.stock_location_name||item?.warehouse_name||item?.location?.name||item?.warehouse?.name||'').trim();
        if(!locationName)continue;
        const list=byLocation.get(productId)||[];
        list.push({name:locationName,quantity:Number(item?.quantity||0),reserved:Number(item?.reserved_quantity||0)});
        byLocation.set(productId,list);
      }

      const lastSale=new Map();
      for(const sale of data?.sales_history||[]){
        const at=String(sale?.completed_at||sale?.created_at||sale?.updated_at||'');
        for(const item of sale?.items||sale?.sale_items||[]){
          const productId=String(item?.product_id||'');
          if(!productId)continue;
          const previous=lastSale.get(productId)||'';
          if(at && (!previous || Date.parse(at)>Date.parse(previous)))lastSale.set(productId,at);
        }
      }

      const stmt=this.db.prepare('update products set ncm=?,brand_name=?,cost_price=?,last_sale_at=?,stock_locations=? where id=?');
      const tx=this.db.transaction((products)=>{
        for(const p of products||[]){
          const fiscal=p?.fiscal||{};
          const ncm=String(p?.ncm||p?.ncm_code||p?.ncmCode||p?.fiscal_ncm||fiscal?.ncm||'').trim();
          const brand=String(p?.brand_name||p?.brand?.name||p?.brand||p?.marca||'').trim();
          const cost=Number(p?.cost_price??p?.purchase_price??p?.average_cost??p?.custo??p?.preco_custo??0)||0;
          const id=String(p.id);
          stmt.run(ncm,brand,cost,lastSale.get(id)||String(p?.last_sale_at||''),JSON.stringify(byLocation.get(id)||[]),id);
        }
      });
      tx(data?.products||[]);
    }catch(error){
      try{this.metric?.('catalog.meta.apply_error',0,{message:String(error?.message||error)});}catch{}
    }
    return result;
  };
}

module.exports={installProductCatalogMetaV081};
