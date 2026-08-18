-- Publisher on the affinity row.
--
-- ComicVine catalogs foreign-language reprint editions as separate volumes, and
-- they score identically to the originals on every co-appearance measure — a
-- Dutch or Spanish reprint of a run is, by definition, the same issues. Without
-- knowing who published a volume the engine cannot prefer the edition the
-- characters' own publisher put out, and reprints crowd out the originals.
drop function if exists volume_pair_affinity(uuid[]);

create function volume_pair_affinity(requested_character_ids uuid[])
returns table (
  volume_id uuid,
  volume_name text,
  volume_start_year integer,
  volume_issue_count integer,
  volume_publisher_name text,
  local_issue_count integer,
  co_issue_count integer,
  min_character_appearances integer,
  longest_co_streak integer,
  first_co_issue_number text,
  last_co_issue_number text,
  first_co_date date,
  last_co_date date,
  top_writer text,
  top_artist text
)
language sql stable as $$
  with requested as (
    select distinct unnest(requested_character_ids) as character_id
  ), requested_total as (
    select count(*) as total from requested
  ), co_issues as (
    select
      i.id as issue_id,
      i.volume_id,
      i.issue_number,
      i.cover_date,
      numeric_issue_number(i.issue_number) as numeric_number
    from co_appearance_issues(requested_character_ids) matched
    join issues i on i.id = matched.issue_id
  ), islands as (
    select
      volume_id,
      numeric_number
        - row_number() over (partition by volume_id order by numeric_number) as island
    from co_issues
    where numeric_number is not null
  ), longest as (
    select volume_id, max(streak)::integer as longest_co_streak
    from (
      select volume_id, island, count(*) as streak
      from islands
      group by volume_id, island
    ) counted
    group by volume_id
  ), bounds as (
    select
      volume_id,
      count(*)::integer as co_issue_count,
      min(cover_date) as first_co_date,
      max(cover_date) as last_co_date,
      (array_agg(issue_number order by numeric_number nulls last, cover_date nulls last))[1]
        as first_co_issue_number,
      (array_agg(issue_number order by numeric_number desc nulls last, cover_date desc nulls last))[1]
        as last_co_issue_number
    from co_issues
    group by volume_id
  ), local_totals as (
    select volume_id, count(*)::integer as local_issue_count
    from issues
    group by volume_id
  ), character_presence as (
    select
      vc.volume_id,
      min(vc.appearance_count)::integer as min_character_appearances,
      count(*) as covered_characters
    from volume_characters vc
    join requested on requested.character_id = vc.character_id
    group by vc.volume_id
  ), creator_ranks as (
    select
      co.volume_id,
      case when lower(link.role) = 'writer' then 'writer' else 'artist' end as role_group,
      person.name,
      count(*) as credited_issues,
      row_number() over (
        partition by co.volume_id,
          case when lower(link.role) = 'writer' then 'writer' else 'artist' end
        order by count(*) desc, person.name
      ) as position
    from co_issues co
    join issue_creators link on link.issue_id = co.issue_id
    join creators person on person.id = link.creator_id
    where lower(link.role) in ('writer', 'penciler', 'penciller', 'artist')
    group by co.volume_id, role_group, person.name
  )
  select
    v.id,
    v.name,
    v.start_year,
    v.issue_count,
    publisher.name,
    coalesce(local_totals.local_issue_count, 0),
    bounds.co_issue_count,
    case
      when character_presence.covered_characters = (select total from requested_total)
        then character_presence.min_character_appearances
      else null
    end,
    coalesce(longest.longest_co_streak, 1),
    bounds.first_co_issue_number,
    bounds.last_co_issue_number,
    bounds.first_co_date,
    bounds.last_co_date,
    (select name from creator_ranks where volume_id = v.id and role_group = 'writer' and position = 1),
    (select name from creator_ranks where volume_id = v.id and role_group = 'artist' and position = 1)
  from bounds
  join volumes v on v.id = bounds.volume_id
  left join publishers publisher on publisher.id = v.publisher_id
  left join longest on longest.volume_id = v.id
  left join local_totals on local_totals.volume_id = v.id
  left join character_presence on character_presence.volume_id = v.id
  order by bounds.co_issue_count desc, v.start_year nulls last, v.name;
$$;

comment on function volume_pair_affinity(uuid[]) is
  'Per-volume co-appearance profile, including publisher so original editions can be told from reprints.';
