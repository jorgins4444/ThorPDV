'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

const SESSION_COOKIE='thorpdv_test_session';
type RpcResult={ok?:boolean;error?:string;data?:Record<string,unknown>[]|Record<string,unknown>;id?:string;[key:string]:unknown};

async function token(){const store=await cookies();const value=store.get(SESSION_COOKIE)?.value;if(!value)redirect('/login');return value;}
async function rpc(name:string,args:Record<string,unknown>){const supabase=await createClient();const {data,error}=await supabase.rpc(name,args);if(error)return {ok:false,error:error.message} as RpcResult;return (data??{ok:false}) as RpcResult;}

export async function productStudioList(search?:string){const p=await token();const r=await rpc('erp_product_list_v3',{p_token:p,p_search:search?.trim()||null});return {ok:Boolean(r.ok),error:r.error,data:Array.isArray(r.data)?r.data:[],branch_id:r.branch_id};}
export async function productStudioDetail(productId:string){const p=await token();return rpc('erp_product_detail_v2',{p_token:p,p_product:productId});}
export async function productStudioSave(payload:Record<string,unknown>){const p=await token();return rpc('erp_product_save_v5',{p_token:p,p_payload:payload});}
export async function productStudioCompositionSet(productId:string,items:Record<string,unknown>[]){const p=await token();return rpc('erp_product_composition_set',{p_token:p,p_product:productId,p_items:items});}
export async function productStudioBarcode(){const p=await token();return rpc('erp_generate_product_barcode',{p_token:p});}
export async function productStudioAddStock(productId:string,quantity:number,unitCost?:number){const p=await token();return rpc('erp_stock_move',{p_token:p,p_payload:{product_id:productId,movement_type:'in',quantity,unit_cost:unitCost??null,notes:'Entrada pelo Studio de Produtos'}});}
