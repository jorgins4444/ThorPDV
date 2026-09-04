create or replace function private.cnab_fixed_write(p_line text,p_start integer,p_length integer,p_value text,p_kind text default 'alpha')
returns text
language plpgsql
immutable
as $$
declare v text:=coalesce(p_value,''); outv text;
begin
  if p_length<1 or p_start<1 or p_start+p_length-1>length(p_line) then raise exception 'cnab_field_out_of_range'; end if;
  if lower(coalesce(p_kind,'alpha'))='numeric' then
    v:=regexp_replace(v,'[^0-9]','','g');
    if length(v)>p_length then raise exception 'cnab_numeric_field_overflow:%:%',p_start,p_length; end if;
    outv:=lpad(v,p_length,'0');
  elsif lower(coalesce(p_kind,'alpha'))='raw' then
    outv:=rpad(left(v,p_length),p_length,' ');
  else
    outv:=rpad(left(private.cnab_clean_text(v,p_length),p_length),p_length,' ');
  end if;
  return overlay(p_line placing outv from p_start for p_length);
end $$;

create or replace function private.bradesco_cnab_nosso_numero_dac(p_wallet text,p_our_number text)
returns text
language plpgsql
immutable
as $$
declare digits text; weights integer[]:=array[2,7,6,5,4,3,2,7,6,5,4,3,2]; i integer; total integer:=0; remainder integer;
begin
  digits:=lpad(regexp_replace(coalesce(p_wallet,''),'[^0-9]','','g'),2,'0')||lpad(regexp_replace(coalesce(p_our_number,''),'[^0-9]','','g'),11,'0');
  if length(digits)<>13 then raise exception 'bradesco_nosso_numero_input_invalid'; end if;
  for i in 1..13 loop total:=total+(substr(digits,i,1)::integer*weights[i]); end loop;
  remainder:=total%11;
  if remainder=0 then return '0'; end if;
  if remainder=1 then return 'P'; end if;
  return (11-remainder)::text;
end $$;

create or replace function private.bradesco_cnab_barcode_dac(p_body43 text)
returns integer
language plpgsql
immutable
as $$
declare i integer; weight integer:=2; total integer:=0; remainder integer; result_dac integer;
begin
  if p_body43 is null or p_body43 !~ '^[0-9]{43}$' then raise exception 'bradesco_barcode_body_invalid'; end if;
  for i in reverse 43..1 loop
    total:=total+(substr(p_body43,i,1)::integer*weight);
    weight:=case when weight=9 then 2 else weight+1 end;
  end loop;
  remainder:=total%11;
  result_dac:=11-remainder;
  if result_dac in (0,1) or result_dac>9 then result_dac:=1; end if;
  return result_dac;
end $$;

create or replace function private.bradesco_cnab_barcode(p_agency text,p_account text,p_wallet text,p_our_number text,p_due date,p_amount numeric)
returns text
language plpgsql
immutable
as $$
declare agency4 text; account7 text; wallet2 text; our11 text; factor text; cents text; free_field text; body text; dac integer;
begin
  agency4:=lpad(regexp_replace(coalesce(p_agency,''),'[^0-9]','','g'),4,'0');
  account7:=lpad(regexp_replace(coalesce(p_account,''),'[^0-9]','','g'),7,'0');
  wallet2:=lpad(regexp_replace(coalesce(p_wallet,''),'[^0-9]','','g'),2,'0');
  our11:=lpad(regexp_replace(coalesce(p_our_number,''),'[^0-9]','','g'),11,'0');
  if length(agency4)<>4 or length(account7)<>7 or length(wallet2)<>2 or length(our11)<>11 then raise exception 'bradesco_barcode_input_invalid'; end if;
  factor:=lpad(private.cnab_due_factor(p_due)::text,4,'0');
  cents:=lpad(round(coalesce(p_amount,0)*100)::bigint::text,10,'0');
  if length(cents)>10 then raise exception 'amount_exceeds_barcode_limit'; end if;
  free_field:=agency4||wallet2||our11||account7||'0';
  body:='2379'||factor||cents||free_field;
  dac:=private.bradesco_cnab_barcode_dac(body);
  return '2379'||dac::text||factor||cents||free_field;
end $$;

create or replace function private.bradesco_cnab_digitable_line(p_agency text,p_account text,p_wallet text,p_our_number text,p_due date,p_amount numeric)
returns text
language plpgsql
immutable
as $$
declare barcode text; free_field text; f1 text; f2 text; f3 text; d1 integer; d2 integer; d3 integer;
begin
  barcode:=private.bradesco_cnab_barcode(p_agency,p_account,p_wallet,p_our_number,p_due,p_amount);
  free_field:=substr(barcode,20,25);
  f1:=substr(barcode,1,4)||substr(free_field,1,5);
  f2:=substr(free_field,6,10);
  f3:=substr(free_field,16,10);
  d1:=private.cnab_mod10_dac(f1); d2:=private.cnab_mod10_dac(f2); d3:=private.cnab_mod10_dac(f3);
  return substr(f1,1,5)||'.'||substr(f1,6)||d1::text||' '||substr(f2,1,5)||'.'||substr(f2,6)||d2::text||' '||substr(f3,1,5)||'.'||substr(f3,6)||d3::text||' '||substr(barcode,5,1)||' '||substr(barcode,6,14);
end $$;

create or replace function private.bradesco_cnab400_parse_return(p_content text)
returns jsonb
language plpgsql
stable
as $$
declare lines text[]; ln text; idx integer:=0; rt text; header jsonb:='{}'::jsonb; details jsonb:='[]'::jsonb;
begin
  lines:=regexp_split_to_array(replace(replace(coalesce(p_content,''),chr(26),''),E'\r',''),E'\n');
  foreach ln in array lines loop
    if ln='' then continue; end if;
    idx:=idx+1; rt:=substr(ln,1,1);
    if length(ln)<>400 then
      details:=details||jsonb_build_array(jsonb_build_object('line_number',idx,'record_type',rt,'invalid_length',length(ln),'raw_line',ln));
      continue;
    end if;
    if rt='0' then
      header:=jsonb_build_object('record_type','0','operation',substr(ln,2,1),'literal',upper(trim(substr(ln,3,7))),'service_code',substr(ln,10,2),'beneficiary_code',trim(substr(ln,27,20)),'company_name',trim(substr(ln,47,30)),'bank_code',substr(ln,77,3),'bank_name',trim(substr(ln,80,15)),'generation_date',private.cnab_ddmmyy_date(substr(ln,95,6)),'bank_file_sequence',trim(substr(ln,109,5)),'credit_date',private.cnab_ddmmyy_date(substr(ln,380,6)),'physical_sequence',trim(substr(ln,395,6)));
    elsif rt='1' then
      details:=details||jsonb_build_array(jsonb_build_object(
        'line_number',idx,'record_type','1','company_use',rtrim(substr(ln,38,25)),
        'our_number',substr(ln,71,11),'our_number_dac',substr(ln,82,1),'wallet_code',substr(ln,108,1),
        'occurrence_code',substr(ln,109,2),'occurrence_date',private.cnab_ddmmyy_date(substr(ln,111,6)),
        'document_number',rtrim(substr(ln,117,10)),'confirmed_our_number',regexp_replace(substr(ln,127,20),'[^0-9]','','g'),
        'due_date',private.cnab_ddmmyy_date(substr(ln,147,6)),'title_amount',private.cnab_numeric_amount(substr(ln,153,13)),
        'bank_fee',private.cnab_numeric_amount(substr(ln,176,13)),'other_expenses',private.cnab_numeric_amount(substr(ln,189,13)),
        'iof',private.cnab_numeric_amount(substr(ln,215,13)),'rebate',private.cnab_numeric_amount(substr(ln,228,13)),
        'discount',private.cnab_numeric_amount(substr(ln,241,13)),'paid_amount',private.cnab_numeric_amount(substr(ln,254,13)),
        'interest_amount',private.cnab_numeric_amount(substr(ln,267,13)),'other_credits',private.cnab_numeric_amount(substr(ln,280,13)),
        'credit_date',private.cnab_ddmmyy_date(substr(ln,296,6)),'payment_origin',substr(ln,302,3),'error_codes',trim(substr(ln,319,10)),
        'raw_line',ln));
    end if;
  end loop;
  return jsonb_build_object('ok',true,'header',header,'details',details,'record_count',idx);
end $$;

create or replace function public.erp_bradesco_cnab400_remittance_generate(p_token text,p_config uuid,p_entry_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path to 'public','private','extensions'
as $$
declare
  v record; cfg public.bank_cnab_configs%rowtype; co public.companies%rowtype; ba public.bank_accounts%rowtype; h public.bank_file_homologations%rowtype;
  fe record; ids uuid[]; requested integer; valid_count integer; file_seq bigint; next_our bigint; rem_id uuid:=gen_random_uuid();
  header text; detail text; trailer text; content text; line_seq integer:=1; item_count integer:=0; total numeric:=0;
  beneficiary_code text; wallet2 text; beneficiary_id text; cnpj text; cust_doc text; payer_type text; payer_address text; cep text;
  company_use text; ourno text; ourdac text; docno text; amount numeric; barcode text; digitable text; fname text; hash text; extension text;
begin
  select * into v from private.resolve_temp_context(p_token);
  if v.user_id is null then return jsonb_build_object('ok',false,'error','invalid_session'); end if;
  if p_entry_ids is null or cardinality(p_entry_ids)=0 then return jsonb_build_object('ok',false,'error','select_receivables'); end if;
  if cardinality(p_entry_ids)>500 then return jsonb_build_object('ok',false,'error','too_many_receivables','limit',500); end if;
  select array_agg(distinct x) into ids from unnest(p_entry_ids) x; requested:=cardinality(ids);
  select * into cfg from public.bank_cnab_configs where id=p_config and tenant_id=v.tenant_id and company_id=v.company_id and active=true for update;
  if cfg.id is null then return jsonb_build_object('ok',false,'error','cnab_config_not_found'); end if;
  if cfg.bank_code<>'237' or cfg.layout<>'cnab400' then return jsonb_build_object('ok',false,'error','cnab_config_not_supported'); end if;
  beneficiary_code:=regexp_replace(coalesce(cfg.settings->>'beneficiary_code',''),'[^0-9]','','g');
  wallet2:=lpad(regexp_replace(coalesce(cfg.wallet,''),'[^0-9]','','g'),2,'0');
  if length(regexp_replace(cfg.agency,'[^0-9]','','g'))<>4 or length(regexp_replace(cfg.account_number,'[^0-9]','','g'))<>7 or length(cfg.account_digit)<>1 or length(wallet2)<>2 or length(beneficiary_code) not between 1 and 20 then return jsonb_build_object('ok',false,'error','bradesco_cnab400_config_incomplete'); end if;
  select * into co from public.companies where id=v.company_id and tenant_id=v.tenant_id;
  select * into ba from public.bank_accounts where id=cfg.bank_account_id and tenant_id=v.tenant_id and active=true and account_type='bank';
  if co.id is null or ba.id is null then return jsonb_build_object('ok',false,'error','cnab_company_or_account_not_found'); end if;
  cnpj:=regexp_replace(coalesce(co.cnpj,''),'[^0-9]','','g'); if length(cnpj)<>14 then return jsonb_build_object('ok',false,'error','company_cnpj_required'); end if;
  select count(*) into valid_count from public.financial_entries f where f.id=any(ids) and f.tenant_id=v.tenant_id and f.company_id=v.company_id and f.entry_type='receivable' and f.status in ('open','partial','overdue') and greatest(f.amount-f.paid_amount,0)>0 and lower(coalesce(nullif(f.metadata->>'term_method',''),f.document_type,'')) in ('boleto','bank_slip');
  if valid_count<>requested then return jsonb_build_object('ok',false,'error','invalid_receivables','requested',requested,'valid',valid_count); end if;
  if exists(select 1 from public.bank_cnab_remittance_items ri where ri.tenant_id=v.tenant_id and ri.financial_entry_id=any(ids) and ri.status not in ('rejected','cancelled')) then return jsonb_build_object('ok',false,'error','receivable_already_in_active_remittance'); end if;
  perform private.ensure_bank_file_homologation(cfg.id);
  select * into h from public.bank_file_homologations where config_id=cfg.id;
  extension:=case when h.status='approved' then '.REM' else '.TST' end;
  file_seq:=cfg.remittance_sequence+1; next_our:=cfg.our_number_sequence;
  fname:='CB'||to_char(current_date,'DDMM')||lpad((file_seq%100)::text,2,'0')||extension;
  header:=repeat(' ',400);
  header:=private.cnab_fixed_write(header,1,1,'0','numeric'); header:=private.cnab_fixed_write(header,2,1,'1','numeric'); header:=private.cnab_fixed_write(header,3,7,'REMESSA');
  header:=private.cnab_fixed_write(header,10,2,'01','numeric'); header:=private.cnab_fixed_write(header,12,15,'COBRANCA'); header:=private.cnab_fixed_write(header,27,20,beneficiary_code,'numeric');
  header:=private.cnab_fixed_write(header,47,30,coalesce(nullif(co.trade_name,''),co.legal_name)); header:=private.cnab_fixed_write(header,77,3,'237','numeric'); header:=private.cnab_fixed_write(header,80,15,'BRADESCO');
  header:=private.cnab_fixed_write(header,95,6,to_char(current_date,'DDMMYY'),'numeric'); header:=private.cnab_fixed_write(header,109,2,'MX'); header:=private.cnab_fixed_write(header,111,7,file_seq::text,'numeric'); header:=private.cnab_fixed_write(header,395,6,'1','numeric');
  content:=header;
  insert into public.bank_cnab_remittance_files(id,tenant_id,company_id,branch_id,config_id,bank_account_id,layout,file_sequence,file_name,status) values(rem_id,v.tenant_id,v.company_id,v.branch_id,cfg.id,cfg.bank_account_id,'cnab400',file_seq,fname,'generated');
  beneficiary_id:='0'||lpad(wallet2,3,'0')||lpad(regexp_replace(cfg.agency,'[^0-9]','','g'),5,'0')||lpad(regexp_replace(cfg.account_number,'[^0-9]','','g'),7,'0')||upper(left(cfg.account_digit,1));
  for fe in select f.*,c.name customer_name,c.document customer_document,c.street,c.number,c.complement,c.district,c.city,c.state,c.postal_code,s.number sale_number from public.financial_entries f join public.customers c on c.id=f.customer_id and c.tenant_id=f.tenant_id left join public.sales s on s.id=f.sale_id where f.id=any(ids) and f.tenant_id=v.tenant_id and f.company_id=v.company_id order by f.due_date,f.created_at
  loop
    cust_doc:=regexp_replace(coalesce(fe.customer_document,''),'[^0-9]','','g');
    if length(cust_doc) not in (11,14) then return jsonb_build_object('ok',false,'error','payer_document_invalid','financial_entry_id',fe.id); end if;
    if nullif(trim(coalesce(fe.customer_name,'')),'') is null or nullif(trim(coalesce(fe.street,'')),'') is null or nullif(trim(coalesce(fe.city,'')),'') is null or length(trim(coalesce(fe.state,'')))<>2 or length(regexp_replace(coalesce(fe.postal_code,''),'[^0-9]','','g'))<>8 then return jsonb_build_object('ok',false,'error','payer_data_incomplete','financial_entry_id',fe.id); end if;
    next_our:=next_our+1; if next_our>99999999999 then return jsonb_build_object('ok',false,'error','cnab_our_number_sequence_exhausted'); end if;
    ourno:=lpad(next_our::text,11,'0'); ourdac:=private.bradesco_cnab_nosso_numero_dac(wallet2,ourno); amount:=greatest(fe.amount-fe.paid_amount,0);
    company_use:='TH'||upper(left(replace(fe.id::text,'-',''),23)); docno:=left(coalesce(nullif(fe.sale_number::text,''),replace(fe.id::text,'-','')),10);
    barcode:=private.bradesco_cnab_barcode(cfg.agency,cfg.account_number,wallet2,ourno,fe.due_date,amount); digitable:=private.bradesco_cnab_digitable_line(cfg.agency,cfg.account_number,wallet2,ourno,fe.due_date,amount);
    payer_type:=case when length(cust_doc)=11 then '01' else '02' end; payer_address:=private.cnab_clean_text(concat_ws(' ',fe.street,fe.number,fe.complement),40); cep:=regexp_replace(coalesce(fe.postal_code,''),'[^0-9]','','g');
    line_seq:=line_seq+1; detail:=repeat(' ',400);
    detail:=private.cnab_fixed_write(detail,1,1,'1','numeric'); detail:=private.cnab_fixed_write(detail,2,19,'0','numeric'); detail:=private.cnab_fixed_write(detail,21,17,beneficiary_id,'raw');
    detail:=private.cnab_fixed_write(detail,38,25,company_use); detail:=private.cnab_fixed_write(detail,63,3,'0','numeric'); detail:=private.cnab_fixed_write(detail,66,1,'0','numeric'); detail:=private.cnab_fixed_write(detail,67,4,'0','numeric');
    detail:=private.cnab_fixed_write(detail,71,11,ourno,'numeric'); detail:=private.cnab_fixed_write(detail,82,1,ourdac,'raw'); detail:=private.cnab_fixed_write(detail,83,10,'0','numeric'); detail:=private.cnab_fixed_write(detail,93,1,'2','numeric');
    detail:=private.cnab_fixed_write(detail,107,2,'0','numeric'); detail:=private.cnab_fixed_write(detail,109,2,'01','numeric'); detail:=private.cnab_fixed_write(detail,111,10,docno); detail:=private.cnab_fixed_write(detail,121,6,to_char(fe.due_date,'DDMMYY'),'numeric');
    detail:=private.cnab_fixed_write(detail,127,13,round(amount*100)::bigint::text,'numeric'); detail:=private.cnab_fixed_write(detail,140,3,'0','numeric'); detail:=private.cnab_fixed_write(detail,143,5,'0','numeric'); detail:=private.cnab_fixed_write(detail,148,2,coalesce(nullif(cfg.species,''),'01'),'numeric'); detail:=private.cnab_fixed_write(detail,150,1,'N','raw');
    detail:=private.cnab_fixed_write(detail,151,6,to_char(coalesce(fe.issued_at,current_date),'DDMMYY'),'numeric'); detail:=private.cnab_fixed_write(detail,157,2,'00','numeric'); detail:=private.cnab_fixed_write(detail,159,2,'00','numeric');
    detail:=private.cnab_fixed_write(detail,161,13,'0','numeric'); detail:=private.cnab_fixed_write(detail,174,6,'0','numeric'); detail:=private.cnab_fixed_write(detail,180,13,'0','numeric'); detail:=private.cnab_fixed_write(detail,193,13,'0','numeric'); detail:=private.cnab_fixed_write(detail,206,13,'0','numeric');
    detail:=private.cnab_fixed_write(detail,219,2,payer_type,'numeric'); detail:=private.cnab_fixed_write(detail,221,14,cust_doc,'numeric'); detail:=private.cnab_fixed_write(detail,235,40,fe.customer_name); detail:=private.cnab_fixed_write(detail,275,40,payer_address,'raw'); detail:=private.cnab_fixed_write(detail,327,8,cep,'numeric'); detail:=private.cnab_fixed_write(detail,395,6,line_seq::text,'numeric');
    if length(detail)<>400 then raise exception 'bradesco_cnab400_detail_invalid_length:%',length(detail); end if;
    content:=content||E'\r\n'||detail;
    insert into public.bank_cnab_remittance_items(tenant_id,company_id,branch_id,config_id,remittance_id,financial_entry_id,customer_id,line_number,company_use,our_number,our_number_dac,document_number,amount,due_date,barcode,digitable_line,status) values(v.tenant_id,v.company_id,fe.branch_id,cfg.id,rem_id,fe.id,fe.customer_id,line_seq,company_use,ourno,ourdac,docno,amount,fe.due_date,barcode,digitable,'generated');
    item_count:=item_count+1; total:=total+amount;
  end loop;
  line_seq:=line_seq+1; trailer:=repeat(' ',400); trailer:=private.cnab_fixed_write(trailer,1,1,'9','numeric'); trailer:=private.cnab_fixed_write(trailer,395,6,line_seq::text,'numeric');
  content:=content||E'\r\n'||trailer||E'\r\n'||chr(26); hash:=encode(extensions.digest(content,'sha256'),'hex');
  update public.bank_cnab_remittance_files set file_hash=hash,raw_content=content,record_count=item_count,total_amount=total where id=rem_id;
  update public.bank_cnab_configs set remittance_sequence=file_seq,our_number_sequence=next_our,settings=coalesce(settings,'{}'::jsonb)||jsonb_build_object('generation_ready',true,'implementation_stage','cnab400_operational'),updated_at=now() where id=cfg.id;
  return jsonb_build_object('ok',true,'bank_code','237','bank_name','Bradesco','layout','cnab400','remittance_id',rem_id,'file_name',fname,'file_sequence',file_seq,'record_count',item_count,'total_amount',total,'content',content,'file_hash',hash,'homologation_status',h.status,'test_file',h.status<>'approved');
end $$;

create or replace function public.erp_bradesco_cnab400_return_preview(p_token text,p_content text)
returns jsonb
language plpgsql
security definer
set search_path to 'public','private'
as $$
declare v record; parsed jsonb; hdr jsonb;
begin
  select * into v from private.resolve_temp_context(p_token); if v.user_id is null then return jsonb_build_object('ok',false,'error','invalid_session'); end if;
  if nullif(p_content,'') is null then return jsonb_build_object('ok',false,'error','return_file_empty'); end if;
  parsed:=private.bradesco_cnab400_parse_return(p_content); hdr:=coalesce(parsed->'header','{}'::jsonb);
  if coalesce(hdr->>'bank_code','')<>'237' then return jsonb_build_object('ok',false,'error','return_not_bradesco_cnab400','bank_code',hdr->>'bank_code'); end if;
  if coalesce(hdr->>'operation','')<>'2' or upper(coalesce(hdr->>'literal',''))<>'RETORNO' or coalesce(hdr->>'service_code','')<>'01' then return jsonb_build_object('ok',false,'error','cnab400_file_is_not_return'); end if;
  return parsed;
end $$;

create or replace function public.erp_bradesco_cnab400_return_import(p_token text,p_config uuid,p_file_name text,p_content text)
returns jsonb
language plpgsql
security definer
set search_path to 'public','private','extensions'
as $$
declare
  v record; cfg public.bank_cnab_configs%rowtype; parsed jsonb; hdr jsonb; d jsonb; v_file_hash text; old_file public.bank_cnab_return_files%rowtype;
  ret_id uuid:=gen_random_uuid(); ret_item_id uuid; ri public.bank_cnab_remittance_items%rowtype; fe public.financial_entries%rowtype;
  occ text; cuse text; ourno text; settle_amount numeric; bank_credit numeric; remaining numeric; settle_id uuid; bank_tx uuid; settled_at timestamptz;
  records integer:=0; processed integer:=0; matched integer:=0; paid integer:=0; errors integer:=0; status_value text;
begin
  select * into v from private.resolve_temp_context(p_token); if v.user_id is null then return jsonb_build_object('ok',false,'error','invalid_session'); end if;
  select * into cfg from public.bank_cnab_configs where id=p_config and tenant_id=v.tenant_id and company_id=v.company_id and active=true;
  if cfg.id is null then return jsonb_build_object('ok',false,'error','cnab_config_not_found'); end if;
  if cfg.bank_code<>'237' or cfg.layout<>'cnab400' then return jsonb_build_object('ok',false,'error','cnab_config_not_supported'); end if;
  parsed:=public.erp_bradesco_cnab400_return_preview(p_token,p_content); if not coalesce((parsed->>'ok')::boolean,false) then return parsed; end if; hdr:=coalesce(parsed->'header','{}'::jsonb);
  v_file_hash:=encode(extensions.digest(p_content,'sha256'),'hex'); select * into old_file from public.bank_cnab_return_files rf where rf.tenant_id=v.tenant_id and rf.file_hash=v_file_hash limit 1;
  if old_file.id is not null then return jsonb_build_object('ok',true,'already_imported',true,'return_file_id',old_file.id,'status',old_file.status,'record_count',old_file.record_count,'paid_count',old_file.paid_count); end if;
  insert into public.bank_cnab_return_files(id,tenant_id,company_id,branch_id,config_id,bank_account_id,layout,file_name,file_hash,bank_file_sequence,generated_date,credit_date,status,raw_content) values(ret_id,v.tenant_id,v.company_id,v.branch_id,cfg.id,cfg.bank_account_id,'cnab400',coalesce(nullif(p_file_name,''),'RETORNO.RET'),v_file_hash,hdr->>'bank_file_sequence',nullif(hdr->>'generation_date','')::date,nullif(hdr->>'credit_date','')::date,'processing',p_content);
  for d in select value from jsonb_array_elements(coalesce(parsed->'details','[]'::jsonb)) loop
    if d ? 'invalid_length' or coalesce(d->>'record_type','')<>'1' then errors:=errors+1; continue; end if;
    records:=records+1; occ:=coalesce(d->>'occurrence_code',''); cuse:=rtrim(coalesce(d->>'company_use','')); ourno:=regexp_replace(coalesce(d->>'our_number',''),'[^0-9]','','g');
    begin
      insert into public.bank_cnab_return_items(tenant_id,company_id,return_file_id,line_number,company_use,wallet,our_number,occurrence_code,occurrence_date,document_number,due_date,title_amount,bank_fee,iof,rebate,discount,principal_amount,interest_amount,other_credits,credit_date,error_codes,raw_line,status)
      values(v.tenant_id,v.company_id,ret_id,(d->>'line_number')::int,nullif(cuse,''),cfg.wallet,nullif(ourno,''),occ,nullif(d->>'occurrence_date','')::date,d->>'document_number',nullif(d->>'due_date','')::date,nullif(d->>'title_amount','')::numeric,nullif(d->>'bank_fee','')::numeric,nullif(d->>'iof','')::numeric,nullif(d->>'rebate','')::numeric,nullif(d->>'discount','')::numeric,nullif(d->>'paid_amount','')::numeric,nullif(d->>'interest_amount','')::numeric,nullif(d->>'other_credits','')::numeric,nullif(d->>'credit_date','')::date,d->>'error_codes',d->>'raw_line','received') returning id into ret_item_id;
      ri:=null;
      if nullif(cuse,'') is not null then select * into ri from public.bank_cnab_remittance_items x where x.config_id=cfg.id and rtrim(x.company_use)=cuse order by x.created_at desc limit 1; end if;
      if ri.id is null and nullif(ourno,'') is not null then select * into ri from public.bank_cnab_remittance_items x where x.config_id=cfg.id and x.our_number=ourno order by x.created_at desc limit 1; end if;
      if ri.id is null then update public.bank_cnab_return_items set status='unmatched',message='Título não localizado na remessa do Thor.',processed_at=now() where id=ret_item_id; errors:=errors+1; continue; end if;
      matched:=matched+1; update public.bank_cnab_return_items set remittance_item_id=ri.id,financial_entry_id=ri.financial_entry_id where id=ret_item_id;
      if occ='02' then update public.bank_cnab_remittance_items set status='accepted',rejection_code=null,rejection_message=null,updated_at=now() where id=ri.id and status<>'paid'; update public.bank_cnab_return_items set status='accepted',message='Entrada confirmada pelo Bradesco.',processed_at=now() where id=ret_item_id; processed:=processed+1; continue;
      elsif occ in ('03','24') then update public.bank_cnab_remittance_items set status='rejected',rejection_code=nullif(d->>'error_codes',''),rejection_message='Entrada rejeitada pelo Bradesco. Consulte os motivos do retorno.',updated_at=now() where id=ri.id; update public.bank_cnab_return_items set status='rejected',message='Entrada rejeitada pelo Bradesco.',processed_at=now() where id=ret_item_id; processed:=processed+1; continue;
      elsif occ in ('09','10') then update public.bank_cnab_remittance_items set status='cancelled',updated_at=now() where id=ri.id and status<>'paid'; update public.bank_cnab_return_items set status='cancelled',message='Baixa sem liquidação confirmada pelo Bradesco.',processed_at=now() where id=ret_item_id; processed:=processed+1; continue;
      elsif occ not in ('06','15','17') then update public.bank_cnab_return_items set status='ignored',message='Ocorrência registrada sem baixa financeira automática.',processed_at=now() where id=ret_item_id; processed:=processed+1; continue; end if;
      select * into fe from public.financial_entries where id=ri.financial_entry_id and tenant_id=v.tenant_id for update;
      if fe.id is null or fe.entry_type<>'receivable' or fe.status='cancelled' then update public.bank_cnab_return_items set status='error',message='Contas a Receber vinculado não encontrado ou cancelado.',processed_at=now() where id=ret_item_id; errors:=errors+1; continue; end if;
      remaining:=greatest(fe.amount-fe.paid_amount,0);
      if remaining<=0.001 or fe.status='paid' then update public.bank_cnab_remittance_items set status='paid',updated_at=now() where id=ri.id; update public.bank_cnab_return_items set status='paid',message='Título já estava quitado; retorno reconhecido sem duplicar baixa.',processed_at=now() where id=ret_item_id; processed:=processed+1; paid:=paid+1; continue; end if;
      settle_amount:=least(remaining,coalesce(nullif((d->>'paid_amount')::numeric,0),remaining)); if settle_amount is null or settle_amount<=0 then settle_amount:=remaining; end if;
      bank_credit:=greatest(0,coalesce(nullif((d->>'paid_amount')::numeric,0),settle_amount)-coalesce((d->>'bank_fee')::numeric,0)-coalesce((d->>'other_expenses')::numeric,0)); if bank_credit<=0 then bank_credit:=settle_amount; end if;
      settled_at:=coalesce(nullif(d->>'credit_date','')::date,nullif(d->>'occurrence_date','')::date,current_date)::timestamptz; settle_id:=gen_random_uuid();
      insert into public.financial_settlements(id,tenant_id,company_id,branch_id,financial_entry_id,amount,settled_at,payment_method,destination_type,bank_account_id,notes,metadata,status) values(settle_id,v.tenant_id,fe.company_id,fe.branch_id,fe.id,settle_amount,settled_at,'bank_slip','bank_account',cfg.bank_account_id,'Baixa automática por arquivo retorno Bradesco CNAB 400.',jsonb_build_object('source','bradesco_cnab400_return','return_file_id',ret_id,'return_item_id',ret_item_id,'remittance_item_id',ri.id,'occurrence_code',occ,'our_number',ri.our_number,'bank_credit',bank_credit,'title_amount',d->>'title_amount','bank_fee',d->>'bank_fee','discount',d->>'discount','interest',d->>'interest_amount'),'active');
      insert into public.bank_transactions(tenant_id,bank_account_id,transaction_date,description,amount,direction,external_id,reconciled,financial_entry_id,payment_method,origin_type,origin_id,notes) values(v.tenant_id,cfg.bank_account_id,settled_at::date,'Liquidação boleto Bradesco CNAB · '||ri.our_number,bank_credit,'credit','bradesco-cnab400:'||ret_id::text||':'||(d->>'line_number'),true,fe.id,'bank_slip','financial_settlement',settle_id,'Crédito confirmado pelo arquivo retorno CNAB 400 do Bradesco.') returning id into bank_tx;
      update public.financial_settlements set bank_transaction_id=bank_tx where id=settle_id;
      update public.financial_entries set paid_amount=least(amount,paid_amount+settle_amount),status=case when paid_amount+settle_amount>=amount-0.001 then 'paid' else 'partial' end,paid_at=case when paid_amount+settle_amount>=amount-0.001 then settled_at else paid_at end,updated_at=now(),metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('last_payment_method','bank_slip','last_destination_type','bank_account','last_settlement_id',settle_id,'last_cnab_return_file_id',ret_id,'last_cnab_return_item_id',ret_item_id,'last_cnab_our_number',ri.our_number,'last_cnab_bank_code','237') where id=fe.id;
      status_value:=case when settle_amount>=remaining-0.001 then 'paid' else 'partial' end; update public.bank_cnab_remittance_items set status=status_value,updated_at=now() where id=ri.id;
      update public.bank_cnab_return_items set status=status_value,financial_settlement_id=settle_id,bank_transaction_id=bank_tx,message=case when status_value='paid' then 'Liquidação Bradesco processada e Contas a Receber quitado automaticamente.' else 'Liquidação parcial Bradesco processada automaticamente.' end,processed_at=now() where id=ret_item_id;
      processed:=processed+1; paid:=paid+case when status_value='paid' then 1 else 0 end;
    exception when others then update public.bank_cnab_return_items set status='error',message=left(sqlerrm,500),processed_at=now() where id=ret_item_id; errors:=errors+1; end;
  end loop;
  update public.bank_cnab_return_files set status=case when errors>0 then 'processed_with_errors' else 'processed' end,record_count=records,processed_count=processed,matched_count=matched,paid_count=paid,error_count=errors where id=ret_id;
  update public.bank_cnab_remittance_files rf set status='processed' where rf.id in (select distinct x.remittance_id from public.bank_cnab_return_items rti join public.bank_cnab_remittance_items x on x.id=rti.remittance_item_id where rti.return_file_id=ret_id) and rf.status in ('generated','sent');
  return jsonb_build_object('ok',true,'bank_code','237','return_file_id',ret_id,'status',case when errors>0 then 'processed_with_errors' else 'processed' end,'record_count',records,'processed_count',processed,'matched_count',matched,'paid_count',paid,'error_count',errors,'header',hdr);
end $$;

create or replace function public.erp_cnab_config_save_v3(p_token text,p_bank_account uuid,p_layout text,p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public','private'
as $$
declare r jsonb; cfg_id uuid; bank text;
begin
  r:=public.erp_cnab_config_save_v2(p_token,p_bank_account,p_layout,p_payload);
  if not coalesce((r->>'ok')::boolean,false) then return r; end if;
  bank:=r->>'bank_code'; cfg_id:=nullif(r->>'config_id','')::uuid;
  if bank='237' and lower(p_layout)='cnab400' and cfg_id is not null then
    update public.bank_cnab_configs set settings=coalesce(settings,'{}'::jsonb)||jsonb_build_object('generation_ready',true,'implementation_stage','cnab400_operational'),updated_at=now() where id=cfg_id;
    r:=r||jsonb_build_object('generation_ready',true,'implementation_stage','cnab400_operational');
  end if;
  return r;
end $$;

create or replace function public.erp_cnab_remittance_generate_v2(p_token text,p_config uuid,p_entry_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path to 'public','private'
as $$
declare v record; cfg public.bank_cnab_configs%rowtype;
begin
  select * into v from private.resolve_temp_context(p_token); if v.user_id is null then return jsonb_build_object('ok',false,'error','invalid_session'); end if;
  select * into cfg from public.bank_cnab_configs where id=p_config and tenant_id=v.tenant_id and company_id=v.company_id and active=true;
  if cfg.id is null then return jsonb_build_object('ok',false,'error','cnab_config_not_found'); end if;
  if cfg.bank_code='341' and cfg.layout='cnab240' then return public.erp_cnab240_remittance_generate(p_token,p_config,p_entry_ids); end if;
  if cfg.bank_code='341' and cfg.layout='cnab400' then return public.erp_cnab400_remittance_generate(p_token,p_config,p_entry_ids); end if;
  if cfg.bank_code='237' and cfg.layout='cnab400' then return public.erp_bradesco_cnab400_remittance_generate(p_token,p_config,p_entry_ids); end if;
  if cfg.bank_code='237' and cfg.layout='cnab240' then return jsonb_build_object('ok',false,'error','bradesco_cnab240_not_operational','detail','Modelo oficial CNAB 240 carregado; gerador e retorno ainda aguardam a etapa específica de homologação.'); end if;
  return jsonb_build_object('ok',false,'error','bank_cnab_not_enabled_yet','bank_code',cfg.bank_code,'layout',cfg.layout);
end $$;

create or replace function public.erp_cnab_return_preview_v2(p_token text,p_config uuid,p_content text)
returns jsonb
language plpgsql
security definer
set search_path to 'public','private'
as $$
declare v record; cfg public.bank_cnab_configs%rowtype;
begin
  select * into v from private.resolve_temp_context(p_token); if v.user_id is null then return jsonb_build_object('ok',false,'error','invalid_session'); end if;
  select * into cfg from public.bank_cnab_configs where id=p_config and tenant_id=v.tenant_id and company_id=v.company_id and active=true;
  if cfg.id is null then return jsonb_build_object('ok',false,'error','cnab_config_not_found'); end if;
  if cfg.bank_code='341' and cfg.layout='cnab240' then return public.erp_cnab240_return_preview(p_token,p_content); end if;
  if cfg.bank_code='341' and cfg.layout='cnab400' then return public.erp_cnab400_return_preview(p_token,p_content); end if;
  if cfg.bank_code='237' and cfg.layout='cnab400' then return public.erp_bradesco_cnab400_return_preview(p_token,p_content); end if;
  return jsonb_build_object('ok',false,'error','return_parser_not_enabled_for_bank','bank_code',cfg.bank_code,'layout',cfg.layout);
end $$;

create or replace function public.erp_cnab_return_import_v2(p_token text,p_config uuid,p_file_name text,p_content text)
returns jsonb
language plpgsql
security definer
set search_path to 'public','private'
as $$
declare v record; cfg public.bank_cnab_configs%rowtype;
begin
  select * into v from private.resolve_temp_context(p_token); if v.user_id is null then return jsonb_build_object('ok',false,'error','invalid_session'); end if;
  select * into cfg from public.bank_cnab_configs where id=p_config and tenant_id=v.tenant_id and company_id=v.company_id and active=true;
  if cfg.id is null then return jsonb_build_object('ok',false,'error','cnab_config_not_found'); end if;
  if cfg.bank_code='341' and cfg.layout='cnab240' then return public.erp_cnab240_return_import(p_token,p_config,p_file_name,p_content); end if;
  if cfg.bank_code='341' and cfg.layout='cnab400' then return public.erp_cnab400_return_import(p_token,p_config,p_file_name,p_content); end if;
  if cfg.bank_code='237' and cfg.layout='cnab400' then return public.erp_bradesco_cnab400_return_import(p_token,p_config,p_file_name,p_content); end if;
  return jsonb_build_object('ok',false,'error','return_parser_not_enabled_for_bank','bank_code',cfg.bank_code,'layout',cfg.layout);
end $$;

update public.bank_cnab_configs set settings=coalesce(settings,'{}'::jsonb)||jsonb_build_object('generation_ready',true,'implementation_stage','cnab400_operational') where bank_code='237' and layout='cnab400';
