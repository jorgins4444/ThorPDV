'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

const CONTROL_COOKIE='thor_control_session';
export async function controlChangePassword(formData:FormData){const password=String(formData.get('password')??'');const confirm=String(formData.get('confirm')??'');if(password.length<8)redirect('/control/change-password?error=A%20senha%20deve%20ter%20ao%20menos%208%20caracteres');if(password!==confirm)redirect('/control/change-password?error=As%20senhas%20não%20coincidem');const c=await cookies();const token=c.get(CONTROL_COOKIE)?.value;if(!token)redirect('/control/login');const supabase=await createClient();const {data,error}=await supabase.rpc('platform_change_password',{p_token:token,p_new_password:password});const r=data as {ok?:boolean;error?:string}|null;if(error||!r?.ok)redirect(`/control/change-password?error=${encodeURIComponent(r?.error??'Não foi possível alterar a senha')}`);redirect('/control');}
