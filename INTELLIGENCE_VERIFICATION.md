# Scouting intelligence verification

Executed against the existing local SQLite demo after migration `20260906211637_scouting_intelligence`.

## Preservation and local scoring

- Existing player IDs and club IDs were unchanged.
- Existing data remains: 16 clubs, 27 players, 30 snapshots, 5 performance rows, and 14 prior Transfermarkt requests. This work made no provider request.
- `npm run score:all` wrote 27 current player opportunity histories and 160 current club-role histories (16 clubs × 10 roles). It also generated 12 deduplicated player events from prior meaningful snapshots.
- Repeating `npm run score:clubs` without material data changes wrote no additional club histories.

## Observed local results

Koffi Kouao is an exact-role RB and scored **24/100 opportunity**, **100/100 confidence**:

| Component | Score |
| --- | ---: |
| Contract, expiring in 481 days | 12 / 35 |
| Representation: AGENCY | 0 / 30 |
| UZ1 minutes: 44.44% | 8 / 15 |
| Age: 28 | 2 / 10 |
| Market value: EUR 2.5m | 2 / 10 |

The highest assessed local club-role observation is Neftchi Fergana AM at **42.29/100**. It has one known AM, whose contract expires within six months, and a known average age of 32. Its depth component remains zero because 24 roster players have no imported main role; this deliberately prevents the engine from asserting an unobserved positional shortage. The value-depth proxy is unavailable.

There are no top player-club matches in this dataset. Only Neftchi Fergana has a roster import, and all current candidates belong to Neftchi; own-club matches are excluded. The other 15 clubs have no roster and are excluded from assessed need/matching output.

## Automated validation

- `npm run typecheck` passed.
- `npm test` passed: 33 tests. The suite includes legacy provider behavior, pure score boundaries, confidence, precise role mapping, club projected depth and risk, matching exclusions/formula, snapshot and threshold events, persistence/deduplication, notes/tags, and Zod validation. Tests make no live Transfermarkt requests.
- `npm run build` passed.
- Local HTTP verification passed for dashboard, players/club opportunity APIs, matches, events, notes/tags, `/players`, `/clubs`, `/opportunities`, and player detail. It also verified 400 invalid filters/bodies and 404 missing player behavior.

## Next command

```sh
npm run score:all
```

Run it after a local import or future sync to refresh deterministic intelligence from the current database. A fuller UZ1 bootstrap is needed before treating club need or match rankings as league-wide signals.
