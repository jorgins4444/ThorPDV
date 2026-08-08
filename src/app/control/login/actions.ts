'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

const CONTROL_COOKIE='thor_control_session';

export async function controlLogin(formData:FormData){
 const email=String(formData.get('email')??'').trim();const password=String(formData.get('password')??'');
 if(!email||!password)redirect('/control/login?error=Informe%20email%20e%20senha');
 const supabase=await createClient();const {data,error}=await supabase.rpc('platform_login',{p_email:email,p_password:password});
 const r=data as {ok?:boolean;error?:string;session_token?:string;must_change_password?:boolean}|null;
 if(error||!r?.ok||!r.session_token){const msg=r?.error==='temporarily_locked'?'Acesso temporariamente bloqueado. Tente novamente em alguns minutos.':'Email ou senha inválidos.';redirect(`/control/login?error=${encodeURIComponent(msg)}`)}
 const c=await cookies();c.set(CONTROL_COOKIE,r.session_token,{httpOnly:true,secure:true,sameSite:'lax',path:'/control',maxAge:60*60*8});
 if(r.must_change_password)redirect('/control/change-password');
 redirect('/control');
}
