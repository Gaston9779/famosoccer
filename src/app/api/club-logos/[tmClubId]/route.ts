import { NextResponse } from "next/server";

export const revalidate = 86_400;

type Context = { params: Promise<{ tmClubId: string }> };

export async function GET(_request: Request, context: Context) {
  const { tmClubId } = await context.params;
  if (!/^\d+$/.test(tmClubId)) return new NextResponse(null, { status: 404 });

  try {
    const upstream = await fetch(`https://tmssl.akamaized.net/images/wappen/head/${tmClubId}.png`, {
      headers: { Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8", "User-Agent": "Mozilla/5.0" },
      next: { revalidate: 86_400 },
    });
    if (!upstream.ok || !upstream.body) return new NextResponse(null, { status: upstream.status });
    return new NextResponse(upstream.body, {
      headers: {
        "Content-Type": upstream.headers.get("content-type") ?? "image/png",
        "Cache-Control": "public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400",
      },
    });
  } catch {
    return new NextResponse(null, { status: 502 });
  }
}
