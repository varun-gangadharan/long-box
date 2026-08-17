# Phase 2 Validation — Deterministic Reading-Path Engine

Validated on 2026-08-17 against deterministic fixtures, ephemeral Postgres, and the configured live Supabase dataset.

## Architecture

The engine is an explicit, testable pipeline:

1. **Query parsing** — accepts one to three character names or one story-arc name; rejects empty, duplicate, oversized, or mixed query types.
2. **Entity resolution** — performs punctuation-insensitive exact matching, uses a persisted canonical catalog identity for same-name characters, and returns explicit not-found or ambiguous errors.
3. **Candidate generation** — SQL returns only issues containing every requested character, or all locally ingested issues attached to a requested story arc. Volume, credited-character count, and arc facts return in the same query.
4. **Grouping** — pure TypeScript creates consecutive same-volume runs, individual issues, and shared story-arc candidates.
5. **Feature calculation and ranking** — centralized weights produce a deterministic score from facts available in the local dataset.
6. **Stable ordering** — score, candidate length, publication date, and deterministic ID break ties in that order.
7. **Explanation generation** — every recommendation includes machine-readable features and factual reasons generated without an LLM.

Important files:

```text
src/lib/reading-path/types.ts       API and engine data contracts
src/lib/reading-path/repository.ts  Supabase RPC boundary and runtime validation
src/lib/reading-path/engine.ts      grouping, features, scoring, reasons, ordering
src/lib/reading-path/service.ts     query parsing and pipeline orchestration
src/app/api/reading-path/route.ts   stable HTTP response and error contract
```

## Ranking model

| Feature | Weight | Meaning |
| --- | ---: | --- |
| Requested-character coverage | 0.25 | Every candidate issue contains every requested character. |
| Continuity | 0.20 | Consecutive issue coverage within one volume. |
| Story-arc evidence | 0.15 | Shared arc membership, with full weight for an arc candidate. |
| Character density | 0.15 | Requested characters as a proportion of credited characters, averaged across issues. |
| Metadata completeness | 0.10 | Availability of issue name, date, cover, and volume year. |
| Brevity | 0.15 | Favors approachable paths of six issues or fewer. |
| Isolated-appearance penalty | -0.10 | Penalizes a single character appearance with no arc context. |

The model does **not** claim subjective quality, creator acclaim, required continuity knowledge, or character-role importance because the current data does not prove those facts.

## HTTP API

Character query:

```http
GET /api/reading-path?characters=Spider-Man,Daredevil
```

Story-arc query:

```http
GET /api/reading-path?storyArc=%22Avengers%22%20Civil%20War
```

Successful responses contain resolved entities and ranked recommendations:

```json
{
  "query": {
    "characters": [
      { "name": "Spider-Man", "comicvineId": 1443 },
      { "name": "Daredevil", "comicvineId": 24694 }
    ],
    "storyArc": null
  },
  "recommendations": [
    {
      "type": "issue_run",
      "title": "Daredevil #2–3",
      "score": 0.662,
      "issues": [],
      "features": {
        "requestedCharacterCoverage": 1,
        "continuityScore": 0.5,
        "arcScore": 0,
        "densityScore": 0.5833333333333333,
        "metadataCompleteness": 0.75,
        "brevityScore": 1,
        "isolatedAppearancePenalty": 0
      },
      "reasons": [
        "All requested characters appear in every issue.",
        "The issues form a consecutive 2-issue run in the same volume.",
        "Across this option, the requested characters average at least half of the credited cast.",
        "This option contains 2 issues."
      ]
    }
  ]
}
```

The abbreviated example omits issue objects only for readability; the real response includes cover, date, volume, issue number, and story-arc metadata.

Errors use a consistent shape:

```json
{
  "error": {
    "code": "character_not_found",
    "message": "Character not found: Unknown",
    "details": { "requestedName": "Unknown" }
  }
}
```

Expected statuses include `400` invalid query, `404` entity not found, `409` ambiguous entity, and `500` bounded internal failure.

## Test coverage

The Phase 2 fixtures cover:

- single-character parsing and resolution;
- punctuation-insensitive character and story-arc resolution;
- persisted canonical identity selection and unresolved ambiguity;
- two-character SQL intersection;
- no shared issues;
- consecutive and non-consecutive grouping;
- numeric order despite missing or inaccurate dates;
- story-arc grouping and overlapping-arc filtering;
- creditless story-arc issues;
- ranking features and isolated-appearance penalty;
- unrelated arc handling;
- deterministic reasons and tie-breaking;
- invalid, duplicate, missing, and mixed queries;
- stable API success and error responses;
- configuration failure containment.

Validation commands:

```bash
npm test
npm run test:db
npm run typecheck
npm run lint
npm run build
```

Results: 7 test files and 41 tests passed; database migrations and SQL assertions passed; typecheck, lint, and production build passed.

## Live observations

Live API validation returned `200` for Daredevil, Spider-Man, Spider-Man + Daredevil, and `"Avengers" Civil War.

| Query | Recommendations | Top result | Warm median endpoint time |
| --- | ---: | --- | ---: |
| Daredevil | 18 | `Daredevil #1–4` | 732.7 ms |
| Spider-Man | 28 | `The Amazing Spider-Man #31–34` | 615.6 ms |
| Spider-Man + Daredevil | 8 | `Daredevil #2–3` | 665.3 ms |
| `"Avengers" Civil War` | 1 | `Civil War: Unmasked #4` | 451.8 ms |

`EXPLAIN (ANALYZE, BUFFERS)` on the live database measured:

| Query | Execution time | Sequential scans |
| --- | ---: | ---: |
| Single-character candidates | 9.403 ms | 0 |
| Two-character candidates | 8.130 ms | 0 |
| Two-name resolution | 2.108 ms | 0 |

The database work is fast on the current dataset. Most endpoint latency is remote network overhead across sequential resolution and candidate RPC calls. Combining those calls or caching should wait for Phase 4 measurement rather than complicating the Phase 2 engine.

## Current weaknesses

- The live dataset is a small development sample, so recommendations are demonstrations of deterministic behavior rather than complete character bibliographies.
- ComicVine credits prove presence, not whether an appearance is a cameo or leading role.
- Metadata cannot establish subjective quality or how much prior continuity a story requires.
- Arc coverage is limited to locally ingested issue relationships.
- Arc candidates and issue runs may intentionally overlap; Phase 3 must present alternatives clearly rather than implying they are wholly separate stories.
- Remote endpoint latency is acceptable for development but should be baselined and improved in Phase 4 if the UI exposes it.

## Next step

Phase 3 should build the search and branching discovery experience against this stable API. The supplied editorial design reference and exact UI constraints live in `IMPLEMENTATION_PLAN.md`; no ranking logic should move into client components.
