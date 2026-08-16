import { NextResponse } from 'next/server';
import { pdvLicenseGuard } from '@/lib/pdv-license-guard';

export const runtime='nodejs';
export const dynamic='force-dynamic';

function bearer(request:Request){
  const value=request.headers.get('authorization')??'';
  return value.toLowerCase().startsWith('bearer ')?value.slice(7).trim():'';
}

export async function POST(request:Request){
  const token=bearer(request);
  if(!token)return NextResponse.json({ok:false,error:'device_token_required'},{status:401});
  const license=await pdvLicenseGuard(token);
  return NextResponse.json(license.result,{status:license.status,headers:{'cache-control':'no-store'}});
}
