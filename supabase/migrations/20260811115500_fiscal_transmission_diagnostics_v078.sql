alter table public.fiscal_documents drop constraint if exists fiscal_documents_status_check;
alter table public.fiscal_documents add constraint fiscal_documents_status_check check (status = any (array['draft'::text,'processing'::text,'authorized'::text,'rejected'::text,'cancelled'::text,'contingency'::text,'transmission_error'::text]));

alter table public.fiscal_documents add column if not exists last_error_code text;
alter table public.fiscal_documents add column if not exists last_error_message text;
alter table public.fiscal_documents add column if not exists last_attempt_at timestamptz;
alter table public.fiscal_documents add column if not exists attempt_count integer not null default 0;

create table if not exists public.fiscal_document_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  fiscal_document_id uuid not null references public.fiscal_documents(id) on delete cascade,
  event_type text not null,
  level text not null default 'info' check (level in ('info','success','warning','error')),
  code text,
  message text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_fiscal_document_events_document_created on public.fiscal_document_events(fiscal_document_id,created_at desc);
create index if not exists idx_fiscal_document_events_tenant_created on public.fiscal_document_events(tenant_id,created_at desc);
alter table public.fiscal_document_events enable row level security;

update public.fiscal_documents
set status='transmission_error',
    last_error_code=case
      when coalesce(response_payload->>'detail','') ilike '%UnknownIssuer%' then 'tls_unknown_issuer'
      when coalesce(response_payload->>'detail','') ilike '%timeout%' then 'sefaz_timeout'
      else 'transport_or_processing_error'
    end,
    last_error_message=coalesce(nullif(response_payload->>'detail',''),rejection_message,'Falha de comunicação com a SEFAZ'),
    last_attempt_at=coalesce(updated_at,now()),
    attempt_count=greatest(attempt_count,1),
    rejection_code=null,
    rejection_message=null,
    updated_at=now()
where status='processing' and response_payload->>'error'='transport_or_processing_error';

insert into public.fiscal_document_events(tenant_id,fiscal_document_id,event_type,level,code,message,payload,created_at)
select fd.tenant_id,fd.id,'transport_error','error',fd.last_error_code,
       coalesce(fd.last_error_message,'Falha de comunicação com a SEFAZ'),
       jsonb_build_object('migrated_from_legacy_processing',true,'retryable',coalesce((fd.response_payload->>'retry_same_xml')::boolean,false)),
       coalesce(fd.last_attempt_at,fd.updated_at,now())
from public.fiscal_documents fd
where fd.status='transmission_error'
  and not exists (select 1 from public.fiscal_document_events e where e.fiscal_document_id=fd.id);

create or replace function public.pdv_pull_v7(p_device_token text,p_since timestamptz default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public','private'
as $function$
declare
  data jsonb;
  enriched jsonb;
begin
  data:=public.pdv_pull_v6(p_device_token,p_since);
  if not coalesce((data->>'ok')::boolean,false) then return data; end if;

  select coalesce(jsonb_agg(
    x.obj || jsonb_build_object(
      'fiscal',
      case when fd.id is null then x.obj->'fiscal'
      else coalesce(x.obj->'fiscal','{}'::jsonb) || jsonb_build_object(
        'last_error_code',fd.last_error_code,
        'last_error_message',fd.last_error_message,
        'last_attempt_at',fd.last_attempt_at,
        'attempt_count',fd.attempt_count,
        'cStat',coalesce(nullif(fd.response_payload->>'cStat',''),nullif(fd.rejection_code,'')),
        'xMotivo',coalesce(nullif(fd.response_payload->>'xMotivo',''),nullif(fd.rejection_message,'')),
        'retryable',coalesce((fd.response_payload->>'retry_same_xml')::boolean,false) or fd.status='transmission_error',
        'events',coalesce((
          select jsonb_agg(jsonb_build_object(
            'id',e.id,'type',e.event_type,'level',e.level,'code',e.code,'message',e.message,'payload',e.payload,'created_at',e.created_at
          ) order by e.created_at)
          from (
            select * from public.fiscal_document_events fe
            where fe.fiscal_document_id=fd.id
            order by fe.created_at desc limit 30
          ) e
        ),'[]'::jsonb)
      ) end
    ) order by coalesce((x.obj->>'completed_at')::timestamptz,(x.obj->>'created_at')::timestamptz) desc
  ),'[]'::jsonb)
  into enriched
  from jsonb_array_elements(coalesce(data->'sales_history','[]'::jsonb)) x(obj)
  left join public.fiscal_documents fd
    on fd.id=nullif(x.obj#>>'{fiscal,id}','')::uuid;

  data:=jsonb_set(data,'{sales_history}',coalesce(enriched,'[]'::jsonb),true);
  return data;
end;
$function$;

grant execute on function public.pdv_pull_v7(text,timestamptz) to anon, authenticated, service_role;
