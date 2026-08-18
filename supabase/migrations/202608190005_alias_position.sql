-- Where in a character's alias list the requested name sits.
--
-- ComicVine orders aliases roughly by prominence, which is the only thing that
-- separates the character a name belongs to from a bigger character who happens
-- to have used it. "Nightwing" is Dick Grayson's second alias and Superman's
-- sixth; without the position, Superman's larger body of work wins and the
-- lookup returns the wrong character.
drop function if exists resolve_character_names(text[]);

create function resolve_character_names(requested_names text[])
returns table (
  requested_name text,
  id uuid,
  comicvine_id bigint,
  name text,
  description text,
  image_url text,
  publisher_name text,
  is_canonical boolean,
  issue_appearance_count integer,
  matched_alias boolean,
  alias_position integer
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
    c.is_canonical,
    c.issue_appearance_count,
    regexp_replace(lower(trim(c.name)), '[^a-z0-9]+', '', 'g') <> r.normalized_name,
    -- 1-based, or null when the character is named by the request.
    array_position(normalized_aliases(c.aliases), r.normalized_name)::integer
  from requested r
  join characters c
    on regexp_replace(lower(trim(c.name)), '[^a-z0-9]+', '', 'g') = r.normalized_name
    or r.normalized_name = any(normalized_aliases(c.aliases))
  left join publishers p on p.id = c.publisher_id
  order by
    r.requested_name,
    (regexp_replace(lower(trim(c.name)), '[^a-z0-9]+', '', 'g') <> r.normalized_name),
    c.is_canonical desc,
    c.issue_appearance_count desc nulls last,
    c.name,
    c.comicvine_id;
$$;

comment on function resolve_character_names(text[]) is
  'Resolves characters by name or alias, reporting which matched and how prominent the alias is.';
