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
    }catch(error){
      try{this.metric?.('catalog.meta.migrate_error',0,{message:String(error?.message||error)});}catch{}
    }
    return result;
  };

  const originalApplyPull=Store.prototype.applyPull;
  Store.prototype.applyPull=function productCatalogMetaApplyPullV081(data){
    const result=originalApplyPull.call(this,data);
    try{
      const stmt=this.db.prepare('update products set ncm=?,brand_name=? where id=?');
      const tx=this.db.transaction((products)=>{
        for(const p of products||[]){
          const fiscal=p?.fiscal||{};
          const ncm=String(p?.ncm||p?.ncm_code||p?.ncmCode||p?.fiscal_ncm||fiscal?.ncm||'').trim();
          const brand=String(p?.brand_name||p?.brand?.name||p?.brand||p?.marca||'').trim();
          stmt.run(ncm,brand,String(p.id));
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
