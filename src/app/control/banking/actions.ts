'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

const CONTROL_COOKIE='thor_control_session';
type Result={ok?:boolean;error?:string;[key:string]:unknown};

async function token(){const c=await cookies();const t=c.get(CONTROL_COOKIE)?.value;if(!t)redirect('/control/login');return t;}
async function rpc(name:string,args:Record<string,unknown>){const supabase=await createClient();const {data,error}=await supabase.rpc(name,args);if(error)return {ok:false,error:error.message} as Result;return (data??{ok:false}) as Result;}

export async function controlBankProviderData(){return rpc('platform_bank_provider_get',{p_token:await token()});}
export async function controlBankProviderSave(payload:Record<string,unknown>){return rpc('platform_bank_provider_save',{p_token:await token(),p_payload:payload});}
export async function controlBankProviderTest(provider:string,environment:string){
 const t=await token();
 if(provider==='itau'&&environment==='production'){
  const supabase=await createClient();
  const {data,error}=await supabase.functions.invoke('itau-bolecode-production',{body:{action:'provider_test',control_token:t}});
  if(error)return {ok:false,error:'itau_production_edge_failed',detail:error.message} as Result;
  return (data??{ok:false}) as Result;
 }
 return rpc('platform_bank_provider_test',{p_token:t,p_provider:provider,p_environment:environment});
}
