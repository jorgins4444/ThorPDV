(()=>{
  'use strict';
  const PAGE_SIZE=10;
  let rows=[]; let filtered=[]; let page=1; let query='';
  const esc=(v)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot',"'":'&#39;'}[c]));
  const txt=(v)=>String(v??'').trim();
  const money=(v)=>Number(v||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
  const num=(v)=>Number(v||0).toLocaleString('pt-BR',{maximumFractionDigits:3});
  const code=(p)=>txt(p.sku||p.code||p.codigo||p.id)||'—';
  const price=(p)=>Number(p.base_price??p.sale_price??p.price??0);
  const stock=(p)=>Number(p.quantity??p.stock??p.estoque??0);
  const ncm=(p)=>txt(p.ncm||p.ncm_code||p.ncmCode||p.fiscal_ncm||p.fiscal?.ncm)||'—';
  const brand=(p)=>txt(p.brand_name||p.brand||p.marca||p.brand?.name)||'—';
  const ean=(p)=>{const b=Array.isArray(p.barcodes)?p.barcodes:[];return txt(b[0]||p.ean||p.gtin||p.barcode)||'—';};

  function style(){
    if(document.getElementById('thorConsultaV083Style'))return;
    const s=document.createElement('style');
    s.id='thorConsultaV083Style';
    s.textContent=`
      #thorConsultaGeralBtn{height:44px;min-width:138px;white-space:nowrap;border:1px solid rgba(255,255,255,.7);border-radius:12px;background:#fff;color:#6336d8;padding:0 16px;font-weight:800;cursor:pointer;box-shadow:0 3px 12px rgba(44,18,105,.15);margin-left:10px;align-self:center}
      #thorConsultaGeralBtn:hover{background:#f7f3ff;border-color:#fff;color:#4f22c2}
      .thorcg-modal{position:fixed;z-index:2147483000;inset:0;background:rgba(16,10,36,.58);display:grid;place-items:center;padding:24px;backdrop-filter:blur(2px)}
      .thorcg-card{width:min(1180px,96vw);height:min(760px,92vh);background:#f7f9f8;border-radius:18px;box-shadow:0 28px 90px rgba(0,0,0,.35);display:grid;grid-template-rows:auto auto minmax(0,1fr) auto;overflow:hidden;color:#202633}
      .thorcg-head{display:flex;justify-content:space-between;gap:20px;align-items:center;padding:20px 22px;background:#fff;border-bottom:1px solid #e3e8e5}
      .thorcg-head h2{margin:0;font-size:24px}.thorcg-head small{display:block;margin-top:4px;color:#748079}
      .thorcg-close{border:0;background:#f0ecff;color:#6336d8;width:40px;height:40px;border-radius:10px;font-size:22px;cursor:pointer}
      .thorcg-toolbar{display:flex;gap:10px;padding:14px 22px;background:#fff;border-bottom:1px solid #e3e8e5}
      .thorcg-toolbar input{height:46px;flex:1;border:1px solid #d6ddd9;border-radius:11px;padding:0 14px;font-size:16px;outline:none}.thorcg-toolbar input:focus{border-color:#7749e8;box-shadow:0 0 0 3px rgba(119,73,232,.12)}
      .thorcg-body{overflow:auto;padding:18px 22px}
      .thorcg-tablewrap{background:#fff;border:1px solid #e1e6e3;border-radius:14px;overflow:auto}
      .thorcg-table{width:100%;border-collapse:collapse;min-width:920px}.thorcg-table th{background:#f4f1fc;text-align:left;padding:11px 12px;font-size:11px;text-transform:uppercase;color:#655b7b;border-bottom:1px solid #ded7ef}
      .thorcg-table td{padding:12px;border-bottom:1px solid #edf1ee;font-size:14px}.thorcg-table tr:last-child td{border-bottom:0}.thorcg-name{font-weight:800}.thorcg-code{font-family:Consolas,monospace}.thorcg-price{font-weight:900;color:#6336d8}
      .thorcg-stock{display:inline-flex;min-width:58px;justify-content:center;border-radius:999px;padding:5px 8px;background:#eaf8f0;color:#176d41;font-weight:800}.thorcg-stock.zero{background:#fff0f1;color:#a72e38}.thorcg-stock.low{background:#fff6e8;color:#94621a}
      .thorcg-empty{padding:50px 20px;text-align:center;color:#7b8580}
      .thorcg-foot{padding:14px 22px;background:#fff;border-top:1px solid #e3e8e5;display:flex;justify-content:space-between;align-items:center}.thorcg-pages{display:flex;gap:8px}.thorcg-pages button{height:38px;padding:0 14px;border:1px solid #d9dfdc;background:#fff;border-radius:9px;font-weight:800;cursor:pointer}.thorcg-pages button:disabled{opacity:.45;cursor:default}
    `;
    document.head.appendChild(s);
  }

  function productSearchInput(){
    const inputs=[...document.querySelectorAll('input')];
    return inputs.find(input=>{
      const placeholder=String(input.getAttribute('placeholder')||'').toLocaleLowerCase('pt-BR');
      return placeholder.includes('buscar produto') || (placeholder.includes('produto') && (placeholder.includes('ean')||placeholder.includes('código')||placeholder.includes('codigo')));
    }) || document.querySelector('.search-row input.search');
  }

  function ensureButton(){
    style();
    document.getElementById('thorProductConsultaBtn')?.remove();
    const input=productSearchInput();
    if(!input)return;
    const existing=document.getElementById('thorConsultaGeralBtn');
    if(existing && existing.isConnected)return;
    const btn=document.createElement('button');
    btn.id='thorConsultaGeralBtn'; btn.type='button'; btn.textContent='Consulta geral';
    btn.title='Abrir consulta geral de produtos'; btn.onclick=open;
    const searchBox=input.parentElement;
    if(searchBox && searchBox.parentElement){
      searchBox.insertAdjacentElement('afterend',btn);
    }else{
      input.insertAdjacentElement('afterend',btn);
    }
  }

  function close(){document.getElementById('thorConsultaGeralModal')?.remove();document.removeEventListener('keydown',keyHandler);}
  function keyHandler(e){if(e.key==='Escape')close();}

  async function open(){
    if(document.getElementById('thorConsultaGeralModal'))return;
    const root=document.createElement('div'); root.id='thorConsultaGeralModal'; root.className='thorcg-modal';
    root.innerHTML=`<section class="thorcg-card"><header class="thorcg-head"><div><h2>Consulta geral de produtos</h2><small>Produtos em ordem alfabética • 10 por página</small></div><button class="thorcg-close" type="button">×</button></header><div class="thorcg-toolbar"><input id="thorCgSearch" placeholder="Pesquisar produto pelo nome" autocomplete="off"></div><main class="thorcg-body" id="thorCgBody"><div class="thorcg-empty">Carregando produtos...</div></main><footer class="thorcg-foot"><span id="thorCgInfo">Página 1</span><div class="thorcg-pages"><button id="thorCgPrev" type="button">Anterior</button><button id="thorCgNext" type="button">Próxima</button></div></footer></section>`;
    document.body.appendChild(root);
    root.querySelector('.thorcg-close').onclick=close;
    root.addEventListener('mousedown',e=>{if(e.target===root)close();});
    root.querySelector('#thorCgSearch').addEventListener('input',e=>{query=e.target.value;page=1;apply();});
    root.querySelector('#thorCgPrev').onclick=()=>{if(page>1){page--;render();}};
    root.querySelector('#thorCgNext').onclick=()=>{const pages=Math.max(1,Math.ceil(filtered.length/PAGE_SIZE));if(page<pages){page++;render();}};
    document.addEventListener('keydown',keyHandler);
    try{const r=await window.thor.allProducts();rows=Array.isArray(r)?r:[];page=1;query='';apply();root.querySelector('#thorCgSearch').focus();}
    catch(e){root.querySelector('#thorCgBody').innerHTML=`<div class="thorcg-empty"><b>Falha ao carregar produtos.</b><br>${esc(e?.message||e)}</div>`;}
  }

  function apply(){
    const q=query.trim().toLocaleLowerCase('pt-BR');
    filtered=rows.filter(p=>!q||txt(p.name).toLocaleLowerCase('pt-BR').includes(q));
    filtered.sort((a,b)=>txt(a.name).localeCompare(txt(b.name),'pt-BR',{sensitivity:'base',numeric:true}));
    const pages=Math.max(1,Math.ceil(filtered.length/PAGE_SIZE)); if(page>pages)page=pages; render();
  }

  function render(){
    const body=document.getElementById('thorCgBody'); if(!body)return;
    const pages=Math.max(1,Math.ceil(filtered.length/PAGE_SIZE)); const start=(page-1)*PAGE_SIZE; const current=filtered.slice(start,start+PAGE_SIZE);
    if(!current.length) body.innerHTML='<div class="thorcg-empty"><b>Nenhum produto encontrado.</b></div>';
    else body.innerHTML=`<div class="thorcg-tablewrap"><table class="thorcg-table"><thead><tr><th>Nome</th><th>Código</th><th>Preço</th><th>NCM</th><th>Estoque</th><th>Marca</th><th>EAN</th></tr></thead><tbody>${current.map(p=>{const q=stock(p),cls=q<=0?'zero':q<=3?'low':'';return `<tr><td class="thorcg-name">${esc(p.name||'Sem descrição')}</td><td class="thorcg-code">${esc(code(p))}</td><td class="thorcg-price">${money(price(p))}</td><td>${esc(ncm(p))}</td><td><span class="thorcg-stock ${cls}">${num(q)}</span></td><td>${esc(brand(p))}</td><td class="thorcg-code">${esc(ean(p))}</td></tr>`;}).join('')}</tbody></table></div>`;
    const info=document.getElementById('thorCgInfo'); if(info)info.textContent=`Página ${page} de ${pages} • ${filtered.length} produto(s)`;
    const prev=document.getElementById('thorCgPrev'); const next=document.getElementById('thorCgNext'); if(prev)prev.disabled=page<=1; if(next)next.disabled=page>=pages;
  }

  const obs=new MutationObserver(()=>ensureButton()); obs.observe(document.documentElement,{subtree:true,childList:true});
  setInterval(ensureButton,1000);
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',ensureButton,{once:true});else ensureButton();
})();
