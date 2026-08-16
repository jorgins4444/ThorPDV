import { createClient } from '@/lib/supabase/server';

type LicenseStatus={ok?:boolean;error?:string;status?:string;blocked_at?:string|null;blocked_reason?:string|null;expires_at?:string|null;[key:string]:unknown};

export async function pdvLicenseGuard(deviceToken:string){
  const supabase=await createClient();
  const {data,error}=await supabase.rpc('pdv_license_status',{p_device_token:deviceToken});
  if(error)return {ok:false,status:500,result:{ok:false,error:error.message} as LicenseStatus};
  const result=(data??{ok:false,error:'empty_response'}) as LicenseStatus;
  if(result.ok)return {ok:true,status:200,result};
  const code=String(result.error||'license_validation_failed');
  const status=code==='invalid_device'?401:403;
  return {ok:false,status,result};
}
