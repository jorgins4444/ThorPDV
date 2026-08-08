'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

const SESSION_COOKIE='thorpdv_test_session';
export async function erpLicenseGet(){const c=await cookies();const token=c.get(SESSION_COOKIE)?.value;if(!token)redirect('/login');const supabase=await createClient();const {data,error}=await supabase.rpc('erp_license_get',{p_token:token});if(error)return {ok:false,error:error.message,modules:{}};const r=(data??{}) as Record<string,unknown>;return {ok:Boolean(r.ok),error:r.error,modules:(r.modules&&typeof r.modules==='object'?r.modules:{}) as Record<string,boolean>,status:String(r.status??''),plan_name:String(r.plan_name??''),management_user_limit:Number(r.management_user_limit??0),pdv_terminal_limit:Number(r.pdv_terminal_limit??0),expires_at:r.expires_at??null};}
