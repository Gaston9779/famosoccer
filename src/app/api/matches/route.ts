import { api, query, matchFilters } from "@/lib/intelligence/api";
import { loadIntelligenceView, topMatches } from "@/lib/intelligence/queries";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  return api(async () => {
    const filters = query(request, matchFilters);
    return { items: topMatches(await loadIntelligenceView(), filters) };
  });
}
