(()=>{
  const TARGET_BYTES=320000;
  const PDV_WIDTH=600;
  const PDV_HEIGHT=500;
  const MAIN_TITLE='Imagem do produto';
  const STYLE_ID='thor-product-crop-v091-style';

  const text=(v)=>String(v||'').trim();
  const isMainField=(input)=>text(input.closest('.image-field')?.querySelector('h3')?.textContent).toLowerCase()===MAIN_TITLE.toLowerCase();

  function injectStyle(){
    if(document.getElementById(STYLE_ID))return;
    const style=document.createElement('style');style.id=STYLE_ID;
    style.textContent=`
      .thor-image-spec{margin:10px 0 2px;padding:10px 11px;border:1px solid #d9cdf5;border-radius:10px;background:#faf8ff;color:#5d3d9b;display:grid;gap:3px;font-size:12px;line-height:1.4}.thor-image-spec strong{font-size:12px;color:#4e2c91}.thor-image-spec small{font-size:11px;color:#766b87}.thor-image-adjust{margin-left:7px;border:1px solid #d7c7f3;background:#fff;color:#6d40bd;border-radius:8px;padding:9px 11px;font-weight:750;cursor:pointer}.thor-image-adjust:hover{background:#f8f4ff}.image-field.thor-pdv-main-image{border-color:#cdb9ef;box-shadow:0 0 0 2px rgba(116,65,215,.05)}.image-field.thor-pdv-main-image .image-preview{height:auto!important;aspect-ratio:6/5!important;background:linear-gradient(135deg,#faf9fc,#fff)!important}.image-field.thor-pdv-main-image .image-preview img{object-fit:contain!important;background:#fff}
      .thor-crop-overlay{position:fixed;inset:0;z-index:99999;background:rgba(24,20,38,.68);display:grid;place-items:center;padding:18px;box-sizing:border-box;backdrop-filter:blur(3px)}.thor-crop-card{width:min(920px,calc(100vw - 36px));max-height:calc(100vh - 36px);overflow:auto;background:#fff;border-radius:18px;box-shadow:0 24px 80px rgba(20,14,38,.35);padding:18px;box-sizing:border-box;color:#242038}.thor-crop-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:14px}.thor-crop-head small{display:block;color:#7541d2;font-weight:900;font-size:11px;letter-spacing:.05em}.thor-crop-head h2{margin:3px 0 4px;font-size:21px}.thor-crop-head p{margin:0;color:#797384;font-size:12px}.thor-crop-close{border:0;background:#f4f1f8;color:#625b6e;width:34px;height:34px;border-radius:50%;font-size:22px;cursor:pointer}.thor-crop-body{display:grid;grid-template-columns:minmax(360px,1fr) 280px;gap:18px}.thor-crop-stage{min-height:430px;border-radius:14px;background:#eeecf2;display:grid;place-items:center;padding:14px;box-sizing:border-box;overflow:hidden}.thor-crop-stage canvas{display:block;width:min(100%,600px);height:auto;aspect-ratio:6/5;background:#fff;border-radius:10px;box-shadow:0 8px 22px rgba(28,20,44,.14)}.thor-crop-tools{display:flex;flex-direction:column;gap:12px}.thor-crop-mode{display:grid;grid-template-columns:1fr 1fr;gap:7px}.thor-crop-mode button{height:42px;border:1px solid #ddd8e6;border-radius:10px;background:#fff;color:#645f6f;font-weight:750;cursor:pointer}.thor-crop-mode button.active{border-color:#8050d5;background:#f4effd;color:#6e3cc6}.thor-crop-control{display:grid;gap:6px}.thor-crop-control label{font-size:12px;font-weight:750;color:#5c5665}.thor-crop-control input[type=range]{width:100%;accent-color:#7541d2}.thor-crop-hint{border:1px solid #ded3f2;background:#faf8ff;border-radius:11px;padding:10px;color:#6a5f77;font-size:11px;line-height:1.45}.thor-crop-hint b{color:#5e34a9}.thor-crop-actions{margin-top:auto;display:grid;grid-template-columns:1fr 1.25fr;gap:8px}.thor-crop-actions button{height:44px;border-radius:10px;font-weight:800;cursor:pointer}.thor-crop-cancel{border:1px solid #ddd9e3;background:#fff;color:#625d68}.thor-crop-apply{border:0;background:linear-gradient(135deg,#7541d2,#8b55df);color:#fff}.thor-crop-apply:disabled{opacity:.6;cursor:wait}.thor-crop-size{display:flex;align-items:center;justify-content:space-between;border:1px solid #ece8f1;border-radius:10px;padding:9px 10px;font-size:11px;color:#716b79}.thor-crop-size strong{color:#3d3850}
      @media(max-width:760px){.thor-crop-body{grid-template-columns:1fr}.thor-crop-stage{min-height:300px}.thor-crop-card{padding:13px}.thor-crop-tools{gap:9px}}
    `;
    document.head.appendChild(style);
  }

  function canvasBlob(canvas,type,quality){return new Promise(resolve=>canvas.toBlob(resolve,type,quality));}
  async function loadImage(source){
    return await new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=()=>reject(new Error('Não foi possível abrir a imagem.'));img.src=source;});
  }
  function fileToUrl(file){return URL.createObjectURL(file);}

  async function exportCanvas(canvas,name='produto'){
    let blob=null;
    for(const quality of [.9,.82,.74,.66,.58,.5]){
      blob=await canvasBlob(canvas,'image/webp',quality);
      if(blob&&blob.size<=TARGET_BYTES)break;
    }
    if(!blob)throw new Error('Não foi possível processar a imagem.');
    return new File([blob],`${text(name).replace(/\.[^.]+$/,'')||'produto'}-thorpdv.webp`,{type:'image/webp',lastModified:Date.now()});
  }

  function openCrop({source,name,onApply}){
    injectStyle();
    let mode='cover',zoom=1,panX=0,panY=0,img=null,busy=false;
    const overlay=document.createElement('div');overlay.className='thor-crop-overlay';
    overlay.innerHTML=`<section class="thor-crop-card"><div class="thor-crop-head"><div><small>IMAGEM PRINCIPAL • THORPDV</small><h2>Ajustar imagem do produto</h2><p>O resultado será padronizado exatamente para o formato visual usado nos cards da grade do PDV.</p></div><button class="thor-crop-close" type="button">×</button></div><div class="thor-crop-body"><div class="thor-crop-stage"><canvas width="${PDV_WIDTH}" height="${PDV_HEIGHT}"></canvas></div><aside class="thor-crop-tools"><div class="thor-crop-size"><span>Tamanho final</span><strong>${PDV_WIDTH} × ${PDV_HEIGHT} px • 6:5</strong></div><div class="thor-crop-mode"><button class="active" type="button" data-mode="cover">Preencher card</button><button type="button" data-mode="contain">Imagem inteira</button></div><div class="thor-crop-control"><label>Zoom</label><input data-control="zoom" type="range" min="100" max="250" value="100"></div><div class="thor-crop-control"><label>Posição horizontal</label><input data-control="x" type="range" min="-100" max="100" value="0"></div><div class="thor-crop-control"><label>Posição vertical</label><input data-control="y" type="range" min="-100" max="100" value="0"></div><div class="thor-crop-hint"><b>Padrão ThorPDV:</b> use <b>Preencher card</b> para ocupar toda a área 6:5 e ajuste o enquadramento pelos controles. Use <b>Imagem inteira</b> quando não quiser cortar nenhuma parte do produto.</div><div class="thor-crop-actions"><button class="thor-crop-cancel" type="button">Cancelar</button><button class="thor-crop-apply" type="button">Aplicar ajuste</button></div></aside></div></section>`;
    document.body.appendChild(overlay);
    const canvas=overlay.querySelector('canvas'),ctx=canvas.getContext('2d',{alpha:false});
    const render=()=>{
      if(!img||!ctx)return;
      const W=PDV_WIDTH,H=PDV_HEIGHT,sw=img.naturalWidth||img.width,sh=img.naturalHeight||img.height;
      ctx.fillStyle='#fff';ctx.fillRect(0,0,W,H);
      const base=mode==='contain'?Math.min(W/sw,H/sh):Math.max(W/sw,H/sh);
      const scale=base*zoom;
      const dw=sw*scale,dh=sh*scale;
      const overflowX=Math.max(0,(dw-W)/2),overflowY=Math.max(0,(dh-H)/2);
      const dx=(W-dw)/2+(panX/100)*overflowX;
      const dy=(H-dh)/2+(panY/100)*overflowY;
      ctx.drawImage(img,dx,dy,dw,dh);
    };
    const syncControls=()=>{
      overlay.querySelectorAll('[data-mode]').forEach(b=>b.classList.toggle('active',b.dataset.mode===mode));
      const disabled=mode==='contain';
      overlay.querySelector('[data-control="x"]').disabled=disabled;
      overlay.querySelector('[data-control="y"]').disabled=disabled;
    };
    overlay.querySelectorAll('[data-mode]').forEach(button=>button.onclick=()=>{mode=button.dataset.mode;zoom=1;panX=0;panY=0;overlay.querySelector('[data-control="zoom"]').value='100';overlay.querySelector('[data-control="x"]').value='0';overlay.querySelector('[data-control="y"]').value='0';syncControls();render();});
    overlay.querySelector('[data-control="zoom"]').oninput=e=>{zoom=Number(e.target.value)/100;render();};
    overlay.querySelector('[data-control="x"]').oninput=e=>{panX=Number(e.target.value);render();};
    overlay.querySelector('[data-control="y"]').oninput=e=>{panY=Number(e.target.value);render();};
    const close=()=>overlay.remove();overlay.querySelector('.thor-crop-close').onclick=close;overlay.querySelector('.thor-crop-cancel').onclick=close;
    overlay.addEventListener('mousedown',e=>{if(e.target===overlay)close();});
    overlay.querySelector('.thor-crop-apply').onclick=async()=>{if(busy||!img)return;busy=true;const button=overlay.querySelector('.thor-crop-apply');button.disabled=true;button.textContent='Processando...';try{const file=await exportCanvas(canvas,name);await onApply(file);close();}catch(error){button.disabled=false;button.textContent='Aplicar ajuste';alert(error?.message||String(error));}finally{busy=false;}};
    void loadImage(source).then(value=>{img=value;render();syncControls();}).catch(error=>{close();alert(error?.message||String(error));});
  }

  async function compactGeneric(file){
    if(!file||file.size<=TARGET_BYTES)return file;
    if(!text(file.type).startsWith('image/'))return file;
    const source=fileToUrl(file);
    try{
      const img=await loadImage(source);let width=img.naturalWidth||img.width,height=img.naturalHeight||img.height;
      const scale=Math.min(1,1280/Math.max(width,height));width=Math.max(1,Math.round(width*scale));height=Math.max(1,Math.round(height*scale));
      const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;const ctx=canvas.getContext('2d',{alpha:false});if(!ctx)return file;ctx.fillStyle='#fff';ctx.fillRect(0,0,width,height);ctx.drawImage(img,0,0,width,height);return await exportCanvas(canvas,file.name);
    }finally{URL.revokeObjectURL(source);}
  }

  function dispatchProcessed(input,file){
    const transfer=new DataTransfer();transfer.items.add(file);input.files=transfer.files;input.dataset.thorProcessed='1';input.dispatchEvent(new Event('change',{bubbles:true}));
  }

  document.addEventListener('change',event=>{
    const input=event.target;
    if(!(input instanceof HTMLInputElement)||input.type!=='file'||!input.closest('.image-field'))return;
    if(input.dataset.thorProcessed==='1'){delete input.dataset.thorProcessed;return;}
    const file=input.files?.[0];if(!file)return;
    event.preventDefault();event.stopImmediatePropagation();
    if(isMainField(input)){
      const source=fileToUrl(file);
      openCrop({source,name:file.name,onApply:async processed=>{URL.revokeObjectURL(source);dispatchProcessed(input,processed);}});
      return;
    }
    void compactGeneric(file).then(processed=>dispatchProcessed(input,processed)).catch(error=>{console.warn('thor_product_image_compress_failed',error);dispatchProcessed(input,file);});
  },true);

  function enhanceFields(){
    injectStyle();
    document.querySelectorAll('.image-field').forEach(field=>{
      const title=text(field.querySelector('h3')?.textContent);
      if(title.toLowerCase()!==MAIN_TITLE.toLowerCase())return;
      field.classList.add('thor-pdv-main-image');
      if(!field.querySelector('.thor-image-spec')){
        const spec=document.createElement('div');spec.className='thor-image-spec';spec.innerHTML='<strong>Padrão da Grade do ThorPDV: 600 × 500 px (proporção 6:5)</strong><small>Ao selecionar uma foto, você poderá enquadrar, aplicar zoom ou usar “Imagem inteira” para evitar cortes.</small>';
        const fileButton=field.querySelector('.file-button');fileButton?.insertAdjacentElement('afterend',spec);
      }
      const preview=field.querySelector('.image-preview');const img=preview?.querySelector('img');
      let adjust=field.querySelector('.thor-image-adjust');
      if(img&&!adjust){adjust=document.createElement('button');adjust.type='button';adjust.className='thor-image-adjust';adjust.textContent='Ajustar / recortar imagem atual';field.querySelector('.file-button')?.insertAdjacentElement('afterend',adjust);adjust.onclick=()=>{const current=field.querySelector('.image-preview img');if(!current?.src)return;openCrop({source:current.src,name:'produto-atual',onApply:async processed=>{const input=field.querySelector('input[type=file]');if(input)dispatchProcessed(input,processed);}});};}
      if(!img&&adjust)adjust.remove();
    });
  }
  new MutationObserver(enhanceFields).observe(document.documentElement,{childList:true,subtree:true});
  enhanceFields();
})();
