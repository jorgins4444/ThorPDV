'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

const SESSION_COOKIE='thorpdv_test_session';
type RpcResult={ok?:boolean;error?:string;data?:Record<string,unknown>[];order?:Record<string,unknown>;id?:string;number?:number;total?:number;[key:string]:unknown};

async function token(){const store=await cookies();const value=store.get(SESSION_COOKIE)?.value;if(!value)redirect('/login');return value;}
async function rpc(name:string,args:Record<string,unknown>){const supabase=await createClient();const {data,error}=await supabase.rpc(name,args);if(error)return {ok:false,error:error.message} as RpcResult;return (data??{ok:false,error:'empty_response'}) as RpcResult;}

export async function salesOrderList(search=''){const pToken=await token();const r=await rpc('erp_sales_order_list',{p_token:pToken,p_search:search.trim()||null});return {ok:Boolean(r.ok),error:r.error,data:Array.isArray(r.data)?r.data:[]};}
export async function salesOrderDetail(orderId:string){const pToken=await token();return rpc('erp_sales_order_detail',{p_token:pToken,p_order:orderId});}
export async function salesOrderSave(payload:Record<string,unknown>){const pToken=await token();return rpc('erp_sales_order_save',{p_token:pToken,p_payload:payload});}
export async function salesOrderCancel(orderId:string){const pToken=await token();return rpc('erp_sales_order_cancel',{p_token:pToken,p_order:orderId});}
export async function paymentTermList(){const pToken=await token();const r=await rpc('erp_payment_terms_list',{p_token:pToken});return {ok:Boolean(r.ok),error:r.error,data:Array.isArray(r.data)?r.data:[]};}
export async function paymentTermSave(payload:Record<string,unknown>){const pToken=await token();return rpc('erp_payment_term_save',{p_token:pToken,p_payload:payload});}
