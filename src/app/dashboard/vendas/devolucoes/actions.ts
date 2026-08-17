'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

const SESSION_COOKIE='thorpdv_test_session';
type Row=Record<string,unknown>;
type RpcResult={ok?:boolean;error?:string;data?:Row[];summary?:Row;branches?:Row[];return?:Row;items?:Row[];voucher_movements?:Row[];[key:string]:unknown};

async function token(){
  const store=await cookies();
  const value=store.get(SESSION_COOKIE)?.value;
  if(!value)redirect('/login');
  return value;
}

async function rpc(name:string,args:Record<string,unknown>){
  const supabase=await createClient();
  const {data,error}=await supabase.rpc(name,args);
  if(error){
    console.error(`[sales-returns] ${name}`,error);
    return {ok:false,error:error.message} as RpcResult;
  }
  return (data??{ok:false,error:'empty_response'}) as RpcResult;
}

export async function salesReturnsDashboard(filters:{start?:string;end?:string;status?:string;branchId?:string;search?:string}={}){
  const p_token=await token();
  const r=await rpc('erp_sale_returns_dashboard',{
    p_token,
    p_start:filters.start||null,
    p_end:filters.end||null,
    p_status:filters.status||null,
    p_branch:filters.branchId||null,
    p_search:filters.search?.trim()||null,
  });
  return {
    ok:Boolean(r.ok),error:r.error,
    data:Array.isArray(r.data)?r.data:[],
    summary:(r.summary&&typeof r.summary==='object'&&!Array.isArray(r.summary)?r.summary:{}) as Row,
    branches:Array.isArray(r.branches)?r.branches:[],
  };
}

export async function salesReturnDetail(returnId:string){
  const p_token=await token();
  const r=await rpc('erp_sale_return_detail',{p_token,p_return:returnId});
  return {
    ok:Boolean(r.ok),error:r.error,
    return:(r.return&&typeof r.return==='object'&&!Array.isArray(r.return)?r.return:{}) as Row,
    items:Array.isArray(r.items)?r.items:[],
    voucherMovements:Array.isArray(r.voucher_movements)?r.voucher_movements:[],
  };
}
