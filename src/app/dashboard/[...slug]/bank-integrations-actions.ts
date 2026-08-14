'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

const SESSION_COOKIE='thorpdv_test_session';
type Result={ok?:boolean;error?:string;[key:string]:unknown};
async function token(){const c=await cookies();const t=c.get(SESSION_COOKIE)?.value;if(!t)redirect('/login');return t;}
async function rpc(name:string,args:Record<string,unknown>){const supabase=await createClient();const {data,error}=await supabase.rpc(name,args);if(error)return {ok:false,error:error.message} as Result;return (data??{ok:false}) as Result;}

export async function bankIntegrationsData(){return rpc('erp_bank_integrations_data',{p_token:await token()});}
export async function saveBankIntegration(bankAccountId:string,payload:Record<string,unknown>){return rpc('erp_bank_integration_save',{p_token:await token(),p_bank_account:bankAccountId,p_payload:payload});}
export async function testItauBolecode(integrationId:string,payload:Record<string,unknown>,effective=false){return rpc('erp_itau_bolecode_test',{p_token:await token(),p_integration:integrationId,p_payload:payload,p_effective:effective});}
export async function bankBillingsList(limit=100){return rpc('erp_bank_billings_list',{p_token:await token(),p_limit:limit});}
