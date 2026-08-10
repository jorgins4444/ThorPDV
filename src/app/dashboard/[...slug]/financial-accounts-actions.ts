'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

const SESSION_COOKIE='thorpdv_test_session';
async function token(){const c=await cookies();const t=c.get(SESSION_COOKIE)?.value;if(!t)redirect('/login');return t;}
async function rpc(name:string,args:Record<string,unknown>){const supabase=await createClient();const {data,error}=await supabase.rpc(name,args);if(error)return {ok:false,error:error.message};return (data??{ok:false}) as Record<string,unknown>}

export async function financialAccountsData(){return rpc('erp_financial_accounts_data',{p_token:await token()})}
export async function saveFinancialAccount(payload:Record<string,unknown>){return rpc('erp_bank_account_save',{p_token:await token(),p_payload:payload})}
export async function addFinancialMovement(payload:Record<string,unknown>){return rpc('erp_bank_transaction_add',{p_token:await token(),p_payload:payload})}
export async function transferFinancialFunds(sourceId:string,destinationId:string,amount:number,description?:string,transactionDate?:string){return rpc('erp_bank_account_transfer',{p_token:await token(),p_source:sourceId,p_destination:destinationId,p_amount:amount,p_description:description||null,p_transaction_date:transactionDate||null})}
