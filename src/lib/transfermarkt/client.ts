import { db } from "../db";
import { BudgetError, ProviderError } from "./errors";
import { limiter, sleep } from "./rateLimiter";
export class TransfermarktClient {
  private cache = new Map<string, string>();
  private failures: number[] = [];
  private stopped = false;
  constructor(
    public runId: string,
    private max: number,
    private transport: typeof fetch = fetch,
    private wait = sleep,
  ) {}
  async request(
    path: string,
    format: "json" | "html" = "json",
  ): Promise<string> {
    if (this.stopped)
      throw new ProviderError("STOPPED", "Synchronization has been stopped.");
    if (this.cache.has(path)) return this.cache.get(path)!;
    for (let attempt = 0; attempt < 3; attempt++) {
      const result = await limiter.schedule(async () => {
        if (this.stopped)
          throw new ProviderError("STOPPED", "Synchronization stopped.");
        const run = await db.syncRun.findUniqueOrThrow({
          where: { id: this.runId },
        });
        if (run.status !== "RUNNING")
          throw new ProviderError("STOPPED", `Run is ${run.status}`);
        if (run.requestsAttempted >= this.max) throw new BudgetError();
        const base = new URL(
          process.env.TM_BASE_URL ?? "https://www.transfermarkt.com",
        );
        const url = new URL(path, base);
        if (url.origin !== base.origin)
          throw new ProviderError(
            "INVALID_URL",
            "Provider URL must use the configured origin.",
          );
        await db.syncRun.update({
          where: { id: this.runId },
          data: { requestsAttempted: { increment: 1 } },
        });
        let response: Response;
        try {
          response = await this.transport(url, {
            headers: {
              "User-Agent":
                "Famosoccer/0.1 (private football scouting demo; manual research)",
              "Accept-Language": "en-GB,en;q=0.9",
              Accept: format === "json" ? "application/json" : "text/html",
            },
            signal: AbortSignal.timeout(25000),
            redirect: "follow",
          });
        } catch (error) {
          await db.syncRun.update({
            where: { id: this.runId },
            data: { requestsFailed: { increment: 1 } },
          });
          throw new ProviderError(
            "NETWORK",
            `Network request failed: ${String(error)}`,
          );
        }
        const status = response.status;
        console.log(
          JSON.stringify({
            event: "tm.request",
            runId: this.runId,
            path,
            status,
            attempt: attempt + 1,
          }),
        );
        if (response.redirected && new URL(response.url).origin !== base.origin)
          throw new ProviderError("INVALID_URL", "Provider redirect left the configured origin.");
        // Error status handling must not wait for (or depend on) the response body.
        let body = "";
        if (response.ok) {
          try { body = await response.text(); }
          catch (error) {
            await db.syncRun.update({ where: { id: this.runId }, data: { requestsFailed: { increment: 1 } } });
            throw new ProviderError("NETWORK", `Response body failed: ${String(error)}`);
          }
        } else {
          void response.body?.cancel().catch(() => {});
        }
        const softBlock =
          status === 200 &&
          /<title>[^<]*(access denied|just a moment|captcha)|verify you are human|enable javascript and cookies to continue/i.test(
            body,
          );
        const blocked = status === 403 || status === 429 || softBlock;
        await db.syncRun.update({
          where: { id: this.runId },
          data: {
            requestsSucceeded: { increment: response.ok && !softBlock ? 1 : 0 },
            requestsFailed: { increment: response.ok && !softBlock ? 0 : 1 },
            http403Count: { increment: status === 403 ? 1 : 0 },
            http429Count: { increment: status === 429 ? 1 : 0 },
            http503Count: { increment: status === 503 ? 1 : 0 },
            ...(blocked
              ? {
                  status: "BLOCKED",
                  finishedAt: new Date(),
                  message: `Access blocked (${status}); no retry.`,
                }
              : {}),
          },
        });
        if (blocked) {
          this.stopped = true;
          throw new ProviderError(
            "BLOCKED",
            `Transfermarkt blocked the request (${status}); synchronization stopped.`,
            status,
          );
        }
        if (status >= 500) {
          this.failures = this.failures.filter(
            (t) => Date.now() - t < 5 * 60_000,
          );
          this.failures.push(Date.now());
          if (this.failures.length >= 3) {
            this.stopped = true;
            throw new ProviderError(
              "CIRCUIT_OPEN",
              "Three server failures in five minutes; synchronization stopped.",
              status,
            );
          }
        }
        if (response.ok) {
          this.cache.set(path, body);
          return { body, status };
        }
        return { body: null, status };
      });
      if (result.body !== null) return result.body;
      if (result.status === 503 && attempt < 2) {
        await this.wait(attempt === 0 ? 30000 : 90000);
        continue;
      }
      if (result.status >= 500 && result.status !== 503 && attempt < 1) {
        await this.wait(5000 * 2 ** attempt);
        continue;
      }
      throw new ProviderError(
        "HTTP",
        `Transfermarkt returned HTTP ${result.status}`,
        result.status,
      );
    }
    throw new ProviderError("HTTP", "Retries exhausted");
  }
}
