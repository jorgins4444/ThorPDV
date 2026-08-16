create or replace function private.publish_current_pdv_release()
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'private', 'extensions'
as $function$
declare
  v_release private.pdv_releases%rowtype;
  v_reason text;
begin
  select r.* into v_release
  from private.pdv_releases r
  where r.status='published'
    and r.channel='stable'
    and r.version ~ '^[0-9]+\.[0-9]+\.[0-9]+$'
  order by
    split_part(r.version,'.',1)::integer desc,
    split_part(r.version,'.',2)::integer desc,
    split_part(r.version,'.',3)::integer desc,
    r.updated_at desc
  limit 1;

  if v_release.id is null then
    return jsonb_build_object('ok',false,'error','published_stable_release_not_found');
  end if;

  v_reason:='Atualização '||v_release.version||': '||coalesce(nullif(v_release.release_notes,''),'versão estável atual do ThorPDV.');

  return private.publish_pdv_stable_release(
    v_release.version,
    v_release.download_url,
    v_release.sha256,
    v_release.release_notes,
    v_release.package_size,
    v_reason
  );
end
$function$;
