'use server';

import { cookies } from 'next/headers';
import { createClient } from '@/lib/supabase/server';

const SESSION_COOKIE='thorpdv_test_session';

export async function dashboardRealtimeChannel(){
  const cookieStore=await cookies();
  const token=cookieStore.get(SESSION_COOKIE)?.value??'';
  if(!token)return {ok:false,error:'temporary_session_required'};
  const supabase=await createClient();
  const {data,error}=await supabase.rpc('erp_dashboard_realtime_channel',{p_token:token});
  if(error)return {ok:false,error:error.message};
  return (data??{ok:false}) as Record<string,unknown>;
}
