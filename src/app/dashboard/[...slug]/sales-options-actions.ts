'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

const SESSION_COOKIE='thorpdv_test_session';
type Row=Record<string,unknown>;
type RpcResult={ok?:boolean;error?:string;payment_methods?:Row[];payment_terms?:Row[];card_brands?:Row[];card_acquirers?:Row[];credit_installments?:Row[];id?:string;[key:string]:unknown};

async function token(){const store=await cookies();const value=store.get(SESSION_COOKIE)?.value;if(!value)redirect('/login');return value;}
async function rpc(name:string,args:Record<string,unknown>){const supabase=await createClient();const {data,error}=await supabase.rpc(name,args);if(error)return {ok:false,error:error.message} as RpcResult;return (data??{ok:false,error:'empty_response'}) as RpcResult;}

export async function salesOptionsGet(){const pToken=await token();const r=await rpc('erp_sales_options_get',{p_token:pToken});return {ok:Boolean(r.ok),error:r.error,payment_methods:Array.isArray(r.payment_methods)?r.payment_methods:[],payment_terms:Array.isArray(r.payment_terms)?r.payment_terms:[],card_brands:Array.isArray(r.card_brands)?r.card_brands:[],card_acquirers:Array.isArray(r.card_acquirers)?r.card_acquirers:[],credit_installments:Array.isArray(r.credit_installments)?r.credit_installments:[]};}
export async function salesPaymentMethodSave(payload:Row){const pToken=await token();return rpc('erp_sales_payment_method_save',{p_token:pToken,p_payload:payload});}
export async function salesCardBrandSave(payload:Row){const pToken=await token();return rpc('erp_sales_card_brand_save',{p_token:pToken,p_payload:payload});}
export async function salesCardAcquirerSave(payload:Row){const pToken=await token();return rpc('erp_sales_card_acquirer_save',{p_token:pToken,p_payload:payload});}
export async function salesCreditInstallmentSave(payload:Row){const pToken=await token();return rpc('erp_sales_credit_installment_save',{p_token:pToken,p_payload:payload});}
export async function salesPaymentTermSave(payload:Row){const pToken=await token();return rpc('erp_payment_term_save',{p_token:pToken,p_payload:payload});}
