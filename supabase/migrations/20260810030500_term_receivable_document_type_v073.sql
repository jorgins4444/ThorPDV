create or replace function private.financial_entry_defaults_v073()
returns trigger
language plpgsql
security definer
set search_path='public','private'
as $$
begin
  if new.issued_at is null then
    if new.sale_id is not null then
      select coalesce(s.completed_at,s.created_at)::date into new.issued_at from public.sales s where s.id=new.sale_id;
    end if;
    new.issued_at:=coalesce(new.issued_at,current_date);
  end if;

  if new.metadata->>'origin'='sale_term' or new.metadata->>'term_method' in ('boleto','crediario') then
    new.document_type:=coalesce(nullif(new.metadata->>'term_method',''),'crediario');
  elsif new.metadata->>'origin'='pdv_desktop_return' then
    new.document_type:='devolucao';
  elsif nullif(new.document_type,'') is null then
    new.document_type:=case when new.sale_id is not null and new.entry_type='receivable' then 'venda' else 'manual' end;
  end if;
  return new;
end $$;

update public.financial_entries
set document_type=coalesce(nullif(metadata->>'term_method',''),'crediario')
where entry_type='receivable' and (metadata->>'origin'='sale_term' or metadata->>'term_method' in ('boleto','crediario'));

update public.financial_entries
set document_type='devolucao'
where metadata->>'origin'='pdv_desktop_return';
