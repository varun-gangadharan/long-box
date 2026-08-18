-- Name matches outrank alias matches, and a canonical claim can be taken over.
--
-- Alias resolution fixed one bug and introduced another: Dick Grayson lists
-- "Batman" among his aliases, so once aliases were matchable he answered to a
-- name that is not his. A character's own name must therefore win over anyone
-- who merely lists it, and aliases only decide when nothing is named that way.
--
-- Separately, `characters_canonical_name_idx` allows one canonical row per name,
-- and it can be held by a stub created from an issue credit — an obscure
-- "Superman" with 38 appearances outranking the real one. Promotion has to be
-- able to take that claim, which needs the demotion and the promotion to happen
-- together.

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
    -- A character called by this name comes before one who merely lists it.
    (regexp_replace(lower(trim(c.name)), '[^a-z0-9]+', '', 'g') <> r.normalized_name),
    c.is_canonical desc,
    c.issue_appearance_count desc nulls last,
    c.name,
    c.comicvine_id;
$$;

comment on function resolve_character_names(text[]) is
  'Resolves characters by name first, then alias, most-published first within each.';

-- Makes one character the canonical owner of its name, taking the claim from a
-- less-published holder. Atomic, so the unique index is never briefly violated.
create function promote_canonical_character(p_comicvine_id bigint)
returns void
language plpgsql as $$
declare
  target_name text;
begin
  select regexp_replace(lower(trim(name)), '[^a-z0-9]+', '', 'g')
    into target_name
  from characters
  where comicvine_id = p_comicvine_id;

  if target_name is null then
    raise exception 'Character % not found', p_comicvine_id;
  end if;

  update characters
  set is_canonical = false
  where is_canonical
    and comicvine_id <> p_comicvine_id
    and regexp_replace(lower(trim(name)), '[^a-z0-9]+', '', 'g') = target_name;

  update characters set is_canonical = true where comicvine_id = p_comicvine_id;
end;
$$;

comment on function promote_canonical_character(bigint) is
  'Marks a character as the canonical owner of its normalized name, demoting any previous holder.';
