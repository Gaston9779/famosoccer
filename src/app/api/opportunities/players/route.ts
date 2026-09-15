import { api, query, playerFilters } from "@/lib/intelligence/api";
import {
  loadIntelligenceView,
  filterPlayerOpportunities,
} from "@/lib/intelligence/queries";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  return api(async () => {
    const { competition, ...filters } = query(request, playerFilters);
    // This endpoint lists opportunity scores *for players in the requested
    // competition* (unlike recruitment matching, it is not about recruitment
    // candidates), so an explicit competition filter keeps narrowing the list
    // to that competition rather than falling back to the "all pools" default.
    return filterPlayerOpportunities(
      await loadIntelligenceView({
        targetCompetition: competition,
        candidates: competition ? { kind: "competition", competition } : undefined,
      }),
      filters,
    );
  });
}
