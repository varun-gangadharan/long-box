begin;

-- Acclaim must reach the engine, and must never become a tax on the books that
-- nothing has been recorded about — which is nearly all of them.

insert into publishers (id, comicvine_id, name)
values ('60000000-0000-0000-0000-000000000001', 601, 'Test Publisher');

insert into characters (id, comicvine_id, name, publisher_id, is_canonical, details_loaded_at)
values ('60000000-0000-0000-0000-000000000010', 610, 'Solo', '60000000-0000-0000-0000-000000000001', true, now());

insert into volumes (id, comicvine_id, name, start_year, issue_count, publisher_id) values
  ('60000000-0000-0000-0000-000000000020', 620, 'The Acclaimed Book', 1996, 13, '60000000-0000-0000-0000-000000000001'),
  ('60000000-0000-0000-0000-000000000021', 621, 'The Unknown Book', 1996, 13, '60000000-0000-0000-0000-000000000001'),
  ('60000000-0000-0000-0000-000000000022', 622, 'The Long Ongoing', 1940, 700, '60000000-0000-0000-0000-000000000001');

insert into issues (id, comicvine_id, volume_id, issue_number, cover_date)
select
  ('60000000-0000-0000-0000-0000000001' || lpad(number::text, 2, '0'))::uuid,
  6300 + number, '60000000-0000-0000-0000-000000000020', number::text, make_date(1996, number, 1)
from generate_series(1, 12) as number;

insert into issues (id, comicvine_id, volume_id, issue_number, cover_date)
select
  ('60000000-0000-0000-0000-0000000002' || lpad(number::text, 2, '0'))::uuid,
  6400 + number, '60000000-0000-0000-0000-000000000021', number::text, make_date(1996, number, 1)
from generate_series(1, 12) as number;

-- A landmark buried deep inside a long-running title, the shape of Year One.
insert into issues (id, comicvine_id, volume_id, issue_number, cover_date)
select
  ('60000000-0000-0000-0000-00000003' || lpad(number::text, 4, '0'))::uuid,
  6500 + number, '60000000-0000-0000-0000-000000000022', number::text, make_date(1987, ((number - 404) % 12) + 1, 1)
from generate_series(404, 407) as number;

-- Plus enough ordinary issues to push the landmark past any per-volume cap.
insert into issues (id, comicvine_id, volume_id, issue_number, cover_date)
select
  ('60000000-0000-0000-0000-00000004' || lpad(number::text, 4, '0'))::uuid,
  6600 + number, '60000000-0000-0000-0000-000000000022', number::text, make_date(1970, ((number - 1) % 12) + 1, 1)
from generate_series(1, 120) as number;

insert into issue_characters (issue_id, character_id)
select id, '60000000-0000-0000-0000-000000000010' from issues where comicvine_id between 6300 and 7000;

insert into volume_acclaim (volume_id, award_count, top_award, monthly_pageviews)
values ('60000000-0000-0000-0000-000000000020', 1, 'Eisner Award for Best Limited Series', 17836);

insert into issue_acclaim (issue_id, curated_tier, curated_story)
select id, 1, 'The Landmark' from issues where comicvine_id between 6904 and 6907;

do $$
declare
  requested uuid[] := array['60000000-0000-0000-0000-000000000010'::uuid];
  acclaimed jsonb;
  unknown_acclaim jsonb;
  landmark_issues integer;
begin
  -- Volume acclaim reaches the engine through the affinity row.
  select acclaim into acclaimed from volume_pair_affinity(requested)
  where volume_id = '60000000-0000-0000-0000-000000000020';
  if acclaimed is null or acclaimed->>'topAward' is null then
    raise exception 'volume acclaim did not reach the engine: %', acclaimed;
  end if;
  if (acclaimed->>'monthlyPageviews')::integer <> 17836 then
    raise exception 'readership did not reach the engine: %', acclaimed;
  end if;

  -- A book nothing is recorded about still appears, with no acclaim attached.
  select acclaim into unknown_acclaim from volume_pair_affinity(requested)
  where volume_id = '60000000-0000-0000-0000-000000000021';
  if unknown_acclaim is not null and unknown_acclaim <> 'null'::jsonb then
    raise exception 'unknown book was given acclaim data: %', unknown_acclaim;
  end if;
  if (select count(*) from reading_path_issue_candidates(requested)
      where volume_name = 'The Unknown Book') <> 12 then
    raise exception 'a book with no acclaim was dropped from the pool';
  end if;

  -- The landmark inside the long title must survive both the per-volume cap and
  -- the overall bound; ordering by issue number alone buried it entirely.
  select count(*) into landmark_issues
  from reading_path_issue_candidates(requested)
  where volume_name = 'The Long Ongoing'
    and issue_number in ('404', '405', '406', '407');
  if landmark_issues <> 4 then
    raise exception 'landmark issues deep in an ongoing title were cut: got %', landmark_issues;
  end if;
end;
$$;

rollback;
