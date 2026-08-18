-- Fill the candidate pool a round at a time, not a volume at a time.
--
-- Capping each volume at forty issues was not enough. The pool was still filled
-- in order of how many co-appearances each volume had, so the seventeen biggest
-- titles took all five hundred slots and a thirteen-issue miniseries — which is
-- the shape of the stories people actually recommend — never got in.
--
-- Taking one issue from every volume, then a second from every volume, and so on
-- means a short complete book finishes early and is represented in full, while a
-- long ongoing keeps contributing only as long as there is room. The limit is
-- raised to leave space for a self-contained story to complete.
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
  from bounded_issues bounded
  join issues i on i.id = bounded.issue_id
  join volumes v on v.id = i.volume_id
  order by v.name, numeric_issue_number(i.issue_number) nulls last, i.issue_number;
$$;

comment on function reading_path_issue_candidates(uuid[]) is
  'At most 900 issues containing every requested character, filled round robin across volumes so a self-contained story is represented in full.';
