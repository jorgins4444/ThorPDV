'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

export type CnabLayout='cnab240'|'cnab400';
export type BankFileDirection='remittance'|'return';

const SESSION_COOKIE='thorpdv_test_session';
async function token(){const store=await cookies();const value=store.get(SESSION_COOKIE)?.value;if(!value)redirect('/login');return value;}
async function rpc(name:string,args:Record<string,unknown>){const supabase=await createClient();const {data,error}=await supabase.rpc(name,args);if(error)return {ok:false,error:error.message};return (data??{ok:false}) as Record<string,unknown>}

export async function cnabData(){return rpc('erp_cnab_data',{p_token:await token()})}
export async function bankHomologationData(){return rpc('erp_bank_homologation_data',{p_token:await token()})}
export async function bankLayoutProfile(configId:string){return rpc('erp_bank_layout_profile_get',{p_token:await token(),p_config:configId})}
export async function saveBankLayoutProfile(configId:string,direction:BankFileDirection,model:unknown[]){return rpc('erp_bank_layout_profile_save',{p_token:await token(),p_config:configId,p_direction:direction,p_model:model})}
export async function resetBankLayoutProfile(configId:string){return rpc('erp_bank_layout_profile_reset',{p_token:await token(),p_config:configId})}
export async function confirmBankLayout(configId:string){return rpc('erp_bank_homologation_confirm_layout',{p_token:await token(),p_config:configId})}
export async function selectHomologationTest(configId:string,financialEntryId:string){return rpc('erp_bank_homologation_select_test',{p_token:await token(),p_config:configId,p_financial_entry:financialEntryId})}
export async function searchHomologationCustomers(query:string){return rpc('erp_bank_homologation_customer_search',{p_token:await token(),p_query:query})}
export async function createHomologationTestTitle(configId:string,customerId:string,amount:number){return rpc('erp_bank_homologation_create_test_title',{p_token:await token(),p_config:configId,p_customer:customerId,p_amount:amount})}
export async function bindHomologationRemittance(configId:string,remittanceId:string){return rpc('erp_bank_homologation_bind_remittance',{p_token:await token(),p_config:configId,p_remittance:remittanceId})}
export async function homologationTestFile(configId:string){return rpc('erp_bank_homologation_test_file',{p_token:await token(),p_config:configId})}
export async function cnabBoletoData(remittanceItemId:string){return rpc('erp_cnab_boleto_get',{p_token:await token(),p_remittance_item:remittanceItemId})}
export async function cnabRemittanceBoletoItems(remittanceId:string){return rpc('erp_cnab_remittance_boleto_items',{p_token:await token(),p_remittance:remittanceId})}
export async function markHomologationRemittanceSent(configId:string){return rpc('erp_bank_homologation_mark_sent',{p_token:await token(),p_config:configId})}
export async function restartBankHomologation(configId:string){return rpc('erp_bank_homologation_restart',{p_token:await token(),p_config:configId})}

export async function saveCnabConfig(layout:CnabLayout,bankAccountId:string,payload:Record<string,unknown>){
  return rpc(layout==='cnab240'?'erp_cnab240_config_save':'erp_cnab400_config_save',{
    p_token:await token(),p_bank_account:bankAccountId,p_payload:payload,
  });
}

export async function generateCnabRemittance(layout:CnabLayout,configId:string,entryIds:string[]){
  return rpc(layout==='cnab240'?'erp_cnab240_remittance_generate':'erp_cnab400_remittance_generate',{
    p_token:await token(),p_config:configId,p_entry_ids:entryIds,
  });
}

export async function markCnabRemittanceSent(remittanceId:string){
  return rpc('erp_cnab400_remittance_mark_sent',{p_token:await token(),p_remittance:remittanceId});
}

export async function previewCnabReturn(layout:CnabLayout,content:string){
  return rpc(layout==='cnab240'?'erp_cnab240_return_preview':'erp_cnab400_return_preview',{
    p_token:await token(),p_content:content,
  });
}

export async function importCnabReturn(layout:CnabLayout,configId:string,fileName:string,content:string){
  return rpc(layout==='cnab240'?'erp_cnab240_return_import':'erp_cnab400_return_import',{
    p_token:await token(),p_config:configId,p_file_name:fileName,p_content:content,
  });
}

// Compatibilidade com chamadas antigas durante a transição da tela.
export async function cnab400Data(){return cnabData()}
export async function saveCnab400Config(bankAccountId:string,payload:Record<string,unknown>){return saveCnabConfig('cnab400',bankAccountId,payload)}
export async function generateCnab400Remittance(configId:string,entryIds:string[]){return generateCnabRemittance('cnab400',configId,entryIds)}
export async function markCnab400RemittanceSent(remittanceId:string){return markCnabRemittanceSent(remittanceId)}
export async function previewCnab400Return(content:string){return previewCnabReturn('cnab400',content)}
export async function importCnab400Return(configId:string,fileName:string,content:string){return importCnabReturn('cnab400',configId,fileName,content)}
