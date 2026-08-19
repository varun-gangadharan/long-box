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

## Acclaim — is the book any good?

Every other ranking signal is structural: who is in a book, how long it runs, where it
starts. Two books of the same shape are therefore indistinguishable, and an
Eisner-winning landmark tied with a competent forgotten one. Acclaim is the only signal
that comes from outside the catalog.

| Source | What it gives | How it joins |
| --- | --- | --- |
| Wikidata (CC0) | Awards, via `P166` | Exact — property `P5905` stores ComicVine ids with their resource prefix, so `4050-6822` is a volume |
| Wikipedia pageviews | Median monthly readership | Exact — the article title comes from the Wikidata sitelink |
| `data/acclaimed-stories.json` | A curated tier | Resolved against the catalog by volume, year and issue range; anything unresolved is reported, never guessed |

The curated file is not a shortcut around the data. Wikidata records an award for only
about forty comic volumes: enough for *The Long Halloween*, nothing for *Year One*,
*Hush*, *The Killing Joke* or *The Dark Knight Returns*. The file covers a gap that was
measured rather than assumed, and it is the only place editorial judgement lives.

Two properties matter more than the weights:

- **Absence is neutral.** Roughly a thousand volumes in all of Wikidata carry a ComicVine
  id, so nearly every candidate has no acclaim data. An unknown book scores the baseline;
  acclaim is a bonus for recognition earned, never a tax on obscurity.
- **Acclaim never opens the gate.** A landmark a character barely appears in is still a
  passing appearance, and `eligibleAsStart` is sourced from togetherness alone.

Refresh it out of band — never on the request path:

```bash
npm run enrich:acclaim -- --dry-run
npm run enrich:acclaim
```

The job also backfills: naming a landmark is a reason to go and fetch it, so books the
curated list names but the catalog lacks are ingested on the spot.

## Current state

- live app is up
- deterministic ranking and explanation flow are in place
- database-backed retrieval is the source of truth for issue facts
- evals and db tests are included so recommendation changes are visible

## Design principle

The model can help interpret intent. Long Box should own the facts.

## License

MIT
