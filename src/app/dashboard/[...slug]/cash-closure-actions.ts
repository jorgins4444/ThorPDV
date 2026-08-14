'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

const SESSION_COOKIE='thorpdv_test_session';
type Row=Record<string,unknown>;
type RpcResult={ok?:boolean;error?:string;data?:Row[];session?:Row;payments?:Row[];movements?:Row[];sales?:Row[];audit?:Row[];fiscal?:Row;can_correct?:boolean;permission?:string;[key:string]:unknown};

async function token(){const store=await cookies();const value=store.get(SESSION_COOKIE)?.value;if(!value)redirect('/login');return value;}
async function rpc(name:string,args:Record<string,unknown>){const supabase=await createClient();const {data,error}=await supabase.rpc(name,args);if(error){console.error(`[cash-closure] ${name}`,error);return {ok:false,error:error.message} as RpcResult}return (data??{ok:false}) as RpcResult;}

export async function cashClosureHistory(filters:{start?:string;end?:string;operatorId?:string;branchId?:string}={}){
  const p_token=await token();
  const r=await rpc('erp_cash_closure_history',{p_token,p_start:filters.start||null,p_end:filters.end||null,p_operator:filters.operatorId||null,p_branch:filters.branchId||null});
  return {ok:Boolean(r.ok),error:r.error,data:Array.isArray(r.data)?r.data:[],canCorrect:Boolean(r.can_correct),permission:String(r.permission||'cash.correct_closure')};
}

export async function cashClosureDetail(cashId:string){
  const p_token=await token();
  const r=await rpc('erp_cash_closure_detail',{p_token,p_cash_id:cashId});
  return {ok:Boolean(r.ok),error:r.error,session:(r.session&&typeof r.session==='object'?r.session:{}) as Row,payments:Array.isArray(r.payments)?r.payments:[],movements:Array.isArray(r.movements)?r.movements:[],sales:Array.isArray(r.sales)?r.sales:[],audit:Array.isArray(r.audit)?r.audit:[],fiscal:(r.fiscal&&typeof r.fiscal==='object'?r.fiscal:{}) as Row,canCorrect:Boolean(r.can_correct),permission:String(r.permission||'cash.correct_closure')};
}

export async function cashClosureCorrect(cashId:string,closing:number,reason:string){
  const p_token=await token();
  return rpc('erp_cash_management_correct',{p_token,p_cash_id:cashId,p_closing:closing,p_reason:reason});
}
