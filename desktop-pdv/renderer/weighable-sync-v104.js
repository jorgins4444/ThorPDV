(()=>{
  if(typeof v3Reprice!=='function')return;
  const previousReprice=v3Reprice;
  v3Reprice=async function(){
    const result=await previousReprice();
    const quote=typeof v3State==='function'?v3State().quote:null;
    const rows=Array.isArray(quote?.items)?quote.items:[];
    const adjusted=[];
    for(const row of rows){
      const item=state.cart.find(x=>String(x.productId)===String(row.productId));
      if(!item)continue;
      const before=Number(item.quantity||0),after=Number(row.quantity||0);
      if(!Number.isFinite(after)||after<=0||Math.abs(before-after)<0.000001)continue;
      item.quantity=after;
      adjusted.push({before,after,unit:item.unit||'KG'});
    }
    if(adjusted.length){
      v3RenderCart();
      const first=adjusted[0];
      if(typeof showToast==='function')showToast(`Peso ajustado: ${first.before} g = ${first.after.toFixed(3).replace(/\.000$/,'')} ${first.unit}.`);
    }
    return result;
  };
  repriceCart=v3Reprice;
})();
