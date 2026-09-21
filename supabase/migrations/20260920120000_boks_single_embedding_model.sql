-- One model per column, enforced.
--
-- Vectors from two models share a column type and nothing else: cosine
-- similarity between a `gte-small` vector and a `multilingual-e5-small` vector
-- is a number with no meaning, and a ranker fed a mixture would reorder the
-- feed by which model happened to embed which piece. Nothing about that failure
-- is visible - no error, no null, just a worse feed - so it has to be
-- impossible rather than merely discouraged.
--
-- The model in force is `multilingual-e5-small`, chosen by measurement on this
-- catalogue (the reasoning and the numbers are in `scripts/embed-catalogue.mjs`):
-- `gte-small`, which is what Supabase's built-in inference offers and what the
-- `embed` Edge Function produces, is an English model, and it put every Russian
-- text in one blob - same-author pairs scored 0.895 against 0.893 for pairs by
-- different authors, inside a spread of 0.020. Three quarters of this catalogue
-- is Russian.
--
-- So `set_bok_embedding` now refuses anything else, which also takes the `embed`
-- Edge Function out of service until Supabase's runtime offers a multilingual
-- model (or the same job moves to Cloudflare Workers AI, whose `bge-m3` is
-- multilingual). It fails loudly on its next call instead of quietly poisoning
-- the column, and `scripts/embed-catalogue.mjs` does the work meanwhile.

create or replace function public.boks_embedding_model()
returns text
language sql
immutable
set search_path = ''
as $$ select 'multilingual-e5-small'::text $$;

comment on function public.boks_embedding_model() is
  'The only embedding model whose vectors may be stored in reels.embedding. Changing it means re-embedding the whole catalogue in one pass.';

create or replace function public.set_bok_embedding(
  p_reel_id uuid,
  p_embedding jsonb,
  p_model text default 'gte-small'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_dims integer;
  v_model text := nullif(btrim(coalesce(p_model, '')), '');
  v_expected text := public.boks_embedding_model();
begin
  if p_embedding is null or jsonb_typeof(p_embedding) <> 'array' then
    raise exception 'An embedding must be a JSON array of numbers.' using errcode = '22023';
  end if;

  if v_model is distinct from v_expected then
    raise exception 'This catalogue is embedded with %; refusing a vector from %.', v_expected, coalesce(v_model, 'an unnamed model')
      using errcode = '22023';
  end if;

  v_dims := jsonb_array_length(p_embedding);
  if v_dims <> 384 then
    raise exception 'An embedding must have 384 dimensions; this one has %.', v_dims using errcode = '22023';
  end if;

  update public.reels
  set embedding = (p_embedding::text)::extensions.vector(384),
      embedding_model = v_model,
      embedded_at = now()
  where id = p_reel_id;

  if not found then
    raise exception 'No bok with id %.', p_reel_id using errcode = 'P0002';
  end if;

  return jsonb_build_object('id', p_reel_id::text, 'model', v_model, 'dimensions', v_dims);
end;
$$;

revoke all on function public.set_bok_embedding(uuid, jsonb, text) from public, anon, authenticated;
grant execute on function public.set_bok_embedding(uuid, jsonb, text) to service_role;

-- "Needs embedding" now includes a bok carrying a vector from a retired model,
-- so a model change is a re-embedding job rather than a silent mixture.
create or replace function public.get_boks_needing_embedding(p_limit integer default 25)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 25), 1), 100);
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', t.id::text, 'title', t.title, 'text', t.text))
    from (
      select r.id, r.title, r.text
      from public.reels r
      where (r.embedding is null or r.embedding_model is distinct from public.boks_embedding_model())
        and r.status in ('published', 'pending_review')
        and coalesce(btrim(r.text), '') <> ''
      order by r.created_at
      limit v_limit
    ) t
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.get_boks_needing_embedding(integer) from public, anon, authenticated;
grant execute on function public.get_boks_needing_embedding(integer) to service_role;

-- Coverage counts a stale model as missing, for the same reason.
create or replace function public.boks_embedding_coverage()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'model', public.boks_embedding_model(),
    'publishedTotal', count(*) filter (where r.status = 'published'),
    'publishedEmbedded', count(*) filter (
      where r.status = 'published' and r.embedding is not null
        and r.embedding_model = public.boks_embedding_model()
    ),
    'publishedMissing', count(*) filter (
      where r.status = 'published'
        and (r.embedding is null or r.embedding_model is distinct from public.boks_embedding_model())
    ),
    'pendingMissing', count(*) filter (
      where r.status = 'pending_review'
        and (r.embedding is null or r.embedding_model is distinct from public.boks_embedding_model())
    ),
    'models', coalesce(jsonb_agg(distinct r.embedding_model) filter (where r.embedding_model is not null), '[]'::jsonb),
    'lastEmbeddedAt', max(r.embedded_at)
  )
  from public.reels r;
$$;

revoke all on function public.boks_embedding_coverage() from public;
grant execute on function public.boks_embedding_coverage() to anon, authenticated, service_role;
