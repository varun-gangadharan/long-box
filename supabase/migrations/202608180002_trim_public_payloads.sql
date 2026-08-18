create or replace function resolve_character_names(requested_names text[])
returns table (
  requested_name text,
  id uuid,
  comicvine_id bigint,
  name text,
  description text,
  image_url text,
  publisher_name text,
  is_canonical boolean
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
    null::text,
    c.image_url,
    p.name,
    c.is_canonical
  from requested r
  join characters c
    on regexp_replace(lower(trim(c.name)), '[^a-z0-9]+', '', 'g') = r.normalized_name
  left join publishers p on p.id = c.publisher_id
  order by r.requested_name, c.is_canonical desc, c.name, c.comicvine_id;
$$;

create or replace function resolve_story_arc_names(requested_names text[])
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
  select r.requested_name, sa.id, sa.comicvine_id, sa.name, null::text
  from requested r
  join story_arcs sa
    on regexp_replace(lower(trim(sa.name)), '[^a-z0-9]+', '', 'g') = r.normalized_name
  order by r.requested_name, sa.name, sa.comicvine_id;
$$;

create or replace function search_catalog(search_term text, result_limit integer default 8)
returns table (
  entity_type text,
  id uuid,
  comicvine_id bigint,
  name text,
  description text,
  image_url text,
  context text
)
language sql stable as $$
  with input as (
    select regexp_replace(lower(trim(search_term)), '[^a-z0-9]+', '', 'g') as normalized
  ), matches as (
    select
      'character'::text as entity_type,
      c.id,
      c.comicvine_id,
      c.name,
      null::text as description,
      c.image_url,
      p.name as context,
      case
        when regexp_replace(lower(trim(c.name)), '[^a-z0-9]+', '', 'g') = input.normalized then 0
        when regexp_replace(lower(trim(c.name)), '[^a-z0-9]+', '', 'g') like input.normalized || '%' then 1
        else 2
      end as rank
    from characters c
    cross join input
    left join publishers p on p.id = c.publisher_id
    where c.is_canonical
      and regexp_replace(lower(trim(c.name)), '[^a-z0-9]+', '', 'g') like '%' || input.normalized || '%'

    union all

    select
      'story_arc'::text,
      sa.id,
      sa.comicvine_id,
      sa.name,
      null::text,
      null::text,
      'Story arc'::text,
      case
        when regexp_replace(lower(trim(sa.name)), '[^a-z0-9]+', '', 'g') = input.normalized then 0
        when regexp_replace(lower(trim(sa.name)), '[^a-z0-9]+', '', 'g') like input.normalized || '%' then 1
        else 2
      end
    from story_arcs sa
    cross join input
    where regexp_replace(lower(trim(sa.name)), '[^a-z0-9]+', '', 'g') like '%' || input.normalized || '%'
  )
  select entity_type, id, comicvine_id, name, description, image_url, context
  from matches
  order by rank, name, comicvine_id
  limit greatest(1, least(result_limit, 20));
$$;

comment on function resolve_character_names(text[]) is
  'Resolves character identities without returning unused large HTML descriptions.';
comment on function resolve_story_arc_names(text[]) is
  'Resolves story arcs without returning unused descriptions.';
comment on function search_catalog(text, integer) is
  'Searches canonical characters and story arcs without returning unused descriptions.';
