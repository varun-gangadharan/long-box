# Long Box

**Live:** [long-box.vercel.app](https://long-box.vercel.app)

I love comics, so I made a tool that helps people figure out where to start and
find better reading paths without guessing their way through a huge back
catalog.

Long Box takes a character search like `Daredevil` or `Batman + Wonder Woman`,
pulls from normalized ComicVine data in Postgres, and returns grounded
recommendations with reasons attached.

## What it does

- searches local data first, then pulls from ComicVine when needed
- normalizes characters, volumes, issues, and story arcs into Postgres
- supports multi-character queries with SQL set intersection
- ranks starting points with deterministic logic
- keeps issue facts and reading order database-backed

## Why it exists

Comics are hard to browse well:

- characters span decades of books
- issue numbers reset across runs
- good entry points are not always obvious
- "just start anywhere" is usually bad advice

I wanted a tool that makes discovery easier while staying grounded in real issue
data.

## Stack

- Next.js App Router
- TypeScript
- Supabase / Postgres
- ComicVine API
- Zod for runtime validation

## Repo layout

```text
src/lib/comicvine/   API client, parsing, normalized types
src/lib/ingestion/   import and upsert logic
src/lib/db/          reusable database queries
src/app/             app routes and UI
supabase/            schema, migrations, SQL tests
evals/               ranking checks and recorded cases
scripts/             seed, smoke, and db test helpers
```

## Running locally

Requires Node 22+.

```bash
npm install
cp .env.example .env.local
npm run dev
```

Set these server-side values in `.env.local`:

- `COMICVINE_API_KEY`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

Then apply the schema and seed some data:

```bash
npx supabase db push
npm run seed
```

## Validation

```bash
npm test
npm run test:db
npm run eval
npm run lint
npm run typecheck
npm run build
```

## Current state

- live app is up
- deterministic ranking and explanation flow are in place
- database-backed retrieval is the source of truth for issue facts
- evals and db tests are included so recommendation changes are visible

## Design principle

The model can help interpret intent. Long Box should own the facts.

## License

MIT
