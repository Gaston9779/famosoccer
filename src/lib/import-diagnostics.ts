import { ProviderError } from "./transfermarkt/errors";

/**
 * Structured, secret-free diagnostics for the manual Transfermarkt import.
 *
 * Every stage of the import emits one JSON line so a production log (Netlify
 * function logs) shows exactly where a failure happened. Nothing here logs
 * cookies, DATABASE_URL, connection strings or request bodies.
 */
export type ImportStage =
  | "IMPORT_START"
  | "TM_FETCH_START"
  | "TM_FETCH_RESULT"
  | "PROFILE_PARSE_RESULT"
  | "DB_WRITE_START"
  | "DB_WRITE_RESULT"
  | "IMPORT_COMPLETE"
  | "IMPORT_ERROR";

export function importLog(stage: ImportStage, fields: Record<string, unknown> = {}) {
  const clean: Record<string, unknown> = { event: stage };
  for (const [key, value] of Object.entries(fields))
    if (value !== undefined) clean[key] = value;
  console.log(JSON.stringify(clean));
}

/** Prisma known-request errors carry a `P####` code; duck-typed to avoid import coupling. */
function prismaErrorCode(error: unknown): string | undefined {
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    typeof (error as { code?: unknown }).code === "string" &&
    /^P\d{3,4}$/.test((error as { code: string }).code)
  )
    return (error as { code: string }).code;
  return undefined;
}

/** Node filesystem / syscall errno codes (EROFS, EACCES, …). */
function syscallErrorCode(error: unknown): string | undefined {
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    typeof (error as { code?: unknown }).code === "string" &&
    /^E[A-Z]+$/.test((error as { code: string }).code)
  )
    return (error as { code: string }).code;
  return undefined;
}

export function describeError(error: unknown) {
  const base =
    error instanceof Error
      ? { errorName: error.name, errorMessage: error.message }
      : { errorName: "NonError", errorMessage: String(error) };
  return {
    ...base,
    providerCode: error instanceof ProviderError ? error.code : undefined,
    httpStatus: error instanceof ProviderError ? error.status : undefined,
    prismaCode: prismaErrorCode(error),
    syscallCode: syscallErrorCode(error),
  };
}

export type ImportFailureCategory =
  | "TRANSFERMARKT_REJECTED"
  | "TRANSFERMARKT_UNAVAILABLE"
  | "IMPORT_TIMED_OUT"
  | "DATABASE_UNAVAILABLE"
  | "STORAGE_UNAVAILABLE"
  | "INVALID_URL"
  | "SYNC_BUSY"
  | "UNKNOWN";

/** Maps any thrown error to a safe, user-facing category + message. Never leaks internals. */
export function categorizeImportFailure(error: unknown): {
  category: ImportFailureCategory;
  message: string;
  httpStatus: number;
} {
  const providerCode = error instanceof ProviderError ? error.code : undefined;
  const prismaCode = prismaErrorCode(error);
  const syscallCode = syscallErrorCode(error);
  const name = error instanceof Error ? error.name : "";
  const message = error instanceof Error ? error.message : String(error);

  if (providerCode === "INVALID_URL")
    return { category: "INVALID_URL", message: message || "That Transfermarkt URL is not valid.", httpStatus: 400 };
  if (providerCode === "SYNC_BUSY")
    return { category: "SYNC_BUSY", message: "Another import is already running. Try again shortly.", httpStatus: 409 };
  if (providerCode === "BLOCKED")
    return { category: "TRANSFERMARKT_REJECTED", message: "Transfermarkt rejected the request. Try again later.", httpStatus: 503 };
  if (providerCode === "HTTP" || providerCode === "NETWORK" || providerCode === "CIRCUIT_OPEN")
    return { category: "TRANSFERMARKT_UNAVAILABLE", message: "Transfermarkt could not be reached. Try again later.", httpStatus: 502 };
  if (providerCode === "PROFILE_PARSE")
    return { category: "TRANSFERMARKT_UNAVAILABLE", message: "The Transfermarkt profile could not be read. Try again later.", httpStatus: 502 };

  if (name === "TimeoutError" || name === "AbortError" || /timed out|aborted/i.test(message))
    return { category: "IMPORT_TIMED_OUT", message: "The import timed out. Try again.", httpStatus: 504 };

  if (syscallCode === "EROFS" || syscallCode === "EACCES" || syscallCode === "EPERM")
    return { category: "STORAGE_UNAVAILABLE", message: "The import service is temporarily unavailable.", httpStatus: 503 };

  if (prismaCode || /prisma|database|connection pool|ECONNREFUSED|ETIMEDOUT/i.test(message))
    return { category: "DATABASE_UNAVAILABLE", message: "The database update failed. Try again.", httpStatus: 502 };

  return { category: "UNKNOWN", message: "Import failed. Please try again.", httpStatus: 502 };
}
