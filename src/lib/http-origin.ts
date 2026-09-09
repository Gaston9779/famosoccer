/**
 * Same-origin (CSRF) validation that works behind a reverse proxy (Netlify).
 *
 * `new URL(request.url).origin` is the *internal* function origin on Netlify, not the
 * public site origin, so comparing it against the browser's `Origin` header rejects
 * every legitimate request. Instead we reconstruct the effective public origin from
 * forwarded headers and also accept explicitly configured canonical origins.
 */

const firstHeaderValue = (value: string | null): string | null =>
  value?.split(",")[0]?.trim() || null;

/** `URL.origin` already lowercases the host, drops default ports, and strips any path/trailing slash. */
export function normalizeOrigin(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value.trim()).origin;
  } catch {
    return null;
  }
}

/** Public origin as seen by the browser: `x-forwarded-host`/`x-forwarded-proto` first, then Host, then the request URL. */
export function effectiveOrigin(request: Request): string | null {
  const headers = request.headers;
  let requestUrl: URL | null = null;
  try {
    requestUrl = new URL(request.url);
  } catch {
    requestUrl = null;
  }
  const host = (
    firstHeaderValue(headers.get("x-forwarded-host")) ??
    firstHeaderValue(headers.get("host")) ??
    requestUrl?.host ??
    ""
  ).toLowerCase();
  if (!host) return requestUrl?.origin ?? null;
  const proto =
    firstHeaderValue(headers.get("x-forwarded-proto"))?.toLowerCase() ??
    requestUrl?.protocol.replace(/:$/, "") ??
    "https";
  return normalizeOrigin(`${proto}://${host}`) ?? requestUrl?.origin ?? null;
}

/** Canonical origins from configuration (never `*`). Netlify sets `URL` / `DEPLOY_PRIME_URL` automatically. */
export function configuredOrigins(): string[] {
  return [
    process.env.APP_ORIGIN,
    process.env.NEXT_PUBLIC_SITE_URL,
    process.env.URL,
    process.env.DEPLOY_PRIME_URL,
  ]
    .map(normalizeOrigin)
    .filter((value): value is string => !!value);
}

export function allowedOrigins(request: Request): string[] {
  const reconstructed = effectiveOrigin(request);
  return [
    ...new Set([...configuredOrigins(), ...(reconstructed ? [reconstructed] : [])]),
  ];
}

/**
 * True when the request carries no `Origin` header (not a cross-site browser request),
 * or its `Origin` matches an allowed origin. In development, any localhost origin is allowed.
 */
export function isSameOrigin(request: Request): boolean {
  const origin = normalizeOrigin(request.headers.get("origin"));
  if (!origin) return true;
  if (allowedOrigins(request).includes(origin)) return true;
  if (process.env.NODE_ENV !== "production") {
    try {
      const { hostname } = new URL(origin);
      if (hostname === "localhost" || hostname === "127.0.0.1") return true;
    } catch {
      /* fall through to reject */
    }
  }
  return false;
}

/** Secret-free fields for logging a rejection so proxy behaviour can be confirmed. */
export function originRejectionFields(request: Request) {
  return {
    origin: request.headers.get("origin"),
    host: request.headers.get("host"),
    xForwardedHost: request.headers.get("x-forwarded-host"),
    xForwardedProto: request.headers.get("x-forwarded-proto"),
    effectiveOrigin: effectiveOrigin(request),
  };
}
