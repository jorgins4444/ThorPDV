'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

const SESSION_COOKIE = 'thorpdv_test_session';
type RpcResult = { ok?: boolean; error?: string; data?: Record<string, unknown>[] | Record<string, unknown>; id?: string; [key: string]: unknown };

async function getSessionToken(){const cookieStore=await cookies();const token=cookieStore.get(SESSION_COOKIE)?.value;if(!token)redirect('/login');return token;}
async function rpc(name:string,args:Record<string,unknown>){const supabase=await createClient();const {data,error}=await supabase.rpc(name,args);if(error)return {ok:false,error:error.message} as RpcResult;return (data??{ok:false}) as RpcResult;}

export async function erpLoad(resource:string,search?:string){const token=await getSessionToken();const result=await rpc('erp_list',{p_token:token,p_resource:resource,p_search:search?.trim()||null});return {ok:Boolean(result.ok),error:result.error,data:Array.isArray(result.data)?result.data:[]};}
export async function erpSave(resource:string,payload:Record<string,unknown>){const token=await getSessionToken();return resource==='stock'?rpc('erp_stock_move',{p_token:token,p_payload:payload}):rpc('erp_save',{p_token:token,p_resource:resource,p_payload:payload});}
export async function erpProductList(search?:string){const token=await getSessionToken();const result=await rpc('erp_product_list_v2',{p_token:token,p_search:search?.trim()||null});return {ok:Boolean(result.ok),error:result.error,data:Array.isArray(result.data)?result.data:[],branch_id:result.branch_id};}
export async function erpProductDetail(productId:string){const token=await getSessionToken();return rpc('erp_product_detail',{p_token:token,p_product:productId});}
export async function erpProductSave(payload:Record<string,unknown>){const token=await getSessionToken();return rpc('erp_product_save_v4',{p_token:token,p_payload:payload});}
export async function erpProductCompositionSet(productId:string,items:Record<string,unknown>[]){const token=await getSessionToken();return rpc('erp_product_composition_set',{p_token:token,p_product:productId,p_items:items});}
export async function erpGenerateProductBarcode(){const token=await getSessionToken();return rpc('erp_generate_product_barcode',{p_token:token});}
export async function erpProductAddStock(productId:string,quantity:number,unitCost?:number){const token=await getSessionToken();return rpc('erp_stock_move',{p_token:token,p_payload:{product_id:productId,movement_type:'in',quantity,unit_cost:unitCost??null,notes:'Entrada de estoque após cadastro do produto'}});}
export async function erpProductionOrders(status?:string){const token=await getSessionToken();const result=await rpc('erp_production_orders',{p_token:token,p_status:status||null});return {ok:Boolean(result.ok),error:result.error,data:Array.isArray(result.data)?result.data:[]};}
export async function erpProductionOrderCreate(productId:string,quantity:number,notes?:string){const token=await getSessionToken();return rpc('erp_production_order_create',{p_token:token,p_product:productId,p_quantity:quantity,p_notes:notes||null});}
export async function erpProductionOrderComplete(orderId:string,quantity?:number){const token=await getSessionToken();return rpc('erp_production_order_complete',{p_token:token,p_order:orderId,p_produced_quantity:quantity||null});}
export async function erpProductionOrderCancel(orderId:string){const token=await getSessionToken();return rpc('erp_production_order_cancel',{p_token:token,p_order:orderId});}
export async function erpProductionOrderStatus(orderId:string,status:string){const token=await getSessionToken();return rpc('erp_production_order_status',{p_token:token,p_order:orderId,p_status:status});}
export async function erpProductionMarkPrinted(orderId:string,ok:boolean,error?:string){const token=await getSessionToken();return rpc('erp_production_mark_printed',{p_token:token,p_order:orderId,p_ok:ok,p_error:error||null});}
export async function erpSaleCatalog(priceTableId?:string){const token=await getSessionToken();const result=await rpc('erp_sale_catalog',{p_token:token,p_price_table_id:priceTableId||null});return {ok:Boolean(result.ok),error:result.error,price_table_id:result.price_table_id,data:Array.isArray(result.data)?result.data:[]};}
export async function erpCreateSale(payload:Record<string,unknown>){const token=await getSessionToken();return rpc('erp_create_sale',{p_token:token,p_payload:payload});}
export async function erpPriceTableDetail(tableId:string){const token=await getSessionToken();return rpc('erp_price_table_detail',{p_token:token,p_table_id:tableId});}
export async function erpPriceTableSetItem(tableId:string,productId:string,price:number){const token=await getSessionToken();return rpc('erp_price_table_set_item',{p_token:token,p_table_id:tableId,p_product_id:productId,p_price:price});}
export async function erpPriceTableCopy(sourceId:string,name:string){const token=await getSessionToken();return rpc('erp_price_table_copy',{p_token:token,p_source_id:sourceId,p_name:name});}
export async function erpInventoryStart(notes?:string){const token=await getSessionToken();return rpc('erp_inventory_start',{p_token:token,p_notes:notes||null});}
export async function erpInventoryDetail(inventoryId:string){const token=await getSessionToken();return rpc('erp_inventory_detail',{p_token:token,p_inventory_id:inventoryId});}
export async function erpInventoryCount(inventoryId:string,productId:string,counted:number){const token=await getSessionToken();return rpc('erp_inventory_set_count',{p_token:token,p_inventory_id:inventoryId,p_product_id:productId,p_counted:counted});}
export async function erpInventoryClose(inventoryId:string){const token=await getSessionToken();return rpc('erp_inventory_close',{p_token:token,p_inventory_id:inventoryId});}
export async function erpCashList(){const token=await getSessionToken();const result=await rpc('erp_cash_list',{p_token:token});return {ok:Boolean(result.ok),error:result.error,data:Array.isArray(result.data)?result.data:[]};}
export async function erpCashOpen(posId:string,opening:number){const token=await getSessionToken();return rpc('erp_cash_open',{p_token:token,p_pos_id:posId,p_opening:opening});}
export async function erpCashClose(cashId:string,closing:number,notes?:string){const token=await getSessionToken();return rpc('erp_cash_close',{p_token:token,p_cash_id:cashId,p_closing:closing,p_notes:notes||null});}

export async function erpSalesCashDashboard(filters:{start?:string;end?:string;operatorId?:string;branchId?:string;status?:string;operationFilter?:string}={}){
  const token=await getSessionToken();
  const result=await rpc('erp_sales_cash_dashboard_v2',{
    p_token:token,p_start:filters.start||null,p_end:filters.end||null,p_operator:filters.operatorId||null,p_branch:filters.branchId||null,
    p_cash_status:filters.status||null,p_operation_filter:filters.operationFilter||null,
  });
  return {ok:Boolean(result.ok),error:result.error,sessions:Array.isArray(result.sessions)?result.sessions:[],operations:Array.isArray(result.operations)?result.operations:[],operators:Array.isArray(result.operators)?result.operators:[],branches:Array.isArray(result.branches)?result.branches:[],summary:(result.summary&&typeof result.summary==='object'&&!Array.isArray(result.summary)?result.summary:{}) as Record<string,unknown>};
}
export async function erpSalesCashSaleDetail(saleId:string){const token=await getSessionToken();return rpc('erp_sales_cash_sale_detail',{p_token:token,p_sale:saleId});}
export async function erpSalesCashCancelSale(saleId:string,reason:string){const token=await getSessionToken();return rpc('erp_sales_cash_cancel_sale',{p_token:token,p_sale:saleId,p_reason:reason});}
export async function erpSalesCashCancelNfce(saleId:string,reason:string){const token=await getSessionToken();return rpc('erp_sales_cash_cancel_nfce',{p_token:token,p_sale:saleId,p_reason:reason});}
export async function erpSalesCashFiscalXml(documentId:string){const token=await getSessionToken();return rpc('erp_sales_cash_fiscal_xml',{p_token:token,p_document:documentId});}
export async function erpCashClosureHistory(filters:{start?:string;end?:string;operatorId?:string;branchId?:string}={}){const token=await getSessionToken();const result=await rpc('erp_cash_closure_history',{p_token:token,p_start:filters.start||null,p_end:filters.end||null,p_operator:filters.operatorId||null,p_branch:filters.branchId||null});return {ok:Boolean(result.ok),error:result.error,data:Array.isArray(result.data)?result.data:[]};}
export async function erpCashManagementClose(cashId:string,closing:number,notes?:string){const token=await getSessionToken();return rpc('erp_cash_management_close',{p_token:token,p_cash_id:cashId,p_closing:closing,p_notes:notes||null});}
export async function erpCashManagementReopen(cashId:string,reason:string){const token=await getSessionToken();return rpc('erp_cash_management_reopen',{p_token:token,p_cash_id:cashId,p_reason:reason});}

export async function erpReport(report:'sales'|'finance'|'stock',start?:string,end?:string,branchId?:string){const token=await getSessionToken();const result=await rpc('erp_report',{p_token:token,p_report:report,p_start:start||null,p_end:end||null,p_branch:branchId||null});return {ok:Boolean(result.ok),error:result.error,data:Array.isArray(result.data)?result.data:[],start:result.start,end:result.end};}
export async function erpFiscalSettingsGet(){const token=await getSessionToken();return rpc('erp_fiscal_settings_get',{p_token:token});}
export async function erpFiscalSettingsSave(payload:Record<string,unknown>){const token=await getSessionToken();return rpc('erp_fiscal_settings_save',{p_token:token,p_payload:payload});}
export async function erpFiscalPrepare(saleId:string,documentType:'nfe'|'nfce'){const token=await getSessionToken();return rpc('erp_fiscal_prepare',{p_token:token,p_sale_id:saleId,p_document_type:documentType});}
export async function erpFiscalSend(documentId:string){const token=await getSessionToken();return rpc('erp_fiscal_send',{p_token:token,p_document_id:documentId});}


export async function erpManagementAudit(filters:{start?:string;end?:string;branchId?:string;operatorId?:string;eventType?:string;search?:string}={}){
  const token=await getSessionToken();
  const result=await rpc('erp_management_audit_list',{
    p_token:token,p_start:filters.start||null,p_end:filters.end||null,p_branch:filters.branchId||null,
    p_operator:filters.operatorId||null,p_event_type:filters.eventType||null,p_search:filters.search?.trim()||null,
  });
  return {
    ok:Boolean(result.ok),error:typeof result.error==='string'?result.error:undefined,
    data:Array.isArray(result.data)?result.data:[],
    summary:(result.summary&&typeof result.summary==='object'&&!Array.isArray(result.summary)?result.summary:{}) as Record<string,unknown>,
    branches:Array.isArray(result.branches)?result.branches:[],
    operators:Array.isArray(result.operators)?result.operators:[],
  };
}
