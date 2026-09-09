import { NextResponse } from "next/server";
import { db } from "@/lib/db";
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
 const { id } = await params; const body = await request.json().catch(() => null);
 if (!body || typeof body.isFavorite !== "boolean") return NextResponse.json({ error: "Invalid favorite value" }, { status: 400 });
 return NextResponse.json(await db.player.update({ where: { id }, data: { isFavorite: body.isFavorite }, select: { id: true, isFavorite: true } }));
}
