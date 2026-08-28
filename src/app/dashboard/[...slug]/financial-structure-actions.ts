'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

const SESSION_COOKIE='thorpdv_test_session';
type Row=Record<string,unknown>;
type Result={ok?:boolean;error?:string;accounts?:Row[];categories?:Row[];cost_centers?:Row[];id?:string;[key:string]:unknown};

async function sessionToken(){
  const store=await cookies();
  const value=store.get(SESSION_COOKIE)?.value;
  if(!value)redirect('/login');
  return value;
}

async function rpc(name:string,args:Record<string,unknown>){
  const supabase=await createClient();
  const {data,error}=await supabase.rpc(name,args);
  if(error)return {ok:false,error:error.message} as Result;
  return (data??{ok:false,error:'empty_response'}) as Result;
}

export async function financialStructureGet(){
  const r=await rpc('erp_financial_structure_get',{p_token:await sessionToken()});
  return {
    ok:Boolean(r.ok),error:r.error,
    accounts:Array.isArray(r.accounts)?r.accounts:[],
    categories:Array.isArray(r.categories)?r.categories:[],
    cost_centers:Array.isArray(r.cost_centers)?r.cost_centers:[],
  };
}

export async function financialStructureSave(resource:'account'|'category'|'cost_center',payload:Row){
  return rpc('erp_financial_structure_save',{
    p_token:await sessionToken(),
    p_resource:resource,
    p_payload:payload,
  });
}

export async function financialEntryClassify(entryId:string,payload:Row){
  return rpc('erp_financial_entry_classify',{
    p_token:await sessionToken(),
    p_entry_id:entryId,
    p_payload:payload,
  });
}
