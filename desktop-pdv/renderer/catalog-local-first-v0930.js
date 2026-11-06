(()=>{
'use strict';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=v=>Number(v||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const errors={
  permission_denied:'Operador sem permissão para essa ação. Libere no perfil PDV do ThorGestão.',
  operator_required:'Faça login como operador do caixa.',
  customer_name_required:'Informe o nome do cliente.',
  invalid_document:'CPF ou CNPJ inválido.',
  document_already_registered:'Já existe cliente com esse documento.',
  product_name_required:'Informe o nome do produto.',
  invalid_price:'Informe valores válidos e não negativos.',
  invalid_ncm:'NCM deve conter exatamente 8 dígitos.',
  invalid_unit:'Unidade de medida inválida.',
  insufficient_stock:'Estoque insuficiente para a retirada.',
  reason_required:'Informe o motivo do ajuste de estoque.',
  category_not_found:'A categoria precisa estar cadastrada anteriormente no ThorGestão.',
  product_not_found:'Produto não localizado.',
  catalog_service_unavailable:'Serviço de sincronização temporariamente indisponível.'
};
let panel=null, tab='customers', search='', products=[], customers=[], busy=false, selected=null;
const title={customers:'Cadastro de Clientes',products:'Produtos e Preços',create:'Cadastrar Produto',history:'Sincronização'};
const field=(name,label,value='',type='text',extra='')=>`<label><span>${esc(label)}</span><input name="${name}" type="${type}" value="${esc(value)}" ${extra}></label>`;
const select=(name,label,options,current)=>`<label><span>${esc(label)}</span><select name="${name}">${options.map(([id,text])=>`<option value="${esc(id)}" ${String(id)===String(current)?'selected':''}>${esc(text)}</option>`).join('')}</select></label>`;
const controls=()=>`<div class="cl930-head"><div><small>THORPDV • CADASTROS LOCAIS</small><h2>${title[tab]}</h2><p>Os dados são gravados neste caixa primeiro. A sincronização com o ThorGestão acontece automaticamente.</p></div><button class="cl930-close" id="cl930Close" aria-label="Fechar">×</button></div>
<div class="cl930-tabs">${[['customers','Clientes'],['products','Preços / Estoque'],['create','Novo Produto'],['history','Sincronização']].map(([id,label])=>`<button data-cl930-tab="${id}" class="${tab===id?'on':''}">${label}</button>`).join('')}</div><div id="cl930Body"></div><div class="cl930-feedback" id="cl930Feedback" role="status"></div>`;
function message(text,kind=''){const el=panel?.querySelector('#cl930Feedback');if(el){el.textContent=text;el.className='cl930-feedback '+kind;}}
function err(e){return errors[String(e?.message||e)]||String(e?.message||e||'Não foi possível concluir a operação.');}
function formData(form){return Object.fromEntries(new FormData(form).entries());}
async function save(kind,body){
  if(busy)return;
  busy=true;message('Salvando no banco local...');
  try{
    const result=await window.thor.catalogSave(kind,body);
    if(!result?.ok)throw new Error(result?.error||'operation_failed');
    message('Salvo neste caixa. Envio automático ao ThorGestão pendente.','good');
    selected=null;
    if(tab==='products'||tab==='create')products=await window.thor.allProducts();
    if(tab==='customers')customers=await window.thor.customers(search);
    // Preserve feedback while keeping the current form ready for another entry.
    if(kind==='product_create')panel.querySelector('#cl930Body form')?.reset();
    if(kind==='customer_save')panel.querySelector('#cl930Body form')?.reset();
    if(kind==='product_price'||kind==='stock_adjust')renderBody();
  }catch(e){message(err(e),'bad');}
  finally{busy=false;}
}
async function load(){
  if(!panel)return;
  try{
    if(tab==='products')products=await window.thor.allProducts();
    if(tab==='customers')customers=await window.thor.customers(search);
  }catch(e){message(err(e),'bad');}
  renderBody();
}
function customerForm(row={}){
  return `<form id="cl930Customer" class="cl930-form">
    <input type="hidden" name="id" value="${esc(row.id||'')}">
    ${select('type','Tipo de pessoa',[['PF','Pessoa física'],['PJ','Pessoa jurídica']],row.type||'PF')}
    ${field('name','Nome / Razão social',row.name||'','text','required maxlength="240"')}
    ${field('document','CPF / CNPJ',row.document||'','text','inputmode="numeric"')}
    ${field('email','E-mail',row.email||'','email')}
    ${field('phone','Telefone',row.phone||'','tel')}
    <div class="cl930-actions"><button type="submit" class="cl930-primary">Salvar cliente no caixa</button><button type="button" id="cl930Clear">Limpar</button></div>
  </form>`;
}
function productForm(){
  return `<form id="cl930Product" class="cl930-form">
  ${field('name','Nome do produto','','text','required maxlength="240"')}
  ${select('unit','Unidade de medida',[['UN','Unidade (UN)'],['KG','Quilograma (KG)'],['G','Grama (G)'],['L','Litro (L)'],['ML','Mililitro (ML)'],['CX','Caixa (CX)'],['PC','Peça (PC)'],['FD','Fardo (FD)'],['MT','Metro (MT)']],'UN')}
  ${field('cost_price','Preço de custo','0','number','required step="0.0001" min="0"')}
  ${field('sale_price','Preço de venda','0','number','required step="0.0001" min="0"')}
  ${field('category','Categoria existente no ThorGestão','','text','maxlength="150"')}
  ${field('ncm','NCM (8 dígitos)','','text','pattern="[0-9]{8}" inputmode="numeric" maxlength="8"')}
  <p class="cl930-note">Categoria opcional; quando informada, deve corresponder a um grupo já cadastrado no ThorGestão. O tratamento fiscal completo continua sendo definido no ThorGestão antes de emitir documentos fiscais.</p>
  <div class="cl930-actions"><button class="cl930-primary" type="submit">Cadastrar produto no caixa</button></div></form>`;
}
function matchesProduct(p){const q=search.toLowerCase().trim();return !q||[p.sku,p.name,p.id].some(v=>String(v||'').toLowerCase().includes(q));}
function renderBody(){
  if(!panel)return;
  const body=panel.querySelector('#cl930Body');if(!body)return;
  if(tab==='customers'){
    body.innerHTML=`<div class="cl930-search"><input id="cl930Search" placeholder="Pesquisar clientes por nome ou documento" value="${esc(search)}"><button id="cl930SearchButton">Pesquisar</button></div>
      ${customerForm(selected||{})}<h3>Clientes encontrados</h3><div class="cl930-list">${customers.map(c=>`<button data-cl930-customer="${esc(c.id)}"><b>${esc(c.name)}</b><small>${esc(c.document||'Sem documento')} • ${esc(c.phone||'')}</small></button>`).join('')||'<p>Nenhum cliente encontrado.</p>'}</div>`;
    body.querySelector('#cl930Customer').onsubmit=e=>{e.preventDefault();save('customer_save',formData(e.currentTarget));};
    body.querySelector('#cl930Clear').onclick=()=>{selected=null;renderBody();};
    body.querySelector('#cl930SearchButton').onclick=()=>{search=body.querySelector('#cl930Search').value.trim();load();};
    body.querySelector('#cl930Search').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();search=e.target.value.trim();load();}};
    body.querySelectorAll('[data-cl930-customer]').forEach(b=>b.onclick=()=>{selected=customers.find(c=>String(c.id)===String(b.dataset.cl930Customer))||null;renderBody();});
  }else if(tab==='create'){
    body.innerHTML=productForm();
    body.querySelector('#cl930Product').onsubmit=e=>{e.preventDefault();save('product_create',formData(e.currentTarget));};
  }else if(tab==='products'){
    const matches=products.filter(matchesProduct).slice(0,100);
    body.innerHTML=`<div class="cl930-search"><input id="cl930Search" placeholder="Pesquisar produto por nome ou código" value="${esc(search)}"></div>
    <div class="cl930-list cl930-products">${matches.map(p=>`<article>
      <div><b>${esc(p.name)}</b><small>${esc(p.sku||'')} • ${esc(p.unit||'UN')} • Estoque: ${Number(p.quantity||0).toLocaleString('pt-BR',{maximumFractionDigits:3})}</small></div>
      <strong>${money(p.base_price??p.sale_price)}</strong>
      <button data-cl930-price="${esc(p.id)}">Preço</button>
      <button data-cl930-stock="${esc(p.id)}">Estoque</button>
    </article>`).join('')||'<p>Nenhum produto encontrado.</p>'}</div>
    <div id="cl930Edit"></div>`;
    body.querySelector('#cl930Search').oninput=e=>{search=e.target.value;renderBody();body.querySelector('#cl930Search')?.focus();};
    body.querySelectorAll('[data-cl930-price]').forEach(b=>b.onclick=()=>openProductEdit(b.dataset.cl930Price,'product_price'));
    body.querySelectorAll('[data-cl930-stock]').forEach(b=>b.onclick=()=>openProductEdit(b.dataset.cl930Stock,'stock_adjust'));
  }else if(tab==='history'){
    body.innerHTML='<p>Consultando registros locais...</p>';
    window.thor.catalogStatus().then(rows=>{
      if(tab!=='history'||!panel)return;
      body.innerHTML=`<div class="cl930-actions"><button id="cl930ForceSync" class="cl930-primary">Sincronizar agora</button><button id="cl930Reload">Atualizar</button></div><div class="cl930-list">${rows.map(r=>`<article><div><b>${esc({customer_save:'Cliente',product_create:'Novo produto',product_price:'Preço de venda',stock_adjust:'Ajuste de estoque'}[r.kind]||r.kind)}</b><small>${esc(r.created_at)} • ${esc(r.error||'')}</small></div><strong>${esc({pending:'Pendente',retry:'Tentando novamente',synced:'Sincronizado',rejected:'Rejeitado'}[r.state]||r.state)}</strong></article>`).join('')||'<p>Nenhuma alteração local registrada.</p>'}</div>`;
      body.querySelector('#cl930ForceSync').onclick=async()=>{message('Solicitando envio...');try{const r=await window.thor.catalogSync();message(r.ok?'Envio concluído. Confira os estados abaixo.':'Existem operações pendentes ou rejeitadas.',r.ok?'good':'bad');renderBody();}catch(e){message(err(e),'bad');}};
      body.querySelector('#cl930Reload').onclick=()=>renderBody();
    }).catch(e=>message(err(e),'bad'));
  }
}
function openProductEdit(id,kind){
  const row=products.find(p=>String(p.id)===String(id));if(!row)return;
  const target=panel.querySelector('#cl930Edit');if(!target)return;
  target.innerHTML=kind==='product_price'
    ? `<form id="cl930Mutation" class="cl930-form"><h3>Alterar somente o preço: ${esc(row.name)}</h3>${field('sale_price','Novo preço de venda',row.base_price??row.sale_price,'number','min="0" step="0.0001" required')}<div class="cl930-actions"><button type="submit" class="cl930-primary">Salvar preço no caixa</button></div></form>`
    : `<form id="cl930Mutation" class="cl930-form"><h3>Ajustar estoque: ${esc(row.name)}</h3>${select('direction','Operação',[['in','Acrescentar quantidade'],['out','Retirar quantidade']],'in')}${field('quantity','Quantidade','1','number','step="0.001" min="0.001" required')}${field('reason','Motivo do ajuste','','text','required maxlength="180"')}<div class="cl930-actions"><button type="submit" class="cl930-primary">Salvar ajuste no caixa</button></div></form>`;
  target.scrollIntoView({block:'nearest'});
  target.querySelector('form').onsubmit=e=>{
    e.preventDefault();const data=formData(e.currentTarget);
    if(kind==='product_price')save(kind,{id,sale_price:data.sale_price});
    else save(kind,{id,delta:(data.direction==='out'?-1:1)*Number(data.quantity),reason:data.reason});
  };
}
async function openTab(next){
  tab=next;selected=null;search='';panel.querySelector('.cl930-head h2').textContent=title[tab];
  panel.querySelectorAll('[data-cl930-tab]').forEach(b=>b.classList.toggle('on',b.dataset.cl930Tab===tab));
  message('');await load();
}
async function open(next){
  if(panel){await openTab(next);return;}
  tab=next;search='';selected=null;
  panel=document.createElement('div');panel.className='cl930-overlay';
  panel.innerHTML=`<section class="cl930-panel" role="dialog" aria-modal="true" aria-label="Cadastros ThorPDV">${controls()}</section>`;
  document.body.appendChild(panel);
  panel.querySelector('#cl930Close').onclick=()=>{panel.remove();panel=null;};
  panel.addEventListener('click',e=>{if(e.target===panel){panel.remove();panel=null;}});
  panel.querySelectorAll('[data-cl930-tab]').forEach(b=>b.onclick=()=>openTab(b.dataset.cl930Tab));
  await load();
}
function decorate(){
  const header=document.querySelector('.top-right');
  if(header&&!header.querySelector('#cl930Nav')){
    const button=document.createElement('button');button.id='cl930Nav';button.className='nav-button';button.textContent='Cadastros';
    button.onclick=()=>open('customers');
    const sibling=header.querySelector('#navFiscal');
    sibling?.after(button);
    if(!sibling)header.prepend(button);
  }
  document.querySelectorAll('.v089-menu-grid').forEach(grid=>{
    if(grid.querySelector('[data-cl930-menu]'))return;
    const button=document.createElement('button');button.dataset.cl930Menu='1';
    button.innerHTML='<i>▤</i><b>Cadastro de Clientes e Produtos</b><small>Preços, estoque e sincronização</small>';
    button.onclick=()=>{grid.closest('.modal')?.remove();open('customers');};
    grid.appendChild(button);
  });
}
new MutationObserver(decorate).observe(document.documentElement,{childList:true,subtree:true});
decorate();
window.openThorCatalogV0930=open;
})();
