'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

const SESSION_COOKIE='thorpdv_test_session';
type Row=Record<string,unknown>;
type RpcResult={ok?:boolean;error?:string;data?:Row[];price_table_id?:unknown;[key:string]:unknown};
type CatalogResult={ok:boolean;error?:string;data:Row[];price_table_id?:unknown};

async function token(){
  const store=await cookies();
  const value=store.get(SESSION_COOKIE)?.value;
  if(!value)redirect('/login');
  return value;
}

export async function erpSaleCatalogSearch(priceTableId?:string,search?:string,limit=40):Promise<CatalogResult>{
  const pToken=await token();
  const supabase=await createClient();
  const {data,error}=await supabase.rpc('erp_sale_catalog_v2',{
    p_token:pToken,
    p_price_table_id:priceTableId||null,
    p_search:search?.trim()||null,
    p_limit:Math.min(Math.max(limit,1),80),
  });
  if(error)return {ok:false,error:error.message,data:[]};
  const result=(data??{ok:false,data:[]}) as RpcResult;
  return {
    ok:Boolean(result.ok),
    error:result.error,
    price_table_id:result.price_table_id,
    data:Array.isArray(result.data)?result.data:[],
  };
}
