(()=>{
  'use strict';

  const PAGE_SIZE=10;
  let rows=[];
  let filtered=[];
  let page=1;
  let sort='name';
  let query='';
  let loading=false;

  const esc=(value)=>String(value??'').replace(/[&<>"']/g,(c)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money=(value)=>Number(value||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
  const num=(value)=>Number(value||0).toLocaleString('pt-BR',{maximumFractionDigits:3});
  const text=(value)=>String(value??'').trim();
  const code=(p)=>text(p.sku||p.code||p.codigo||p.id);
  const price=(p)=>Number(p.base_price??p.sale_price??p.price??0);
  const stock=(p)=>Number(p.quantity??p.stock??p.estoque??0);
  const ncm=(p)=>text(p.ncm||p.ncm_code||p.ncmCode||p.fiscal_ncm||p.fiscal?.ncm)||'—';
  const brand=(p)=>text(p.brand_name||p.brand||p.marca||p.brand?.name)||'—';
  const ean=(p)=>{
    const list=Array.isArray(p.barcodes)?p.barcodes:[];
    return text(list[0]||p.ean||p.gtin||p.barcode)||'—';
  };

  function injectStyle(){
    if(document.getElementById('thorProductConsultaV081Style'))return;
    const style=document.createElement('style');
    style.id='thorProductConsultaV081Style';
    style.textContent=`
      #thorProductConsultaBtn{display:inline-flex;align-items:center;gap:7px}
      #thorProductConsultaBtn .thor-prod-icon{font-size:15px;line-height:1}
      .thor-prod-backdrop{position:fixed;inset:0;z-index:2147483000;background:rgba(9,13,22,.60);backdrop-filter:blur(3px);display:flex;align-items:stretch;justify-content:flex-end}
      .thor-prod-panel{width:min(1180px,94vw);height:100%;background:#f7f8fb;box-shadow:-18px 0 48px rgba(0,0,0,.25);display:flex;flex-direction:column;color:#19202d;animation:thorProdIn .18s ease-out}
      @keyframes thorProdIn{from{transform:translateX(36px);opacity:.6}to{transform:none;opacity:1}}
      .thor-prod-head{display:flex;align-items:center;justify-content:space-between;padding:20px 24px;background:#fff;border-bottom:1px solid #e4e8ef}
      .thor-prod-head h2{margin:0;font-size:22px}.thor-prod-head small{display:block;margin-top:4px;color:#687386}
      .thor-prod-close{border:0;background:#eef1f6;border-radius:10px;width:40px;height:40px;font-size:22px;cursor:pointer;color:#2a3443}
      .thor-prod-toolbar{padding:16px 24px;background:#fff;border-bottom:1px solid #e4e8ef;display:grid;grid-template-columns:1fr 230px auto;gap:12px;align-items:center}
      .thor-prod-toolbar input,.thor-prod-toolbar select{height:42px;border:1px solid #cfd6e2;border-radius:9px;background:#fff;padding:0 12px;font:inherit;color:#1c2532;outline:none}
      .thor-prod-toolbar input:focus,.thor-prod-toolbar select:focus{border-color:#6d5dfc;box-shadow:0 0 0 3px rgba(109,93,252,.12)}
      .thor-prod-refresh{height:42px;border:0;border-radius:9px;padding:0 16px;background:#ece9ff;color:#4739bb;font-weight:700;cursor:pointer}
      .thor-prod-content{flex:1;min-height:0;overflow:auto;padding:18px 24px 12px}
      .thor-prod-summary{display:flex;justify-content:space-between;gap:12px;align-items:center;margin-bottom:12px;color:#687386;font-size:13px}
      .thor-prod-table-wrap{background:#fff;border:1px solid #e2e6ed;border-radius:12px;overflow:auto}
      .thor-prod-table{width:100%;border-collapse:collapse;min-width:940px}
      .thor-prod-table th{position:sticky;top:0;z-index:1;background:#f3f5f8;text-align:left;padding:11px 12px;font-size:12px;text-transform:uppercase;letter-spacing:.03em;color:#657085;border-bottom:1px solid #dde2ea}
      .thor-prod-table td{padding:12px;border-bottom:1px solid #eef1f5;font-size:14px;vertical-align:middle}.thor-prod-table tr:last-child td{border-bottom:0}
      .thor-prod-table tbody tr{cursor:pointer}.thor-prod-table tbody tr:hover{background:#fafaff}
      .thor-prod-name{font-weight:750;color:#18212d}.thor-prod-code{font-family:Consolas,monospace;color:#455065}.thor-prod-price{font-weight:800;color:#3326a8;white-space:nowrap}
      .thor-stock{display:inline-flex;align-items:center;justify-content:center;min-width:60px;padding:5px 9px;border-radius:999px;font-weight:800;background:#e9f7ef;color:#1f7a47}
      .thor-stock.low{background:#fff4d9;color:#976309}.thor-stock.zero{background:#fde8e8;color:#b42318}
      .thor-prod-empty,.thor-prod-loading{padding:48px 20px;text-align:center;color:#6e788a;background:#fff;border-radius:12px;border:1px dashed #d8dde6}
      .thor-prod-foot{padding:14px 24px 18px;background:#fff;border-top:1px solid #e4e8ef;display:flex;align-items:center;justify-content:space-between;gap:16px}
      .thor-prod-pages{display:flex;align-items:center;gap:8px}.thor-prod-pages button{height:38px;border:1px solid #d4dae4;background:#fff;border-radius:8px;padding:0 14px;font-weight:700;cursor:pointer}.thor-prod-pages button:disabled{opacity:.45;cursor:default}
      .thor-prod-detail{position:absolute;right:28px;top:86px;width:min(440px,88vw);background:#fff;border-radius:14px;box-shadow:0 22px 70px rgba(0,0,0,.28);border:1px solid #e2e6ed;overflow:hidden;z-index:2147483100}
      .thor-prod-detail-head{padding:18px 20px;background:linear-gradient(135deg,#3424a5,#6d5dfc);color:#fff}.thor-prod-detail-head h3{margin:0 36px 4px 0}.thor-prod-detail-head small{opacity:.82}
      .thor-prod-detail-close{position:absolute;right:12px;top:12px;border:0;background:rgba(255,255,255,.16);color:#fff;width:32px;height:32px;border-radius:8px;font-size:18px;cursor:pointer}
      .thor-prod-detail-body{padding:18px 20px;display:grid;grid-template-columns:1fr 1fr;gap:12px}.thor-prod-field{padding:10px 12px;border-radius:9px;background:#f6f7fa}.thor-prod-field small{display:block;color:#758094;margin-bottom:3px}.thor-prod-field b{display:block;overflow-wrap:anywhere}.thor-prod-field.wide{grid-column:1/-1}
      @media(max-width:820px){.thor-prod-toolbar{grid-template-columns:1fr}.thor-prod-panel{width:100vw}.thor-prod-detail-body{grid-template-columns:1fr}}
    `;
    document.head.appendChild(style);
  }

  function ensureButton(){
    injectStyle();
    const host=document.querySelector('.top-right');
    if(!host||document.getElementById('thorProductConsultaBtn'))return;
    const btn=document.createElement('button');
    btn.id='thorProductConsultaBtn';
    btn.className='nav-button';
    btn.type='button';
    btn.innerHTML='<span class="thor-prod-icon">▦</span> Produtos';
    btn.title='Consulta geral de produtos';
    btn.addEventListener('click',open);
    const fiscal=document.getElementById('navFiscal');
    if(fiscal?.nextSibling)host.insertBefore(btn,fiscal.nextSibling);else host.appendChild(btn);
  }

  function modal(){return document.getElementById('thorProductConsultaV081');}

  async function open(){
    if(modal())return;
    const root=document.createElement('div');
    root.id='thorProductConsultaV081';
    root.className='thor-prod-backdrop';
    root.innerHTML=`<section class="thor-prod-panel" role="dialog" aria-modal="true" aria-label="Consulta geral de produtos">
      <header class="thor-prod-head"><div><h2>Consulta geral de produtos</h2><small>Catálogo local do caixa • 10 produtos por página</small></div><button class="thor-prod-close" type="button" aria-label="Fechar">×</button></header>
      <div class="thor-prod-toolbar"><input id="thorProdSearch" autocomplete="off" placeholder="Pesquisar por nome, código, EAN, NCM ou marca"><select id="thorProdSort"><option value="name">Nome (A–Z)</option><option value="code">Código</option><option value="priceAsc">Menor preço</option><option value="priceDesc">Maior preço</option><option value="stockAsc">Menor estoque</option><option value="stockDesc">Maior estoque</option></select><button class="thor-prod-refresh" id="thorProdRefresh" type="button">Atualizar lista</button></div>
      <main class="thor-prod-content" id="thorProdContent"><div class="thor-prod-loading">Carregando produtos…</div></main>
      <footer class="thor-prod-foot"><span id="thorProdPageInfo">Página 1</span><div class="thor-prod-pages"><button id="thorProdPrev" type="button">Anterior</button><button id="thorProdNext" type="button">Próxima</button></div></footer>
    </section>`;
    document.body.appendChild(root);
    root.querySelector('.thor-prod-close').onclick=close;
    root.addEventListener('mousedown',(event)=>{if(event.target===root)close();});
    root.querySelector('#thorProdSearch').addEventListener('input',(event)=>{query=event.target.value;page=1;apply();});
    root.querySelector('#thorProdSort').addEventListener('change',(event)=>{sort=event.target.value;page=1;apply();});
    root.querySelector('#thorProdRefresh').onclick=load;
    root.querySelector('#thorProdPrev').onclick=()=>{if(page>1){page--;render();}};
    root.querySelector('#thorProdNext').onclick=()=>{const pages=Math.max(1,Math.ceil(filtered.length/PAGE_SIZE));if(page<pages){page++;render();}};
    document.addEventListener('keydown',onKey);
    await load();
    root.querySelector('#thorProdSearch')?.focus();
  }

  function close(){
    document.removeEventListener('keydown',onKey);
    modal()?.remove();
  }
  function onKey(event){if(event.key==='Escape'&&modal()){event.preventDefault();close();}}

  async function load(){
    if(loading)return;
    loading=true;
    const content=document.getElementById('thorProdContent');
    if(content)content.innerHTML='<div class="thor-prod-loading">Carregando produtos…</div>';
    try{
      const result=await window.thor.allProducts();
      rows=Array.isArray(result)?result:[];
      page=1;
      apply();
    }catch(error){
      if(content)content.innerHTML=`<div class="thor-prod-empty"><b>Não foi possível carregar a consulta.</b><br>${esc(error?.message||error)}</div>`;
    }finally{loading=false;}
  }

  function apply(){
    const q=query.trim().toLocaleLowerCase('pt-BR');
    filtered=rows.filter((p)=>{
      if(!q)return true;
      const hay=[p.name,code(p),ean(p),ncm(p),brand(p),...(Array.isArray(p.barcodes)?p.barcodes:[])].map(text).join(' ').toLocaleLowerCase('pt-BR');
      return hay.includes(q);
    });
    filtered.sort((a,b)=>{
      if(sort==='code')return code(a).localeCompare(code(b),'pt-BR',{numeric:true,sensitivity:'base'});
      if(sort==='priceAsc')return price(a)-price(b);
      if(sort==='priceDesc')return price(b)-price(a);
      if(sort==='stockAsc')return stock(a)-stock(b);
      if(sort==='stockDesc')return stock(b)-stock(a);
      return text(a.name).localeCompare(text(b.name),'pt-BR',{sensitivity:'base'});
    });
    const pages=Math.max(1,Math.ceil(filtered.length/PAGE_SIZE));
    if(page>pages)page=pages;
    render();
  }

  function render(){
    const content=document.getElementById('thorProdContent');
    if(!content)return;
    const pages=Math.max(1,Math.ceil(filtered.length/PAGE_SIZE));
    const start=(page-1)*PAGE_SIZE;
    const current=filtered.slice(start,start+PAGE_SIZE);
    if(!current.length){
      content.innerHTML='<div class="thor-prod-empty"><b>Nenhum produto encontrado.</b><br>Altere a pesquisa ou atualize a lista.</div>';
    }else{
      content.innerHTML=`<div class="thor-prod-summary"><span><b>${filtered.length}</b> produto(s) encontrado(s)</span><span>Exibindo ${start+1}–${Math.min(start+PAGE_SIZE,filtered.length)}</span></div><div class="thor-prod-table-wrap"><table class="thor-prod-table"><thead><tr><th>Nome</th><th>Código</th><th>Preço</th><th>NCM</th><th>Estoque</th><th>Marca</th><th>EAN</th></tr></thead><tbody>${current.map((p,index)=>{
        const qty=stock(p);const stockClass=qty<=0?'zero':qty<=3?'low':'';
        return `<tr data-index="${start+index}"><td class="thor-prod-name">${esc(p.name||'Sem descrição')}</td><td class="thor-prod-code">${esc(code(p)||'—')}</td><td class="thor-prod-price">${money(price(p))}</td><td>${esc(ncm(p))}</td><td><span class="thor-stock ${stockClass}">${num(qty)}</span></td><td>${esc(brand(p))}</td><td class="thor-prod-code">${esc(ean(p))}</td></tr>`;
      }).join('')}</tbody></table></div>`;
      content.querySelectorAll('tbody tr').forEach((tr)=>tr.addEventListener('click',()=>showDetail(filtered[Number(tr.dataset.index)])));
    }
    const info=document.getElementById('thorProdPageInfo');if(info)info.textContent=`Página ${page} de ${pages}`;
    const prev=document.getElementById('thorProdPrev');if(prev)prev.disabled=page<=1;
    const next=document.getElementById('thorProdNext');if(next)next.disabled=page>=pages;
  }

  function showDetail(p){
    document.getElementById('thorProductDetailV081')?.remove();
    if(!p)return;
    const box=document.createElement('aside');
    box.id='thorProductDetailV081';
    box.className='thor-prod-detail';
    const qty=stock(p);
    box.innerHTML=`<div class="thor-prod-detail-head"><button class="thor-prod-detail-close" type="button">×</button><h3>${esc(p.name||'Produto')}</h3><small>${esc(code(p)||'Sem código')}</small></div><div class="thor-prod-detail-body">
      <div class="thor-prod-field"><small>Preço</small><b>${money(price(p))}</b></div><div class="thor-prod-field"><small>Estoque</small><b>${num(qty)} ${esc(p.unit||'')}</b></div>
      <div class="thor-prod-field"><small>NCM</small><b>${esc(ncm(p))}</b></div><div class="thor-prod-field"><small>Marca</small><b>${esc(brand(p))}</b></div>
      <div class="thor-prod-field wide"><small>EAN / Códigos de barras</small><b>${esc((Array.isArray(p.barcodes)&&p.barcodes.length?p.barcodes.join(' • '):ean(p)))}</b></div>
      <div class="thor-prod-field"><small>Unidade</small><b>${esc(p.unit||'—')}</b></div><div class="thor-prod-field"><small>Última atualização</small><b>${esc(p.updated_at?new Date(p.updated_at).toLocaleString('pt-BR'):'—')}</b></div>
    </div>`;
    modal()?.querySelector('.thor-prod-panel')?.appendChild(box);
    box.querySelector('.thor-prod-detail-close').onclick=()=>box.remove();
  }

  const observer=new MutationObserver(()=>ensureButton());
  observer.observe(document.documentElement,{childList:true,subtree:true});
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',ensureButton,{once:true});else ensureButton();
})();
