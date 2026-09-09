import { api, query, playerFilters } from "@/lib/intelligence/api";
import {
  loadIntelligenceView,
  filterPlayerOpportunities,
} from "@/lib/intelligence/queries";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  return api(async () => {
    const filters = query(request, playerFilters);
    return filterPlayerOpportunities(await loadIntelligenceView(true), filters);
  });
}
