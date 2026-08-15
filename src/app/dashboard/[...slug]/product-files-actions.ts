'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

const SESSION_COOKIE='thorpdv_test_session';

async function token(){
  const store=await cookies();
  const value=store.get(SESSION_COOKIE)?.value;
  if(!value) redirect('/login');
  return value;
}

export async function productFileExportData(){
  const supabase=await createClient();
  const {data,error}=await supabase.rpc('erp_product_file_export_data',{p_token:await token()});
  if(error) return {ok:false,error:error.message,data:[]};
  const result=(data??{ok:false,error:'empty_response',data:[]}) as Record<string,unknown>;
  return {
    ...result,
    ok:result.ok===true,
    data:Array.isArray(result.data)?result.data:[],
  };
}
