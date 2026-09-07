import { db } from "../db";
import { scoringConfig } from "../scoring/config";
export const EVENT_TYPES = [
  "AGENCY_CHANGED",
  "REPRESENTATION_STATUS_CHANGED",
  "CONTRACT_CHANGED",
  "MARKET_VALUE_CHANGED",
  "CLUB_CHANGED",
  "PLAYER_LEFT_CLUB",
  "PLAYER_JOINED_CLUB",
  "OPPORTUNITY_SCORE_INCREASED",
  "OPPORTUNITY_SCORE_DECREASED",
  "CLUB_NEED_INCREASED",
  "CLUB_NEED_DECREASED",
] as const;
export type SnapshotValues = {
  id: string;
  playerId: string;
  contractExpires: Date | null;
  representationStatus: string;
  agencyName: string | null;
  marketValueEur: number | null;
  clubId: string | null;
};
export function snapshotChanges(
  previous: SnapshotValues,
  current: SnapshotValues,
) {
  const result: {
    type: string;
    oldValue: string | null;
    newValue: string | null;
  }[] = [];
  const compare = (type: string, a: string | null, b: string | null) => {
    if (a !== b) result.push({ type, oldValue: a, newValue: b });
  };
  compare("AGENCY_CHANGED", previous.agencyName, current.agencyName);
  compare(
    "REPRESENTATION_STATUS_CHANGED",
    previous.representationStatus,
    current.representationStatus,
  );
  compare(
    "CONTRACT_CHANGED",
    previous.contractExpires?.toISOString() ?? null,
    current.contractExpires?.toISOString() ?? null,
  );
  compare(
    "MARKET_VALUE_CHANGED",
    previous.marketValueEur === null ? null : String(previous.marketValueEur),
    current.marketValueEur === null ? null : String(current.marketValueEur),
  );
  if (previous.clubId !== current.clubId)
    compare(
      previous.clubId === null
        ? "PLAYER_JOINED_CLUB"
        : current.clubId === null
          ? "PLAYER_LEFT_CLUB"
          : "CLUB_CHANGED",
      previous.clubId,
      current.clubId,
    );
  return result;
}
export function scoreChangeEvent(
  kind: "OPPORTUNITY_SCORE" | "CLUB_NEED",
  previous: number | null,
  current: number,
  threshold = scoringConfig.eventThreshold,
) {
  if (previous === null || Math.abs(current - previous) < threshold)
    return null;
  return {
    type: `${kind}_${current > previous ? "INCREASED" : "DECREASED"}`,
    severity: "INFO",
    title: `${kind === "CLUB_NEED" ? "Club need" : "Player opportunity"} ${current > previous ? "increased" : "decreased"}`,
    description: `Score changed from ${previous} to ${current} (${current - previous >= 0 ? "+" : ""}${current - previous}).`,
    oldValue: String(previous),
    newValue: String(current),
  };
}
export async function generateSnapshotEvents(playerId?: string) {
  const snapshots = await db.playerSnapshot.findMany({
    where: playerId ? { playerId } : {},
    orderBy: [{ capturedAt: "asc" }, { id: "asc" }],
  });
  const last = new Map<string, SnapshotValues>();
  let created = 0;
  for (const snapshot of snapshots) {
    const previous = last.get(snapshot.playerId);
    if (previous) {
      const changes = snapshotChanges(previous, snapshot);
      if (!changes.length) continue;
      for (const change of changes) {
        const dedupeKey = `snapshot:${previous.id}:${snapshot.id}:${change.type}`;
        const found = await db.playerEvent.findUnique({ where: { dedupeKey } });
        await db.playerEvent.upsert({
          where: { dedupeKey },
          create: {
            ...change,
            playerId: snapshot.playerId,
            severity: "INFO",
            title: change.type.toLowerCase().replaceAll("_", " "),
            description: `Stored value changed from ${change.oldValue ?? "unavailable"} to ${change.newValue ?? "unavailable"}.`,
            metadata: JSON.stringify({
              previousSnapshotId: previous.id,
              snapshotId: snapshot.id,
            }),
            dedupeKey,
            createdAt: snapshot.capturedAt,
          },
          update: {},
        });
        if (!found) created++;
      }
    }
    last.set(snapshot.playerId, snapshot);
  }
  return created;
}
