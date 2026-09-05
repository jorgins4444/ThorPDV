'use client';

import { useEffect } from 'react';

type Row=Record<string,unknown>;

const text=(value:unknown)=>value==null?'':String(value);
const bankNames:Record<string,string>={
  '001':'Banco do Brasil',
  '033':'Santander',
  '104':'CAIXA Econômica Federal',
  '237':'Bradesco',
  '341':'Itaú Unibanco',
};

function bankCode(value:unknown){
  const digits=text(value).replace(/\D/g,'');
  return digits?digits.padStart(3,'0').slice(-3):'';
}

export function HomologationBankSelectorFix({accounts,layoutModels}:{accounts:Row[];layoutModels:Row[]}){
  useEffect(()=>{
    let frame=0;

    const schedule=()=>{
      cancelAnimationFrame(frame);
      frame=requestAnimationFrame(patchModal);
    };

    const patchModal=()=>{
      const modal=document.querySelector<HTMLElement>('.hom-modal');
      const form=modal?.querySelector<HTMLFormElement>('form');
      if(!modal||!form)return;

      const accountSelect=form.querySelector<HTMLSelectElement>('select[name="bank_account_id"]');
      const layoutSelect=form.querySelector<HTMLSelectElement>('select[name="layout"]');
      if(!accountSelect||!layoutSelect)return;

      const bankLabel=Array.from(form.querySelectorAll<HTMLLabelElement>('label')).find(label=>{
        const ownText=Array.from(label.childNodes).filter(node=>node.nodeType===Node.TEXT_NODE).map(node=>node.textContent||'').join(' ').trim();
        return ownText==='Banco';
      });
      if(!bankLabel)return;
      const bankSelect=bankLabel.querySelector<HTMLSelectElement>('select');
      if(!bankSelect)return;

      bankSelect.dataset.homBankSelector='1';
      if(bankSelect.disabled)bankSelect.disabled=false;

      const codes=Array.from(new Set([...accounts.map(a=>bankCode(a.bank_code)),...Object.keys(bankNames)].filter(Boolean))).sort();
      const bankSignature=codes.join('|');
      if(bankSelect.dataset.optionsSignature!==bankSignature){
        const current=bankSelect.value;
        bankSelect.replaceChildren(new Option('Selecione...',''),...codes.map(code=>new Option(`${code} — ${bankNames[code]||`Banco ${code}`}`,code)));
        bankSelect.dataset.optionsSignature=bankSignature;
        if(codes.includes(current))bankSelect.value=current;
      }

      const selectedAccount=accounts.find(account=>text(account.id)===accountSelect.value);
      const selectedBank=bankCode(selectedAccount?.bank_code);
      if(selectedBank&&bankSelect.value!==selectedBank)bankSelect.value=selectedBank;

      const agency=form.querySelector<HTMLInputElement>('input[name="agency"]');
      const accountNumber=form.querySelector<HTMLInputElement>('input[name="account_number"]');
      const accountDigit=form.querySelector<HTMLInputElement>('input[name="account_digit"]');
      const currentBoundId=form.dataset.boundBankAccount||'';
      if(selectedAccount&&currentBoundId!==text(selectedAccount.id)){
        if(agency)agency.value=text(selectedAccount.agency);
        if(accountNumber)accountNumber.value=text(selectedAccount.account_number);
        if(accountDigit)accountDigit.value=text(selectedAccount.account_digit);
        form.dataset.boundBankAccount=text(selectedAccount.id);
      }

      const effectiveBank=selectedBank||bankSelect.value;
      const models=layoutModels.filter(model=>bankCode(model.bank_code)===effectiveBank&&model.active!==false);
      const modelSignature=models.map(model=>`${text(model.layout)}:${text(model.version)}`).join('|');
      if(layoutSelect.dataset.modelSignature!==`${effectiveBank}|${modelSignature}`){
        const previous=layoutSelect.value;
        if(models.length){
          layoutSelect.replaceChildren(...models.map(model=>new Option(`${text(model.layout)==='cnab400'?'CNAB 400':'CNAB 240'} · versão ${text(model.version)||'oficial'}`,text(model.layout))));
          const preferred=text(selectedAccount?.default_layout);
          const next=[preferred,previous,text(models[0]?.layout)].find(value=>value&&models.some(model=>text(model.layout)===value))||text(models[0]?.layout);
          layoutSelect.disabled=false;
          if(next&&layoutSelect.value!==next){
            layoutSelect.value=next;
            layoutSelect.dispatchEvent(new Event('change',{bubbles:true}));
          }
        }else{
          layoutSelect.replaceChildren(new Option('Modelo oficial ainda não disponível',''));
          layoutSelect.value='';
          layoutSelect.disabled=true;
        }
        layoutSelect.dataset.modelSignature=`${effectiveBank}|${modelSignature}`;
      }

      let hint=bankLabel.querySelector<HTMLElement>('[data-bank-hint="1"]');
      if(!hint){
        hint=document.createElement('small');
        hint.dataset.bankHint='1';
        hint.style.display='block';
        hint.style.marginTop='4px';
        hint.style.fontSize='9px';
        bankLabel.appendChild(hint);
      }
      hint.textContent=effectiveBank
        ? models.length
          ? `Banco ${effectiveBank} sincronizado com a conta selecionada.`
          : `Banco ${effectiveBank} selecionado. O modelo CNAB oficial deste banco ainda está em implantação.`
        : 'Selecione uma conta ou um banco.';

      const submit=form.querySelector<HTMLButtonElement>('button.primary[type="submit"], button.primary:not([type])');
      if(submit){
        const canSubmit=Boolean(accountSelect.value&&effectiveBank&&models.length);
        submit.disabled=!canSubmit||submit.textContent?.includes('Salvando')===true;
        if(!models.length&&effectiveBank)submit.title=`CNAB do banco ${effectiveBank} ainda não está liberado para homologação.`;
        else submit.removeAttribute('title');
      }
    };

    const onChange=(event:Event)=>{
      const target=event.target as HTMLSelectElement|null;
      if(!target)return;
      const form=target.closest<HTMLFormElement>('.hom-modal form');
      if(!form)return;

      if(target.name==='bank_account_id'){
        form.dataset.boundBankAccount='';
        schedule();
        return;
      }

      if(target.dataset.homBankSelector==='1'){
        const code=bankCode(target.value);
        const accountSelect=form.querySelector<HTMLSelectElement>('select[name="bank_account_id"]');
        if(accountSelect){
          const matching=accounts.find(account=>bankCode(account.bank_code)===code);
          const next=matching?text(matching.id):'';
          if(accountSelect.value!==next){
            accountSelect.value=next;
            form.dataset.boundBankAccount='';
            accountSelect.dispatchEvent(new Event('change',{bubbles:true}));
          }
        }
        schedule();
      }
    };

    const observer=new MutationObserver(schedule);
    observer.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['disabled']});
    document.addEventListener('change',onChange,true);
    schedule();

    return()=>{
      cancelAnimationFrame(frame);
      observer.disconnect();
      document.removeEventListener('change',onChange,true);
    };
  },[accounts,layoutModels]);

  return null;
}
