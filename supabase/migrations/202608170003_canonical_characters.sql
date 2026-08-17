alter table characters add column is_canonical boolean not null default false;

update characters set is_canonical = true where details_loaded_at is not null;

create unique index characters_canonical_name_idx on characters (
  (regexp_replace(lower(trim(name)), '[^a-z0-9]+', '', 'g'))
) where is_canonical;

drop function resolve_character_names(text[]);

create function resolve_character_names(requested_names text[])
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
    c.description,
    c.image_url,
    p.name,
    c.is_canonical
  from requested r
  join characters c
    on regexp_replace(lower(trim(c.name)), '[^a-z0-9]+', '', 'g') = r.normalized_name
  left join publishers p on p.id = c.publisher_id
  order by r.requested_name, c.is_canonical desc, c.name, c.comicvine_id;
$$;

comment on column characters.is_canonical is
  'Marks the single catalog-selected identity for a normalized name; same-name alternatives remain ambiguous choices.';
