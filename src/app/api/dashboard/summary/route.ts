import { api } from "@/lib/intelligence/api";
import { dashboardSummary } from "@/lib/intelligence/queries";
export const dynamic = "force-dynamic";
export async function GET() {
  return api(dashboardSummary);
}
