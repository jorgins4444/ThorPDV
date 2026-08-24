import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

function bearer(request: Request) {
  const value = request.headers.get('authorization') ?? '';
  return value.toLowerCase().startsWith('bearer ') ? value.slice(7).trim() : '';
}

export async function POST(request: Request) {
  const token = bearer(request);
  if (!token) return NextResponse.json({ ok:false,error:'device_token_required' },{status:401});
  const body = await request.json().catch(()=>({})) as { query?:string; type?:string; limit?:number };
  const supabase = await createClient();
  const { data,error } = await supabase.rpc('pdv_operation_history_server',{
    p_device_token:token,
    p_query:body.query?.trim() || null,
    p_type:body.type || 'all',
    p_limit:Math.min(Math.max(Number(body.limit)||250,1),500),
  });
  if(error) return NextResponse.json({ok:false,error:error.message},{status:500});
  const result=data as {ok?:boolean}|null;
  return NextResponse.json(result??{ok:false,error:'empty_response'},{status:result?.ok?200:400});
}
