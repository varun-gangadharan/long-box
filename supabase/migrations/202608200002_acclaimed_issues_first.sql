-- Let a known landmark into the candidate pool.
--
-- The pool takes forty issues per volume, ordered by issue number, which is fine
-- for a miniseries and wrong for an ongoing title: Batman: Year One is issues
-- 404 to 407 of a seven-hundred-issue run, so it never came within four hundred
-- places of being considered. Anything with an acclaim row is pulled to the
-- front of its volume's queue, since a story we already know matters is exactly
-- what the pool should contain.
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
        order by
          -- An issue we already know is a landmark goes to the front of its
          -- volume's queue. Year One is Batman #404-407, and ordering purely by
          -- issue number buries it four hundred issues deep in a title whose
          -- first forty are all the pool has room for.
          (select 0 from issue_acclaim a where a.issue_id = i.id) nulls last,
          numeric_issue_number(i.issue_number) nulls last,
          i.cover_date nulls last,
          matched.issue_id
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
  'At most 900 issues containing every requested character, filled round robin across volumes, with acclaimed issues first within each volume.';
