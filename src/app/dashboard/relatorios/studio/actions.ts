'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { studioAllowedReports } from './report-studio-catalog';

const SESSION_COOKIE='thorpdv_test_session';

type Row=Record<string,unknown>;
type RunResult={ok:boolean;error?:string;sources:Record<string,{current:Row[];comparison:Row[]}>};

async function sessionToken(){
 const store=await cookies();const token=store.get(SESSION_COOKIE)?.value;if(!token)redirect('/login');return token;
}

function safeDate(v?:string){return /^\d{4}-\d{2}-\d{2}$/.test(String(v??''))?String(v):null}

export async function reportStudioRun(reports:string[],start:string,end:string,branchId?:string,compareStart?:string,compareEnd?:string):Promise<RunResult>{
 const token=await sessionToken();
 const unique=[...new Set(reports)].filter(r=>studioAllowedReports.includes(r)).slice(0,16);
 if(!unique.length)return {ok:true,sources:{}};
 const supabase=await createClient();
 const run=async(report:string,s?:string,e?:string)=>{
  const {data,error}=await supabase.rpc('erp_report_v3',{p_token:token,p_report:report,p_start:safeDate(s),p_end:safeDate(e),p_branch:branchId||null,p_filters:{}});
  if(error)return {ok:false,error:error.message,data:[] as Row[]};
  const out=(data??{}) as {ok?:boolean;error?:string;data?:Row[]};
  return {ok:Boolean(out.ok),error:out.error,data:Array.isArray(out.data)?out.data:[]};
 };
 const result:RunResult={ok:true,sources:{}};
 await Promise.all(unique.map(async report=>{
  const [current,comparison]=await Promise.all([
   run(report,start,end),
   compareStart&&compareEnd?run(report,compareStart,compareEnd):Promise.resolve({ok:true,data:[] as Row[]})
  ]);
  if(!current.ok){result.ok=false;result.error=current.error??`Falha ao carregar ${report}`;}
  result.sources[report]={current:current.data,comparison:comparison.data};
 }));
 return result;
}

export async function reportStudioList(){
 const token=await sessionToken();const supabase=await createClient();const {data,error}=await supabase.rpc('erp_report_studio_list',{p_token:token});
 if(error)return {ok:false,error:error.message,workbooks:[]};return (data??{ok:true,workbooks:[]}) as Record<string,unknown>;
}

export async function reportStudioGet(id?:string){
 const token=await sessionToken();const supabase=await createClient();const {data,error}=await supabase.rpc('erp_report_studio_get',{p_token:token,p_id:id||null});
 if(error)return {ok:false,error:error.message,workbook:null};return (data??{ok:true,workbook:null}) as Record<string,unknown>;
}

export async function reportStudioSave(id:string|undefined,name:string,layout:unknown[],settings:Record<string,unknown>,isDefault=false){
 const token=await sessionToken();const supabase=await createClient();const {data,error}=await supabase.rpc('erp_report_studio_save',{p_token:token,p_id:id||null,p_name:name,p_layout:layout,p_settings:settings,p_is_default:isDefault});
 if(error)return {ok:false,error:error.message};return (data??{ok:false}) as Record<string,unknown>;
}

export async function reportStudioDelete(id:string){
 const token=await sessionToken();const supabase=await createClient();const {data,error}=await supabase.rpc('erp_report_studio_delete',{p_token:token,p_id:id});
 if(error)return {ok:false,error:error.message};return (data??{ok:false}) as Record<string,unknown>;
}
