import { db } from "@/lib/db";
import { api, body, idSchema } from "@/lib/intelligence/api";
import { z } from "zod";

const createBody = z.object({ playerId: idSchema }).strict();

export async function POST(request: Request) {
  return api(async () => {
    const { playerId } = await body(request, createBody);
    await db.player.findUniqueOrThrow({ where: { id: playerId }, select: { id: true } });
    const existing = await db.contactedPlayer.findUnique({ where: { playerId } });
    if (existing) return { item: existing, alreadyTracked: true };
    const item = await db.contactedPlayer.create({
      data: {
        playerId,
        statusEvents: { create: { status: "DA_CONTATTARE", note: "Added to contacted players" } },
      },
      include: { statusEvents: { orderBy: { changedAt: "desc" } } },
    });
    return { item, alreadyTracked: false };
  }, 201);
}
