function installProductImagesV090(){
  const { Store } = require('./store');
  if(Store.prototype.__productImagesV090) return;
  Store.prototype.__productImagesV090 = true;

  const originalMigrate = Store.prototype.migrate;
  Store.prototype.migrate = function(){
    originalMigrate.call(this);
    const cols = new Set(this.db.prepare('pragma table_info(products)').all().map(row=>row.name));
    const add = (name,definition)=>{ if(!cols.has(name)) this.db.exec(`alter table products add column ${name} ${definition}`); };
    add('product_code', "text not null default ''");
    add('image_url', "text not null default ''");
    add('menu_image_url', "text not null default ''");
    add('self_service_image_url', "text not null default ''");
  };

  const originalApplyPull = Store.prototype.applyPull;
  Store.prototype.applyPull = function(data){
    originalApplyPull.call(this,data);
    const products = Array.isArray(data?.products) ? data.products : [];
    if(!products.length) return;
    const update = this.db.prepare(`update products
      set product_code=?, image_url=?, menu_image_url=?, self_service_image_url=?
      where id=?`);
    const tx = this.db.transaction(()=>{
      for(const product of products){
        update.run(
          String(product?.product_code ?? ''),
          String(product?.image_url ?? ''),
          String(product?.menu_image_url ?? ''),
          String(product?.self_service_image_url ?? ''),
          String(product?.id ?? '')
        );
      }
    });
    tx();
  };
}

module.exports={installProductImagesV090};
