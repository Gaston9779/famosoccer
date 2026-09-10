type RankedMatch = { playerId: string; clubId: string; role: string; matchScore: number };

export function compareMatches(a: RankedMatch, b: RankedMatch) {
  return b.matchScore - a.matchScore || a.playerId.localeCompare(b.playerId)
    || a.clubId.localeCompare(b.clubId) || a.role.localeCompare(b.role);
}

// Preserve every valid club/role opportunity, including multiple roles at one club.
export function groupMatchesByPlayer<T extends RankedMatch>(matches: readonly T[]) {
  const groups = new Map<string, { playerId: string; bestMatchForPlayer: T; matches: T[]; additionalMatches: T[] }>();
  for (const match of [...matches].sort(compareMatches)) {
    const group = groups.get(match.playerId);
    if (group) { group.matches.push(match); group.additionalMatches.push(match); }
    else groups.set(match.playerId, { playerId: match.playerId, bestMatchForPlayer: match, matches: [match], additionalMatches: [] });
  }
  return [...groups.values()];
}
