begin;

insert into publishers (id, comicvine_id, name)
values ('10000000-0000-0000-0000-000000000001', 101, 'Test Publisher');

insert into characters (id, comicvine_id, name, publisher_id) values
  ('10000000-0000-0000-0000-000000000010', 110, 'Daredevil', '10000000-0000-0000-0000-000000000001'),
  ('10000000-0000-0000-0000-000000000011', 111, 'Spider-Man', '10000000-0000-0000-0000-000000000001'),
  ('10000000-0000-0000-0000-000000000012', 112, 'Daredevil', '10000000-0000-0000-0000-000000000001');

insert into volumes (id, comicvine_id, name, start_year, publisher_id)
values ('10000000-0000-0000-0000-000000000020', 120, 'Test Volume', 2020, '10000000-0000-0000-0000-000000000001');

insert into issues (id, comicvine_id, volume_id, issue_number, name, cover_date) values
  ('10000000-0000-0000-0000-000000000030', 130, '10000000-0000-0000-0000-000000000020', '1', 'Shared', '2020-01-01'),
  ('10000000-0000-0000-0000-000000000031', 131, '10000000-0000-0000-0000-000000000020', '2', 'Daredevil only', '2020-02-01'),
  ('10000000-0000-0000-0000-000000000032', 132, '10000000-0000-0000-0000-000000000020', '3', 'Arc only', '2020-03-01');

insert into issue_characters (issue_id, character_id) values
  ('10000000-0000-0000-0000-000000000030', '10000000-0000-0000-0000-000000000010'),
  ('10000000-0000-0000-0000-000000000030', '10000000-0000-0000-0000-000000000011'),
  ('10000000-0000-0000-0000-000000000031', '10000000-0000-0000-0000-000000000010');

insert into story_arcs (id, comicvine_id, name)
values ('10000000-0000-0000-0000-000000000040', 140, 'Test Arc');
insert into issue_story_arcs (issue_id, story_arc_id) values
  ('10000000-0000-0000-0000-000000000030', '10000000-0000-0000-0000-000000000040'),
  ('10000000-0000-0000-0000-000000000032', '10000000-0000-0000-0000-000000000040');

do $$
declare
  resolved_count integer;
  candidate_count integer;
  candidate_characters integer;
  candidate_arcs integer;
  arc_issue_count integer;
  search_count integer;
begin
  select count(*) into resolved_count
  from resolve_character_names(array['spider man']);
  if resolved_count <> 1 then
    raise exception 'punctuation-insensitive resolution failed: got %', resolved_count;
  end if;

  select count(*) into resolved_count
  from resolve_character_names(array['Daredevil']);
  if resolved_count <> 2 then
    raise exception 'ambiguity preservation failed: got %', resolved_count;
  end if;

  select count(*), max(character_count), max(jsonb_array_length(story_arcs))
    into candidate_count, candidate_characters, candidate_arcs
  from reading_path_issue_candidates(array[
    '10000000-0000-0000-0000-000000000010'::uuid,
    '10000000-0000-0000-0000-000000000011'::uuid
  ]);
  if candidate_count <> 1 then
    raise exception 'candidate intersection failed: got %', candidate_count;
  end if;
  if candidate_characters <> 2 then
    raise exception 'candidate character density failed: got %', candidate_characters;
  end if;
  if candidate_arcs <> 1 then
    raise exception 'candidate story arcs failed: got %', candidate_arcs;
  end if;

  select count(*) into resolved_count
  from resolve_story_arc_names(array['test-arc']);
  if resolved_count <> 1 then
    raise exception 'story arc resolution failed: got %', resolved_count;
  end if;

  select count(*) into arc_issue_count
  from reading_path_story_arc_issues('10000000-0000-0000-0000-000000000040');
  if arc_issue_count <> 2 then
    raise exception 'story arc issue lookup failed: got %', arc_issue_count;
  end if;

  update characters
  set is_canonical = true
  where id = '10000000-0000-0000-0000-000000000010';
  select count(*) into search_count from search_catalog('dare devil', 8);
  if search_count <> 1 then
    raise exception 'catalog character search failed: got %', search_count;
  end if;
  select count(*) into search_count from search_catalog('test arc', 8);
  if search_count <> 1 then
    raise exception 'catalog story arc search failed: got %', search_count;
  end if;
end;
$$;

rollback;
