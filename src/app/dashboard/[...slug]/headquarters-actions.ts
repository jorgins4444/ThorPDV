'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

const SESSION_COOKIE='thorpdv_test_session';
type Result={ok?:boolean;error?:string;[key:string]:unknown};

async function token(){const store=await cookies();const value=store.get(SESSION_COOKIE)?.value;if(!value)redirect('/login');return value;}
async function rpc(name:string,args:Record<string,unknown>){const supabase=await createClient();const {data,error}=await supabase.rpc(name,args);if(error)return {ok:false,error:error.message} as Result;return (data??{ok:false}) as Result;}

export async function headquartersGet(){return rpc('erp_headquarters_get',{p_token:await token()});}
export async function headquartersSave(payload:Record<string,unknown>){return rpc('erp_headquarters_save',{p_token:await token(),p_payload:payload});}
