-- Give every shared volume a place in the candidate pool.
--
-- The bound took the 500 issues belonging to the volumes with the most
-- co-appearances, which sounds reasonable and is not: a seven-hundred-issue
-- ongoing title contributes hundreds of issues and fills the pool by itself. A
-- thirteen-issue miniseries — the shape of the stories people actually recommend,
-- The Long Halloween, The Dark Knight Returns — never reached the engine at all,
-- however well it would have scored.
--
-- Capping each volume's contribution means the pool spans many books rather than
-- being one book's worth of issues, and ranking gets to decide between them.
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
    -- A long ongoing contributes its opening stretch; a complete miniseries
    -- contributes all of itself.
    where position_in_volume <= 40
    order by co_issue_count desc, volume_id, position_in_volume
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
  'At most 500 issues containing every requested character, capped per volume so no single ongoing title fills the pool.';
