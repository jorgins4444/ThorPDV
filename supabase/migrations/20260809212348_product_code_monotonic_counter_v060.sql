create table if not exists private.product_code_counters(
  tenant_id uuid primary key,
  next_code bigint not null check(next_code>0),
  updated_at timestamptz not null default now()
);

insert into private.product_code_counters(tenant_id,next_code)
select tenant_id,coalesce(max(product_code),0)+1 from public.products group by tenant_id
on conflict(tenant_id) do update set next_code=greatest(private.product_code_counters.next_code,excluded.next_code),updated_at=now();

create or replace function private.assign_product_code()
returns trigger
language plpgsql
security definer
set search_path='public','private'
as $$
declare v_code bigint;
begin
  if new.product_code is null or new.product_code<=0 then
    insert into private.product_code_counters(tenant_id,next_code,updated_at)
      values(new.tenant_id,2,now())
    on conflict(tenant_id) do update set next_code=private.product_code_counters.next_code+1,updated_at=now()
    returning next_code-1 into v_code;
    new.product_code:=v_code;
  else
    insert into private.product_code_counters(tenant_id,next_code,updated_at)
      values(new.tenant_id,new.product_code+1,now())
    on conflict(tenant_id) do update set next_code=greatest(private.product_code_counters.next_code,excluded.next_code),updated_at=now();
  end if;
  return new;
end;
$$;
