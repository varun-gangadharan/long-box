-- Acclaim: whether a book is any good, as opposed to whether it fits.
--
-- Every existing ranking feature is structural — who is in it, how long it runs,
-- where it starts. Two books of the same shape are indistinguishable, so an
-- Eisner-winning landmark ties with a competent forgotten one. Separating them
-- needs a different kind of evidence, and it has to come from outside ComicVine.
--
-- Wikidata carries property P5905, "Comic Vine ID", whose values are prefixed by
-- ComicVine's own resource type — "4050-6822" is a volume, "4000-..." an issue —
-- so external notability joins onto these tables by exact id rather than by
-- matching titles. Wikidata is CC0, so the values can be stored freely.
--
-- Coverage is real but partial: about 1,150 volumes and 2,000 issues in all of
-- Wikidata carry such an id. Everything else has no row here at all, and the
-- engine must treat that absence as unknown rather than as poor.

create table volume_acclaim (
  volume_id uuid primary key references volumes(id) on delete cascade,
  wikidata_id text,
  wikipedia_title text,
  monthly_pageviews integer,
  award_count integer not null default 0,
  top_award text,
  -- 1 canonical landmark, 2 strongly acclaimed, 3 notable. Editorial judgement
  -- from data/acclaimed-stories.json, kept separate from the sourced columns so
  -- the two are never confused for one another.
  curated_tier integer,
  curated_story text,
  refreshed_at timestamptz not null default now()
);

-- The stories people actually name are often a run inside an ongoing title
-- rather than a book of their own: Year One is Batman #404-407, Hush is
-- #608-619. Volume-level acclaim cannot tell those apart from the seven hundred
-- issues around them, so acclaim is recorded per issue as well.
create table issue_acclaim (
  issue_id uuid primary key references issues(id) on delete cascade,
  wikidata_id text,
  wikipedia_title text,
  monthly_pageviews integer,
  award_count integer not null default 0,
  top_award text,
  curated_tier integer,
  curated_story text,
  refreshed_at timestamptz not null default now()
);

create index volume_acclaim_curated_idx on volume_acclaim (curated_tier);
create index issue_acclaim_curated_idx on issue_acclaim (curated_tier);

alter table volume_acclaim enable row level security;
alter table issue_acclaim enable row level security;

-- Replaces the acclaim rows for one batch of volumes or issues, mirroring
-- replace_issue_relationships so the enrichment job stays idempotent.
create function replace_volume_acclaim(p_rows jsonb)
returns integer
language plpgsql as $$
declare
  affected integer;
begin
  insert into volume_acclaim (
    volume_id, wikidata_id, wikipedia_title, monthly_pageviews,
    award_count, top_award, curated_tier, curated_story, refreshed_at
  )
  select
    (row->>'volume_id')::uuid,
    row->>'wikidata_id',
    row->>'wikipedia_title',
    (row->>'monthly_pageviews')::integer,
    coalesce((row->>'award_count')::integer, 0),
    row->>'top_award',
    (row->>'curated_tier')::integer,
    row->>'curated_story',
    now()
  from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) as row
  on conflict (volume_id) do update set
    wikidata_id = coalesce(excluded.wikidata_id, volume_acclaim.wikidata_id),
    wikipedia_title = coalesce(excluded.wikipedia_title, volume_acclaim.wikipedia_title),
    monthly_pageviews = coalesce(excluded.monthly_pageviews, volume_acclaim.monthly_pageviews),
    award_count = greatest(excluded.award_count, volume_acclaim.award_count),
    top_award = coalesce(excluded.top_award, volume_acclaim.top_award),
    curated_tier = coalesce(excluded.curated_tier, volume_acclaim.curated_tier),
    curated_story = coalesce(excluded.curated_story, volume_acclaim.curated_story),
    refreshed_at = now();

  get diagnostics affected = row_count;
  return affected;
end;
$$;

create function replace_issue_acclaim(p_rows jsonb)
returns integer
language plpgsql as $$
declare
  affected integer;
begin
  insert into issue_acclaim (
    issue_id, wikidata_id, wikipedia_title, monthly_pageviews,
    award_count, top_award, curated_tier, curated_story, refreshed_at
  )
  select
    (row->>'issue_id')::uuid,
    row->>'wikidata_id',
    row->>'wikipedia_title',
    (row->>'monthly_pageviews')::integer,
    coalesce((row->>'award_count')::integer, 0),
    row->>'top_award',
    (row->>'curated_tier')::integer,
    row->>'curated_story',
    now()
  from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) as row
  on conflict (issue_id) do update set
    wikidata_id = coalesce(excluded.wikidata_id, issue_acclaim.wikidata_id),
    wikipedia_title = coalesce(excluded.wikipedia_title, issue_acclaim.wikipedia_title),
    monthly_pageviews = coalesce(excluded.monthly_pageviews, issue_acclaim.monthly_pageviews),
    award_count = greatest(excluded.award_count, issue_acclaim.award_count),
    top_award = coalesce(excluded.top_award, issue_acclaim.top_award),
    curated_tier = coalesce(excluded.curated_tier, issue_acclaim.curated_tier),
    curated_story = coalesce(excluded.curated_story, issue_acclaim.curated_story),
    refreshed_at = now();

  get diagnostics affected = row_count;
  return affected;
end;
$$;

comment on table volume_acclaim is
  'External recognition for a volume, joined from Wikidata by exact Comic Vine id, plus curated editorial tiers.';
comment on table issue_acclaim is
  'External recognition for a single issue, so a landmark run inside an ongoing title can be told from the issues around it.';

-- The engine needs acclaim alongside the data it already fetches; a separate
-- query on the request path would add latency to the slowest page in the product.
drop function if exists reading_path_issue_candidates(uuid[]);

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
  creators jsonb,
  acclaim jsonb
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
  ), ranked_within_volume as (
    select
      matched.issue_id,
      i.volume_id,
      w.co_issue_count,
      row_number() over (
        partition by i.volume_id
        order by numeric_issue_number(i.issue_number) nulls last, i.cover_date nulls last, matched.issue_id
      ) as position_in_volume
    from matching_issues matched
    join issues i on i.id = matched.issue_id
    join volume_weight w on w.volume_id = i.volume_id
  ), bounded_issues as (
    select issue_id
    from ranked_within_volume
    where position_in_volume <= 40
    -- Round robin: every volume's opening issue, then every volume's second, and
    -- so on. Weight only breaks ties within a round.
    order by position_in_volume, co_issue_count desc, volume_id
    limit 900
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
    ,
    coalesce(
      (
        select jsonb_build_object(
          'curatedTier', a.curated_tier,
          'curatedStory', a.curated_story,
          'awardCount', a.award_count,
          'topAward', a.top_award,
          'monthlyPageviews', a.monthly_pageviews
        )
        from issue_acclaim a
        where a.issue_id = i.id
      ),
      'null'::jsonb
    )
  from bounded_issues bounded
  join issues i on i.id = bounded.issue_id
  join volumes v on v.id = i.volume_id
  order by v.name, numeric_issue_number(i.issue_number) nulls last, i.issue_number;
$$;

comment on function reading_path_issue_candidates(uuid[]) is
  'At most 900 issues containing every requested character, filled round robin across volumes, with per-issue acclaim.';

drop function if exists volume_pair_affinity(uuid[]);

create function volume_pair_affinity(requested_character_ids uuid[])
returns table (
  volume_id uuid,
  volume_name text,
  volume_start_year integer,
  volume_issue_count integer,
  volume_publisher_name text,
  local_issue_count integer,
  co_issue_count integer,
  min_character_appearances integer,
  longest_co_streak integer,
  first_co_issue_number text,
  last_co_issue_number text,
  first_co_date date,
  last_co_date date,
  top_writer text,
  top_artist text,
  acclaim jsonb
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
    publisher.name,
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
    (select name from creator_ranks where volume_id = v.id and role_group = 'artist' and position = 1),
    coalesce(
      (
        select jsonb_build_object(
          'curatedTier', a.curated_tier,
          'curatedStory', a.curated_story,
          'awardCount', a.award_count,
          'topAward', a.top_award,
          'monthlyPageviews', a.monthly_pageviews
        )
        from volume_acclaim a
        where a.volume_id = v.id
      ),
      'null'::jsonb
    )
  from bounds
  join volumes v on v.id = bounds.volume_id
  left join publishers publisher on publisher.id = v.publisher_id
  left join longest on longest.volume_id = v.id
  left join local_totals on local_totals.volume_id = v.id
  left join character_presence on character_presence.volume_id = v.id
  order by bounds.co_issue_count desc, v.start_year nulls last, v.name;
$$;

comment on function volume_pair_affinity(uuid[]) is
  'Per-volume co-appearance profile, publisher, and external acclaim.';
