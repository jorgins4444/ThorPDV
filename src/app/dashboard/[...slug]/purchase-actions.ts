'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

const SESSION_COOKIE='thorpdv_test_session';
async function token(){const c=await cookies();const t=c.get(SESSION_COOKIE)?.value;if(!t)redirect('/login');return t;}
async function rpc(name:string,args:Record<string,unknown>){const supabase=await createClient();const {data,error}=await supabase.rpc(name,args);if(error)return {ok:false,error:error.message};return (data??{ok:false}) as Record<string,unknown>}
export async function purchaseList(){const r=await rpc('erp_purchase_list',{p_token:await token()});return {ok:Boolean(r.ok),error:r.error,data:Array.isArray(r.data)?r.data:[]}}
export async function purchaseCreate(payload:Record<string,unknown>){return rpc('erp_purchase_create',{p_token:await token(),p_payload:payload})}
export async function purchaseCancel(id:string){return rpc('erp_purchase_cancel',{p_token:await token(),p_purchase_id:id})}
export async function purchaseXmlContext(){
  const r=await rpc('erp_purchase_xml_context',{p_token:await token()});
  return {
    ok:Boolean(r.ok),error:r.error,
    suppliers:Array.isArray(r.suppliers)?r.suppliers:[],
    products:Array.isArray(r.products)?r.products:[],
    links:Array.isArray(r.links)?r.links:[],
    units:Array.isArray(r.units)?r.units:[],
    branch_id:String(r.branch_id??''),
  };
}
export async function purchaseXmlImport(payload:Record<string,unknown>){return rpc('erp_purchase_xml_import',{p_token:await token(),p_payload:payload})}
