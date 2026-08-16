-- Corrige conflitos entre variável PL/pgSQL `ri` e alias SQL `ri`
-- nas rotinas legadas de importação de retorno usadas também pela homologação bancária.

do $$
declare
  src text;
begin
  src := pg_get_functiondef('public.erp_cnab400_return_import(text,uuid,text,text)'::regprocedure);
  src := replace(src,'select distinct ri.remittance_id','select distinct matched_ri.remittance_id');
  src := replace(src,'join public.bank_cnab_remittance_items ri on ri.id=rti.remittance_item_id','join public.bank_cnab_remittance_items matched_ri on matched_ri.id=rti.remittance_item_id');
  execute src;

  src := pg_get_functiondef('public.erp_cnab240_return_import(text,uuid,text,text)'::regprocedure);
  src := replace(src,'select distinct ri.remittance_id','select distinct matched_ri.remittance_id');
  src := replace(src,'join public.bank_cnab_remittance_items ri on ri.id=rti.remittance_item_id','join public.bank_cnab_remittance_items matched_ri on matched_ri.id=rti.remittance_item_id');
  execute src;
end $$;
