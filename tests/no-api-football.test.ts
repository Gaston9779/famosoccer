import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

/**
 * FamoSoccer's only live Sporting provider is Transfermarkt. This guards against
 * any API-Football / API-Sports code, config or env creeping back in.
 */

const roots = ["src", "scripts", "prisma/schema.prisma", "package.json", ".env.example"];
// Historical, already-applied migrations legitimately still name the reverted columns.
const allowedHistorical = /prisma\/postgres-migrations\/\d+_(add_performance_provider_and_api_football_stats|remove_api_football_experiment)\//;

function grep(pattern: string): string[] {
  try {
    const out = execFileSync(
      "grep",
      ["-rniI", "--exclude-dir=node_modules", "--exclude-dir=generated", "-e", pattern, ...roots],
      { encoding: "utf8" },
    );
    return out.split("\n").filter(Boolean).filter((line) => !allowedHistorical.test(line));
  } catch (error) {
    // grep exits 1 when there are no matches
    if ((error as { status?: number }).status === 1) return [];
    throw error;
  }
}

test("no API-Football / API-Sports references anywhere in product code, scripts or config", () => {
  for (const pattern of ["api-?football", "api-?sports", "apisports", "API_FOOTBALL", "apiFootballPlayerId"]) {
    const hits = grep(pattern);
    assert.deepEqual(hits, [], `unexpected "${pattern}" references:\n${hits.join("\n")}`);
  }
});

test("no API-Football environment variable is referenced or documented", () => {
  const envExample = readFileSync(".env.example", "utf8");
  assert.ok(!/API_FOOTBALL/i.test(envExample), ".env.example must not mention API_FOOTBALL");
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  assert.ok(!Object.keys(pkg.scripts).some((s) => /api-?football/i.test(s)), "no api-football package script");
});

test("PerformanceSource enum is Transfermarkt/Seed only", () => {
  const schema = readFileSync("prisma/schema.prisma", "utf8");
  const block = schema.match(/enum PerformanceSource \{([^}]*)\}/)?.[1] ?? "";
  const values = block.split("\n").map((l) => l.trim()).filter(Boolean);
  assert.deepEqual(values.sort(), ["SEED", "TRANSFERMARKT"]);
});
