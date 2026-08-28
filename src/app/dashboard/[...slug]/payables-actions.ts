'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

const SESSION_COOKIE='thorpdv_test_session';
type Row=Record<string,unknown>;
type RpcResult={ok?:boolean;error?:string;data?:Row[];accounts?:Row[];payment_methods?:Row[];summary?:Row;[key:string]:unknown};

async function token(){
  const store=await cookies();
  const value=store.get(SESSION_COOKIE)?.value;
  if(!value)redirect('/login');
  return value;
}

async function rpc(name:string,args:Record<string,unknown>){
  const supabase=await createClient();
  const {data,error}=await supabase.rpc(name,args);
  if(error)return {ok:false,error:error.message} as RpcResult;
  return (data??{ok:false,error:'empty_response'}) as RpcResult;
}

export async function payablesList(search?:string){
  const r=await rpc('erp_list',{p_token:await token(),p_resource:'finance',p_search:search?.trim()||null});
  const rows=Array.isArray(r.data)?r.data.filter(row=>String(row.entry_type??'')==='payable'):[];
  return {ok:Boolean(r.ok),error:r.error,data:rows};
}

export async function payableCreate(payload:Row){
  return rpc('erp_save',{
    p_token:await token(),
    p_resource:'finance',
    p_payload:{...payload,entry_type:'payable',status:'open',paid_amount:0},
  });
}

export async function payableSettle(entryId:string,payload:Row){
  return rpc('erp_financial_settle',{
    p_token:await token(),
    p_entry_id:entryId,
    p_payload:payload,
  });
}

export async function payablesFinancialContext(){
  const r=await rpc('erp_financial_accounts_data',{p_token:await token()});
  return {
    ok:Boolean(r.ok),error:r.error,
    accounts:Array.isArray(r.accounts)?r.accounts:[],
    payment_methods:Array.isArray(r.payment_methods)?r.payment_methods:[],
    summary:(r.summary&&typeof r.summary==='object'&&!Array.isArray(r.summary)?r.summary:{}) as Row,
  };
}
