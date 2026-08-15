'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

const SESSION_COOKIE='thorpdv_test_session';
async function token(){const store=await cookies();const value=store.get(SESSION_COOKIE)?.value;if(!value)redirect('/login');return value;}
async function rpc(name:string,args:Record<string,unknown>){const supabase=await createClient();const {data,error}=await supabase.rpc(name,args);if(error)return {ok:false,error:error.message};return (data??{ok:false}) as Record<string,unknown>}

export async function cnab400Data(){return rpc('erp_cnab400_data',{p_token:await token()})}
export async function saveCnab400Config(bankAccountId:string,payload:Record<string,unknown>){return rpc('erp_cnab400_config_save',{p_token:await token(),p_bank_account:bankAccountId,p_payload:payload})}
export async function generateCnab400Remittance(configId:string,entryIds:string[]){return rpc('erp_cnab400_remittance_generate',{p_token:await token(),p_config:configId,p_entry_ids:entryIds})}
export async function markCnab400RemittanceSent(remittanceId:string){return rpc('erp_cnab400_remittance_mark_sent',{p_token:await token(),p_remittance:remittanceId})}
export async function previewCnab400Return(content:string){return rpc('erp_cnab400_return_preview',{p_token:await token(),p_content:content})}
export async function importCnab400Return(configId:string,fileName:string,content:string){return rpc('erp_cnab400_return_import',{p_token:await token(),p_config:configId,p_file_name:fileName,p_content:content})}
