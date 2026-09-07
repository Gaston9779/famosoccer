# Executed verification — 2026-09-06

- Node 20.19.6, Next.js 16.3.4, Prisma 7.10.0, SQLite migration applied.
- Production build and strict TypeScript check passed.
- 16 offline tests passed, including real captured fixtures, SQLite uniqueness/snapshots, manual upsert, resumable bootstrap, daily roster changes/TTL/budget, and 403/429/503 behavior. Mocked test responses are not live request results.
- Next.js development server started at http://127.0.0.1:3000. `/players` and `/clubs` returned HTTP 200 and contained Koffi Kouao / Pakhtakor respectively.
- Live local `POST /api/players/import` with the Italian-domain Kouao URL returned HTTP 200, updated the existing internal player ID, and left exactly one `tmPlayerId=481513` row.

## Live requests

| Operation | Requests | Outcome |
| --- | ---: | --- |
| Probe | 4 | 4 × HTTP 200 |
| Limited bootstrap | 8 | 8 × HTTP 200 |
| Manual import API | 2 | 2 × HTTP 200 |
| **Total** | **14** | **No 403, 429 or 503; no retries** |

Probe discovered 16 UZ1 clubs. Sample: Neftchi Fergana, ID 13306, 27 squad players. Sample player: Koffi Kouao, ID 481513. The initial probe exposed day/month/year dates and prefixed position strings; these were corrected and tested against the captured real HTML before the limited bootstrap.

Verified final profile: birth date 1998-05-20, age 28, Abidjan, Cote d'Ivoire, 173 cm, right foot, Right-Back (FB), secondary Right Midfield / Left-Back, joined 2026-08-04, contract 2027-12-31, Team Anchor (AGENCY), €2,500,000.

Verified UZ1 campaign returned by source: 2026. Possible games 5, games played 4, goals 1, assists 0, yellow/second-yellow/red cards 0, minutes 200, minutes percentage 44.4444%, starting-eleven percentage 40%. All two returned sample season/competition rows parsed.

Limited bootstrap finished SUCCESS in 37 seconds, storing 16 clubs, 27 player stubs, 3 enriched profiles, 5 performance rows and 30 snapshots (27 initial roster states plus 3 commercial enrichments). After manual reimport: still 27 players, 3 enriched profiles, 5 performances and 30 snapshots.

Contract option was absent in all three inspected profiles. Separate first/last names were not inferred. Quickselect `positionId` is too coarse to reliably distinguish macro roles such as CB/FB; profile position text supplies the reliable normalization. This small sample does not establish availability for every player.

## Full bootstrap next

```sh
nvm use
npm run bootstrap:uzbekistan
```

Full bootstrap was deliberately not launched. Exact league-wide player count is not known: only one of 16 rosters was fetched. Formula is `17 + P + E` requests, plus any bounded retries, where P is globally deduplicated squad players and E is commercially eligible performance imports. A rough sample-based extrapolation (16 × 27 = 432 players, not an observed total) gives 449–881 requests. At about five seconds spacing this is approximately 37–73 minutes plus network latency. Each invocation is capped at 500 requests (roughly 42 minutes spacing); resume with the same command when PARTIAL. Actual estimates are recalculated after full roster discovery and again after profile enrichment.

The persisted original probe report retains its original null date fields for auditability; final parser corrections are verified by fixtures, the subsequent limited bootstrap and the manual API result. CLI status exposes exact real request counts. See README for the transitive Prisma tooling dependency audit limitation.
