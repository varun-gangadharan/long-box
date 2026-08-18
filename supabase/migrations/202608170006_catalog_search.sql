create function search_catalog(search_term text, result_limit integer default 8)
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
      c.description,
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
      sa.description,
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
