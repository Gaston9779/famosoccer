export const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));
export class RateLimiter {
  private tail: Promise<unknown> = Promise.resolve();
  private lastFinished = 0;
  constructor(
    private delay: number,
    private jitter: number,
    private wait = sleep,
  ) {}
  schedule<T>(task: () => Promise<T>): Promise<T> {
    const result = this.tail.then(async () => {
      if (this.lastFinished)
        await this.wait(
          Math.max(
            0,
            this.delay +
              Math.random() * this.jitter -
              (Date.now() - this.lastFinished),
          ),
        );
      try {
        return await task();
      } finally {
        this.lastFinished = Date.now();
      }
    });
    this.tail = result.catch(() => {});
    return result;
  }
}
export function configNumber(name: string, fallback: number) {
  const n = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n))
    throw new Error(`${name} must be a nonnegative integer`);
  return n;
}
export const limiter = new RateLimiter(
  configNumber("TM_REQUEST_DELAY_MS", 4000),
  configNumber("TM_REQUEST_JITTER_MS", 2000),
);
