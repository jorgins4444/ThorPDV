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
export async function fiscalPrepareV2(saleId:string,documentType:'nfe'|'nfce',seriesId?:string){return rpc('erp_fiscal_prepare_v2',{p_token:await token(),p_sale_id:saleId,p_document_type:documentType,p_series_id:seriesId||null});}
