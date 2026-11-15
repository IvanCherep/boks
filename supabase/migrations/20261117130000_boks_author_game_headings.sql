-- Guess the author: no heading gives the answer away (2026-11-15).
--
-- Some catalogue texts open with their own heading ("Басни. Книга первая /
-- XXII. Орёл и Куры"), which named the fable and hinted at its author before
-- the reader answered. The game now shows the text without such a heading
-- (`boks_game_text`), Studio previews exactly that, and a text that names its
-- own author is never a candidate. Same signatures, same fields.

-- The text as the game shows it. Some catalogue texts open with their own
-- heading ("Басни. Книга первая / XXII. Орёл и Куры"): within the first four
-- lines, a line that is the title (a numbering like "XXII." aside) and stands
-- as a heading, a blank line after it, goes with everything above it. A first
-- line that merely shares words with the title is the poem and stays.
create or replace function public.boks_game_text(p_text text, p_title text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_lines text[] := regexp_split_to_array(coalesce(p_text, ''), '\n');
  v_title text := btrim(public.boks_passage_key(p_title), ' .…');
  v_line text;
  v_seen integer := 0;
  v_cut integer := 0;
begin
  if v_title = '' then
    return btrim(p_text, E'\n ');
  end if;
  for i in 1..coalesce(array_length(v_lines, 1), 0) loop
    if btrim(v_lines[i]) = '' then continue; end if;
    v_seen := v_seen + 1;
    exit when v_seen > 4;
    v_line := btrim(regexp_replace(public.boks_passage_key(v_lines[i]), '^[ivxlcdm0-9]+[.)]\s*', ''), ' .…');
    if v_line = v_title and coalesce(btrim(v_lines[i + 1]), '') = '' then
      v_cut := i;
    end if;
  end loop;
  return btrim(array_to_string(v_lines[v_cut + 1:], E'\n'), E'\n ');
end;
$$;

revoke all on function public.boks_game_text(text, text) from public, anon, authenticated;

-- Texts the game may use: those, two minutes of reading or less, that never
-- name their own author.
create or replace function public.boks_game_pool()
returns table (bok_id uuid, author_name text, verse boolean)
language sql
stable
set search_path = ''
as $$
  select a.bok_id, a.author_name, a.verse
  from public.boks_game_authors() a
  join public.reels b on b.id = a.bok_id
  where a.word_count between 20 and 360 and a.minutes <= 2
    and position(public.boks_surname(a.author_name) in lower(b.text)) = 0;
$$;

revoke all on function public.boks_game_pool() from public, anon, authenticated;

-- Today's issue for a reader. The text and the three names only; the rest
-- after their answer. A guest may read it; answering needs an account.
create or replace function public.get_author_game()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_issue public.author_game_issues := public.boks_game_issue_today();
  v_answer public.author_game_answers;
  v_text text;
  v_words integer;
begin
  if v_issue.published_at is null then
    return jsonb_build_object('date', public.boks_game_today(), 'status', 'none');
  end if;
  select public.boks_game_text(b.text, b.title), b.word_count into v_text, v_words
  from public.reels b where b.id = v_issue.published_bok_id and b.status = 'published';
  if v_text is null then
    return jsonb_build_object('date', v_issue.game_date, 'status', 'none');
  end if;
  if v_uid is not null then
    select * into v_answer from public.author_game_answers a where a.game_date = v_issue.game_date and a.user_id = v_uid;
  end if;
  return jsonb_build_object(
    'date', v_issue.game_date,
    'status', case when v_answer.user_id is null then 'open' else 'answered' end,
    'text', v_text,
    'words', v_words,
    'options', to_jsonb(v_issue.published_options),
    'result', case when v_answer.user_id is null then null else public.boks_game_result_json(v_issue, v_answer) end
  );
end;
$$;

revoke all on function public.get_author_game() from public, anon, authenticated;
grant execute on function public.get_author_game() to authenticated;

create or replace function public.boks_game_day_json(p_date date, p_with_text boolean)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'date', p_date,
    'today', p_date = public.boks_game_today(),
    'chosenPosition', i.chosen_position,
    'publishedAt', i.published_at,
    'publishedPosition', i.published_position,
    'published', case when i.published_at is null then null else jsonb_build_object(
      'bokId', b.id::text, 'title', b.title, 'authorName', i.published_options[i.published_correct + 1],
      'options', to_jsonb(i.published_options), 'correct', i.published_correct,
      'answers', (select count(*) from public.author_game_answers a where a.game_date = p_date and a.choice is not null),
      'correctAnswers', (select count(*) from public.author_game_answers a where a.game_date = p_date and a.correct)
    ) end,
    'available', (
      select count(*) from public.author_game_candidates c
      where c.game_date = p_date and public.boks_game_candidate_valid(c.bok_id)
    ),
    'candidates', coalesce((
      select jsonb_agg(public.boks_game_candidate_json(c, p_with_text) order by c.position)
      from public.author_game_candidates c where c.game_date = p_date
    ), '[]'::jsonb)
  )
  from (select 1) one
  left join public.author_game_issues i on i.game_date = p_date
  left join public.reels b on b.id = i.published_bok_id;
$$;

revoke all on function public.boks_game_day_json(date, boolean) from public, anon, authenticated;
