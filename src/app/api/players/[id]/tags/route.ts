import { db } from "@/lib/db";
import {
  api,
  body,
  tagBody,
  idSchema,
  sameOrigin,
} from "@/lib/intelligence/api";
type Context = { params: Promise<{ id: string }> };
export async function GET(_request: Request, context: Context) {
  return api(async () => {
    const id = idSchema.parse((await context.params).id);
    await db.player.findUniqueOrThrow({ where: { id }, select: { id: true } });
    return {
      items: await db.playerTagAssignment.findMany({
        where: { playerId: id },
        include: { tag: true },
      }),
    };
  });
}
export async function POST(request: Request, context: Context) {
  return api(async () => {
    const id = idSchema.parse((await context.params).id);
    const parsed = await body(request, tagBody);
    return db.$transaction(async (tx) => {
      await tx.player.findUniqueOrThrow({
        where: { id },
        select: { id: true },
      });
      const tag = await tx.playerTag.upsert({
        where: { name: parsed.name },
        create: parsed,
        update: {},
      });
      await tx.playerTagAssignment.upsert({
        where: { playerId_tagId: { playerId: id, tagId: tag.id } },
        create: { playerId: id, tagId: tag.id },
        update: {},
      });
      return { tag };
    });
  }, 201);
}
export async function DELETE(request: Request, context: Context) {
  return api(async () => {
    sameOrigin(request);
    const id = idSchema.parse((await context.params).id);
    const tagId = idSchema.parse(
      new URL(request.url).searchParams.get("tagId"),
    );
    await db.playerTagAssignment.delete({
      where: { playerId_tagId: { playerId: id, tagId } },
    });
    return { deleted: true };
  });
}
