-- A nickname is the only public identity boks has, so its shape is a product
-- rule and not a matter of taste: English letters, digits and underscores,
-- always starting with a letter.
--
-- What was wrong before this migration:
--
--   * `user_profiles_handle_format` allowed `^[a-z0-9_]{3,24}$`, so `9ivan` and
--     `_ivan` were both storable. A handle that starts with a digit reads as an
--     id rather than a name, and one that starts with an underscore is
--     invisible at the start of a sentence.
--   * `normalize_boks_handle` was used for two different jobs - sanitising a
--     seed derived from an email, and accepting what a person typed - and it
--     silently rewrote the second. Asking for `ivan.ystal` saved `ivan_ystal`
--     without saying so; asking for `9ivan` would now save `ivan`. A rename
--     nobody asked for is worse than a refusal.
--
-- So the two jobs are separated here: derivation still sanitises, because the
-- reader never sees it happen and there is nothing to refuse; an explicit
-- request is validated and refused with a message naming the rule.

create or replace function public.normalize_boks_handle(p_handle text)
returns text
language sql
immutable
as $$
  -- Derivation only. Anything outside the allowed set becomes an underscore,
  -- edge underscores go, and then everything before the first letter goes too,
  -- so the result either starts with a letter or is empty.
  select nullif(
    left(
      regexp_replace(
        regexp_replace(
          regexp_replace(
            lower(trim(leading '@' from btrim(coalesce(p_handle, '')))),
            '[^a-z0-9_]+',
            '_',
            'g'
          ),
          '^_+|_+$',
          '',
          'g'
        ),
        '^[^a-z]+',
        '',
        'g'
      ),
      24
    ),
    ''
  );
$$;

comment on function public.normalize_boks_handle(text) is
  'Sanitises a handle seed (an email local part, say). Never use it on a handle a person typed: it rewrites rather than refuses. See boks_handle_is_valid.';

-- The rule itself, in one place, so the constraint, the RPC and the tests
-- cannot drift apart.
create or replace function public.boks_handle_is_valid(p_handle text)
returns boolean
language sql
immutable
as $$
  select p_handle ~ '^[a-z][a-z0-9_]{2,23}$';
$$;

comment on function public.boks_handle_is_valid(text) is
  'English letters, digits and underscores, 3 to 24 characters, starting with a letter.';

/**
 * Explicit requests are validated, not rewritten. Only the two things that
 * carry no meaning are removed first: surrounding whitespace and a leading `@`,
 * which readers type out of habit because that is how a handle is displayed.
 */
create or replace function public.update_boks_user_profile(
  p_display_name text default '',
  p_handle text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := (select auth.uid());
  v_is_anonymous boolean := coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false);
  v_requested text := nullif(lower(trim(leading '@' from btrim(coalesce(p_handle, '')))), '');
  v_email text;
begin
  if v_uid is null or v_is_anonymous then
    raise exception 'Permanent sign in required.' using errcode = '42501';
  end if;

  if v_requested is not null and not public.boks_handle_is_valid(v_requested) then
    if char_length(v_requested) < 3 then
      raise exception 'A nickname needs at least 3 characters.' using errcode = '22023';
    end if;
    if char_length(v_requested) > 24 then
      raise exception 'A nickname can be at most 24 characters.' using errcode = '22023';
    end if;
    -- The alphabet is checked before the first-character rule on purpose.
    -- Someone who typed Cyrillic did start with a letter, and telling them to
    -- "start with a letter" would send them looking for the wrong mistake.
    if v_requested !~ '^[a-z0-9_]+$' then
      raise exception 'A nickname can only use English letters, numbers and underscores.' using errcode = '22023';
    end if;
    raise exception 'A nickname has to start with a letter.' using errcode = '22023';
  end if;

  if v_requested is not null and exists (
    select 1 from public.user_profiles
    where lower(handle) = v_requested and user_id <> v_uid
  ) then
    raise exception 'That nickname is taken.' using errcode = '23505';
  end if;

  select email into v_email from auth.users where id = v_uid;

  insert into public.user_profiles (user_id, handle)
  values (v_uid, coalesce(v_requested, public.generate_boks_handle(public.boks_handle_seed_from_email(v_email), v_uid)))
  on conflict (user_id) do update
  set handle = coalesce(v_requested, public.user_profiles.handle),
      updated_at = now();

  return public.get_boks_user_context();
end;
$$;

-- Any handle already stored that the rule would now refuse is regenerated
-- rather than left to fail the constraint. Nothing matches locally; production
-- is where this earns its keep.
update public.user_profiles p
set handle = public.generate_boks_handle(
      public.boks_handle_seed_from_email((select au.email from auth.users au where au.id = p.user_id)),
      p.user_id
    ),
    updated_at = now()
where p.handle is not null
  and not public.boks_handle_is_valid(p.handle);

-- The regex is repeated here rather than calling `boks_handle_is_valid`: a
-- constraint that calls a function keeps no record of the rule it was validated
-- against, so editing the function would silently change what the table
-- permits without revalidating a single stored row. `checks.sql` asserts that
-- the two agree.
alter table public.user_profiles
  drop constraint if exists user_profiles_handle_format,
  add constraint user_profiles_handle_format
    check (handle is null or handle ~ '^[a-z][a-z0-9_]{2,23}$');

revoke all on function public.update_boks_user_profile(text, text) from public, anon, authenticated;
grant execute on function public.update_boks_user_profile(text, text) to authenticated;
revoke all on function public.boks_handle_is_valid(text) from public, anon, authenticated;
grant execute on function public.boks_handle_is_valid(text) to authenticated;
