create or replace function private.validate_cash_movement_reason()
returns trigger language plpgsql as $$
begin
  if new.movement_type in ('supply','withdrawal') and length(trim(coalesce(new.notes,''))) < 15 then
    raise exception 'cash_movement_reason_min_15';
  end if;
  return new;
end $$;

drop trigger if exists trg_cash_movement_reason on public.cash_movements;
create trigger trg_cash_movement_reason
before insert or update of movement_type,notes on public.cash_movements
for each row execute function private.validate_cash_movement_reason();
