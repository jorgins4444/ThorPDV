'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

const SESSION_COOKIE='thorpdv_test_session';
type Row=Record<string,unknown>;
type RpcResult={ok?:boolean;error?:string;payment_methods?:Row[];payment_terms?:Row[];card_brands?:Row[];card_acquirers?:Row[];credit_installments?:Row[];id?:string;branch_id?:string;settings?:Row;[key:string]:unknown};

async function token(){const store=await cookies();const value=store.get(SESSION_COOKIE)?.value;if(!value)redirect('/login');return value;}
async function rpc(name:string,args:Record<string,unknown>){const supabase=await createClient();const {data,error}=await supabase.rpc(name,args);if(error)return {ok:false,error:error.message} as RpcResult;return (data??{ok:false,error:'empty_response'}) as RpcResult;}
function obj(value:unknown):Row{return value&&typeof value==='object'&&!Array.isArray(value)?value as Row:{};}

async function branchPaymentParameters(pToken:string){
  const context=await rpc('erp_context',{p_token:pToken});
  if(!context.ok||!context.branch_id)return {ok:false,error:String(context.error||'branch_context_required'),branchId:'',parameters:{} as Row};
  const config=await rpc('erp_branch_configuration_get',{p_token:pToken,p_branch:context.branch_id});
  if(!config.ok)return {ok:false,error:String(config.error||'branch_configuration_unavailable'),branchId:String(context.branch_id),parameters:{} as Row};
  const settings=obj(config.settings);
  return {ok:true,branchId:String(context.branch_id),parameters:obj(settings.pdv_parameters)};
}

export async function salesOptionsGet(){
  const pToken=await token();
  const r=await rpc('erp_sales_options_get',{p_token:pToken});
  const branch=await branchPaymentParameters(pToken);
  const parameters=branch.ok?branch.parameters:{};
  const mapping=obj(parameters.card_brand_acquirers);
  const acquirers=Array.isArray(r.card_acquirers)?r.card_acquirers:[];
  const acquirerByCnpj=new Map(acquirers.map(a=>[String(a.cnpj??''),a]));
  const cardBrands=(Array.isArray(r.card_brands)?r.card_brands:[]).map(b=>{
    const cnpj=String(mapping[String(b.code??'')]??'');
    const acq=acquirerByCnpj.get(cnpj);
    return {...b,acquirer_cnpj:cnpj,acquirer_name:acq?String(acq.name??''):''};
  });
  return {ok:Boolean(r.ok),error:r.error,payment_methods:Array.isArray(r.payment_methods)?r.payment_methods:[],payment_terms:Array.isArray(r.payment_terms)?r.payment_terms:[],card_brands:cardBrands,card_acquirers:acquirers,credit_installments:Array.isArray(r.credit_installments)?r.credit_installments:[],branch_id:branch.branchId};
}
export async function salesPaymentMethodSave(payload:Row){const pToken=await token();return rpc('erp_sales_payment_method_save',{p_token:pToken,p_payload:payload});}
export async function salesCardBrandSave(payload:Row){const pToken=await token();return rpc('erp_sales_card_brand_save',{p_token:pToken,p_payload:payload});}
export async function salesCardAcquirerSave(payload:Row){const pToken=await token();return rpc('erp_sales_card_acquirer_save',{p_token:pToken,p_payload:payload});}
export async function salesCreditInstallmentSave(payload:Row){const pToken=await token();return rpc('erp_sales_credit_installment_save',{p_token:pToken,p_payload:payload});}
export async function salesPaymentTermSave(payload:Row){const pToken=await token();return rpc('erp_payment_term_save',{p_token:pToken,p_payload:payload});}

export async function salesCardBrandAcquirerSave(payload:Row){
  const pToken=await token();
  const code=String(payload.code??'').trim().toLowerCase();
  const cnpj=String(payload.acquirer_cnpj??'').trim();
  if(!code)return {ok:false,error:'card_brand_required'};
  if(cnpj){
    const options=await rpc('erp_sales_options_get',{p_token:pToken});
    const allowed=(Array.isArray(options.card_acquirers)?options.card_acquirers:[]).some(a=>String(a.cnpj??'')===cnpj&&a.active!==false);
    if(!allowed)return {ok:false,error:'brand_acquirer_must_be_enabled'};
  }
  const branch=await branchPaymentParameters(pToken);
  if(!branch.ok)return {ok:false,error:branch.error};
  const map={...obj(branch.parameters.card_brand_acquirers)};
  if(cnpj)map[code]=cnpj;else delete map[code];
  const next={...branch.parameters,card_brand_acquirers:map};
  return rpc('erp_branch_configuration_save',{p_token:pToken,p_branch:branch.branchId,p_section:'parameters',p_payload:next});
}
