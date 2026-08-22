(()=>{
  'use strict';
  if(window.__thorPersonalizationV098)return;
  window.__thorPersonalizationV098=true;

  const STORAGE_KEY='thorpdv.personalization.v098';
  const DEFAULTS={theme:'thor',font:'calibri',scale:'1.08',accent:'#7443d3',accent2:'#0bbf79',button:'#7443d3',text:'#242435',muted:'#67697a',surface:'#ffffff',page:'#f6f5fa',border:'#e7e4ee'};
  const THEMES={
    thor:{name:'Thor Original',desc:'Roxo e verde',accent:'#7443d3',accent2:'#0bbf79',button:'#7443d3',text:'#242435',muted:'#67697a',surface:'#ffffff',page:'#f6f5fa',border:'#e7e4ee',swatch:'linear-gradient(135deg,#7443d3 0 50%,#0bbf79 50%)'},
    ocean:{name:'Oceano',desc:'Azul e ciano',accent:'#2563eb',accent2:'#06b6d4',button:'#2563eb',text:'#172033',muted:'#64748b',surface:'#ffffff',page:'#f4f8fc',border:'#dbe5f0',swatch:'linear-gradient(135deg,#2563eb 0 50%,#06b6d4 50%)'},
    emerald:{name:'Esmeralda',desc:'Verde comercial',accent:'#087f5b',accent2:'#17b978',button:'#087f5b',text:'#19352c',muted:'#64766f',surface:'#ffffff',page:'#f3f8f5',border:'#dce9e2',swatch:'linear-gradient(135deg,#087f5b 0 50%,#17b978 50%)'},
    ruby:{name:'Rubi',desc:'Vinho e coral',accent:'#a61e4d',accent2:'#e85976',button:'#a61e4d',text:'#35222a',muted:'#78656c',surface:'#ffffff',page:'#faf5f7',border:'#eddde3',swatch:'linear-gradient(135deg,#a61e4d 0 50%,#e85976 50%)'},
    graphite:{name:'Grafite',desc:'Sóbrio e moderno',accent:'#374151',accent2:'#64748b',button:'#374151',text:'#202631',muted:'#6b7280',surface:'#ffffff',page:'#f3f4f6',border:'#d9dde3',swatch:'linear-gradient(135deg,#1f2937 0 50%,#94a3b8 50%)'}
  };
  const FONTS={calibri:'Calibri, Arial, "Segoe UI", sans-serif',arial:'Arial, "Segoe UI", sans-serif',segoe:'"Segoe UI", Arial, sans-serif'};

  function read(){try{return {...DEFAULTS,...JSON.parse(localStorage.getItem(STORAGE_KEY)||'{}')};}catch{return {...DEFAULTS};}}
  function write(value){localStorage.setItem(STORAGE_KEY,JSON.stringify(value));}
  function apply(value){
    const root=document.documentElement,body=document.body;
    body.dataset.thorTheme=value.theme||'custom';
    root.style.setProperty('--thor-font-family',FONTS[value.font]||FONTS.calibri);
    root.style.setProperty('--thor-font-scale',String(value.scale||1.08));
    root.style.setProperty('--thor-accent',value.accent);
    root.style.setProperty('--thor-accent-2',value.accent2);
    root.style.setProperty('--thor-button',value.button);
    root.style.setProperty('--thor-text',value.text);
    root.style.setProperty('--thor-muted',value.muted);
    root.style.setProperty('--thor-surface',value.surface);
    root.style.setProperty('--thor-page',value.page);
    root.style.setProperty('--thor-border',value.border);
  }
  function preset(name,current){return {...current,theme:name,...THEMES[name]};}
  let current=read();apply(current);

  function escHtml(value){return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}

  function openPersonalization(){
    const original={...current};let draft={...current};
    const html=`<div class="thor-personalization-head"><div><small>APARÊNCIA DO TERMINAL</small><h3>Personalização</h3><p>Escolha a identidade visual deste caixa e aumente a legibilidade das telas.</p></div><span>Preferência salva neste terminal</span></div>
      <div class="thor-personalization-grid">
        <section class="thor-personalization-section"><h4>Tema</h4><div class="thor-theme-list">${Object.entries(THEMES).map(([key,t])=>`<button type="button" class="thor-theme-card ${draft.theme===key?'active':''}" data-theme="${key}"><span class="thor-theme-swatch" style="background:${t.swatch}"></span><span><b>${escHtml(t.name)}</b><small>${escHtml(t.desc)}</small></span></button>`).join('')}</div><div class="thor-preview"><div class="thor-preview-card"><h4>Pré-visualização</h4><p>Produto selecionado • Estoque disponível • R$ 29,90</p><div class="thor-preview-actions"><button class="p">Ação principal</button><button class="s">Ação secundária</button></div></div></div></section>
        <section class="thor-personalization-section"><h4>Leitura e cores</h4><div class="thor-control-list"><label class="thor-control"><span>Fonte</span><select id="thorPersFont"><option value="calibri">Calibri</option><option value="arial">Arial</option><option value="segoe">Segoe UI</option></select></label><label class="thor-control"><span>Tamanho da fonte</span><select id="thorPersScale"><option value="1">Normal</option><option value="1.08">Grande</option><option value="1.16">Extra grande</option><option value="1.24">Máxima leitura</option></select></label><label class="thor-control"><span>Cor principal</span><input type="color" id="thorPersAccent" value="${draft.accent}"></label><label class="thor-control"><span>Cor dos botões</span><input type="color" id="thorPersButton" value="${draft.button}"></label><label class="thor-control"><span>Cor das letras</span><input type="color" id="thorPersText" value="${draft.text}"></label><label class="thor-control"><span>Cor secundária</span><input type="color" id="thorPersAccent2" value="${draft.accent2}"></label></div></section>
      </div><div class="thor-personalization-actions"><button type="button" class="secondary" id="thorPersReset">Restaurar padrão</button><div><button type="button" class="secondary" id="thorPersCancel">Cancelar</button><button type="button" class="primary" id="thorPersSave">Salvar personalização</button></div></div>`;
    const m=typeof modal==='function'?modal(html,'wide'):null;if(!m)return;
    m.classList.add('thor-personalization-modal');
    const font=m.querySelector('#thorPersFont'),scale=m.querySelector('#thorPersScale'),accent=m.querySelector('#thorPersAccent'),button=m.querySelector('#thorPersButton'),text=m.querySelector('#thorPersText'),accent2=m.querySelector('#thorPersAccent2');
    font.value=draft.font;scale.value=String(draft.scale);
    const syncControls=()=>{font.value=draft.font;scale.value=String(draft.scale);accent.value=draft.accent;button.value=draft.button;text.value=draft.text;accent2.value=draft.accent2;m.querySelectorAll('[data-theme]').forEach(x=>x.classList.toggle('active',x.dataset.theme===draft.theme));};
    const preview=()=>apply(draft);
    m.querySelectorAll('[data-theme]').forEach(card=>card.onclick=()=>{draft=preset(card.dataset.theme,draft);syncControls();preview();});
    font.onchange=()=>{draft.font=font.value;draft.theme='custom';preview();};scale.onchange=()=>{draft.scale=scale.value;preview();};accent.oninput=()=>{draft.accent=accent.value;draft.theme='custom';preview();};button.oninput=()=>{draft.button=button.value;draft.theme='custom';preview();};text.oninput=()=>{draft.text=text.value;draft.theme='custom';preview();};accent2.oninput=()=>{draft.accent2=accent2.value;draft.theme='custom';preview();};
    m.querySelector('#thorPersReset').onclick=()=>{draft={...DEFAULTS};syncControls();preview();};
    m.querySelector('#thorPersCancel').onclick=()=>{apply(original);m.remove();};
    m.querySelector('#thorPersSave').onclick=()=>{current={...draft};write(current);apply(current);m.remove();if(typeof showToast==='function')showToast('Personalização salva neste terminal.');};
    const oldClick=m.onclick;m.onclick=e=>{if(e.target===m){apply(original);m.remove();return;}if(typeof oldClick==='function')oldClick.call(m,e);};
  }

  function ensureTab(){
    const quick=document.querySelector('.v089-quick');
    if(!quick)return;
    let btn=document.getElementById('thorPersonalizationTab');
    if(btn&&btn.parentElement!==quick){btn.remove();btn=null;}
    if(!btn){
      btn=document.createElement('button');
      btn.type='button';
      btn.id='thorPersonalizationTab';
      btn.className='thor-personalization-quick';
      btn.dataset.thorPersonalization='1';
      btn.innerHTML='<span>◐</span><b>Personalização<small>Tema</small></b>';
      btn.title='Temas, cores e tamanho das fontes';
      btn.onclick=openPersonalization;
      const surcharge=quick.querySelector('#v089Surcharge');
      if(surcharge?.nextSibling)quick.insertBefore(btn,surcharge.nextSibling);else quick.appendChild(btn);
    }
  }

  setInterval(ensureTab,500);
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>{apply(current);ensureTab();},{once:true});else{apply(current);ensureTab();}
  window.openThorPersonalization=openPersonalization;
})();
