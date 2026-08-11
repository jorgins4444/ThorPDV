'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

const CONTROL_COOKIE='thor_control_session';
type RpcResult={ok?:boolean;error?:string;[key:string]:unknown};

async function token(){const c=await cookies();const t=c.get(CONTROL_COOKIE)?.value;if(!t)redirect('/control/login');return t;}
async function rpc(name:string,args:Record<string,unknown>){const supabase=await createClient();const {data,error}=await supabase.rpc(name,args);if(error)return {ok:false,error:error.message} as RpcResult;return (data??{ok:false}) as RpcResult;}

export async function controlDashboard(){const t=await token();return rpc('platform_dashboard',{p_token:t});}
export async function controlCreateCustomer(payload:Record<string,unknown>){const t=await token();return rpc('platform_customer_create',{p_token:t,p_payload:payload});}
export async function controlUpdateLicense(tenantId:string,payload:Record<string,unknown>){const t=await token();return rpc('platform_license_update',{p_token:t,p_tenant:tenantId,p_payload:payload});}
export async function controlSetLicenseBlocked(tenantId:string,blocked:boolean,reason=''){const t=await token();return rpc('platform_license_block',{p_token:t,p_tenant:tenantId,p_blocked:blocked,p_reason:reason});}
export async function controlSavePricing(payload:Record<string,unknown>){const t=await token();return rpc('platform_pricing_save',{p_token:t,p_payload:payload});}
export async function controlFiscalDetail(documentId:string){const t=await token();return rpc('platform_fiscal_detail',{p_token:t,p_document:documentId});}
export async function controlUpdateDashboard(){const t=await token();return rpc('platform_update_dashboard',{p_token:t});}
export async function controlReleaseSave(payload:Record<string,unknown>){const t=await token();return rpc('platform_release_save',{p_token:t,p_payload:payload});}
export async function controlUpdatePolicySet(payload:Record<string,unknown>){const t=await token();return rpc('platform_update_policy_set',{p_token:t,p_payload:payload});}
export async function controlUpdatePolicyClear(payload:Record<string,unknown>){const t=await token();return rpc('platform_update_policy_clear',{p_token:t,p_payload:payload});}
export async function controlLogout(){const c=await cookies();const t=c.get(CONTROL_COOKIE)?.value;if(t)await rpc('platform_logout',{p_token:t});c.delete(CONTROL_COOKIE);redirect('/control/login');}
