import { api, query, matchFilters } from "@/lib/intelligence/api";
import { loadIntelligenceView, topMatches } from "@/lib/intelligence/queries";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  return api(async () => {
    // Recruitment matches: candidates default to every eligible scouted player
    // (see intelligenceViewOptions), not just players already at a club in the
    // requested target competition.
    const { competition, ...filters } = query(request, matchFilters);
    return { items: topMatches(await loadIntelligenceView({ targetCompetition: competition }), filters) };
  });
}
