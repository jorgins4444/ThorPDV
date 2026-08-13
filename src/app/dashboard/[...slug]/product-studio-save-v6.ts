'use server';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
const SESSION_COOKIE='thorpdv_test_session';
export async function productStudioSaveV6(payload:Record<string,unknown>){const store=await cookies();const token=store.get(SESSION_COOKIE)?.value;if(!token)redirect('/login');const supabase=await createClient();const {data,error}=await supabase.rpc('erp_product_save_v6',{p_token:token,p_payload:payload});if(error){console.error('product_studio_save_v6_error',{code:error.code,message:error.message,details:error.details});return {ok:false,error:error.message} as Record<string,unknown>;}return (data??{ok:false}) as Record<string,unknown>;}
