-- Corrige ambiguidade do hash na importação CNAB e padroniza nomes de remessa Itaú.
-- Novo padrão: REM + código do banco + sequência com pelo menos 2 dígitos + .REM
-- Exemplo: banco 341, sequência 4 => REM34104.REM

do $do$
declare ddl text;
begin
  select pg_get_functiondef(p.oid) into ddl
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='erp_cnab400_return_import';

  if position('v_file_hash text;' in ddl)=0 then
    ddl := replace(ddl, 'file_hash text;', 'v_file_hash text;');
  end if;
  if position('v_file_hash:=encode' in ddl)=0 then
    ddl := replace(ddl, 'file_hash:=encode', 'v_file_hash:=encode');
  end if;
  ddl := replace(
    ddl,
    'select * into old_file from public.bank_cnab_return_files where tenant_id=v.tenant_id and file_hash=file_hash limit 1;',
    'select * into old_file from public.bank_cnab_return_files rf where rf.tenant_id=v.tenant_id and rf.file_hash=v_file_hash limit 1;'
  );
  ddl := replace(ddl, ',file_hash,hdr->>''bank_file_sequence''', ',v_file_hash,hdr->>''bank_file_sequence''');
  execute ddl;

  select pg_get_functiondef(p.oid) into ddl
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='erp_cnab240_return_import';

  if position('v_file_hash text;' in ddl)=0 then
    ddl := replace(ddl, 'file_hash text;', 'v_file_hash text;');
  end if;
  if position('v_file_hash:=encode' in ddl)=0 then
    ddl := replace(ddl, 'file_hash:=encode', 'v_file_hash:=encode');
  end if;
  ddl := replace(
    ddl,
    'where tenant_id=v.tenant_id and file_hash=file_hash limit 1;',
    'where bank_cnab_return_files.tenant_id=v.tenant_id and bank_cnab_return_files.file_hash=v_file_hash limit 1;'
  );
  ddl := replace(ddl, '),file_hash,hdr->>''bank_file_sequence''', '),v_file_hash,hdr->>''bank_file_sequence''');
  execute ddl;
end
$do$;

do $do$
declare ddl text;
begin
  select pg_get_functiondef(p.oid) into ddl
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='erp_cnab400_remittance_generate';
  if position('ITAU_CNAB400_' in ddl)>0 then
    ddl := replace(
      ddl,
      'fname:=''ITAU_CNAB400_''||to_char(current_date,''YYYYMMDD'')||''_''||lpad(file_seq::text,6,''0'')||''.REM'';',
      'fname:=''REM''||cfg.bank_code||lpad(file_seq::text,2,''0'')||''.REM'';'
    );
    execute ddl;
  end if;

  select pg_get_functiondef(p.oid) into ddl
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='erp_cnab240_remittance_generate';
  if position('ITAU_CNAB240_' in ddl)>0 then
    ddl := replace(
      ddl,
      'fname:=''ITAU_CNAB240_''||to_char(current_date,''YYYYMMDD'')||''_''||lpad(file_seq::text,6,''0'')||''.REM'';',
      'fname:=''REM''||cfg.bank_code||lpad(file_seq::text,2,''0'')||''.REM'';'
    );
    execute ddl;
  end if;
end
$do$;
