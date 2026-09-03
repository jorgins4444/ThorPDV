'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

const SESSION_COOKIE='thorpdv_test_session';
type Row=Record<string,unknown>;
type Screen='products'|'product_studio'|'sale'|'nfe'|'fiscal_documents';

type RawResult={ok?:boolean;error?:string;[key:string]:unknown};

function obj(value:unknown):Row{return value&&typeof value==='object'&&!Array.isArray(value)?value as Row:{};}
function data(value:unknown):Row[]{const node=obj(value);return Array.isArray(node.data)?node.data as Row[]:[];}
function text(value:unknown){return String(value??'').trim();}

async function token(){
  const store=await cookies();
  const value=store.get(SESSION_COOKIE)?.value;
  if(!value)redirect('/login');
  return value;
}

async function bootstrap(screen:Screen){
  const pToken=await token();
  const supabase=await createClient();
  const {data:raw,error}=await supabase.rpc('erp_screen_bootstrap_v1',{p_token:pToken,p_screen:screen});
  if(error)return {ok:false,error:error.message} as RawResult;
  return (raw??{ok:false,error:'empty_response'}) as RawResult;
}

export async function productScreenBootstrap(){
  const r=await bootstrap('products');
  return {
    ok:Boolean(r.ok),error:r.error,
    products:data(r.products),groups:data(r.groups),classes:data(r.classes),suppliers:data(r.suppliers),modifiers:data(r.modifiers),branches:data(r.branches),
    categories:data(r.categories),brands:data(r.brands),
  };
}

export async function productStudioScreenBootstrap(){
  const r=await bootstrap('product_studio');
  const products=obj(r.products);
  const rows=Array.isArray(products.data)?products.data as Row[]:[];
  return {
    ok:Boolean(r.ok),error:r.error,
    products:rows,total:Number(products.total??rows.length),
    groups:data(r.groups),classes:data(r.classes),suppliers:data(r.suppliers),modifiers:data(r.modifiers),branches:data(r.branches),
    categories:data(r.categories),brands:data(r.brands),
  };
}

export async function saleScreenBootstrap(){
  const r=await bootstrap('sale');
  const options=obj(r.sales_options);
  const branchConfig=obj(r.branch_config);
  const settings=obj(branchConfig.settings);
  const parameters=obj(settings.pdv_parameters);
  const mapping=obj(parameters.card_brand_acquirers);
  const acquirers=Array.isArray(options.card_acquirers)?options.card_acquirers as Row[]:[];
  const acquirerByCnpj=new Map(acquirers.map(a=>[text(a.cnpj),a]));
  const cardBrands=(Array.isArray(options.card_brands)?options.card_brands as Row[]:[]).map(b=>{
    const cnpj=text(mapping[text(b.code)]);
    const acq=acquirerByCnpj.get(cnpj);
    return {...b,acquirer_cnpj:cnpj,acquirer_name:acq?text(acq.name):''};
  });
  return {
    ok:Boolean(r.ok),error:r.error,
    customers:data(r.customers),priceTables:data(r.price_tables),
    salesOptions:{
      payment_methods:Array.isArray(options.payment_methods)?options.payment_methods as Row[]:[],
      payment_terms:Array.isArray(options.payment_terms)?options.payment_terms as Row[]:[],
      card_brands:cardBrands,
      card_acquirers:acquirers,
      credit_installments:Array.isArray(options.credit_installments)?options.credit_installments as Row[]:[],
    },
    sessionRules:obj(parameters.sales_session),
  };
}

export async function nfeScreenBootstrap(){
  const r=await bootstrap('nfe');
  const settings=obj(r.settings);
  return {
    ok:Boolean(r.ok),error:r.error,
    settings:obj(settings.settings),sales:data(r.sales),documents:data(r.documents),customers:data(r.customers),products:data(r.products),
    cfopRules:obj(r.cfop_rules),
  };
}

export async function fiscalDocumentsScreenBootstrap(){
  const r=await bootstrap('fiscal_documents');
  const settings=obj(r.settings);
  return {ok:Boolean(r.ok),error:r.error,settings:obj(settings.settings),sales:data(r.sales),documents:data(r.documents)};
}
