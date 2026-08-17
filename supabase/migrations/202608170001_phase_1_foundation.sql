create extension if not exists pgcrypto;

create table publishers (
  id uuid primary key default gen_random_uuid(),
  comicvine_id bigint not null unique,
  name text not null
);

create table characters (
  id uuid primary key default gen_random_uuid(),
  comicvine_id bigint not null unique,
  name text not null,
  description text,
  image_url text,
  publisher_id uuid references publishers(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table volumes (
  id uuid primary key default gen_random_uuid(),
  comicvine_id bigint not null unique,
  name text not null,
  start_year integer,
  publisher_id uuid references publishers(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table issues (
  id uuid primary key default gen_random_uuid(),
  comicvine_id bigint not null unique,
  volume_id uuid not null references volumes(id) on delete cascade,
  issue_number text not null,
  name text,
  cover_date date,
  description text,
  image_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (volume_id, issue_number)
);

create table story_arcs (
  id uuid primary key default gen_random_uuid(),
  comicvine_id bigint not null unique,
  name text not null,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table issue_characters (
  issue_id uuid not null references issues(id) on delete cascade,
  character_id uuid not null references characters(id) on delete cascade,
  primary key (issue_id, character_id)
);

create table issue_story_arcs (
  issue_id uuid not null references issues(id) on delete cascade,
  story_arc_id uuid not null references story_arcs(id) on delete cascade,
  primary key (issue_id, story_arc_id)
);

create index characters_name_lower_idx on characters (lower(name));
create index issues_volume_id_idx on issues (volume_id);
create index issue_characters_character_id_idx on issue_characters (character_id, issue_id);
create index issue_story_arcs_story_arc_id_idx on issue_story_arcs (story_arc_id, issue_id);

create function set_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger characters_set_updated_at before update on characters
for each row execute function set_updated_at();
create trigger volumes_set_updated_at before update on volumes
for each row execute function set_updated_at();
create trigger issues_set_updated_at before update on issues
for each row execute function set_updated_at();
create trigger story_arcs_set_updated_at before update on story_arcs
for each row execute function set_updated_at();

create function issues_for_characters(requested_names text[])
returns table (
  issue_id uuid,
  comicvine_id bigint,
  issue_number text,
  issue_name text,
  cover_date date,
  image_url text,
  volume_id uuid,
  volume_name text,
  volume_start_year integer
)
language sql stable as $$
  with requested_names_normalized as (
    select distinct lower(trim(value)) as name
    from unnest(requested_names) as value
    where trim(value) <> ''
  ), requested as (
    select c.id, r.name
    from requested_names_normalized r
    join characters c on lower(c.name) = r.name
  )
  select
    i.id,
    i.comicvine_id,
    i.issue_number,
    i.name,
    i.cover_date,
    i.image_url,
    v.id,
    v.name,
    v.start_year
  from issues i
  join volumes v on v.id = i.volume_id
  join issue_characters ic on ic.issue_id = i.id
  join requested r on r.id = ic.character_id
  group by i.id, v.id
  having count(distinct r.name) = (select count(*) from requested_names_normalized)
  order by i.cover_date nulls last, v.name, i.issue_number;
$$;

create function story_arcs_for_character(requested_name text)
returns table (
  story_arc_id uuid,
  comicvine_id bigint,
  name text,
  description text
)
language sql stable as $$
  select distinct sa.id, sa.comicvine_id, sa.name, sa.description
  from story_arcs sa
  join issue_story_arcs isa on isa.story_arc_id = sa.id
  join issue_characters ic on ic.issue_id = isa.issue_id
  join characters c on c.id = ic.character_id
  where lower(c.name) = lower(requested_name)
  order by sa.name;
$$;

create function replace_issue_relationships(
  p_issue_ids uuid[],
  p_character_links jsonb,
  p_story_arc_links jsonb
) returns void
language plpgsql as $$
begin
  delete from issue_characters where issue_id = any(p_issue_ids);
  delete from issue_story_arcs where issue_id = any(p_issue_ids);

  insert into issue_characters (issue_id, character_id)
  select (link->>'issue_id')::uuid, (link->>'character_id')::uuid
  from jsonb_array_elements(coalesce(p_character_links, '[]'::jsonb)) as link
  on conflict do nothing;

  insert into issue_story_arcs (issue_id, story_arc_id)
  select (link->>'issue_id')::uuid, (link->>'story_arc_id')::uuid
  from jsonb_array_elements(coalesce(p_story_arc_links, '[]'::jsonb)) as link
  on conflict do nothing;
end;
$$;

alter table publishers enable row level security;
alter table characters enable row level security;
alter table volumes enable row level security;
alter table issues enable row level security;
alter table story_arcs enable row level security;
alter table issue_characters enable row level security;
alter table issue_story_arcs enable row level security;

comment on function issues_for_characters(text[]) is
  'Returns issues containing every requested character name. Server-side service-role access only.';
