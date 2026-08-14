import './control.css';
import './provisioning.css';
import './banking/banking.css';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { controlDashboard } from './actions';
import { ControlClient } from './control-client';

const CONTROL_COOKIE='thor_control_session';
export default async function ControlPage(){const c=await cookies();const token=c.get(CONTROL_COOKIE)?.value;if(!token)redirect('/control/login');const supabase=await createClient();const {data,error}=await supabase.rpc('platform_session_status',{p_token:token});const status=data as {ok?:boolean;must_change_password?:boolean}|null;if(error||!status?.ok)redirect('/control/login');if(status.must_change_password)redirect('/control/change-password');const r=await controlDashboard();if(!r.ok)redirect('/control/login');return <><ControlClient initial={r as Record<string,unknown>}/><a className="control-banking-fab" href="/control/banking">🏦 Integrações bancárias</a></>}
