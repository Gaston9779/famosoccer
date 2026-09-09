import { z } from "zod";
import { ROLES } from "../scoring/config";
import { EVENT_TYPES } from "./events";
import { isSameOrigin } from "../http-origin";
export const idSchema = z.string().min(1).max(128);
const number = (max: number) => z.coerce.number().finite().min(0).max(max);
const page = {
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).max(100000).default(0),
};
export const playerFilters = z
  .object({
    minScore: number(100).optional(),
    representationStatus: z
      .enum(["NO_AGENT", "FAMILY", "NOT_LISTED", "UNKNOWN", "AGENCY"])
      .optional(),
    role: z.enum(ROLES).optional(),
    club: idSchema.optional(),
    maxAge: number(100).int().optional(),
    contractWithinDays: number(36500).int().optional(),
    sort: z
      .enum([
        "score_desc",
        "score_asc",
        "confidence_desc",
        "age_asc",
        "contract_asc",
      ])
      .default("score_desc"),
    ...page,
  })
  .strict();
export const clubFilters = z
  .object({
    role: z.enum(ROLES).optional(),
    minScore: number(100).optional(),
    club: idSchema.optional(),
    ...page,
  })
  .strict();
const bool = z.enum(["true", "false"]).transform((v) => v === "true");
export const matchFilters = z
  .object({
    clubId: idSchema.optional(),
    playerId: idSchema.optional(),
    role: z.enum(ROLES).optional(),
    minScore: number(100).optional(),
    limit: page.limit,
    includeCurrentClub: bool.optional(),
  })
  .strict();
export const eventFilters = z
  .object({
    type: z.enum(EVENT_TYPES).optional(),
    severity: z.enum(["INFO", "WARNING", "HIGH"]).optional(),
    unread: bool.optional(),
    limit: page.limit,
  })
  .strict();
export const noteBody = z
  .object({ content: z.string().trim().min(1).max(10000) })
  .strict();
export const tagBody = z
  .object({
    name: z.string().trim().min(1).max(60),
    color: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .nullable()
      .optional(),
  })
  .strict();
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export function query<T extends z.ZodType>(
  request: Request,
  schema: T,
): z.infer<T> {
  const params = Object.fromEntries(new URL(request.url).searchParams);
  return schema.parse(params);
}
export function sameOrigin(request: Request) {
  // Proxy-aware: behind Netlify, new URL(request.url).origin is the internal function
  // origin, not the public site origin. See src/lib/http-origin.ts.
  if (!isSameOrigin(request))
    throw new ApiError(403, "INVALID_ORIGIN", "Same-origin writes only.");
}
export async function body<T extends z.ZodType>(
  request: Request,
  schema: T,
): Promise<z.infer<T>> {
  sameOrigin(request);
  let data: unknown;
  try {
    data = await request.json();
  } catch {
    throw new ApiError(400, "INVALID_BODY", "Expected JSON body");
  }
  return schema.parse(data);
}
export async function api<T>(work: () => Promise<T>, status = 200) {
  try {
    return Response.json(await work(), { status });
  } catch (error) {
    if (error instanceof z.ZodError)
      return Response.json(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: "Invalid request",
            details: error.issues,
          },
        },
        { status: 400 },
      );
    if (error instanceof ApiError)
      return Response.json(
        { error: { code: error.code, message: error.message } },
        { status: error.status },
      );
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error.code === "P2025" || error.code === "P2003")
    )
      return Response.json(
        {
          error: { code: "NOT_FOUND", message: "Player or resource not found" },
        },
        { status: 404 },
      );
    console.error(error);
    return Response.json(
      {
        error: {
          code: "INTERNAL_ERROR",
          message: "Unable to complete request",
        },
      },
      { status: 500 },
    );
  }
}
