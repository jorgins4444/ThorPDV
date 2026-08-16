'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import type { CnabLayout } from './bank-cnab-actions';

const SESSION_COOKIE='thorpdv_test_session';
async function token(){const store=await cookies();const value=store.get(SESSION_COOKIE)?.value;if(!value)redirect('/login');return value;}
async function rpc(name:string,args:Record<string,unknown>){const supabase=await createClient();const {data,error}=await supabase.rpc(name,args);if(error)return {ok:false,error:error.message};return (data??{ok:false}) as Record<string,unknown>}

function validate(layout:CnabLayout,content:string):Record<string,unknown>{
  const lines=String(content||'').replace(/\r/g,'').split('\n').filter(Boolean);const first=lines[0]||'';
  if(!first)return {ok:false,error:'return_file_empty',detail:'O arquivo selecionado está vazio.'};
  if(layout==='cnab400'){
    const operation=first.slice(1,2),literal=first.slice(2,9).trim().toUpperCase(),service=first.slice(9,11),bank=first.slice(76,79);
    if(operation==='1'||literal==='REMESSA')return {ok:false,error:'cnab400_file_is_not_return',detail:'O arquivo selecionado é uma remessa, não um retorno do Itaú.'};
    if(operation!=='2'||literal!=='RETORNO'||service!=='01'||bank!=='341')return {ok:false,error:'return_not_itau_cnab400',detail:'O arquivo não possui o cabeçalho de retorno Itaú CNAB 400.'};
  }else{
    if(first.slice(0,3)!=='341'||first.slice(142,143)!=='2')return {ok:false,error:'return_not_itau_cnab240',detail:'O arquivo não possui o cabeçalho de retorno Itaú CNAB 240.'};
  }
  return {ok:true};
}

export async function reviewCnabReturn(layout:CnabLayout,configId:string,content:string){
  const valid=validate(layout,content);if(!valid.ok)return valid;
  return rpc(layout==='cnab240'?'erp_cnab240_return_review':'erp_cnab400_return_review',{p_token:await token(),p_config:configId,p_content:content});
}

export async function confirmCnabReturnImport(layout:CnabLayout,configId:string,fileName:string,content:string,selectedLines:number[]){
  const valid=validate(layout,content);if(!valid.ok)return valid;
  return rpc(layout==='cnab240'?'erp_cnab240_return_import_confirm':'erp_cnab400_return_import_confirm',{p_token:await token(),p_config:configId,p_file_name:fileName,p_content:content,p_selected_lines:selectedLines});
}
