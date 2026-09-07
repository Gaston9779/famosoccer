# Famosoccer

Private Uzbekistan Super League (Transfermarkt UZ1) scouting demo. Next.js App Router, strict TypeScript, Tailwind, Prisma and SQLite. No authentication: bind to localhost, as the default scripts do.

## Setup

Use Node 20.19.6 (`nvm use`) or a supported Prisma Node LTS (22.12+ / 24+). Node 23 is not supported by Prisma.

```sh
cp .env.example .env
npm install
npm run db:setup
npm run dev
```

Open http://127.0.0.1:3000/players or /clubs. `npm install` generates Prisma Client. SQLite resides at `prisma/dev.db`; run commands from the repository root.

## Commands

- `npm run dev`: localhost development server.
- `npm run build`, `npm start`: production build and localhost server.
- `npm run db:generate`: regenerate ORM client.
- `npm run db:setup`: apply committed migrations.
- `npm test`: offline parser, normalization, isolated SQLite integration and client safety tests. Live fixtures are tested if present; tests never contact Transfermarkt.
- `npm run typecheck`: strict TypeScript check.
- `npm run tm:probe`: at most 10 requests; clubs, one roster, one profile, one performance endpoint. Saves sanitized successful fixtures and a persisted report.
- `npm run bootstrap:small`: requires successful probe; discovers all clubs, one roster, at most 3 profiles and eligible performances, capped at 10 requests including retries.
- `npm run bootstrap:uzbekistan`: full resumable initialization, requires successful probe.
- `npm run sync:uzbekistan`: manual selective daily refresh; no cron or daemon.
- `npm run sync:status`: recent runs, metadata/cursors, database counts and total real request counters.

To reset the local database, stop the app/sync and delete `prisma/dev.db` (and its `-wal` / `-shm` sidecars if present), then run `npm run db:setup`. This deletes all imported data and sync history.

## Provider and safety

Transfermarkt has **no public official API for this use case**. These unofficial endpoints can change, disappear or block access:

- `/quickselect/teams/UZ1`
- `/quickselect/players/{clubId}`
- `/ceapi/player/{playerId}/performance`
- Canonical `/player-slug/profil/spieler/{playerId}` HTML profile.

All Transfermarkt HTTP requests pass through `src/lib/transfermarkt/client.ts`. A process-wide queue and cross-process lock serialize provider operations, including CLI and manual imports. Native fetch uses an identifying private-demo User-Agent, English language preference, explicit Accept, 25-second timeout, no automatic redirects, and per-run response caching. No proxies, CAPTCHA bypass, fingerprint spoofing or access-control circumvention. Unrecognized endpoint schemas fail explicitly; there is no unverified alternate-source fallback.

403/429 or a detected challenge immediately persist BLOCKED and stop, without retry. 503 waits 30 then 90 seconds, at most two retries. Other server errors get at most two total attempts. Three server failures within five minutes open the circuit and stop the run. Every network attempt, including retries, consumes the budget. Network errors are persisted and stop the run.

Defaults: `TM_REQUEST_DELAY_MS=4000`, `TM_REQUEST_JITTER_MS=2000`, bootstrap budget 500, daily budget 100 across DAILY runs per UTC day, profile and performance TTL 7 days. Average spacing is about five seconds **plus network latency**, not a guarantee against blocking. `TM_BASE_URL` defaults to https://www.transfermarkt.com and is an operator-controlled origin, never taken from input URLs. All user country URLs canonicalize to this provider. Manual imports are capped at 10 requests.

## Data engine

`src/lib/transfermarkt/` isolates URLs, client, parsers, schemas, probe and provider. Services in `src/lib/services/` own transactions, sync state and import orchestration. UI and scoring never fetch Transfermarkt. `src/lib/scoring.ts` exposes current UZ1 performance, contract days, commercial status and playing-time bands. Playing time does not measure quality.

Player and club Transfermarkt IDs are unique external keys. Manual `POST /api/players/import` accepts `{ "url": "https://www.transfermarkt.com/name/profil/spieler/123" }`, imports profile then performances and updates existing players. A performance failure can leave an updated profile stored; the run reports the failure and retrying safely updates the same row. Snapshots record initial state and commercial/club changes. Profile club disagreements with an existing roster relation are logged and preserve that relation for review. Out-of-league manual clubs have no UZ1 competition relation; no league membership is fabricated.

Missing agent field is NOT_LISTED, an empty/uninterpretable field UNKNOWN, explicit no-agent wording NO_AGENT, family FAMILY, named representation AGENCY. Unknown external values are null. Dates parse conservatively, EUR conversion accepts explicit euro units. Full names are retained; first/last names are not guessed. Competition season starts UNVERIFIED and is updated only from a returned UZ1 performance season; current league performance selects the most recent applicable returned UZ1 season instead of assuming calendar labels or using the first row.

## Bootstrap, estimates and resume

Stages: teams → all sequential rosters and deduplicated stubs → all sequential profiles → selectively eligible performance. Eligibility: NO_AGENT/FAMILY/NOT_LISTED/UNKNOWN, contract expiring within 18 months, or manually added. Estimates are printed before enrichment and refined as rosters and commercial fields become known: `1 + clubs + players + eligible performances`. Before rosters are discovered the estimate is explicitly provisional. Worst case performance eligibility is all discovered players. Retries can add requests but never exceed the budget.

Run the same command to resume a PARTIAL/FAILED/BLOCKED run from the saved phase and index; completed rows are not duplicated. BLOCKED runs are never automatically retried: wait until access is legitimately available before manually resuming. A terminated process leaves its last persisted cursor; the next invocation recovers a stale PID lock and marks abandoned RUNNING runs PARTIAL. Current resource may be reprocessed after a crash; upserts and snapshot comparison make this safe. Successful bootstrap can be intentionally rerun.

Daily refresh collects all squads before detecting departures, records NEW_PLAYER / PLAYER_LEFT_ROSTER / PLAYER_CHANGED_CLUB in run metadata, and refreshes stale profiles oldest first. Eligible stale performances follow. Request budgets can postpone performance work; the cursor preserves this work for the next invocation. Empty/failed rosters never imply departures. No automatic scheduling is installed.

## Troubleshooting

Inspect `npm run sync:status` and structured stdout logs. 403/429: stop and do not attempt bypass. SCHEMA/PROFILE_PARSE: inspect the saved probe report, repair parser fixtures and rerun offline tests before trying again. No successful live response means synthetic fixtures are the only available parser evidence, not proof of live compatibility. If a process was killed, the next command recovers its lock; a malformed lock requires manual inspection. SYNC_BUSY means another command or manual import owns the lock.

SQLite migrations/client setup follow the [Prisma SQLite documentation](https://docs.prisma.io/docs/orm/v7/core-concepts/supported-databases/sqlite); app setup follows [Next.js installation documentation](https://nextjs.org/docs/app/getting-started/installation).

Dependency audit at implementation time reports four high-severity transitive findings in Prisma CLI/config dependencies (`deepmerge-ts` and `mysql2`). This SQLite demo does not use MySQL or merge untrusted Prisma configuration. No forced major downgrade or unverified dependency override has been applied; update Prisma when compatible upstream fixes are available.

## Scouting intelligence (local, deterministic)

The additive `20260906211637_scouting_intelligence` migration preserves existing players, clubs, statistics and snapshots. Run `npm run db:setup` and `npm run db:generate` when updating an existing checkout, then:

```sh
npm run score:players
npm run score:clubs
# Or both, with snapshot and score-change events:
npm run score:all
```

These commands only use SQLite. They never initiate a Transfermarkt synchronization. `/players` now links to `/players/{internalId}` with the complete opportunity/confidence breakdown; `/clubs` shows the highest assessed role need; `/opportunities` shows the three diagnostic rankings.

### Formula and missing-data policies

Pure engines live under `src/lib/scoring/`; persistence, event detection and read queries live under `src/lib/intelligence/`. Configuration, ideal squad depths, history/event thresholds and algorithm version live in `src/lib/scoring/config.ts`. Pure functions receive an explicit reference date so fixture results are reproducible.

Opportunity adds contract (35), representation (30), playing time (15), age (10) and market accessibility (10). Component boundaries match the requested specification; shared percentage endpoints use half-open bands: [0,10), [10,25), [25,50), [50,75), [75,100]. Contract day thresholds include their upper endpoint. Dates in the past receive zero contract points plus a verification warning, rather than implying that an outdated roster player is free. `Player.confirmedFreeAgent` is an explicit operator-confirmed flag, defaults false, and awards free-agent points only when clubId is null. The provider never guesses this flag. Missing contract alone awards no points.

Representation remains NO_AGENT=30, FAMILY=28, NOT_LISTED=23, UNKNOWN=15, AGENCY=0. A missing profile is provisional, even if its UNKNOWN representation yields 15 opportunity points. Confidence is separate: profile freshness 25/18/8 (never imported 0), current known contract/status 20, classified representation 20, fresh current-season statistics 15, precise role 10, market value 10. NOT_LISTED classification points do not mean representation is absent professionally. Performance freshness requires both the source row and performance synchronization to be within seven days. Only UZ1 rows whose season exactly matches the stored Competition season are used; previous-season or unverified-season rows are not substituted. Stale current-season minutes can still provide an opportunity signal, with warnings and no performance confidence points. Birth date determines age when available; stored age is a fallback.

`normalizeRole()` adds GK/RB/CB/LB/DM/CM/AM/RW/LW/ST/UNKNOWN, including secondary roles, without altering the old macro `normalizePosition()` behavior or raw Transfermarkt text. No quickselect code is used as final role evidence.

For each imported club roster and role:

- Projected depth subtracts known contracts expiring by 12 calendar months, including already-expired listed contracts as at-risk. Unknown contract dates remain in projected depth with warnings.
- Depth = 40 × max(0, (ideal − projected known depth − unclassified roster players) / ideal). Subtracting unclassified players makes the shortfall a conservative lower bound: missing profile roles cannot create a fabricated shortage.
- Contract risk = 30 × (0.65 × fraction expiring within 6 months + 0.35 × fraction within 12 months).
- Age risk = 20 × (0.5 × fraction aged 30+ + 0.3 × fraction aged 33+ + 0.2 × clamp((known average age − 28)/7)). Fractions use the whole known-role group, so one older player among younger depth has limited impact.
- Value-depth proxy = 10 × clamp(2 × (largest known value / summed known values − 0.5)). Requires at least two positive values and complete role classification; otherwise zero and a warning. It is not a player quality model.

Unimported rosters are persisted as `available=false` observations, score zero, and excluded from need rankings/matches. The current roster is only partially classified, so observed contract and age risk remains provisional. These are not league-wide quality conclusions.

Matching weights: need 35%, opportunity 35%, role fit 15%, age fit 10%, market fit 5%. Main role fit is 100; an eligible secondary role is 75. Unknown main role, missing identity and own-club matches are excluded by default. Ages 18–24/25–27/28–30/31+ give 100/80/55/30; minors give 0 plus warning, unavailable age is neutral 50. At least five positive squad market values are required for market context. Player value relative to the median gives 100/75/50/25 for ratios ≤1/≤2/≤4/>4. Missing context is neutral 50. Top matches use bounded memory and shared roster context, without persisting every pair.

### Histories and events

`PlayerOpportunityHistory` stores each explicit calculation, its components, confidence explanations, algorithm version and `isCurrent` index. The current row supplies the cache without redundant Player score columns. `ClubNeedHistory` writes only for a ≥2-point total change, role membership/unknown-role composition change, algorithm change, or optional configured daily snapshot. Current rows are replaced transactionally. GET requests never write histories or events.

Existing PlayerSnapshot rows remain intact. Score player/all jobs compare successive meaningful snapshot states and emit agency, representation, contract, market value and club-transition events. A first snapshot is a baseline, not a change event; unchanged intermediate snapshots are skipped. Stable unique event keys prevent repeated jobs from duplicating snapshot events. Existing snapshots are backfilled into the event timeline using their captured dates. Score changes generate events only at ≥10 points against the previous observation; first calculations and previously unassessed club needs do not emit spurious increases.

PlayerEvent and ClubEvent share the read API. PlayerNote, PlayerTag and the compound-unique PlayerTagAssignment provide minimal note/tag storage. Tag assignment is idempotent; reusing an existing tag name preserves its original color. No CRM workflow or automatic scheduler is installed.

### Intelligence APIs

All identifiers below are internal database IDs. All query/body inputs use Zod; invalid filters return typed JSON 400 errors, missing resources 404. Writes enforce same-origin when an Origin header is supplied.

| Endpoint | Parameters |
| --- | --- |
| GET `/api/opportunities/players` | minScore, representationStatus, role, club, maxAge, contractWithinDays, sort, limit, offset |
| GET `/api/opportunities/clubs` | role, minScore, club, limit, offset |
| GET `/api/matches` | clubId, playerId, role, minScore, limit, includeCurrentClub=true/false |
| GET `/api/events` | type, severity=INFO/WARNING/HIGH, unread=true/false, limit |
| GET `/api/dashboard/summary` | Counts, representation/contract counts, top scores/matches, latest events and data coverage |
| GET/POST `/api/players/{id}/notes` | POST JSON `{ "content": "Scouting observation" }` |
| GET/POST `/api/players/{id}/tags` | POST JSON `{ "name": "Watch", "color": "#22aa88" }` |
| DELETE `/api/players/{id}/tags?tagId={id}` | Removes assignment; keeps reusable tag |

Sort values: score_desc (default), score_asc, confidence_desc, age_asc, contract_asc. Limits are 1–200 (default 50). Contract filters include future/current dates only. `openRepresentationCount` counts explicit NO_AGENT/FAMILY, never NOT_LISTED/UNKNOWN. Events support unread filtering; editing readAt is reserved for a later inbox UI. All new GET paths have bounded query counts with bulk player/performance/history reads, not one query per club/player; matches never call external providers.

`tests/fixtures/intelligence/uzbekistan.local.json` was exported from the existing 27-player SQLite dataset without external requests. New tests use this public scouting data or isolated temporary SQLite databases. See `INTELLIGENCE_VERIFICATION.md` for executed results and current sample limitations.
