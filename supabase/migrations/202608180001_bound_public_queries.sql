create or replace function reading_path_issue_candidates(requested_character_ids uuid[])
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
  character_count integer,
  requested_character_count integer,
  story_arcs jsonb
)
language sql stable as $$
  with requested as (
    select distinct unnest(requested_character_ids) as character_id
  ), matching_issues as (
    select ic.issue_id
    from issue_characters ic
    join requested r on r.character_id = ic.character_id
    join issues candidate on candidate.id = ic.issue_id
    group by ic.issue_id, candidate.cover_date
    having count(distinct ic.character_id) = (select count(*) from requested)
    order by candidate.cover_date desc nulls last, ic.issue_id
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
    count(distinct all_characters.character_id)::integer,
    (select count(*)::integer from requested),
    coalesce(
      jsonb_agg(
        distinct jsonb_build_object(
          'id', sa.id,
          'comicvineId', sa.comicvine_id,
          'name', sa.name
        )
      ) filter (where sa.id is not null),
      '[]'::jsonb
    )
  from matching_issues matched
  join issues i on i.id = matched.issue_id
  join volumes v on v.id = i.volume_id
  join issue_characters all_characters on all_characters.issue_id = i.id
  left join issue_story_arcs isa on isa.issue_id = i.id
  left join story_arcs sa on sa.id = isa.story_arc_id
  group by i.id, v.id
  order by i.cover_date desc nulls last, v.name, i.issue_number;
$$;

create or replace function reading_path_story_arc_issues(requested_story_arc_id uuid)
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
  character_count integer,
  requested_character_count integer,
  story_arcs jsonb
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
    count(distinct ic.character_id)::integer,
    0,
    coalesce(
      jsonb_agg(
        distinct jsonb_build_object(
          'id', all_arcs.id,
          'comicvineId', all_arcs.comicvine_id,
          'name', all_arcs.name
        )
      ) filter (where all_arcs.id is not null),
      '[]'::jsonb
    )
  from bounded_issues bounded
  join issues i on i.id = bounded.issue_id
  join volumes v on v.id = i.volume_id
  left join issue_characters ic on ic.issue_id = i.id
  left join issue_story_arcs all_issue_arcs on all_issue_arcs.issue_id = i.id
  left join story_arcs all_arcs on all_arcs.id = all_issue_arcs.story_arc_id
  group by i.id, v.id
  order by i.cover_date desc nulls last, v.name, i.issue_number;
$$;

comment on function reading_path_issue_candidates(uuid[]) is
  'Returns at most 500 recent issues containing every requested character.';
comment on function reading_path_story_arc_issues(uuid) is
  'Returns at most 100 recent locally ingested issues for one resolved story arc.';
