import { api, query, clubFilters } from "@/lib/intelligence/api";
import {
  loadIntelligenceView,
  filterClubNeeds,
} from "@/lib/intelligence/queries";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  return api(async () => {
    const filters = query(request, clubFilters);
    return filterClubNeeds(await loadIntelligenceView(true), filters);
  });
}
