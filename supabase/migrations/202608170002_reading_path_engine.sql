alter table characters add column details_loaded_at timestamptz;

create index characters_name_normalized_idx on characters (
  (regexp_replace(lower(trim(name)), '[^a-z0-9]+', '', 'g'))
);
create index story_arcs_name_normalized_idx on story_arcs (
  (regexp_replace(lower(trim(name)), '[^a-z0-9]+', '', 'g'))
);

create function resolve_character_names(requested_names text[])
returns table (
  requested_name text,
  id uuid,
  comicvine_id bigint,
  name text,
  description text,
  image_url text,
  publisher_name text,
  details_loaded_at timestamptz
)
language sql stable as $$
  with requested as (
    select value as requested_name,
      regexp_replace(lower(trim(value)), '[^a-z0-9]+', '', 'g') as normalized_name
    from unnest(requested_names) as value
  )
  select
    r.requested_name,
    c.id,
    c.comicvine_id,
    c.name,
    c.description,
    c.image_url,
    p.name,
    c.details_loaded_at
  from requested r
  join characters c
    on regexp_replace(lower(trim(c.name)), '[^a-z0-9]+', '', 'g') = r.normalized_name
  left join publishers p on p.id = c.publisher_id
  order by r.requested_name, c.name, c.comicvine_id;
$$;

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
    group by ic.issue_id
    having count(distinct ic.character_id) = (select count(*) from requested)
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
  order by i.cover_date nulls last, v.name, i.issue_number;
$$;

comment on function resolve_character_names(text[]) is
  'Resolves punctuation-insensitive exact character names and preserves ambiguous matches.';
comment on function reading_path_issue_candidates(uuid[]) is
  'Returns issues containing every requested character with volume, density, and story-arc facts.';
