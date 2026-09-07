import { z } from "zod";
import { ProviderError } from "../errors";
const id = z.union([z.string(), z.number()]).transform(String);
const row = z
  .object({
    id,
    name: z.string().min(1),
    link: z.string().nullish(),
    shirtNumber: z.union([z.string(), z.number()]).nullish(),
    positionId: id.nullish(),
  })
  .passthrough();
export function parseListings(text: string) {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new ProviderError("SCHEMA", "Listing endpoint did not return JSON.");
  }
  if (data && !Array.isArray(data) && typeof data === "object") {
    const obj = data as Record<string, unknown>;
    data = obj.teams ?? obj.players ?? obj.data;
  }
  const parsed = z.array(row).safeParse(data);
  if (!parsed.success)
    throw new ProviderError(
      "SCHEMA",
      `Listing schema changed: ${parsed.error.message}`,
    );
  if (parsed.data.some((r) => !/^\d+$/.test(r.id)))
    throw new ProviderError("SCHEMA", "Invalid external ID in listing");
  return parsed.data.map((r) => ({
    id: r.id,
    name: r.name,
    link: r.link ?? null,
    shirtNumber: r.shirtNumber == null ? null : String(r.shirtNumber),
    positionId: r.positionId ?? null,
  }));
}
