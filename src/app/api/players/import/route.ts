import { NextResponse } from "next/server";
import { z } from "zod";
import { importPlayerFromTransfermarktUrl } from "@/lib/services/players";
import { playerUrl } from "@/lib/transfermarkt/endpoints";
import { categorizeImportFailure, describeError, importLog } from "@/lib/import-diagnostics";
import { isSameOrigin, originRejectionFields } from "@/lib/http-origin";
export const runtime = "nodejs";
// A manual import makes two rate-limited Transfermarkt requests plus DB writes and
// routinely needs more than Netlify's 10s default. @netlify/plugin-nextjs reads this
// and raises the function timeout (clamped to the site plan's ceiling).
export const maxDuration = 26;
export async function POST(request: Request) {
  if (!isSameOrigin(request)) {
    console.log(JSON.stringify({ event: "IMPORT_ORIGIN_REJECTED", ...originRejectionFields(request) }));
    return NextResponse.json(
      { error: { code: "INVALID_ORIGIN", message: "Same-origin requests only." } },
      { status: 403 },
    );
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: { code: "INVALID_BODY", message: "Expected JSON body." } },
      { status: 400 },
    );
  }
  const parsed = z.object({ url: z.string().max(2048) }).safeParse(body);
  if (!parsed.success)
    return NextResponse.json(
      {
        error: {
          code: "INVALID_BODY",
          message: "A Transfermarkt URL is required.",
        },
      },
      { status: 400 },
    );
  try {
    playerUrl(parsed.data.url);
    const imported = await importPlayerFromTransfermarktUrl(parsed.data.url);
    return NextResponse.json(imported);
  } catch (error) {
    const { category, message, httpStatus } = categorizeImportFailure(error);
    // Full root cause stays in the server log; the client only sees the safe category.
    importLog("IMPORT_ERROR", { at: "route", ...describeError(error), category, responseStatus: httpStatus });
    console.error("[players/import]", error);
    return NextResponse.json(
      { error: { code: category, message } },
      { status: httpStatus },
    );
  }
}
