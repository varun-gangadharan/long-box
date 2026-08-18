-- Pair affinity: the data needed to tell co-starring apart from co-occurrence.
--
-- The reading-path engine previously had no way to distinguish "these characters
-- are the core cast of this book" from "these characters were both credited in
-- one issue". These tables and functions supply that distinction.

-- Complete per-character appearance index, independent of which issues have been
-- ingested in detail. One ComicVine character request fills this for a character,
-- however many thousands of appearances they have.
create table character_issue_credits (
  character_id uuid not null references characters(id) on delete cascade,
  comicvine_issue_id bigint not null,
  primary key (character_id, comicvine_issue_id)
);

create index character_issue_credits_issue_idx
  on character_issue_credits (comicvine_issue_id, character_id);

create table creators (
  id uuid primary key default gen_random_uuid(),
  comicvine_id bigint not null unique,
  name text not null
);

create table issue_creators (
  issue_id uuid not null references issues(id) on delete cascade,
  creator_id uuid not null references creators(id) on delete cascade,
  role text not null,
  primary key (issue_id, creator_id, role)
);

create index issue_creators_creator_idx on issue_creators (creator_id, issue_id);

-- ComicVine's volume detail endpoint reports, per character, how many issues of
-- that volume they appear in. That single number is the core-cast signal, and it
-- costs one request per volume rather than one per issue. Per-issue character
-- credits are only available on the issue detail endpoint, which is capped at
-- 200 requests per hour, so this table is what makes the signal affordable.
create table volume_characters (
  volume_id uuid not null references volumes(id) on delete cascade,
  character_id uuid not null references characters(id) on delete cascade,
  appearance_count integer not null,
  primary key (volume_id, character_id)
);

create index volume_characters_character_idx on volume_characters (character_id, volume_id);

-- Denominator for "how much of this book are these characters actually in".
alter table volumes add column issue_count integer;

-- Set when a character's full issue_credits list has been cached above.
alter table characters add column credits_loaded_at timestamptz;

-- Set when a volume's detail (issue count and per-character appearance counts)
-- has been fetched.
alter table volumes add column details_loaded_at timestamptz;

-- Lets a repeat query for the same character set skip re-ingestion.
create table pair_ingestions (
  character_key text primary key,
  ingested_at timestamptz not null default now()
);

alter table character_issue_credits enable row level security;
alter table creators enable row level security;
alter table issue_creators enable row level security;
alter table volume_characters enable row level security;
alter table pair_ingestions enable row level security;

-- Numeric issue number, or null for annuals and other non-numeric entries.
create function numeric_issue_number(value text)
returns numeric
language sql immutable as $$
  select nullif(regexp_replace(coalesce(value, ''), '[^0-9.]', '', 'g'), '')::numeric;
$$;

-- The true, complete set of issues in which every requested character is
-- credited, derived from the cached credit index rather than from the small
-- slice of issues that happen to be ingested in detail.
create function co_appearance_issue_ids(requested_character_ids uuid[])
returns table (comicvine_issue_id bigint)
language sql stable as $$
  with requested as (
    select distinct unnest(requested_character_ids) as character_id
  )
  select credits.comicvine_issue_id
  from character_issue_credits credits
  join requested on requested.character_id = credits.character_id
  group by credits.comicvine_issue_id
  having count(distinct credits.character_id) = (select count(*) from requested)
  order by credits.comicvine_issue_id;
$$;

comment on function co_appearance_issue_ids(uuid[]) is
  'ComicVine issue IDs where every requested character is credited, from the cached credit index.';

-- Locally known issues in which every requested character appears. Two sources
-- count as evidence and are unioned rather than ranked: the cached credit index,
-- which is complete but only names ComicVine issue IDs, and issue_characters,
-- which is richer but only covers issues whose detail was fetched. Requiring
-- both would discard real co-appearances.
create function co_appearance_issues(requested_character_ids uuid[])
returns table (issue_id uuid)
language sql stable as $$
  with requested as (
    select distinct unnest(requested_character_ids) as character_id
  ), evidence as (
    select i.id as issue_id, credits.character_id
    from character_issue_credits credits
    join requested r on r.character_id = credits.character_id
    join issues i on i.comicvine_id = credits.comicvine_issue_id
    union
    select ic.issue_id, ic.character_id
    from issue_characters ic
    join requested r on r.character_id = ic.character_id
  )
  select evidence.issue_id
  from evidence
  group by evidence.issue_id
  having count(distinct evidence.character_id) = (select count(*) from requested);
$$;

comment on function co_appearance_issues(uuid[]) is
  'Locally known issues containing every requested character, from the credit index and issue credits combined.';

-- Per-volume co-appearance profile for a character set. This is the signal that
-- separates "the book these characters co-star in" from "a book one of them
-- passed through".
--
-- Co-appearances come from character_issue_credits, the complete credit index,
-- rather than from issue_characters, which only covers issues whose detail was
-- fetched. min_character_appearances comes from ComicVine's per-volume character
-- counts. Measured against volume_issue_count, a team book the pair headlines
-- scores near 1 while a 700-issue title with one guest spot scores near 0.
create function volume_pair_affinity(requested_character_ids uuid[])
returns table (
  volume_id uuid,
  volume_name text,
  volume_start_year integer,
  volume_issue_count integer,
  local_issue_count integer,
  co_issue_count integer,
  min_character_appearances integer,
  longest_co_streak integer,
  first_co_issue_number text,
  last_co_issue_number text,
  first_co_date date,
  last_co_date date,
  top_writer text,
  top_artist text
)
language sql stable as $$
  with requested as (
    select distinct unnest(requested_character_ids) as character_id
  ), requested_total as (
    select count(*) as total from requested
  ), co_issues as (
    select
      i.id as issue_id,
      i.volume_id,
      i.issue_number,
      i.cover_date,
      numeric_issue_number(i.issue_number) as numeric_number
    from co_appearance_issues(requested_character_ids) matched
    join issues i on i.id = matched.issue_id
  ), islands as (
    select
      volume_id,
      numeric_number
        - row_number() over (partition by volume_id order by numeric_number) as island
    from co_issues
    where numeric_number is not null
  ), longest as (
    select volume_id, max(streak)::integer as longest_co_streak
    from (
      select volume_id, island, count(*) as streak
      from islands
      group by volume_id, island
    ) counted
    group by volume_id
  ), bounds as (
    select
      volume_id,
      count(*)::integer as co_issue_count,
      min(cover_date) as first_co_date,
      max(cover_date) as last_co_date,
      (array_agg(issue_number order by numeric_number nulls last, cover_date nulls last))[1]
        as first_co_issue_number,
      (array_agg(issue_number order by numeric_number desc nulls last, cover_date desc nulls last))[1]
        as last_co_issue_number
    from co_issues
    group by volume_id
  ), local_totals as (
    select volume_id, count(*)::integer as local_issue_count
    from issues
    group by volume_id
  ), character_presence as (
    -- The weakest member decides: both characters have to be regulars before a
    -- volume counts as a book about the pair.
    select
      vc.volume_id,
      min(vc.appearance_count)::integer as min_character_appearances,
      count(*) as covered_characters
    from volume_characters vc
    join requested on requested.character_id = vc.character_id
    group by vc.volume_id
  ), creator_ranks as (
    select
      co.volume_id,
      case when lower(link.role) = 'writer' then 'writer' else 'artist' end as role_group,
      person.name,
      count(*) as credited_issues,
      row_number() over (
        partition by co.volume_id,
          case when lower(link.role) = 'writer' then 'writer' else 'artist' end
        order by count(*) desc, person.name
      ) as position
    from co_issues co
    join issue_creators link on link.issue_id = co.issue_id
    join creators person on person.id = link.creator_id
    where lower(link.role) in ('writer', 'penciler', 'penciller', 'artist')
    group by co.volume_id, role_group, person.name
  )
  select
    v.id,
    v.name,
    v.start_year,
    v.issue_count,
    coalesce(local_totals.local_issue_count, 0),
    bounds.co_issue_count,
    case
      when character_presence.covered_characters = (select total from requested_total)
        then character_presence.min_character_appearances
      else null
    end,
    coalesce(longest.longest_co_streak, 1),
    bounds.first_co_issue_number,
    bounds.last_co_issue_number,
    bounds.first_co_date,
    bounds.last_co_date,
    (select name from creator_ranks where volume_id = v.id and role_group = 'writer' and position = 1),
    (select name from creator_ranks where volume_id = v.id and role_group = 'artist' and position = 1)
  from bounds
  join volumes v on v.id = bounds.volume_id
  left join longest on longest.volume_id = v.id
  left join local_totals on local_totals.volume_id = v.id
  left join character_presence on character_presence.volume_id = v.id
  order by bounds.co_issue_count desc, v.start_year nulls last, v.name;
$$;

comment on function volume_pair_affinity(uuid[]) is
  'Per-volume co-appearance profile: how much of each book the requested characters actually share.';

-- Rewritten candidate bound. The previous version ordered by cover_date desc
-- before the limit, which is a recency bias applied ahead of any scoring and
-- structurally excluded the older runs that are often the right answer. The pool
-- is now bounded by how much of each volume the characters actually share, and
-- carries creator credits so results can name their creative team.
-- Postgres cannot change a function's return type in place, so the two
-- reading-path candidate functions are dropped and recreated with the wider row.
drop function if exists reading_path_issue_candidates(uuid[]);
drop function if exists reading_path_story_arc_issues(uuid);

create function reading_path_issue_candidates(requested_character_ids uuid[])
returns table (
  issue_id uuid,
  comicvine_id bigint,
  issue_number text,
  issue_name text,
  cover_date date,
  image_url text,
  volume_id uuid,
  volume_name text,
  volume_start_year integer,
  volume_issue_count integer,
  character_count integer,
  requested_character_count integer,
  story_arcs jsonb,
  creators jsonb
)
language sql stable as $$
  with requested as (
    select distinct unnest(requested_character_ids) as character_id
  ), requested_total as (
    select count(*) as total from requested
  ), matching_issues as (
    select issue_id from co_appearance_issues(requested_character_ids)
  ), volume_weight as (
    select i.volume_id, count(*) as co_issue_count
    from matching_issues matched
    join issues i on i.id = matched.issue_id
    group by i.volume_id
  ), bounded_issues as (
    select matched.issue_id
    from matching_issues matched
    join issues i on i.id = matched.issue_id
    join volume_weight w on w.volume_id = i.volume_id
    order by
      w.co_issue_count desc,
      i.volume_id,
      numeric_issue_number(i.issue_number) nulls last,
      i.cover_date nulls last,
      matched.issue_id
    limit 500
  )
  select
    i.id,
    i.comicvine_id,
    i.issue_number,
    i.name,
    i.cover_date,
    i.image_url,
    v.id,
    v.name,
    v.start_year,
    v.issue_count,
    (select count(*)::integer from issue_characters cast_members where cast_members.issue_id = i.id),
    (select total::integer from requested_total),
    coalesce(
      (
        select jsonb_agg(distinct jsonb_build_object(
          'id', sa.id, 'comicvineId', sa.comicvine_id, 'name', sa.name
        ))
        from issue_story_arcs link
        join story_arcs sa on sa.id = link.story_arc_id
        where link.issue_id = i.id
      ),
      '[]'::jsonb
    ),
    coalesce(
      (
        select jsonb_agg(distinct jsonb_build_object('name', person.name, 'role', link.role))
        from issue_creators link
        join creators person on person.id = link.creator_id
        where link.issue_id = i.id
          and lower(link.role) in ('writer', 'penciler', 'penciller', 'artist')
      ),
      '[]'::jsonb
    )
  from bounded_issues bounded
  join issues i on i.id = bounded.issue_id
  join volumes v on v.id = i.volume_id
  order by v.name, numeric_issue_number(i.issue_number) nulls last, i.issue_number;
$$;

comment on function reading_path_issue_candidates(uuid[]) is
  'At most 500 issues containing every requested character, bounded by volume co-appearance weight rather than recency.';

-- Same row shape as the character candidate function so the repository can parse
-- both with one schema. Story-arc queries keep their recency bound: an arc is
-- already a bounded story, so there is no classic-run bias to correct for.
create function reading_path_story_arc_issues(requested_story_arc_id uuid)
returns table (
  issue_id uuid,
  comicvine_id bigint,
  issue_number text,
  issue_name text,
  cover_date date,
  image_url text,
  volume_id uuid,
  volume_name text,
  volume_start_year integer,
  volume_issue_count integer,
  character_count integer,
  requested_character_count integer,
  story_arcs jsonb,
  creators jsonb
)
language sql stable as $$
  with bounded_issues as (
    select requested_arc.issue_id
    from issue_story_arcs requested_arc
    join issues candidate on candidate.id = requested_arc.issue_id
    where requested_arc.story_arc_id = requested_story_arc_id
    order by candidate.cover_date desc nulls last, requested_arc.issue_id
    limit 100
  )
  select
    i.id,
    i.comicvine_id,
    i.issue_number,
    i.name,
    i.cover_date,
    i.image_url,
    v.id,
    v.name,
    v.start_year,
    v.issue_count,
    (select count(*)::integer from issue_characters cast_members where cast_members.issue_id = i.id),
    0,
    coalesce(
      (
        select jsonb_agg(distinct jsonb_build_object(
          'id', sa.id, 'comicvineId', sa.comicvine_id, 'name', sa.name
        ))
        from issue_story_arcs link
        join story_arcs sa on sa.id = link.story_arc_id
        where link.issue_id = i.id
      ),
      '[]'::jsonb
    ),
    coalesce(
      (
        select jsonb_agg(distinct jsonb_build_object('name', person.name, 'role', link.role))
        from issue_creators link
        join creators person on person.id = link.creator_id
        where link.issue_id = i.id
          and lower(link.role) in ('writer', 'penciler', 'penciller', 'artist')
      ),
      '[]'::jsonb
    )
  from bounded_issues bounded
  join issues i on i.id = bounded.issue_id
  join volumes v on v.id = i.volume_id
  order by v.name, numeric_issue_number(i.issue_number) nulls last, i.issue_number;
$$;

comment on function reading_path_story_arc_issues(uuid) is
  'At most 100 recent locally ingested issues for one resolved story arc.';

-- Replaces the whole credit index for one character in a single statement.
create function replace_character_issue_credits(
  p_character_id uuid,
  p_comicvine_issue_ids bigint[]
) returns void
language plpgsql as $$
begin
  delete from character_issue_credits where character_id = p_character_id;

  insert into character_issue_credits (character_id, comicvine_issue_id)
  select p_character_id, distinct_id
  from unnest(coalesce(p_comicvine_issue_ids, '{}'::bigint[])) as distinct_id
  on conflict do nothing;

  update characters set credits_loaded_at = now() where id = p_character_id;
end;
$$;

-- Replaces creator links for a set of issues, mirroring replace_issue_relationships.
create function replace_issue_creators(
  p_issue_ids uuid[],
  p_creator_links jsonb
) returns void
language plpgsql as $$
begin
  delete from issue_creators where issue_id = any(p_issue_ids);

  insert into issue_creators (issue_id, creator_id, role)
  select (link->>'issue_id')::uuid, (link->>'creator_id')::uuid, link->>'role'
  from jsonb_array_elements(coalesce(p_creator_links, '[]'::jsonb)) as link
  on conflict do nothing;
end;
$$;

-- Replaces ComicVine's per-character appearance counts for one volume.
create function replace_volume_characters(
  p_volume_id uuid,
  p_character_counts jsonb
) returns void
language plpgsql as $$
begin
  delete from volume_characters where volume_id = p_volume_id;

  insert into volume_characters (volume_id, character_id, appearance_count)
  select p_volume_id, (entry->>'character_id')::uuid, (entry->>'appearance_count')::integer
  from jsonb_array_elements(coalesce(p_character_counts, '[]'::jsonb)) as entry
  on conflict do nothing;

  update volumes set details_loaded_at = now() where id = p_volume_id;
end;
$$;
