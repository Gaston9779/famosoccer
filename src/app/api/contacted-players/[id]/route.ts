import { db } from "@/lib/db";
import { api, body, idSchema } from "@/lib/intelligence/api";
import { z } from "zod";

const status = z.enum(["DA_CONTATTARE", "CONTATTATO", "RIFIUTATO", "STALLO"]);
const updateBody = z.object({ status: status.optional(), note: z.string().trim().max(10000).nullable().optional() }).strict();
type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: Context) {
  return api(async () => {
    const id = idSchema.parse((await context.params).id);
    const input = await body(request, updateBody);
    const current = await db.contactedPlayer.findUniqueOrThrow({ where: { id } });
    const statusChanged = input.status !== undefined && input.status !== current.status;
    const now = new Date();
    const item = await db.contactedPlayer.update({
      where: { id },
      data: {
        ...(input.note !== undefined ? { note: input.note || null } : {}),
        ...(statusChanged ? {
          status: input.status,
          lastStatusAt: now,
          ...(input.status === "CONTATTATO" && !current.firstContactedAt ? { firstContactedAt: now } : {}),
          statusEvents: { create: { status: input.status!, note: input.note === undefined ? null : input.note || null, changedAt: now } },
        } : {}),
      },
    });
    return { item };
  });
}
