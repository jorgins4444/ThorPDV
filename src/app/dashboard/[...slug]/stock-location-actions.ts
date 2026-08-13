'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

const SESSION_COOKIE='thorpdv_test_session';
type Row=Record<string,unknown>;
type RpcResult={ok?:boolean;error?:string;locations?:Row[];balances?:Row[];history?:Row[];current_branch_id?:string;[key:string]:unknown};

async function token(){const store=await cookies();const value=store.get(SESSION_COOKIE)?.value;if(!value)redirect('/login');return value;}
async function rpc(name:string,args:Record<string,unknown>){const supabase=await createClient();const {data,error}=await supabase.rpc(name,args);if(error)return {ok:false,error:error.message} as RpcResult;return (data??{ok:false}) as RpcResult;}

export async function erpStockOverview(){const p=await token();const r=await rpc('erp_stock_overview',{p_token:p});return {ok:Boolean(r.ok),error:r.error,locations:Array.isArray(r.locations)?r.locations:[],balances:Array.isArray(r.balances)?r.balances:[],history:Array.isArray(r.history)?r.history:[],current_branch_id:String(r.current_branch_id??'')};}
export async function erpStockLocationSave(payload:Row){const p=await token();return rpc('erp_stock_location_save',{p_token:p,p_payload:payload});}
export async function erpStockLocationDelete(locationId:string){const p=await token();return rpc('erp_stock_location_delete',{p_token:p,p_location:locationId});}
