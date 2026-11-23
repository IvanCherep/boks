-- Up to 30 Boks Series a year, not 50 (2026-11-23): the editors keep a pace they
-- can hold. The Workshop's plan says so; the rest of get_my_workshop is as in
-- 20261122220000_boks_workshop.sql.

create or replace function public.get_my_workshop()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.boks_require_workshop_author();
  v_space public.author_spaces;
  v_handle text;
begin
  select * into v_space from public.author_spaces s
  where s.owner_user_id = v_uid and s.kind = 'author' and s.status in ('draft', 'published', 'unpublished') and s.verified
  order by (s.status = 'published') desc, s.created_at
  limit 1;
  select p.handle into v_handle from public.user_profiles p where p.user_id = v_uid;

  return jsonb_build_object(
    'author', jsonb_build_object(
      'userId', v_uid::text,
      'handle', v_handle,
      'name', coalesce(v_space.name, case when v_handle is not null then '@' || v_handle end),
      'pageId', v_space.id::text,
      'pageStatus', v_space.status
    ),
    'plan', jsonb_build_object(
      'perYear', 30,
      'perWeek', 1,
      'usedThisYear', (
        select count(*)::integer from public.bok_series_work w
        where w.author_id = v_uid and w.state in ('accepted', 'sent', 'published')
          and w.accepted_at >= date_trunc('year', now())
      )
    ),
    'pieces', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id::text,
        'title', r.title,
        'text', r.text,
        'status', r.status,
        'coverRequested', r.cover_requested,
        'coverVersion', r.cover_version,
        'createdAt', r.created_at,
        'updatedAt', r.updated_at,
        'form', coalesce(bw.form, 'poem'),
        'shelvedAt', bw.shelved_at,
        'queuePos', bw.queue_pos,
        'notes', coalesce(bw.notes, '{}'::jsonb),
        'voice', case when v.bok_id is null then null else jsonb_build_object(
          'file', v.file, 'durationMs', v.duration_ms, 'source', v.source, 'name', v.name,
          'at', v.recorded_at, 'current', v.fingerprint = public.boks_voice_fingerprint(r.text)
        ) end,
        'decision', case when d.bok_id is null then null else jsonb_build_object(
          'decision', d.decision, 'kind', d.kind, 'note', d.note, 'at', d.decided_at
        ) end,
        'series', case when sw.bok_id is null then null else jsonb_build_object(
          'state', sw.state, 'acceptedAt', sw.accepted_at, 'sentAt', sw.sent_at, 'publishedAt', sw.published_at,
          'workId', sw.work_id::text, 'revision', aw.revision, 'workStatus', aw.status,
          -- The Series sent to the author, to watch before publishing; null before it is sent.
          'seriesPiece', case when sw.state in ('sent', 'published') then coalesce(aw.series_piece, sw.series_piece) end
        ) end,
        'importedFrom', null
      ) order by r.created_at desc, r.id)
      from (
        select * from public.reels
        where author_user_id = v_uid and status <> 'archived'
        order by created_at desc, id
        limit 200
      ) r
      left join public.bok_workshop bw on bw.bok_id = r.id
      left join public.bok_voices v on v.bok_id = r.id and v.user_id = v_uid
      left join public.bok_editor_decisions d on d.bok_id = r.id
        and ((d.decision = 'changes' and r.status = 'draft') or (d.decision = 'refused' and r.status = 'rejected'))
      left join public.bok_series_work sw on sw.bok_id = r.id and sw.state in ('accepted', 'sent', 'published')
      left join public.author_space_works aw on aw.id = sw.work_id
    ), '[]'::jsonb),
    'ready', coalesce((
      select jsonb_agg(jsonb_build_object(
        'workId', w.id::text, 'revision', w.revision, 'title', w.title, 'format', w.format, 'bokId', w.bok_id::text
      ) order by w.position nulls last, w.ready_at)
      from public.author_space_works w
      where v_space.id is not null and w.space_id = v_space.id and w.status = 'ready'
        and not exists (select 1 from public.bok_series_work s where s.work_id = w.id)
    ), '[]'::jsonb)
  );
end;
$$;
revoke all on function public.get_my_workshop() from public, anon, authenticated;
grant execute on function public.get_my_workshop() to authenticated;
