'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

const SESSION_COOKIE='thorpdv_test_session';
async function token(){const c=await cookies();const t=c.get(SESSION_COOKIE)?.value;if(!t)redirect('/login');return t;}
async function rpc(name:string,args:Record<string,unknown>){const supabase=await createClient();const {data,error}=await supabase.rpc(name,args);if(error)return {ok:false,error:error.message} as Record<string,unknown>;return (data??{ok:false}) as Record<string,unknown>;}

export async function fiscalConfigGet(){return rpc('erp_fiscal_settings_get',{p_token:await token()});}
export async function fiscalSettingsSave(payload:Record<string,unknown>){return rpc('erp_fiscal_settings_save',{p_token:await token(),p_payload:payload});}
export async function fiscalSeriesSave(payload:Record<string,unknown>){return rpc('erp_fiscal_series_save',{p_token:await token(),p_payload:payload});}
export async function fiscalPosSeriesSave(payload:Record<string,unknown>){return rpc('erp_fiscal_pos_series_save',{p_token:await token(),p_payload:payload});}
export async function fiscalCfopSave(payload:Record<string,unknown>){return rpc('erp_fiscal_cfop_save',{p_token:await token(),p_payload:payload});}
export async function fiscalCfopRulesGet(){return rpc('erp_fiscal_cfop_rules_get',{p_token:await token()});}
export async function fiscalCfopRuleSave(payload:Record<string,unknown>){return rpc('erp_fiscal_cfop_rule_save',{p_token:await token(),p_payload:payload});}
export async function fiscalCfopResolve(payload:{product_cfop?:string;purpose:string;presence:string;recipient_state:string;consumer_final:boolean;indicator_ie:string}){
  return rpc('erp_fiscal_cfop_resolve',{p_token:await token(),p_product_cfop:payload.product_cfop||'',p_purpose:payload.purpose,p_presence:payload.presence,p_recipient_state:payload.recipient_state,p_consumer_final:payload.consumer_final,p_indicator_ie:payload.indicator_ie});
}
export async function fiscalPrepareV2(saleId:string,documentType:'nfe'|'nfce',seriesId?:string){
  const result=await rpc('erp_fiscal_prepare_v2',{p_token:await token(),p_sale_id:saleId,p_document_type:documentType,p_series_id:seriesId||null});
  if(result.error==='fiscal_preflight_failed'){
    const validation=Array.isArray(result.validation_errors)?result.validation_errors.map(v=>String(v)).filter(Boolean):[];
    return {...result,error_code:'fiscal_preflight_failed',error:validation.length?validation.join(' · '):'Revise os dados fiscais do destinatário antes de preparar a NF-e.'};
  }
  return result;
}
export async function nfeManualDraftCreate(payload:Record<string,unknown>){
  const result=await rpc('erp_nfe_manual_draft_create',{p_token:await token(),p_payload:payload});
  if(result.error==='fiscal_preflight_failed'||result.error==='fiscal_configuration_incomplete'){
    const validation=Array.isArray(result.validation_errors)?result.validation_errors.map(v=>String(v)).filter(Boolean):[];
    return {...result,error_code:String(result.error),error:validation.length?validation.join(' · '):'Revise os dados fiscais antes de criar o rascunho da NF-e.'};
  }
  return result;
}
