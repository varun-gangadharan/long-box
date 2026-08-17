create function resolve_story_arc_names(requested_names text[])
returns table (
  requested_name text,
  id uuid,
  comicvine_id bigint,
  name text,
  description text
)
language sql stable as $$
  with requested as (
    select value as requested_name,
      regexp_replace(lower(trim(value)), '[^a-z0-9]+', '', 'g') as normalized_name
    from unnest(requested_names) as value
  )
  select r.requested_name, sa.id, sa.comicvine_id, sa.name, sa.description
  from requested r
  join story_arcs sa
    on regexp_replace(lower(trim(sa.name)), '[^a-z0-9]+', '', 'g') = r.normalized_name
  order by r.requested_name, sa.name, sa.comicvine_id;
$$;

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
  character_count integer,
  requested_character_count integer,
  story_arcs jsonb
)
language sql stable as $$
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
  from issue_story_arcs requested_arc
  join issues i on i.id = requested_arc.issue_id
  join volumes v on v.id = i.volume_id
  left join issue_characters ic on ic.issue_id = i.id
  left join issue_story_arcs all_issue_arcs on all_issue_arcs.issue_id = i.id
  left join story_arcs all_arcs on all_arcs.id = all_issue_arcs.story_arc_id
  where requested_arc.story_arc_id = requested_story_arc_id
  group by i.id, v.id
  order by i.cover_date nulls last, v.name, i.issue_number;
$$;

comment on function reading_path_story_arc_issues(uuid) is
  'Returns all locally ingested issues attached to one resolved story arc.';
