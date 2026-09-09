import { test } from "node:test";
import assert from "node:assert/strict";
import { isSameOrigin, effectiveOrigin, normalizeOrigin } from "../src/lib/http-origin";

const ORIGIN_ENV = ["NODE_ENV", "APP_ORIGIN", "NEXT_PUBLIC_SITE_URL", "URL", "DEPLOY_PRIME_URL"] as const;

/** Run `body` with a clean, explicit env for the origin helpers, then restore. */
function withEnv(overrides: Partial<Record<(typeof ORIGIN_ENV)[number], string>>, body: () => void) {
  const saved = Object.fromEntries(ORIGIN_ENV.map((key) => [key, process.env[key]]));
  for (const key of ORIGIN_ENV) delete process.env[key];
  Object.assign(process.env, overrides);
  try {
    body();
  } finally {
    for (const key of ORIGIN_ENV) delete process.env[key];
    for (const [key, value] of Object.entries(saved)) if (value !== undefined) process.env[key] = value;
  }
}

const request = (url: string, headers: Record<string, string>) =>
  new Request(url, { method: "POST", headers });

test("normalizeOrigin lowercases host, drops default port and trailing slash", () => {
  assert.equal(normalizeOrigin("https://Example.NETLIFY.app:443/"), "https://example.netlify.app");
  assert.equal(normalizeOrigin("http://LocalHost:3000"), "http://localhost:3000");
  assert.equal(normalizeOrigin("not a url"), null);
  assert.equal(normalizeOrigin(null), null);
});

test("effectiveOrigin prefers x-forwarded-host / x-forwarded-proto over the request URL", () => {
  assert.equal(
    effectiveOrigin(request("http://internal-lambda.local/api/players/import", {
      host: "internal-lambda.local",
      "x-forwarded-host": "famosoccer.com",
      "x-forwarded-proto": "https",
    })),
    "https://famosoccer.com",
  );
  // comma-separated forwarded chain: first value wins
  assert.equal(
    effectiveOrigin(request("http://internal/api", {
      "x-forwarded-host": "example.netlify.app, proxy.internal",
      "x-forwarded-proto": "https, http",
    })),
    "https://example.netlify.app",
  );
});

test("LOCAL: matching localhost Origin/Host is accepted", () => {
  withEnv({ NODE_ENV: "development" }, () => {
    assert.equal(
      isSameOrigin(request("http://localhost:3000/api/players/import", {
        origin: "http://localhost:3000",
        host: "localhost:3000",
      })),
      true,
    );
  });
});

test("NETLIFY: Origin reconstructed from forwarded headers is accepted in production", () => {
  withEnv({ NODE_ENV: "production" }, () => {
    assert.equal(
      isSameOrigin(request("https://624f9d--famosoccer.netlify.app/api/players/import", {
        origin: "https://example.netlify.app",
        host: "624f9d--famosoccer.netlify.app",
        "x-forwarded-host": "example.netlify.app",
        "x-forwarded-proto": "https",
      })),
      true,
    );
  });
});

test("CUSTOM DOMAIN: forwarded custom host is accepted in production", () => {
  withEnv({ NODE_ENV: "production" }, () => {
    assert.equal(
      isSameOrigin(request("https://internal.netlify/api/players/import", {
        origin: "https://famosoccer.com",
        "x-forwarded-host": "famosoccer.com",
        "x-forwarded-proto": "https",
      })),
      true,
    );
  });
});

test("CUSTOM DOMAIN via APP_ORIGIN env is accepted even without forwarded headers", () => {
  withEnv({ NODE_ENV: "production", APP_ORIGIN: "https://famosoccer.com" }, () => {
    assert.equal(
      isSameOrigin(request("https://internal.netlify/api/players/import", {
        origin: "https://famosoccer.com",
        host: "internal.netlify",
      })),
      true,
    );
  });
});

test("CROSS SITE: foreign Origin is rejected even with a spoofed forwarded host", () => {
  withEnv({ NODE_ENV: "production" }, () => {
    assert.equal(
      isSameOrigin(request("https://internal.netlify/api/players/import", {
        origin: "https://evil.example",
        "x-forwarded-host": "famosoccer.com",
        "x-forwarded-proto": "https",
      })),
      false,
    );
  });
});

test("CROSS SITE: foreign Origin is rejected in development too (not localhost)", () => {
  withEnv({ NODE_ENV: "development" }, () => {
    assert.equal(
      isSameOrigin(request("http://localhost:3000/api/players/import", {
        origin: "https://evil.example",
        host: "localhost:3000",
      })),
      false,
    );
  });
});

test("no Origin header (non-CORS request) is allowed", () => {
  withEnv({ NODE_ENV: "production" }, () => {
    assert.equal(
      isSameOrigin(request("https://famosoccer.com/api/players/import", { host: "famosoccer.com" })),
      true,
    );
  });
});
