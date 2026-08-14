import './banking.css';
import './banking-v2.css';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { controlBankProviderData } from './actions';
import ControlBankingClient from './banking-client';

const CONTROL_COOKIE='thor_control_session';
export default async function ControlBankingPage(){
 const c=await cookies();const token=c.get(CONTROL_COOKIE)?.value;if(!token)redirect('/control/login');
 const supabase=await createClient();const {data,error}=await supabase.rpc('platform_session_status',{p_token:token});const status=data as {ok?:boolean;must_change_password?:boolean}|null;
 if(error||!status?.ok)redirect('/control/login');if(status.must_change_password)redirect('/control/change-password');
 const r=await controlBankProviderData();if(!r.ok)redirect('/control/login');
 return <ControlBankingClient initial={r as Record<string,unknown>}/>;
}