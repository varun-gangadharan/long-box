-- Remembers which names have already been looked up on ComicVine.
--
-- A name that only ever resolves through an alias — "Nightwing" belongs to Dick
-- Grayson, and nobody is published under it — otherwise sends every single
-- request off to ComicVine to look for a better match that does not exist. That
-- is a round trip on the critical path and a slice of a 200-per-hour budget,
-- repeated forever. The answer is stable, so it only needs asking once.
create table name_searches (
  normalized_name text primary key,
  searched_at timestamptz not null default now()
);

alter table name_searches enable row level security;

comment on table name_searches is
  'Names already searched on ComicVine, so a name with no better match is not looked up repeatedly.';

-- `details_loaded_at` marks a character fetched in its own right, as opposed to
-- a stub created from another issue's credit list. It is the honest test of
-- whether an identity is settled; appearance count is merely a column that
-- happens to be null on older rows.
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
  alias_position integer,
  has_details boolean
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
    array_position(normalized_aliases(c.aliases), r.normalized_name)::integer,
    c.details_loaded_at is not null
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
  'Resolves characters by name or alias, reporting which matched, how prominent the alias is, and whether the row was fetched in its own right.';
