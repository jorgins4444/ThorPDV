update public.products
   set fractioned=true,is_weighable=true,updated_at=now()
 where coalesce(label_scale,false)=true
   and (not coalesce(fractioned,false) or not coalesce(is_weighable,false));

create or replace function private.lock_product_code()
returns trigger
language plpgsql
set search_path='public','private'
as $$
begin
  if old.product_code is distinct from new.product_code then
    new.product_code:=old.product_code;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_products_lock_product_code on public.products;
create trigger trg_products_lock_product_code before update of product_code on public.products for each row execute function private.lock_product_code();
