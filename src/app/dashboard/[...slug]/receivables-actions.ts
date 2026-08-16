'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

const SESSION_COOKIE='thorpdv_test_session';

async function token(){const store=await cookies();const value=store.get(SESSION_COOKIE)?.value;if(!value)redirect('/login');return value;}

export type ReceivableFilters={
  issuedFrom?:string;issuedTo?:string;documentType?:string;customerId?:string;customerName?:string;status?:string;
  dueFrom?:string;dueTo?:string;paidFrom?:string;paidTo?:string;
};

export async function erpReceivablesList(filters:ReceivableFilters={}){
  const pToken=await token();
  const supabase=await createClient();
  const {data,error}=await supabase.rpc('erp_receivables_list',{p_token:pToken,p_filters:{
    issued_from:filters.issuedFrom||null,issued_to:filters.issuedTo||null,document_type:filters.documentType||null,
    customer_id:filters.customerId||null,customer_name:filters.customerName||null,status:filters.status||null,
    due_from:filters.dueFrom||null,due_to:filters.dueTo||null,paid_from:filters.paidFrom||null,paid_to:filters.paidTo||null,
  }});
  if(error)return {ok:false,error:error.message,data:[] as Record<string,unknown>[]};
  const result=(data??{}) as {ok?:boolean;error?:string;data?:Record<string,unknown>[]};
  return {ok:Boolean(result.ok),error:result.error,data:Array.isArray(result.data)?result.data:[]};
}

export async function erpCreateReceivable(payload:Record<string,unknown>){
  const pToken=await token();
  const supabase=await createClient();
  const {data,error}=await supabase.rpc('erp_receivable_create',{p_token:pToken,p_payload:payload});
  if(error)return {ok:false,error:error.message};
  return (data??{ok:false}) as Record<string,unknown>;
}

export async function erpSettleReceivable(entryId:string,payload:Record<string,unknown>){
  const pToken=await token();
  const supabase=await createClient();
  const {data,error}=await supabase.rpc('erp_term_receivable_settle',{p_token:pToken,p_entry_id:entryId,p_payload:payload});
  if(error)return {ok:false,error:error.message};
  return (data??{ok:false}) as Record<string,unknown>;
}

export async function erpReceivableDetail(entryId:string){
  const pToken=await token();
  const supabase=await createClient();
  const {data,error}=await supabase.rpc('erp_term_receivable_detail',{p_token:pToken,p_entry_id:entryId});
  if(error)return {ok:false,error:error.message};
  return (data??{ok:false}) as Record<string,unknown>;
}

export async function erpReverseReceivable(entryId:string,reason:string){
  const pToken=await token();
  const supabase=await createClient();
  const {data,error}=await supabase.rpc('erp_term_receivable_reverse',{p_token:pToken,p_entry_id:entryId,p_reason:reason});
  if(error)return {ok:false,error:error.message};
  return (data??{ok:false}) as Record<string,unknown>;
}
