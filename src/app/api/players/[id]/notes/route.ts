import { db } from "@/lib/db";
import { api, body, noteBody, idSchema } from "@/lib/intelligence/api";
type Context = { params: Promise<{ id: string }> };
export async function GET(_request: Request, context: Context) {
  return api(async () => {
    const id = idSchema.parse((await context.params).id);
    await db.player.findUniqueOrThrow({ where: { id }, select: { id: true } });
    return {
      items: await db.playerNote.findMany({
        where: { playerId: id },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      }),
    };
  });
}
export async function POST(request: Request, context: Context) {
  return api(async () => {
    const id = idSchema.parse((await context.params).id);
    const parsed = await body(request, noteBody);
    return {
      note: await db.playerNote.create({ data: { playerId: id, ...parsed } }),
    };
  }, 201);
}
