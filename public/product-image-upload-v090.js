(()=>{
  const TARGET=320000;
  const MAX_SIDE=1280;

  async function canvasBlob(canvas,type,quality){
    return new Promise((resolve)=>canvas.toBlob(resolve,type,quality));
  }

  async function compress(file){
    if(!file||file.size<=TARGET)return file;
    if(!String(file.type||'').startsWith('image/'))return file;
    const url=URL.createObjectURL(file);
    try{
      const img=await new Promise((resolve,reject)=>{
        const el=new Image();
        el.onload=()=>resolve(el);
        el.onerror=()=>reject(new Error('image_decode_failed'));
        el.src=url;
      });
      let width=img.naturalWidth||img.width;
      let height=img.naturalHeight||img.height;
      const scale=Math.min(1,MAX_SIDE/Math.max(width,height));
      width=Math.max(1,Math.round(width*scale));
      height=Math.max(1,Math.round(height*scale));
      const canvas=document.createElement('canvas');
      canvas.width=width;canvas.height=height;
      const ctx=canvas.getContext('2d',{alpha:false});
      if(!ctx)return file;
      ctx.fillStyle='#fff';ctx.fillRect(0,0,width,height);ctx.drawImage(img,0,0,width,height);
      let blob=null;
      for(const quality of [.82,.72,.62,.52,.44]){
        blob=await canvasBlob(canvas,'image/webp',quality);
        if(blob&&blob.size<=TARGET)break;
      }
      if(!blob)return file;
      const name=String(file.name||'produto').replace(/\.[^.]+$/,'')+'.webp';
      return new File([blob],name,{type:'image/webp',lastModified:Date.now()});
    }finally{URL.revokeObjectURL(url);}
  }

  document.addEventListener('change',async event=>{
    const input=event.target;
    if(!(input instanceof HTMLInputElement)||input.type!=='file'||!input.closest('.image-field'))return;
    if(input.dataset.thorCompressed==='1'){delete input.dataset.thorCompressed;return;}
    const file=input.files?.[0];
    if(!file||file.size<=TARGET)return;
    event.preventDefault();event.stopImmediatePropagation();
    try{
      input.disabled=true;
      const compact=await compress(file);
      const transfer=new DataTransfer();transfer.items.add(compact);input.files=transfer.files;
      input.dataset.thorCompressed='1';
      input.disabled=false;
      input.dispatchEvent(new Event('change',{bubbles:true}));
    }catch(error){
      input.disabled=false;
      console.warn('thor_product_image_compress_failed',error);
      const transfer=new DataTransfer();transfer.items.add(file);input.files=transfer.files;
      input.dataset.thorCompressed='1';
      input.dispatchEvent(new Event('change',{bubbles:true}));
    }
  },true);
})();
