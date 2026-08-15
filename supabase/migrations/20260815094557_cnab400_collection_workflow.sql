create or replace function public.erp_cnab400_config_save(p_token text,p_bank_account uuid,p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public','private','extensions'
as $$
declare
  v record; ba public.bank_accounts%rowtype; cfg public.bank_cnab_configs%rowtype; co public.companies%rowtype;
  ag text; acct text; digit text; wallet text; species text; acceptance text; initial_our bigint;
begin
  select * into v from private.resolve_temp_context(p_token);
  if v.user_id is null then return jsonb_build_object('ok',false,'error','invalid_session'); end if;
  select * into ba from public.bank_accounts where id=p_bank_account and tenant_id=v.tenant_id and active=true and account_type='bank';
  if ba.id is null then return jsonb_build_object('ok',false,'error','bank_account_not_found'); end if;
  select * into co from public.companies where id=v.company_id and tenant_id=v.tenant_id;
  if co.id is null or length(regexp_replace(coalesce(co.cnpj,''),'\D','','g'))<>14 then return jsonb_build_object('ok',false,'error','company_cnpj_required'); end if;
  ag:=regexp_replace(coalesce(nullif(p_payload->>'agency',''),ba.agency,''),'\D','','g');
  acct:=regexp_replace(coalesce(nullif(p_payload->>'account_number',''),ba.account_number,''),'\D','','g');
  digit:=regexp_replace(coalesce(p_payload->>'account_digit',''),'\D','','g');
  wallet:=regexp_replace(coalesce(nullif(p_payload->>'wallet',''),'109'),'\D','','g');
  species:=regexp_replace(coalesce(nullif(p_payload->>'species',''),'01'),'\D','','g');
  acceptance:=upper(coalesce(nullif(p_payload->>'acceptance',''),'N'));
  initial_our:=greatest(coalesce(nullif(p_payload->>'initial_our_number','')::bigint,0),0);
  if length(ag)<>4 then return jsonb_build_object('ok',false,'error','cnab_agency_must_have_4_digits'); end if;
  if length(acct)<>5 then return jsonb_build_object('ok',false,'error','cnab_account_must_have_5_digits'); end if;
  if length(digit)<>1 then return jsonb_build_object('ok',false,'error','cnab_account_digit_required'); end if;
  if wallet<>'109' then return jsonb_build_object('ok',false,'error','cnab_wallet_not_supported','supported','109'); end if;
  if length(species)<>2 then return jsonb_build_object('ok',false,'error','cnab_species_invalid'); end if;
  if acceptance not in ('A','N') then return jsonb_build_object('ok',false,'error','cnab_acceptance_invalid'); end if;
  if initial_our>99999999 then return jsonb_build_object('ok',false,'error','cnab_our_number_out_of_range'); end if;
  insert into public.bank_cnab_configs(tenant_id,company_id,branch_id,bank_account_id,bank_code,layout,agency,account_number,account_digit,wallet,species,acceptance,our_number_sequence,active,settings)
  values(v.tenant_id,v.company_id,v.branch_id,ba.id,'341','cnab400',ag,acct,digit,wallet,species,acceptance,initial_our,coalesce((p_payload->>'active')::boolean,true),jsonb_build_object('bank_name','BANCO ITAU SA','carteira_code','I'))
  on conflict(tenant_id,bank_account_id,layout) do update set company_id=excluded.company_id,branch_id=excluded.branch_id,agency=excluded.agency,account_number=excluded.account_number,account_digit=excluded.account_digit,wallet=excluded.wallet,species=excluded.species,acceptance=excluded.acceptance,our_number_sequence=case when public.bank_cnab_configs.our_number_sequence=0 and initial_our>0 then initial_our else public.bank_cnab_configs.our_number_sequence end,active=excluded.active,settings=excluded.settings,updated_at=now()
  returning * into cfg;
  update public.bank_accounts set bank_code='341',agency=ag,account_number=acct,updated_at=now() where id=ba.id;
  return jsonb_build_object('ok',true,'config_id',cfg.id,'layout',cfg.layout,'bank_code','341','agency',ag,'account_number',acct,'account_digit',digit,'wallet',wallet,'species',species,'acceptance',acceptance,'our_number_sequence',cfg.our_number_sequence);
end $$;

create or replace function public.erp_cnab400_data(p_token text)
returns jsonb
language plpgsql
security definer
set search_path to 'public','private','extensions'
as $$
declare v record; accounts jsonb; configs jsonb; receivables jsonb; remittances jsonb; returns jsonb;
begin
  select * into v from private.resolve_temp_context(p_token);
  if v.user_id is null then return jsonb_build_object('ok',false,'error','invalid_session'); end if;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.name),'[]'::jsonb) into accounts from (select b.id,b.name,b.bank_code,b.agency,b.account_number,b.active from public.bank_accounts b where b.tenant_id=v.tenant_id and b.account_type='bank' and b.active=true) x;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.account_name),'[]'::jsonb) into configs from (select c.*,b.name account_name from public.bank_cnab_configs c join public.bank_accounts b on b.id=c.bank_account_id where c.tenant_id=v.tenant_id and c.company_id=v.company_id) x;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.due_date,x.created_at),'[]'::jsonb) into receivables from (
    select f.id,f.description,f.amount,f.paid_amount,greatest(f.amount-f.paid_amount,0) remaining,f.due_date,f.issued_at,f.status,f.customer_id,c.name customer,c.document,c.street,c.number,c.complement,c.district,c.city,c.state,c.postal_code,f.created_at,
      exists(select 1 from public.bank_cnab_remittance_items ri where ri.tenant_id=v.tenant_id and ri.financial_entry_id=f.id and ri.status not in ('rejected','cancelled')) remitted,
      case when c.id is null then 'Cliente não encontrado' when length(regexp_replace(coalesce(c.document,''),'\D','','g')) not in (11,14) then 'CPF/CNPJ do cliente inválido' when nullif(trim(coalesce(c.name,'')),'') is null then 'Nome do cliente ausente' when nullif(trim(coalesce(c.street,'')),'') is null then 'Endereço do cliente ausente' when nullif(trim(coalesce(c.district,'')),'') is null then 'Bairro do cliente ausente' when nullif(trim(coalesce(c.city,'')),'') is null then 'Cidade do cliente ausente' when length(trim(coalesce(c.state,'')))<>2 then 'UF do cliente inválida' when length(regexp_replace(coalesce(c.postal_code,''),'\D','','g'))<>8 then 'CEP do cliente inválido' else null end validation_error
    from public.financial_entries f left join public.customers c on c.id=f.customer_id and c.tenant_id=f.tenant_id
    where f.tenant_id=v.tenant_id and f.company_id=v.company_id and f.entry_type='receivable' and f.status in ('open','partial','overdue') and greatest(f.amount-f.paid_amount,0)>0 and lower(coalesce(nullif(f.metadata->>'term_method',''),f.document_type,'')) in ('boleto','bank_slip') limit 1000
  ) x;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.generated_at desc),'[]'::jsonb) into remittances from (select rf.id,rf.config_id,rf.bank_account_id,b.name account,rf.file_sequence,rf.file_name,rf.status,rf.record_count,rf.total_amount,rf.generated_at,rf.sent_at from public.bank_cnab_remittance_files rf join public.bank_accounts b on b.id=rf.bank_account_id where rf.tenant_id=v.tenant_id and rf.company_id=v.company_id order by rf.generated_at desc limit 100) x;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.imported_at desc),'[]'::jsonb) into returns from (select r.id,r.config_id,r.bank_account_id,b.name account,r.file_name,r.bank_file_sequence,r.generated_date,r.credit_date,r.status,r.record_count,r.processed_count,r.matched_count,r.paid_count,r.error_count,r.imported_at from public.bank_cnab_return_files r join public.bank_accounts b on b.id=r.bank_account_id where r.tenant_id=v.tenant_id and r.company_id=v.company_id order by r.imported_at desc limit 100) x;
  return jsonb_build_object('ok',true,'accounts',accounts,'configs',configs,'receivables',receivables,'remittances',remittances,'returns',returns,'layout','itau_cnab400');
end $$;

create or replace function public.erp_cnab400_remittance_generate(p_token text,p_config uuid,p_entry_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path to 'public','private','extensions'
as $$
declare
  v record; cfg public.bank_cnab_configs%rowtype; co public.companies%rowtype; ba public.bank_accounts%rowtype; fe record; ids uuid[]; requested integer; valid_count integer; file_seq bigint; next_our bigint; rem_id uuid:=gen_random_uuid();
  header text; detail text; trailer text; content text; line_seq integer:=1; item_count integer:=0; total numeric:=0; cnpj text; cust_doc text; payer_type text; payer_address text; company_use text; ourno text; ourdac integer; docno text; amount numeric; barcode text; digitable text; fname text; hash text;
begin
  select * into v from private.resolve_temp_context(p_token); if v.user_id is null then return jsonb_build_object('ok',false,'error','invalid_session'); end if;
  if p_entry_ids is null or cardinality(p_entry_ids)=0 then return jsonb_build_object('ok',false,'error','select_receivables'); end if;
  if cardinality(p_entry_ids)>500 then return jsonb_build_object('ok',false,'error','too_many_receivables','limit',500); end if;
  select array_agg(distinct x) into ids from unnest(p_entry_ids) x; requested:=cardinality(ids);
  select * into cfg from public.bank_cnab_configs where id=p_config and tenant_id=v.tenant_id and company_id=v.company_id and active=true for update;
  if cfg.id is null then return jsonb_build_object('ok',false,'error','cnab_config_not_found'); end if;
  if cfg.bank_code<>'341' or cfg.layout<>'cnab400' or cfg.wallet<>'109' then return jsonb_build_object('ok',false,'error','cnab_config_not_supported'); end if;
  if length(cfg.agency)<>4 or length(cfg.account_number)<>5 or length(cfg.account_digit)<>1 then return jsonb_build_object('ok',false,'error','cnab_account_config_invalid'); end if;
  select * into co from public.companies where id=v.company_id and tenant_id=v.tenant_id; select * into ba from public.bank_accounts where id=cfg.bank_account_id and tenant_id=v.tenant_id and active=true and account_type='bank';
  if co.id is null or ba.id is null then return jsonb_build_object('ok',false,'error','cnab_company_or_account_not_found'); end if;
  cnpj:=regexp_replace(coalesce(co.cnpj,''),'\D','','g'); if length(cnpj)<>14 then return jsonb_build_object('ok',false,'error','company_cnpj_required'); end if;
  select count(*) into valid_count from public.financial_entries f where f.id=any(ids) and f.tenant_id=v.tenant_id and f.company_id=v.company_id and f.entry_type='receivable' and f.status in ('open','partial','overdue') and greatest(f.amount-f.paid_amount,0)>0 and lower(coalesce(nullif(f.metadata->>'term_method',''),f.document_type,'')) in ('boleto','bank_slip');
  if valid_count<>requested then return jsonb_build_object('ok',false,'error','invalid_receivables','requested',requested,'valid',valid_count); end if;
  if exists(select 1 from public.bank_cnab_remittance_items ri where ri.tenant_id=v.tenant_id and ri.financial_entry_id=any(ids) and ri.status not in ('rejected','cancelled')) then return jsonb_build_object('ok',false,'error','receivable_already_in_active_remittance'); end if;
  file_seq:=cfg.remittance_sequence+1; next_our:=cfg.our_number_sequence; fname:='ITAU_CNAB400_'||to_char(current_date,'YYYYMMDD')||'_'||lpad(file_seq::text,6,'0')||'.REM';
  header:='0'||'1'||'REMESSA'||'01'||rpad('COBRANCA',15,' ')||cfg.agency||'00'||cfg.account_number||cfg.account_digit||repeat(' ',8)||rpad(private.cnab_clean_text(coalesce(nullif(co.trade_name,''),co.legal_name),30),30,' ')||'341'||rpad('BANCO ITAU SA',15,' ')||to_char(current_date,'DDMMYY')||repeat(' ',294)||'000001';
  if length(header)<>400 then raise exception 'cnab_header_invalid_length:%',length(header); end if; content:=header;
  insert into public.bank_cnab_remittance_files(id,tenant_id,company_id,branch_id,config_id,bank_account_id,layout,file_sequence,file_name,status) values(rem_id,v.tenant_id,v.company_id,v.branch_id,cfg.id,cfg.bank_account_id,'cnab400',file_seq,fname,'generated');
  for fe in select f.*,c.name customer_name,c.document customer_document,c.street,c.number,c.complement,c.district,c.city,c.state,c.postal_code,s.number sale_number from public.financial_entries f join public.customers c on c.id=f.customer_id and c.tenant_id=f.tenant_id left join public.sales s on s.id=f.sale_id where f.id=any(ids) and f.tenant_id=v.tenant_id and f.company_id=v.company_id order by f.due_date,f.created_at
  loop
    cust_doc:=regexp_replace(coalesce(fe.customer_document,''),'\D','','g'); if length(cust_doc) not in (11,14) then return jsonb_build_object('ok',false,'error','payer_document_invalid','financial_entry_id',fe.id); end if;
    if nullif(trim(coalesce(fe.customer_name,'')),'') is null or nullif(trim(coalesce(fe.street,'')),'') is null or nullif(trim(coalesce(fe.district,'')),'') is null or nullif(trim(coalesce(fe.city,'')),'') is null or length(trim(coalesce(fe.state,'')))<>2 or length(regexp_replace(coalesce(fe.postal_code,''),'\D','','g'))<>8 then return jsonb_build_object('ok',false,'error','payer_data_incomplete','financial_entry_id',fe.id); end if;
    next_our:=next_our+1; if next_our>99999999 then return jsonb_build_object('ok',false,'error','cnab_our_number_sequence_exhausted'); end if;
    ourno:=lpad(next_our::text,8,'0'); ourdac:=private.itau_cnab_nosso_numero_dac(cfg.agency,cfg.account_number,cfg.wallet,ourno); amount:=greatest(fe.amount-fe.paid_amount,0); company_use:='TH'||upper(left(replace(fe.id::text,'-',''),23)); docno:=left(coalesce(nullif(fe.sale_number::text,''),replace(fe.id::text,'-','')),10); barcode:=private.itau_cnab_barcode(cfg.agency,cfg.account_number,cfg.account_digit,cfg.wallet,ourno,fe.due_date,amount); digitable:=private.itau_cnab_digitable_line(cfg.agency,cfg.account_number,cfg.account_digit,cfg.wallet,ourno,fe.due_date,amount); payer_type:=case when length(cust_doc)=11 then '01' else '02' end; payer_address:=private.cnab_clean_text(concat_ws(' ',fe.street,fe.number,fe.complement),40); line_seq:=line_seq+1;
    detail:='1'||'02'||lpad(cnpj,14,'0')||cfg.agency||'00'||cfg.account_number||cfg.account_digit||repeat(' ',4)||'0000'||rpad(company_use,25,' ')||ourno||repeat('0',13)||cfg.wallet||repeat(' ',21)||'I'||'01'||rpad(private.cnab_clean_text(docno,10),10,' ')||to_char(fe.due_date,'DDMMYY')||lpad(round(amount*100)::bigint::text,13,'0')||'341'||'00000'||cfg.species||cfg.acceptance||to_char(coalesce(fe.issued_at,current_date),'DDMMYY')||'00'||'00'||repeat('0',13)||'000000'||repeat('0',13)||repeat('0',13)||repeat('0',13)||payer_type||lpad(cust_doc,14,'0')||rpad(private.cnab_clean_text(fe.customer_name,30),30,' ')||repeat(' ',10)||rpad(payer_address,40,' ')||rpad(private.cnab_clean_text(fe.district,12),12,' ')||regexp_replace(fe.postal_code,'\D','','g')||rpad(private.cnab_clean_text(fe.city,15),15,' ')||upper(fe.state)||repeat(' ',30)||repeat(' ',4)||'000000'||'00'||' '||lpad(line_seq::text,6,'0');
    if length(detail)<>400 then raise exception 'cnab_detail_invalid_length:% entry:%',length(detail),fe.id; end if; content:=content||E'\r\n'||detail;
    insert into public.bank_cnab_remittance_items(tenant_id,company_id,branch_id,config_id,remittance_id,financial_entry_id,customer_id,line_number,company_use,our_number,our_number_dac,document_number,amount,due_date,barcode,digitable_line,status) values(v.tenant_id,v.company_id,fe.branch_id,cfg.id,rem_id,fe.id,fe.customer_id,line_seq,company_use,ourno,ourdac::text,docno,amount,fe.due_date,barcode,digitable,'generated');
    item_count:=item_count+1; total:=total+amount;
  end loop;
  line_seq:=line_seq+1; trailer:='9'||repeat(' ',393)||lpad(line_seq::text,6,'0'); if length(trailer)<>400 then raise exception 'cnab_trailer_invalid_length:%',length(trailer); end if; content:=content||E'\r\n'||trailer||E'\r\n'; hash:=encode(extensions.digest(content,'sha256'),'hex');
  update public.bank_cnab_remittance_files set file_hash=hash,raw_content=content,record_count=item_count,total_amount=total where id=rem_id; update public.bank_cnab_configs set remittance_sequence=file_seq,our_number_sequence=next_our,updated_at=now() where id=cfg.id;
  return jsonb_build_object('ok',true,'remittance_id',rem_id,'file_name',fname,'file_sequence',file_seq,'record_count',item_count,'total_amount',total,'content',content,'file_hash',hash);
end $$;

create or replace function public.erp_cnab400_remittance_mark_sent(p_token text,p_remittance uuid)
returns jsonb language plpgsql security definer set search_path to 'public','private' as $$
declare v record; r public.bank_cnab_remittance_files%rowtype;
begin
 select * into v from private.resolve_temp_context(p_token); if v.user_id is null then return jsonb_build_object('ok',false,'error','invalid_session'); end if;
 select * into r from public.bank_cnab_remittance_files where id=p_remittance and tenant_id=v.tenant_id and company_id=v.company_id for update; if r.id is null then return jsonb_build_object('ok',false,'error','remittance_not_found'); end if;
 update public.bank_cnab_remittance_files set status='sent',sent_at=coalesce(sent_at,now()) where id=r.id; return jsonb_build_object('ok',true,'id',r.id,'status','sent');
end $$;

create or replace function public.erp_cnab400_return_preview(p_token text,p_content text)
returns jsonb language plpgsql security definer set search_path to 'public','private' as $$
declare v record;
begin select * into v from private.resolve_temp_context(p_token); if v.user_id is null then return jsonb_build_object('ok',false,'error','invalid_session'); end if; return private.cnab400_parse_return(p_content); end $$;

create or replace function public.erp_cnab400_return_import(p_token text,p_config uuid,p_file_name text,p_content text)
returns jsonb
language plpgsql
security definer
set search_path to 'public','private','extensions'
as $$
declare
  v record; cfg public.bank_cnab_configs%rowtype; parsed jsonb; hdr jsonb; d jsonb; file_hash text; old_file public.bank_cnab_return_files%rowtype; ret_id uuid:=gen_random_uuid(); ret_item_id uuid; ri public.bank_cnab_remittance_items%rowtype; fe public.financial_entries%rowtype;
  occ text; cuse text; ourno text; settle_amount numeric; bank_credit numeric; remaining numeric; settle_id uuid; bank_tx uuid; settled_at timestamptz; records integer:=0; processed integer:=0; matched integer:=0; paid integer:=0; errors integer:=0; status_value text;
begin
  select * into v from private.resolve_temp_context(p_token); if v.user_id is null then return jsonb_build_object('ok',false,'error','invalid_session'); end if;
  select * into cfg from public.bank_cnab_configs where id=p_config and tenant_id=v.tenant_id and company_id=v.company_id and active=true; if cfg.id is null then return jsonb_build_object('ok',false,'error','cnab_config_not_found'); end if;
  if nullif(p_content,'') is null then return jsonb_build_object('ok',false,'error','return_file_empty'); end if;
  parsed:=private.cnab400_parse_return(p_content); hdr:=coalesce(parsed->'header','{}'::jsonb); if coalesce(hdr->>'bank_code','')<>'341' then return jsonb_build_object('ok',false,'error','return_not_itau_cnab400','bank_code',hdr->>'bank_code'); end if;
  file_hash:=encode(extensions.digest(p_content,'sha256'),'hex'); select * into old_file from public.bank_cnab_return_files where tenant_id=v.tenant_id and file_hash=file_hash limit 1;
  if old_file.id is not null then return jsonb_build_object('ok',true,'already_imported',true,'return_file_id',old_file.id,'status',old_file.status,'record_count',old_file.record_count,'paid_count',old_file.paid_count); end if;
  insert into public.bank_cnab_return_files(id,tenant_id,company_id,branch_id,config_id,bank_account_id,layout,file_name,file_hash,bank_file_sequence,generated_date,credit_date,status,raw_content) values(ret_id,v.tenant_id,v.company_id,v.branch_id,cfg.id,cfg.bank_account_id,'cnab400',coalesce(nullif(p_file_name,''),'RETORNO.RET'),file_hash,hdr->>'bank_file_sequence',nullif(hdr->>'generation_date','')::date,nullif(hdr->>'credit_date','')::date,'processing',p_content);
  for d in select value from jsonb_array_elements(coalesce(parsed->'details','[]'::jsonb)) loop
    if d ? 'invalid_length' or coalesce(d->>'record_type','')<>'1' then errors:=errors+1; continue; end if;
    records:=records+1; occ:=coalesce(d->>'occurrence_code',''); cuse:=rtrim(coalesce(d->>'company_use','')); ourno:=coalesce(nullif(d->>'our_number_confirmed',''),d->>'our_number'); if ourno='00000000' then ourno:=d->>'our_number'; end if;
    begin
      insert into public.bank_cnab_return_items(tenant_id,company_id,return_file_id,line_number,company_use,wallet,our_number,occurrence_code,occurrence_date,document_number,due_date,title_amount,bank_fee,iof,rebate,discount,principal_amount,interest_amount,other_credits,credit_date,liquidation_code,error_codes,raw_line,status)
      values(v.tenant_id,v.company_id,ret_id,(d->>'line_number')::int,nullif(cuse,''),d->>'wallet',nullif(ourno,''),occ,nullif(d->>'occurrence_date','')::date,d->>'document_number',nullif(d->>'due_date','')::date,nullif(d->>'title_amount','')::numeric,nullif(d->>'bank_fee','')::numeric,nullif(d->>'iof','')::numeric,nullif(d->>'rebate','')::numeric,nullif(d->>'discount','')::numeric,nullif(d->>'principal_amount','')::numeric,nullif(d->>'interest_amount','')::numeric,nullif(d->>'other_credits','')::numeric,nullif(d->>'credit_date','')::date,d->>'liquidation_code',d->>'error_codes',d->>'raw_line','received') returning id into ret_item_id;
      ri:=null;
      if nullif(cuse,'') is not null then select * into ri from public.bank_cnab_remittance_items x where x.config_id=cfg.id and rtrim(x.company_use)=cuse order by x.created_at desc limit 1; end if;
      if ri.id is null and nullif(ourno,'') is not null then select * into ri from public.bank_cnab_remittance_items x where x.config_id=cfg.id and x.our_number=ourno order by x.created_at desc limit 1; end if;
      if ri.id is null then update public.bank_cnab_return_items set status='unmatched',message='Título não localizado na remessa do Thor.',processed_at=now() where id=ret_item_id; errors:=errors+1; continue; end if;
      matched:=matched+1; update public.bank_cnab_return_items set remittance_item_id=ri.id,financial_entry_id=ri.financial_entry_id where id=ret_item_id;
      if occ='02' then update public.bank_cnab_remittance_items set status='accepted',rejection_code=null,rejection_message=null,updated_at=now() where id=ri.id and status<>'paid'; update public.bank_cnab_return_items set status='accepted',message='Entrada confirmada pelo Itaú.',processed_at=now() where id=ret_item_id; processed:=processed+1; continue;
      elsif occ='03' then update public.bank_cnab_remittance_items set status='rejected',rejection_code=nullif(d->>'error_codes',''),rejection_message='Entrada rejeitada pelo Itaú. Consulte os códigos de erro do retorno.',updated_at=now() where id=ri.id; update public.bank_cnab_return_items set status='rejected',message='Entrada rejeitada pelo Itaú.',processed_at=now() where id=ret_item_id; processed:=processed+1; continue;
      elsif occ='09' then update public.bank_cnab_remittance_items set status='cancelled',updated_at=now() where id=ri.id and status<>'paid'; update public.bank_cnab_return_items set status='cancelled',message='Baixa simples confirmada pelo Itaú.',processed_at=now() where id=ret_item_id; processed:=processed+1; continue;
      elsif occ not in ('06','07','08','10') then update public.bank_cnab_return_items set status='ignored',message='Ocorrência registrada sem baixa financeira automática.',processed_at=now() where id=ret_item_id; processed:=processed+1; continue; end if;
      select * into fe from public.financial_entries where id=ri.financial_entry_id and tenant_id=v.tenant_id for update;
      if fe.id is null or fe.entry_type<>'receivable' or fe.status='cancelled' then update public.bank_cnab_return_items set status='error',message='Contas a Receber vinculado não encontrado ou cancelado.',processed_at=now() where id=ret_item_id; errors:=errors+1; continue; end if;
      remaining:=greatest(fe.amount-fe.paid_amount,0);
      if remaining<=0.001 or fe.status='paid' then update public.bank_cnab_remittance_items set status='paid',updated_at=now() where id=ri.id; update public.bank_cnab_return_items set status='paid',message='Título já estava quitado; retorno reconhecido sem duplicar a baixa.',processed_at=now() where id=ret_item_id; processed:=processed+1; paid:=paid+1; continue; end if;
      if occ='07' then settle_amount:=least(remaining,coalesce(nullif((d->>'principal_amount')::numeric,0),nullif((d->>'title_amount')::numeric,0),remaining)); else settle_amount:=remaining; end if;
      if settle_amount is null or settle_amount<=0 then settle_amount:=remaining; end if; bank_credit:=coalesce(nullif((d->>'principal_amount')::numeric,0),settle_amount); settled_at:=coalesce(nullif(d->>'credit_date','')::date,nullif(d->>'occurrence_date','')::date,current_date)::timestamptz; settle_id:=gen_random_uuid();
      insert into public.financial_settlements(id,tenant_id,company_id,branch_id,financial_entry_id,amount,settled_at,payment_method,destination_type,bank_account_id,notes,metadata,status) values(settle_id,v.tenant_id,fe.company_id,fe.branch_id,fe.id,settle_amount,settled_at,'bank_slip','bank_account',cfg.bank_account_id,'Baixa automática por arquivo retorno Itaú CNAB 400.',jsonb_build_object('source','cnab400_return','return_file_id',ret_id,'return_item_id',ret_item_id,'remittance_item_id',ri.id,'occurrence_code',occ,'our_number',ri.our_number,'bank_credit',bank_credit,'title_amount',d->>'title_amount','bank_fee',d->>'bank_fee','discount',d->>'discount','interest',d->>'interest_amount'),'active');
      insert into public.bank_transactions(tenant_id,bank_account_id,transaction_date,description,amount,direction,external_id,reconciled,financial_entry_id,payment_method,origin_type,origin_id,notes) values(v.tenant_id,cfg.bank_account_id,settled_at::date,'Liquidação boleto Itaú CNAB · '||ri.our_number,bank_credit,'credit','cnab400:'||ret_id::text||':'||(d->>'line_number'),true,fe.id,'bank_slip','financial_settlement',settle_id,'Crédito confirmado pelo arquivo retorno CNAB 400 do Itaú.') returning id into bank_tx;
      update public.financial_settlements set bank_transaction_id=bank_tx where id=settle_id;
      update public.financial_entries set paid_amount=least(amount,paid_amount+settle_amount),status=case when paid_amount+settle_amount>=amount-0.001 then 'paid' else 'partial' end,paid_at=case when paid_amount+settle_amount>=amount-0.001 then settled_at else paid_at end,updated_at=now(),metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('last_payment_method','bank_slip','last_destination_type','bank_account','last_settlement_id',settle_id,'last_cnab_return_file_id',ret_id,'last_cnab_return_item_id',ret_item_id,'last_cnab_our_number',ri.our_number) where id=fe.id;
      status_value:=case when settle_amount>=remaining-0.001 then 'paid' else 'partial' end; update public.bank_cnab_remittance_items set status=status_value,updated_at=now() where id=ri.id;
      update public.bank_cnab_return_items set status=status_value,financial_settlement_id=settle_id,bank_transaction_id=bank_tx,message=case when status_value='paid' then 'Liquidação processada e Contas a Receber quitado automaticamente.' else 'Liquidação parcial processada automaticamente.' end,processed_at=now() where id=ret_item_id;
      processed:=processed+1; paid:=paid+case when status_value='paid' then 1 else 0 end;
    exception when others then update public.bank_cnab_return_items set status='error',message=left(sqlerrm,500),processed_at=now() where id=ret_item_id; errors:=errors+1; end;
  end loop;
  update public.bank_cnab_return_files set status=case when errors>0 then 'processed_with_errors' else 'processed' end,record_count=records,processed_count=processed,matched_count=matched,paid_count=paid,error_count=errors where id=ret_id;
  update public.bank_cnab_remittance_files rf set status='processed' where rf.id in (select distinct ri.remittance_id from public.bank_cnab_return_items rti join public.bank_cnab_remittance_items ri on ri.id=rti.remittance_item_id where rti.return_file_id=ret_id) and rf.status in ('generated','sent');
  return jsonb_build_object('ok',true,'return_file_id',ret_id,'status',case when errors>0 then 'processed_with_errors' else 'processed' end,'record_count',records,'processed_count',processed,'matched_count',matched,'paid_count',paid,'error_count',errors,'header',hdr);
end $$;

revoke all on function public.erp_cnab400_config_save(text,uuid,jsonb) from public;
revoke all on function public.erp_cnab400_data(text) from public;
revoke all on function public.erp_cnab400_remittance_generate(text,uuid,uuid[]) from public;
revoke all on function public.erp_cnab400_remittance_mark_sent(text,uuid) from public;
revoke all on function public.erp_cnab400_return_preview(text,text) from public;
revoke all on function public.erp_cnab400_return_import(text,uuid,text,text) from public;
grant execute on function public.erp_cnab400_config_save(text,uuid,jsonb) to anon,authenticated;
grant execute on function public.erp_cnab400_data(text) to anon,authenticated;
grant execute on function public.erp_cnab400_remittance_generate(text,uuid,uuid[]) to anon,authenticated;
grant execute on function public.erp_cnab400_remittance_mark_sent(text,uuid) to anon,authenticated;
grant execute on function public.erp_cnab400_return_preview(text,text) to anon,authenticated;
grant execute on function public.erp_cnab400_return_import(text,uuid,text,text) to anon,authenticated;
