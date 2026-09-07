import { api, query, eventFilters } from "@/lib/intelligence/api";
import { listEvents } from "@/lib/intelligence/queries";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  return api(async () => ({
    items: await listEvents(query(request, eventFilters)),
  }));
}
