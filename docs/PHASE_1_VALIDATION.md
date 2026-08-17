# Phase 1 Validation — Foundation and ComicVine Ingestion

Validated on 2026-08-17 against the configured Supabase project and live ComicVine API.

## Implemented

- normalized Postgres schema for publishers, characters, volumes, issues, story arcs, and both many-to-many relationships;
- foreign keys, entity uniqueness constraints, join-table primary keys, lookup indexes, RLS, timestamp triggers, and reusable SQL functions;
- typed ComicVine client with runtime payload validation, pagination, timeout, bounded retry, HTTP/API error handling, and separate raw/normalized types;
- idempotent character ingestion with full per-issue credit resolution and atomic relationship replacement;
- Daredevil and Spider-Man development seed command;
- reusable single-character, multi-character intersection, story-arc, and issue-volume queries;
- deterministic unit and ephemeral-Postgres integration tests.

## Live validation

The migration was applied successfully through the Supabase Management API. A 25-issue-per-character seed completed twice.

First live run:

```text
Daredevil: 25 issues, 17 volumes, 5 story arcs
Spider-Man: 25 issues, 20 volumes, 2 story arcs
Daredevil issues returned: 25
Spider-Man issues returned: 33
Shared Daredevil + Spider-Man issues returned: 9
Daredevil story arcs returned: 5
```

The shared query returned an issue with its associated volume, proving the issue-to-volume join in the live database.

### Idempotency proof

Row counts before and after the second identical seed were unchanged:

| Table | Before | After |
| --- | ---: | ---: |
| publishers | 2 | 2 |
| characters | 660 | 660 |
| volumes | 36 | 36 |
| issues | 49 | 49 |
| story_arcs | 7 | 7 |
| issue_characters | 1,218 | 1,218 |
| issue_story_arcs | 8 | 8 |

The second seed exited successfully and returned the same 9 shared issues.

## Validation suite

```bash
npm test
npm run test:db
npm run typecheck
npm run lint
npm run build
npm run seed -- 25
npm run seed -- 25
```

Results:

- 3 unit-test files passed;
- 9 unit tests passed;
- ephemeral Postgres migration and integration assertions passed;
- TypeScript typecheck passed;
- ESLint passed;
- Next.js production build passed;
- live ComicVine authentication and normalization passed;
- live Supabase migration, ingestion, duplicate rerun, and validation queries passed.

## Schema decisions

- Internal UUIDs decouple application relationships from external IDs.
- ComicVine IDs remain unique per entity type and drive conflict-aware upserts.
- Issue numbers remain text because comic numbering is not reliably numeric.
- Join tables use composite primary keys to prevent duplicate relationships.
- Multi-character intersection executes in SQL and requires every normalized requested name.
- RLS is enabled without public write policies; ingestion uses the server-only service role.
- Relationship replacement runs in one database function so reruns cannot leave half-replaced joins.

## Remaining limitations

- The development validation intentionally sampled 25 issue credits per requested character; it is not a complete ComicVine mirror.
- ComicVine exposes full character credits on individual issue resources, so ingestion uses bounded per-issue requests and must remain conscious of API limits.
- Related character credits are stored as minimal stubs until those characters are ingested directly.
- The entire multi-entity run spans several requests, although relationship replacement itself is atomic.
- ComicVine data quality and story-arc coverage vary by issue.

## Next step

Phase 2 should build deterministic query resolution, candidate grouping, ranking features, stable ordering, machine-readable reasons, and the reading-path API on top of these validated database queries. No LLM or recommendation UI should be added yet.
