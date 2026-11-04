-- A storage bucket for link-only pieces (`docs/link-only-pieces.md`).
--
-- A link-only piece is a living author's work shown to that author, and to
-- whoever they choose to pass the link to, before there is any agreement to
-- publish it. Its text, recording and pictures must not be in the repository,
-- which is public, and must not be in the catalogue, which the feed, the
-- series shelf, search and the studies all read. They live here instead,
-- under a folder named by the piece's unguessable token, and the Worker serves
-- them same-origin from `/l/<token>/f/<file>`.
--
-- Public, because the Worker holds no service-role key and reads the files as
-- an anonymous caller: a public bucket serves an object to anyone who already
-- knows its full path. It does not let anyone list it. Listing goes through the
-- row policies on `storage.objects`, and this migration adds none, so `anon`
-- and `authenticated` see an empty bucket. Uploads are made by an operator with
-- the Supabase CLI.
--
-- Guarded, because the throwaway Postgres behind `npm run verify:schema` has no
-- `storage` schema.
do $$
begin
  if to_regclass('storage.buckets') is null then
    return;
  end if;
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values (
    'link-only',
    'link-only',
    true,
    10485760,
    array['application/json', 'audio/mpeg', 'image/webp']
  )
  on conflict (id) do update
    set public = excluded.public,
        file_size_limit = excluded.file_size_limit,
        allowed_mime_types = excluded.allowed_mime_types;
end
$$;
