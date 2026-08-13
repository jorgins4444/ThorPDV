'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';

const SESSION_COOKIE='thorpdv_test_session';
type Row=Record<string,unknown>;
type RpcResult={ok?:boolean;error?:string;branch_id?:string;settings?:Row;[key:string]:unknown};

async function token(){const store=await cookies();const value=store.get(SESSION_COOKIE)?.value;if(!value)redirect('/login');return value;}
async function rpc(name:string,args:Record<string,unknown>){const supabase=await createClient();const {data,error}=await supabase.rpc(name,args);if(error)return {ok:false,error:error.message} as RpcResult;return (data??{ok:false,error:'empty_response'}) as RpcResult;}
function obj(value:unknown):Row{return value&&typeof value==='object'&&!Array.isArray(value)?value as Row:{};}

async function branchPolicyContext(pToken:string){
  const context=await rpc('erp_context',{p_token:pToken});
  if(!context.ok||!context.branch_id)return {ok:false,error:String(context.error||'branch_context_required'),branchId:'',parameters:{} as Row};
  const config=await rpc('erp_branch_configuration_get',{p_token:pToken,p_branch:context.branch_id});
  if(!config.ok)return {ok:false,error:String(config.error||'branch_configuration_unavailable'),branchId:String(context.branch_id),parameters:{} as Row};
  const settings=obj(config.settings);
  return {ok:true,branchId:String(context.branch_id),parameters:obj(settings.pdv_parameters)};
}

export async function inventoryPolicyGet(){
  const pToken=await token();
  const branch=await branchPolicyContext(pToken);
  if(!branch.ok)return {ok:false,error:branch.error,allow_negative_stock:false};
  return {ok:true,branch_id:branch.branchId,allow_negative_stock:branch.parameters.allow_negative_stock===true};
}

export async function inventoryPolicySave(allowNegativeStock:boolean){
  const pToken=await token();
  const branch=await branchPolicyContext(pToken);
  if(!branch.ok)return {ok:false,error:branch.error};
  const next={...branch.parameters,allow_negative_stock:Boolean(allowNegativeStock)};
  return rpc('erp_branch_configuration_save',{p_token:pToken,p_branch:branch.branchId,p_section:'parameters',p_payload:next});
}

export async function inventoryPolicySaveForm(formData:FormData){
  const allow=String(formData.get('allow_negative_stock')??'')==='on';
  const result=await inventoryPolicySave(allow);
  if(result.ok)revalidatePath('/dashboard/estoque');
}
