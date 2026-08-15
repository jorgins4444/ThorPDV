create or replace function public.pdv_pull_v9(p_device_token text, p_since timestamptz default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public','private'
as $function$
declare
  data jsonb;
  enriched jsonb;
begin
  data := public.pdv_pull_v8(p_device_token,p_since);
  if not coalesce((data->>'ok')::boolean,false) then return data; end if;

  select coalesce(jsonb_agg(
    case
      when fd.id is null then x.obj
      else jsonb_set(
        x.obj,
        '{fiscal}',
        coalesce(x.obj->'fiscal','{}'::jsonb) || jsonb_build_object(
          'environment',fd.environment,
          'qr_code_url',coalesce(fd.response_payload->>'qr_code_url',fd.request_payload->>'qr_code_url')
        ),
        true
      )
    end
    order by coalesce((x.obj->>'completed_at')::timestamptz,(x.obj->>'created_at')::timestamptz) desc
  ),'[]'::jsonb)
  into enriched
  from jsonb_array_elements(coalesce(data->'sales_history','[]'::jsonb)) x(obj)
  left join public.fiscal_documents fd
    on fd.id=nullif(x.obj#>>'{fiscal,id}','')::uuid;

  data := jsonb_set(data,'{sales_history}',coalesce(enriched,'[]'::jsonb),true);
  return data;
end;
$function$;

revoke all on function public.pdv_pull_v9(text,timestamptz) from public;
grant execute on function public.pdv_pull_v9(text,timestamptz) to anon, authenticated, service_role;
