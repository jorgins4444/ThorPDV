'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

const SESSION_COOKIE='thorpdv_test_session';
type RpcResult={ok?:boolean;error?:string;data?:Record<string,unknown>[]|Record<string,unknown>;id?:string;total?:number;ids?:unknown;limit?:number;offset?:number;[key:string]:unknown};
export type ProductListFilters={category_id?:string;brand_id?:string;group_id?:string;ncm?:string;tax_situation?:string;product_structure?:string;active?:string};

async function token(){const store=await cookies();const value=store.get(SESSION_COOKIE)?.value;if(!value)redirect('/login');return value;}
async function rpc(name:string,args:Record<string,unknown>){
  const supabase=await createClient();
  const {data,error}=await supabase.rpc(name,args);
  if(error){
    console.error('product_studio_rpc_transport_error',{rpc:name,code:error.code,message:error.message,details:error.details,hint:error.hint});
    return {ok:false,error:error.message} as RpcResult;
  }
  const result=(data??{ok:false}) as RpcResult;
  if(result.ok===false) console.warn('product_studio_rpc_business_error',{rpc:name,error:result.error??'unknown'});
  return result;
}

function objectValue(value:unknown):Record<string,unknown>{return value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};}
function sourceLabel(value:unknown){
  const key=String(value??'').trim();
  const labels:Record<string,string>={
    stock_movement:'Movimentação de estoque',product_update:'Cadastro do produto',product_studio:'Cadastro do produto',product_master:'Cadastro do produto',
    price_table:'Tabela de preços',bulk_price:'Alteração de preços em lote',sale_return:'Devolução de venda',sale:'Venda',manual:'Movimentação manual',transfer:'Transferência',purchase:'Compra/entrada',production:'Produção',
  };
  return labels[key]||key;
}
function enrichProductHistory(data:Record<string,unknown>){
  const history=Array.isArray(data.history)?data.history:[];
  return {...data,history:history.map(value=>{
    const row=objectValue(value);const metadata=objectValue(row.metadata);
    const description=String(row.description??'').trim();
    const actor=String(row.actor_name??'').trim()||'Sistema';
    const document=String(metadata.notes??'').trim();
    const source=sourceLabel(metadata.reference_type??row.source_type);
    const details=[`Responsável: ${actor}`];
    if(document)details.push(`Documento/origem: ${document}`);else if(source)details.push(`Origem: ${source}`);
    return {...row,description:[description,...details].filter(Boolean).join(' • ')};
  })};
}

export async function productStudioList(search?:string,filters:ProductListFilters={},limit=100,offset=0){
  const p=await token();
  const r=await rpc('erp_product_list_v4',{p_token:p,p_search:search?.trim()||null,p_filters:filters,p_limit:limit,p_offset:offset});
  return {ok:Boolean(r.ok),error:r.error,data:Array.isArray(r.data)?r.data:[],branch_id:r.branch_id,total:Number(r.total||0),limit:Number(r.limit||limit),offset:Number(r.offset||offset)};
}
export async function productStudioFilteredIds(search?:string,filters:ProductListFilters={}){
  const p=await token();
  const r=await rpc('erp_product_filtered_ids_v1',{p_token:p,p_search:search?.trim()||null,p_filters:filters});
  const ids=Array.isArray(r.ids)?r.ids.map(String):[];
  return {ok:Boolean(r.ok),error:r.error,ids,total:Number(r.total||ids.length)};
}
export async function productStudioSetActive(productId:string,active:boolean){const p=await token();return rpc('erp_product_set_active_v1',{p_token:p,p_product:productId,p_active:active});}
export async function productStudioBulkUpdate(productIds:string[],patch:Record<string,unknown>){const p=await token();return rpc('erp_product_bulk_update_v1',{p_token:p,p_product_ids:productIds,p_patch:patch});}
export async function productStudioDetail(productId:string){
  const p=await token();const r=await rpc('erp_product_detail_v2',{p_token:p,p_product:productId});
  if(r.ok&&r.data&&!Array.isArray(r.data))r.data=enrichProductHistory(r.data);
  return r;
}
export async function productStudioSave(payload:Record<string,unknown>){const p=await token();return rpc('erp_product_save_v5',{p_token:p,p_payload:payload});}
export async function productStudioCompositionSet(productId:string,items:Record<string,unknown>[]){const p=await token();return rpc('erp_product_composition_set',{p_token:p,p_product:productId,p_items:items});}
export async function productStudioBarcode(){const p=await token();return rpc('erp_generate_product_barcode',{p_token:p});}
export async function productStudioAddStock(productId:string,quantity:number,unitCost?:number){const p=await token();return rpc('erp_stock_move',{p_token:p,p_payload:{product_id:productId,movement_type:'in',quantity,unit_cost:unitCost??null,notes:'Entrada pelo Studio de Produtos'}});}