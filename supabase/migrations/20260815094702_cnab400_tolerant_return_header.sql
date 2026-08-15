create or replace function private.cnab400_parse_return(p_content text)
returns jsonb language plpgsql stable as $$
declare lines text[]; ln text; idx integer:=0; header jsonb:='{}'::jsonb; details jsonb:='[]'::jsonb; n text; val numeric; rt text;
begin
  lines:=regexp_split_to_array(replace(coalesce(p_content,''),E'\r',''),E'\n');
  foreach ln in array lines loop
    if ln='' then continue; end if;
    idx:=idx+1; rt:=substr(ln,1,1);
    if rt='0' then
      if length(ln)<119 then details:=details||jsonb_build_array(jsonb_build_object('line_number',idx,'record_type',rt,'invalid_length',length(ln),'raw_line',ln)); continue; end if;
      header:=jsonb_build_object('record_type','0','record_length',length(ln),'operation',substr(ln,2,1),'literal',trim(substr(ln,3,7)),'service_code',substr(ln,10,2),'service',trim(substr(ln,12,15)),'company_name',trim(substr(ln,47,30)),'bank_code',substr(ln,77,3),'bank_name',trim(substr(ln,80,15)),'generation_date',private.cnab_ddmmyy_date(substr(ln,95,6)),'bank_file_sequence',trim(substr(ln,109,5)),'credit_date',private.cnab_ddmmyy_date(substr(ln,114,6)),'physical_sequence',case when length(ln)>=400 then trim(right(ln,6)) else null end);
    elsif rt='1' then
      if length(ln)<>400 then details:=details||jsonb_build_array(jsonb_build_object('line_number',idx,'record_type',rt,'invalid_length',length(ln),'raw_line',ln)); continue; end if;
      n:=regexp_replace(substr(ln,153,13),'[^0-9]','','g'); val:=case when n='' then null else n::numeric/100 end;
      details:=details||jsonb_build_array(jsonb_build_object('line_number',idx,'record_type','1','record_length',400,'company_use',rtrim(substr(ln,38,25)),'wallet',substr(ln,83,3),'our_number',substr(ln,86,8),'our_number_confirmed',substr(ln,127,8),'occurrence_code',substr(ln,109,2),'occurrence_date',private.cnab_ddmmyy_date(substr(ln,111,6)),'document_number',rtrim(substr(ln,117,10)),'due_date',private.cnab_ddmmyy_date(substr(ln,147,6)),'title_amount',val,'bank_fee',nullif(regexp_replace(substr(ln,176,13),'[^0-9]','','g'),'')::numeric/100,'iof',nullif(regexp_replace(substr(ln,215,13),'[^0-9]','','g'),'')::numeric/100,'rebate',nullif(regexp_replace(substr(ln,228,13),'[^0-9]','','g'),'')::numeric/100,'discount',nullif(regexp_replace(substr(ln,241,13),'[^0-9]','','g'),'')::numeric/100,'principal_amount',nullif(regexp_replace(substr(ln,254,13),'[^0-9]','','g'),'')::numeric/100,'interest_amount',nullif(regexp_replace(substr(ln,267,13),'[^0-9]','','g'),'')::numeric/100,'other_credits',nullif(regexp_replace(substr(ln,280,13),'[^0-9]','','g'),'')::numeric/100,'credit_date',private.cnab_ddmmyy_date(substr(ln,296,6)),'error_codes',trim(substr(ln,378,8)),'liquidation_code',substr(ln,393,2),'raw_line',ln));
    end if;
  end loop;
  return jsonb_build_object('ok',true,'header',header,'details',details,'record_count',idx);
end $$;
