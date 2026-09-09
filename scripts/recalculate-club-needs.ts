import "dotenv/config";
import { db } from "../src/lib/db";
import { recalculateAllClubNeeds } from "../src/lib/intelligence/persistence";

/**
 * Recomputes ClubNeedHistory for every current UZ1 club from persisted PostgreSQL
 * data only. No Transfermarkt / external requests. Safe to re-run (idempotent once
 * the algorithm version and roster composition are unchanged).
 *
 *   npm run recalculate:club-needs
 */

type NeedSnapshot = { name: string; players: number; topRole: string | null; topScore: number | null; hasAvailableRow: boolean };

async function snapshot(): Promise<Map<string, NeedSnapshot>> {
  const clubs = await db.club.findMany({
    where: { competition: { tmCompetitionId: "UZ1" } },
    select: {
      id: true,
      name: true,
      _count: { select: { players: true } },
      needHistory: {
        where: { isCurrent: true },
        select: { role: true, total: true, available: true },
      },
    },
  });
  return new Map(
    clubs.map((club) => {
      const available = club.needHistory.filter((row) => row.available);
      const top = [...available].sort((a, b) => b.total - a.total)[0] ?? null;
      return [
        club.id,
        {
          name: club.name,
          players: club._count.players,
          topRole: top?.role ?? null,
          topScore: top ? top.total : null,
          hasAvailableRow: available.length > 0,
        },
      ];
    }),
  );
}

async function main() {
  const before = await snapshot();
  const started = Date.now();
  const results = await recalculateAllClubNeeds();
  const rowsWritten = results.filter((r) => r.written).length;
  const after = await snapshot();

  const clubs = [...after.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name));
  let calculated = 0;
  let genuineZero = 0;
  let fixedFalseZero = 0;
  let notCalculable = 0;

  const fmt = (value: number | null) => (value === null ? "—" : value.toFixed(2));
  const header = ["CLUB", "PLAYERS", "HIGHEST NEED", "OLD", "NEW", "STATUS"];
  const rows: string[][] = [];

  for (const [clubId, now] of clubs) {
    const was = before.get(clubId);
    let status: string;
    if (!now.hasAvailableRow) {
      status = "NOT CALCULABLE (no roster / not synced)";
      notCalculable++;
    } else {
      calculated++;
      const oldZeroish = !was?.hasAvailableRow || (was.topScore ?? 0) === 0;
      if ((now.topScore ?? 0) === 0) {
        status = "GENUINE ZERO";
        genuineZero++;
      } else if (oldZeroish) {
        status = "FALSE ZERO FIXED";
        fixedFalseZero++;
      } else {
        status = "RECALCULATED";
      }
    }
    rows.push([
      now.name,
      String(now.players),
      now.topRole ?? "—",
      was ? fmt(was.topScore) : "—",
      fmt(now.topScore),
      status,
    ]);
  }

  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
  const line = (cells: string[]) => cells.map((c, i) => c.padEnd(widths[i])).join("  ");
  console.log(line(header));
  console.log(widths.map((w) => "-".repeat(w)).join("  "));
  for (const row of rows) console.log(line(row));

  console.log(
    "\n" +
      JSON.stringify(
        {
          event: "CLUB_NEEDS_RECALC_COMPLETE",
          durationMs: Date.now() - started,
          uz1Clubs: clubs.length,
          clubNeedRowsWritten: rowsWritten,
          calculated,
          genuineZero,
          fixedFalseZero,
          notCalculable,
        },
        null,
        2,
      ),
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
