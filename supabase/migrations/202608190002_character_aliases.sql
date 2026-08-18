-- Character identity by alias, not just by name.
--
-- ComicVine files many characters under a civilian name: Dick Grayson is "Dick
-- Grayson", and "Nightwing" is one of his aliases. Resolving on `name` alone
-- therefore matched an obscure character with a single appearance instead of the
-- one with ten thousand, and every recommendation downstream inherited that
-- mistake. Aliases are stored so they can be matched, and appearance counts
-- decide between characters who genuinely share a name.

alter table characters add column aliases text[] not null default '{}';
alter table characters add column issue_appearance_count integer;

-- Normalized aliases, matching the name-normalization used everywhere else.
create function normalized_aliases(aliases text[])
returns text[]
language sql immutable as $$
  select coalesce(
    array_agg(regexp_replace(lower(trim(alias)), '[^a-z0-9]+', '', 'g'))
      filter (where trim(coalesce(alias, '')) <> ''),
    '{}'::text[]
  )
  from unnest(coalesce(aliases, '{}'::text[])) as alias;
$$;

create index characters_normalized_aliases_idx
  on characters using gin (normalized_aliases(aliases));

-- Resolution now matches a requested name against the character's name or any
-- of its aliases. Where several characters answer to a name, the one with the
-- most published appearances is listed first: asking for "Nightwing" means the
-- character who has been in thousands of comics, not the one who was in one.
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
  matched_alias boolean
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
    regexp_replace(lower(trim(c.name)), '[^a-z0-9]+', '', 'g') <> r.normalized_name
  from requested r
  join characters c
    on regexp_replace(lower(trim(c.name)), '[^a-z0-9]+', '', 'g') = r.normalized_name
    or r.normalized_name = any(normalized_aliases(c.aliases))
  left join publishers p on p.id = c.publisher_id
  order by
    r.requested_name,
    c.is_canonical desc,
    c.issue_appearance_count desc nulls last,
    c.name,
    c.comicvine_id;
$$;

comment on function resolve_character_names(text[]) is
  'Resolves characters by name or alias, most-published first.';
