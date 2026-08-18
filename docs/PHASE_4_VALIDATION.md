# Phase 4 Validation — Production Hardening and Deployment

Validated and deployed on 2026-08-18.

## Production

- URL: <https://long-box.vercel.app>
- Platform: Vercel, connected to `varun-gangadharan/long-box`
- Database: live Supabase Postgres
- Runtime: pinned Node.js 22
- Deployment health: `GET /api/health`
- Smoke command: `npm run smoke -- https://long-box.vercel.app`

Vercel production and preview environments contain only the required server-side Supabase and ComicVine variables. Values remain encrypted and are not stored in Git.

## Hardening delivered

- Content Security Policy, HSTS, clickjacking protection, MIME sniffing protection, strict referrer policy, and restrictive browser permissions;
- removed the framework disclosure header;
- 10-second public API execution budgets and a 5-second readiness budget;
- CDN caching for deterministic successful search and reading-path responses;
- no-store error and readiness responses;
- request IDs on uncached responses;
- structured JSON boundary logs containing no query values, secrets, raw exception messages, or stack traces;
- punctuation and accent-safe search normalization before SQL;
- SQL candidate bounds applied before expensive relationship aggregation;
- a maximum of 12 recommendations per response;
- unused ComicVine HTML descriptions removed from public database results and API payloads;
- Node.js 22 pinned in both package metadata and CI;
- Dependabot for npm and GitHub Actions;
- pinned GitHub Actions revisions with least-privilege workflow permissions;
- independent application and ephemeral PostgreSQL CI jobs;
- reusable local/remote database test runner and production smoke script.

## Validation

```bash
npm test
npm run test:db
npm run typecheck
npm run lint
npm run build
npm run smoke -- https://long-box.vercel.app
```

Results:

- 11 test files passed;
- 52 unit, component, route, and service tests passed;
- database integration tests passed, including 500-character-candidate and 100-story-arc-issue bounds;
- clean-checkout TypeScript validation passed before generating `.next` types;
- ESLint and the production build passed;
- `npm audit` reported zero known vulnerabilities;
- GitHub CI `validate` and `database` jobs passed;
- production homepage, readiness, and reading-path smoke checks passed;
- production returned no `X-Powered-By` header and all configured security headers were present.

GitHub CI evidence: <https://github.com/varun-gangadharan/long-box/actions/runs/32084911706>

## Measured production behavior

Cold uncached requests remained below one second during validation. Warm deterministic requests were served from Vercel's cache:

| Route | Warm response | Payload after trimming |
| --- | ---: | ---: |
| `/api/search?q=dare` | 138 ms | 635 B |
| `/api/reading-path?characters=Daredevil` | 18 ms | 14.4 KB |
| `/api/reading-path?characters=Spider-Man,Daredevil` | 20 ms | 8.5 KB |

Trimming unused ComicVine descriptions reduced the two-character response from approximately 660 KB to 8.5 KB without changing displayed content or ranking evidence.

## Operational checks

```bash
curl -fsS https://long-box.vercel.app/api/health
npm run smoke -- https://long-box.vercel.app
vercel logs https://long-box.vercel.app
```

The health endpoint verifies a production application RPC, not only network access to the database.

## Residual risks

- Server-side read paths currently use the Supabase service-role credential. It is never sent to the browser, but a dedicated least-privilege API credential should replace it before adding authenticated writes or third-party server code.
- Abuse protection currently relies on bounded inputs, bounded SQL work, short execution budgets, CDN caching, and Vercel platform protection. Add a distributed per-client rate limiter when traffic or abuse data justifies another external service.
- The static CSP follows the documented Next.js non-nonce configuration and therefore permits inline framework scripts. Move to per-request nonces only if the product begins rendering user-authored HTML or adds higher-risk script integrations.
- Production alerting is not connected to an external paging service; readiness and structured logs are available through Vercel.
