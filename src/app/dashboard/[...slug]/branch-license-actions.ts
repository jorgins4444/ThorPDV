'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';

const SESSION_COOKIE='thorpdv_test_session';
type RpcResult={ok?:boolean;error?:string;[key:string]:unknown};

async function token(){const c=await cookies();const t=c.get(SESSION_COOKIE)?.value;if(!t)redirect('/login');return t;}
async function rpc(name:string,args:Record<string,unknown>){const supabase=await createClient();const {data,error}=await supabase.rpc(name,args);if(error)return {ok:false,error:error.message} as RpcResult;return (data??{ok:false}) as RpcResult;}

export async function branchLicenseSave(payload:Record<string,unknown>){
  const t=await token();
  const result=await rpc('erp_branch_save',{p_token:t,p_payload:payload});
  if(result.ok){
    revalidatePath('/dashboard/administrativo/filiais');
    revalidatePath('/dashboard/configuracoes');
  }
  return result;
}
