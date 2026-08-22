(()=>{
  'use strict';
  if(window.__thorCreditBrandV0914)return;
  window.__thorCreditBrandV0914=true;

  function options(){
    try{return v3State().salesOptions||state.status?.salesOptions||{};}catch{return state.status?.salesOptions||{};}
  }
  function brands(){return (options().card_brands||[]).filter(x=>x.active!==false);}
  function escHtml(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}

  function selectedCredit(modalRoot){
    const active=modalRoot.querySelector('[data-method].active');
    return active?.dataset.method==='credit_card';
  }

  function patchPaymentMetadata(modalRoot, brand){
    if(!brand)return;
    let v;try{v=v3State();}catch{return;}
    const rows=Array.isArray(v.payments)?v.payments:[];
    for(let i=rows.length-1;i>=0;i--){
      const p=rows[i];
      if(p?.method==='credit_card'){
        p.metadata={...(p.metadata||{}),card_brand_code:brand};
        break;
      }
    }
  }

  function ensureCreditBrand(modalRoot){
    if(!selectedCredit(modalRoot))return;
    const holder=modalRoot.querySelector('#s71CardFields');
    if(!holder)return;
    const bs=brands();
    if(!bs.length)return;
    let field=holder.querySelector('#thorCreditBrandField');
    const current=holder.dataset.thorCreditBrand||bs[0]?.code||'';
    if(!field){
      field=document.createElement('div');
      field.id='thorCreditBrandField';
      field.className='field thor-credit-brand-field';
      field.innerHTML=`<label>Bandeira</label><select id="thorCreditBrand"><option value="">Selecione...</option>${bs.map(x=>`<option value="${escHtml(x.code)}">${escHtml(x.name)}</option>`).join('')}</select>`;
      const grid=holder.querySelector('.s71-card-grid');
      if(grid)grid.prepend(field);else holder.prepend(field);
      const select=field.querySelector('#thorCreditBrand');
      select.value=current;
      holder.dataset.thorCreditBrand=select.value;
      select.addEventListener('change',()=>{holder.dataset.thorCreditBrand=select.value;});
    }
  }

  function wireModal(modalRoot){
    if(modalRoot.dataset.thorCreditBrandWired==='1')return;
    modalRoot.dataset.thorCreditBrandWired='1';

    modalRoot.addEventListener('click',e=>{
      const method=e.target.closest?.('[data-method]');
      if(method){
        setTimeout(()=>ensureCreditBrand(modalRoot),0);
        return;
      }
      const action=e.target.closest?.('#addPayment,#integratedPay');
      if(!action||!selectedCredit(modalRoot))return;
      const holder=modalRoot.querySelector('#s71CardFields');
      const brand=holder?.querySelector('#thorCreditBrand')?.value||holder?.dataset.thorCreditBrand||'';
      if(!brand)return;
      let tries=0;
      const timer=setInterval(()=>{
        patchPaymentMetadata(modalRoot,brand);
        tries+=1;
        if(tries>=12||!modalRoot.isConnected)clearInterval(timer);
      },120);
    },true);

    ensureCreditBrand(modalRoot);
  }

  function patch(){
    document.querySelectorAll('.modal').forEach(m=>{
      if(m.querySelector('#s71CardFields')&&m.querySelector('[data-method="credit_card"]'))wireModal(m);
    });
  }

  setInterval(patch,300);
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',patch,{once:true});else patch();
})();
