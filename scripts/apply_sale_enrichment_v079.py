from pathlib import Path
p=Path('desktop-pdv/agent/index.js')
s=p.read_text()
old="fiscalSale(key){ const sale=this.store.fiscalSale(key); if(!sale) throw new Error('sale_not_found'); return sale; }"
new="fiscalSale(key){ const sale=this.store.fiscalSale(key); if(!sale) throw new Error('sale_not_found'); const items=(sale.items||[]).map(i=>{const product=i.product_id?this.store.product(String(i.product_id)):null;return {...i,name:i.name||i.description||product?.name||'',description:i.description||i.name||product?.name||'',sku:i.sku||product?.sku||product?.code||'',unit:i.unit||product?.unit||''};}); return {...sale,items}; }"
if old not in s: raise SystemExit('fiscalSale method marker not found')
s=s.replace(old,new,1)
p.write_text(s)
