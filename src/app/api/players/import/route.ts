import { NextResponse } from "next/server";
import { z } from "zod";
import { importPlayerFromTransfermarktUrl } from "@/lib/services/players";
import { ProviderError } from "@/lib/transfermarkt/errors";
export const runtime = "nodejs";
export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin)
    return NextResponse.json(
      {
        error: {
          code: "INVALID_ORIGIN",
          message: "Same-origin requests only.",
        },
      },
      { status: 403 },
    );
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
    return NextResponse.json({
      player: await importPlayerFromTransfermarktUrl(parsed.data.url),
    });
  } catch (error) {
    const known = error instanceof ProviderError;
    const code = known ? error.code : "INTERNAL_ERROR";
    const status =
      code === "INVALID_URL"
        ? 400
        : code === "SYNC_BUSY"
          ? 409
          : code === "BLOCKED"
            ? 503
            : 502;
    console.error(error);
    return NextResponse.json(
      {
        error: {
          code,
          message: known
            ? error.message
            : "Import failed; inspect sync status and server logs.",
        },
      },
      { status },
    );
  }
}
