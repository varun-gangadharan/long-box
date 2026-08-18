begin;

-- A deliberately Nightwing/Starfire-shaped fixture: one team book the pair
-- co-stars in across a contiguous run, and one long-running title where one of
-- them makes a single guest appearance. The affinity function must be able to
-- tell those apart.

insert into publishers (id, comicvine_id, name)
values ('50000000-0000-0000-0000-000000000001', 501, 'Test Publisher');

insert into characters (id, comicvine_id, name, publisher_id) values
  ('50000000-0000-0000-0000-000000000010', 510, 'Acrobat', '50000000-0000-0000-0000-000000000001'),
  ('50000000-0000-0000-0000-000000000011', 511, 'Comet', '50000000-0000-0000-0000-000000000001');

insert into volumes (id, comicvine_id, name, start_year, issue_count, publisher_id) values
  ('50000000-0000-0000-0000-000000000020', 520, 'The Team Book', 1980, 10, '50000000-0000-0000-0000-000000000001'),
  ('50000000-0000-0000-0000-000000000021', 521, 'The Long Title', 1940, 700, '50000000-0000-0000-0000-000000000001');

-- Team book: eight contiguous issues, both characters in every one.
insert into issues (id, comicvine_id, volume_id, issue_number, cover_date)
select
  ('50000000-0000-0000-0000-0000000001' || lpad(number::text, 2, '0'))::uuid,
  5300 + number,
  '50000000-0000-0000-0000-000000000020',
  number::text,
  make_date(1980, number, 1)
from generate_series(1, 8) as number;

-- Long title: one issue, one guest appearance by each.
insert into issues (id, comicvine_id, volume_id, issue_number, cover_date)
values ('50000000-0000-0000-0000-000000000200', 5400, '50000000-0000-0000-0000-000000000021', '415', '1988-06-01');

insert into issue_characters (issue_id, character_id)
select i.id, c.id
from issues i
cross join characters c
where i.comicvine_id between 5301 and 5308
  and c.id in ('50000000-0000-0000-0000-000000000010', '50000000-0000-0000-0000-000000000011');

insert into issue_characters (issue_id, character_id) values
  ('50000000-0000-0000-0000-000000000200', '50000000-0000-0000-0000-000000000010'),
  ('50000000-0000-0000-0000-000000000200', '50000000-0000-0000-0000-000000000011');

insert into creators (id, comicvine_id, name) values
  ('50000000-0000-0000-0000-000000000030', 530, 'Test Writer'),
  ('50000000-0000-0000-0000-000000000031', 531, 'Test Artist');

insert into issue_creators (issue_id, creator_id, role)
select i.id, '50000000-0000-0000-0000-000000000030', 'writer'
from issues i where i.comicvine_id between 5301 and 5308;

insert into issue_creators (issue_id, creator_id, role)
select i.id, '50000000-0000-0000-0000-000000000031', 'penciler'
from issues i where i.comicvine_id between 5301 and 5308;

-- Credit index: the pair genuinely co-appears in the nine issues above, and
-- Acrobat alone has a tenth appearance that is not a co-appearance.
insert into character_issue_credits (character_id, comicvine_issue_id)
select '50000000-0000-0000-0000-000000000010', comicvine_id from issues
where comicvine_id between 5301 and 5308 or comicvine_id = 5400;
insert into character_issue_credits (character_id, comicvine_issue_id)
values ('50000000-0000-0000-0000-000000000010', 9999);

insert into character_issue_credits (character_id, comicvine_issue_id)
select '50000000-0000-0000-0000-000000000011', comicvine_id from issues
where comicvine_id between 5301 and 5308 or comicvine_id = 5400;

-- ComicVine's per-volume character counts: both are regulars in the team book,
-- both are one-issue guests in the long-running title.
insert into volume_characters (volume_id, character_id, appearance_count) values
  ('50000000-0000-0000-0000-000000000020', '50000000-0000-0000-0000-000000000010', 8),
  ('50000000-0000-0000-0000-000000000020', '50000000-0000-0000-0000-000000000011', 8),
  ('50000000-0000-0000-0000-000000000021', '50000000-0000-0000-0000-000000000010', 1),
  ('50000000-0000-0000-0000-000000000021', '50000000-0000-0000-0000-000000000011', 1);

do $$
declare
  requested uuid[] := array[
    '50000000-0000-0000-0000-000000000010'::uuid,
    '50000000-0000-0000-0000-000000000011'::uuid
  ];
  co_ids bigint[];
  team record;
  long_title record;
  first_volume_name text;
  candidate_creators jsonb;
begin
  -- The credit index intersection returns only shared appearances, never the
  -- solo credit, and does not depend on which issues were ingested in detail.
  select array_agg(comicvine_issue_id order by comicvine_issue_id)
    into co_ids
  from co_appearance_issue_ids(requested);
  if array_length(co_ids, 1) <> 9 then
    raise exception 'co-appearance intersection failed: got %', array_length(co_ids, 1);
  end if;
  if 9999 = any(co_ids) then
    raise exception 'co-appearance intersection leaked a solo credit';
  end if;

  select * into team from volume_pair_affinity(requested)
  where volume_id = '50000000-0000-0000-0000-000000000020';
  select * into long_title from volume_pair_affinity(requested)
  where volume_id = '50000000-0000-0000-0000-000000000021';

  if team.co_issue_count <> 8 then
    raise exception 'team book co-appearance count failed: got %', team.co_issue_count;
  end if;
  if team.longest_co_streak <> 8 then
    raise exception 'contiguous streak detection failed: got %', team.longest_co_streak;
  end if;
  if team.first_co_issue_number <> '1' or team.last_co_issue_number <> '8' then
    raise exception 'run bounds failed: got % to %',
      team.first_co_issue_number, team.last_co_issue_number;
  end if;
  if team.top_writer <> 'Test Writer' or team.top_artist <> 'Test Artist' then
    raise exception 'creative team detection failed: got % / %',
      team.top_writer, team.top_artist;
  end if;

  -- The weakest member's appearance count is what the engine reads as core-cast
  -- strength, so a volume only scores high when both characters are regulars.
  if team.min_character_appearances <> 8 then
    raise exception 'core-cast strength failed: got %', team.min_character_appearances;
  end if;
  if long_title.min_character_appearances <> 1 then
    raise exception 'guest-spot strength failed: got %', long_title.min_character_appearances;
  end if;

  -- The core-cast ratio is what separates a co-starring book from a guest spot.
  if team.co_issue_count::numeric / team.volume_issue_count <= 0.5 then
    raise exception 'team book core-cast ratio too low: %',
      team.co_issue_count::numeric / team.volume_issue_count;
  end if;
  if long_title.co_issue_count::numeric / long_title.volume_issue_count >= 0.01 then
    raise exception 'guest appearance ratio too high: %',
      long_title.co_issue_count::numeric / long_title.volume_issue_count;
  end if;

  -- The candidate bound must lead with the volume the pair actually shares,
  -- rather than with the most recent issue as it did before.
  select volume_name into first_volume_name
  from reading_path_issue_candidates(requested)
  order by 1 limit 1;
  if first_volume_name is null then
    raise exception 'candidate query returned no rows';
  end if;

  -- Both evidence sources count. Deleting the credit index must not lose a
  -- co-appearance that issue_characters already proves.
  delete from character_issue_credits;
  if (select count(*) from co_appearance_issues(requested)) <> 9 then
    raise exception 'issue-credit evidence alone failed: got %',
      (select count(*) from co_appearance_issues(requested));
  end if;

  select creators into candidate_creators
  from reading_path_issue_candidates(requested)
  where issue_number = '1' and volume_name = 'The Team Book';
  if jsonb_array_length(candidate_creators) <> 2 then
    raise exception 'candidate creator payload failed: got %', candidate_creators;
  end if;
end;
$$;

rollback;
