'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

const SESSION_COOKIE='thorpdv_test_session';
type RpcResult={ok?:boolean;error?:string;data?:Record<string,unknown>[];id?:string;[key:string]:unknown};
async function token(){const store=await cookies();const value=store.get(SESSION_COOKIE)?.value;if(!value)redirect('/login');return value;}
async function rpc(name:string,args:Record<string,unknown>){const supabase=await createClient();const {data,error}=await supabase.rpc(name,args);if(error){console.error('product_reference_rpc_error',{rpc:name,code:error.code,message:error.message,details:error.details});return {ok:false,error:error.message} as RpcResult;}return (data??{ok:false}) as RpcResult;}

export async function productReferenceList(resource:'brands'|'categories'|'units'|'attributes',search?:string){const p=await token();const map={brands:'erp_product_brands_list',categories:'erp_product_categories_list',units:'erp_product_units_list',attributes:'erp_product_attributes_list'} as const;const r=await rpc(map[resource],{p_token:p,p_search:search?.trim()||null});return {ok:Boolean(r.ok),error:r.error,data:Array.isArray(r.data)?r.data:[]};}
export async function productBrandSave(payload:Record<string,unknown>){const p=await token();return rpc('erp_product_brand_save',{p_token:p,p_payload:payload});}
export async function productCategorySave(payload:Record<string,unknown>){const p=await token();return rpc('erp_product_category_save',{p_token:p,p_payload:payload});}
export async function productUnitSave(payload:Record<string,unknown>){const p=await token();return rpc('erp_product_unit_save',{p_token:p,p_payload:payload});}
export async function productAttributeSave(payload:Record<string,unknown>){const p=await token();return rpc('erp_product_attribute_save',{p_token:p,p_payload:payload});}
export async function productAttributeValueSave(attributeId:string,value:string,sort:number){const p=await token();return rpc('erp_product_attribute_value_save',{p_token:p,p_attribute:attributeId,p_value:value,p_sort:sort});}
export async function productAttributeValueDisable(valueId:string){const p=await token();return rpc('erp_product_attribute_value_disable',{p_token:p,p_value_id:valueId});}
