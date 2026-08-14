'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

const SESSION_COOKIE='thorpdv_test_session';
type Result={ok?:boolean;error?:string;[key:string]:unknown};

async function token(){
  const store=await cookies();
  const value=store.get(SESSION_COOKIE)?.value;
  if(!value)redirect('/login');
  return value;
}

async function rpc(name:string,args:Record<string,unknown>){
  const supabase=await createClient();
  const {data,error}=await supabase.rpc(name,args);
  if(error)return {ok:false,error:error.message} as Result;
  return (data??{ok:false}) as Result;
}

export async function receivableBankBillings(entryId?:string){
  return rpc('erp_receivable_bank_billings',{p_token:await token(),p_entry_id:entryId||null});
}

export async function receivableCustomerBillingSnapshot(customerId:string){
  return rpc('erp_customer_billing_snapshot',{p_token:await token(),p_customer:customerId});
}

export async function issueReceivableItauBoleto(entryId:string,integrationId:string,simulate=false){
  const pToken=await token();
  const transport=await rpc('erp_bank_integration_transport',{p_token:pToken,p_integration:integrationId});
  if(!transport.ok)return transport;
  if(transport.environment==='production'){
    return {ok:false,error:'production_receivable_issue_not_enabled',detail:'A emissão de Contas a Receber em Produção exige o runtime mTLS do Itaú e permanece bloqueada até a homologação produtiva.'};
  }
  return rpc('erp_itau_boleto_issue_receivable',{p_token:pToken,p_entry_id:entryId,p_integration:integrationId,p_simulate:simulate});
}

export async function consultReceivableItauBoleto(billingId:string){
  return rpc('erp_itau_boleto_consult',{p_token:await token(),p_billing_id:billingId});
}

// Compatibilidade temporária com componentes antigos.
export const issueReceivableItauBolecode=issueReceivableItauBoleto;
