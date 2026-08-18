-- Sample the co-appearance list inside the database.
--
-- PostgREST caps a function result at a thousand rows, and this function orders
-- by ComicVine id, so a character with twenty-five thousand appearances silently
-- returned only the lowest ids — the earliest-catalogued material. Every
-- recommendation for Batman came back as Golden Age filler for that reason
-- alone, and nothing downstream could tell it had been truncated.
--
-- Sampling here instead of in the caller keeps the result under the cap by
-- construction and spreads it across the character's whole publication history.
drop function if exists co_appearance_issue_ids(uuid[]);

create function co_appearance_issue_ids(
  requested_character_ids uuid[],
  sample_limit integer default 1200
)
returns table (comicvine_issue_id bigint)
language sql stable as $$
  with requested as (
    select distinct unnest(requested_character_ids) as character_id
  ), matched as (
    select credits.comicvine_issue_id
    from character_issue_credits credits
    join requested on requested.character_id = credits.character_id
    group by credits.comicvine_issue_id
    having count(distinct credits.character_id) = (select count(*) from requested)
  ), ordered as (
    select
      matched.comicvine_issue_id,
      row_number() over (order by matched.comicvine_issue_id) - 1 as position,
      count(*) over () as total
    from matched
  )
  select ordered.comicvine_issue_id
  from ordered
  where ordered.total <= greatest(sample_limit, 1)
    or ordered.position % greatest(1, ordered.total / greatest(sample_limit, 1)) = 0
  order by ordered.comicvine_issue_id
  limit greatest(sample_limit, 1);
$$;

comment on function co_appearance_issue_ids(uuid[], integer) is
  'ComicVine issue IDs where every requested character is credited, sampled evenly across the whole range so the result is never a truncated prefix.';
