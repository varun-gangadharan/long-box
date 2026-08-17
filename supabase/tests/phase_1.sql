begin;

insert into publishers (id, comicvine_id, name)
values ('00000000-0000-0000-0000-000000000001', 1, 'Test Publisher');

insert into characters (id, comicvine_id, name, publisher_id) values
  ('00000000-0000-0000-0000-000000000010', 10, 'Daredevil', '00000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-000000000011', 11, 'Spider-Man', '00000000-0000-0000-0000-000000000001');

insert into volumes (id, comicvine_id, name, start_year, publisher_id)
values ('00000000-0000-0000-0000-000000000020', 20, 'Test Volume', 2020, '00000000-0000-0000-0000-000000000001');

insert into issues (id, comicvine_id, volume_id, issue_number, name) values
  ('00000000-0000-0000-0000-000000000030', 30, '00000000-0000-0000-0000-000000000020', '1', 'Shared'),
  ('00000000-0000-0000-0000-000000000031', 31, '00000000-0000-0000-0000-000000000020', '2', 'Daredevil only');

-- The same external ID updates instead of creating a duplicate.
insert into issues (comicvine_id, volume_id, issue_number, name)
values (30, '00000000-0000-0000-0000-000000000020', '1', 'Shared updated')
on conflict (comicvine_id) do update set name = excluded.name;

insert into issue_characters (issue_id, character_id) values
  ('00000000-0000-0000-0000-000000000030', '00000000-0000-0000-0000-000000000010'),
  ('00000000-0000-0000-0000-000000000030', '00000000-0000-0000-0000-000000000011'),
  ('00000000-0000-0000-0000-000000000031', '00000000-0000-0000-0000-000000000010');

insert into story_arcs (id, comicvine_id, name)
values ('00000000-0000-0000-0000-000000000040', 40, 'Test Arc');
insert into issue_story_arcs (issue_id, story_arc_id)
values ('00000000-0000-0000-0000-000000000030', '00000000-0000-0000-0000-000000000040');

do $$
declare
  duplicate_count integer;
  shared_count integer;
  daredevil_count integer;
  arc_count integer;
  returned_volume text;
begin
  select count(*) into duplicate_count from issues where comicvine_id = 30;
  if duplicate_count <> 1 then
    raise exception 'idempotency failed: expected 1 issue, got %', duplicate_count;
  end if;

  select count(*) into shared_count
  from issues_for_characters(array['Daredevil', 'Spider-Man']);
  if shared_count <> 1 then
    raise exception 'intersection failed: expected 1 issue, got %', shared_count;
  end if;

  select count(*) into daredevil_count
  from issues_for_characters(array['Daredevil']);
  if daredevil_count <> 2 then
    raise exception 'single-character lookup failed: expected 2 issues, got %', daredevil_count;
  end if;

  select count(*) into arc_count from story_arcs_for_character('Daredevil');
  if arc_count <> 1 then
    raise exception 'story arc lookup failed: expected 1 arc, got %', arc_count;
  end if;

  select volume_name into returned_volume
  from issues_for_characters(array['Daredevil', 'Spider-Man']) limit 1;
  if returned_volume <> 'Test Volume' then
    raise exception 'volume lookup failed: got %', returned_volume;
  end if;

  perform replace_issue_relationships(
    array['00000000-0000-0000-0000-000000000030'::uuid],
    '[{"issue_id":"00000000-0000-0000-0000-000000000030","character_id":"00000000-0000-0000-0000-000000000010"}]'::jsonb,
    '[]'::jsonb
  );
  select count(*) into shared_count
  from issues_for_characters(array['Daredevil', 'Spider-Man']);
  if shared_count <> 0 then
    raise exception 'relationship replacement left a stale character link';
  end if;
  select count(*) into arc_count from story_arcs_for_character('Daredevil');
  if arc_count <> 0 then
    raise exception 'relationship replacement left a stale story arc link';
  end if;
end;
$$;

rollback;
