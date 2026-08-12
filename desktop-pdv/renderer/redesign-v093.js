(function(){
  let queued=false;
  const num=v=>{const n=Number(v||0);return Number.isFinite(n)?n:0;};
  const br=v=>num(v).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
  const html=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  function apply(){
    queued=false;
    const box=document.getElementById('products');
    if(!box)return;
    const listMode=box.classList.contains('v090-product-list');
    const products=Array.isArray(state?.products)?state.products:[];
    box.querySelectorAll('.v089-product-card').forEach((card,index)=>{
      const product=products[index];
      if(!product)return;
      const noPhoto=card.classList.contains('v090-no-photo') || !String(product.image_url||product.imageUrl||product.menu_image_url||product.menuImageUrl||product.thumbnail_url||product.thumbnailUrl||'').trim();
      card.classList.toggle('v093-grid-no-photo',noPhoto&&!listMode);
      if(!noPhoto)return;
      const media=card.querySelector('.v088-product-media');
      if(!media)return;

      // Remove qualquer placeholder legado (inclusive unidade renderizada em tamanho de ícone).
      [...media.children].forEach(child=>{
        if(child.classList?.contains('v089-badges'))return;
        if(child.classList?.contains('v093-no-photo-content'))return;
        child.remove();
      });

      let content=media.querySelector('.v093-no-photo-content');
      if(!content){content=document.createElement('div');content.className='v093-no-photo-content';media.appendChild(content);}
      const price=num(product.base_price??product.sale_price);
      const unit=String(product.unit||'UN').trim().toUpperCase()||'UN';
      content.innerHTML=`<strong>${html(product.name||'Produto')}</strong><b>R$ ${br(price)}</b><small>${html(unit)}</small>`;
    });
  }
  function schedule(){if(queued)return;queued=true;requestAnimationFrame(apply);}
  new MutationObserver(schedule).observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:['class']});
  schedule();
})();
