'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

type Row = Record<string,unknown>;
type LotsResponse = {ok?:boolean;error?:string;lots?:Row[];products?:Row[];branch_id?:string;id?:string};

async function call(action:'list'|'save'|'remove',payload:Row={}):Promise<LotsResponse>{
 const token=(await cookies()).get('thorpdv_test_session')?.value;
 if(!token)redirect('/login');
 const supabase=await createClient();
 const {data,error}=await supabase.rpc('erp_expiry_lots_manage',{p_token:token,p_action:action,p_payload:payload});
 if(error)return {ok:false,error:error.message};
 return (data??{ok:false}) as LotsResponse;
}

export async function expiryLotsLoad(){return call('list');}
export async function expiryLotsSave(payload:Row){return call('save',payload);}
export async function expiryLotsRemove(id:string){return call('remove',{id});}

export async function expiryLotTrace(){
 const token=(await cookies()).get('thorpdv_test_session')?.value;
 if(!token)redirect('/login');
 const supabase=await createClient();
 const {data,error}=await supabase.rpc('erp_purchase_lot_trace',{p_token:token});
 if(error)return {ok:false,error:error.message,traces:[]};
 return (data??{ok:false,traces:[]}) as {ok?:boolean;error?:string;traces?:Row[]};
}
export async function expiryLotManualDecrement(id:string,quantity:number,note:string){
 const token=(await cookies()).get('thorpdv_test_session')?.value;
 if(!token)redirect('/login');
 const supabase=await createClient();
 const {data,error}=await supabase.rpc('erp_lot_manual_decrement',{p_token:token,p_lot:id,p_quantity:quantity,p_note:note});
 if(error)return {ok:false,error:error.message};
 return (data??{ok:false}) as {ok?:boolean;error?:string;remaining?:number};
}
