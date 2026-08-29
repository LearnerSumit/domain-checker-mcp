/**
 * Application error taxonomy.
 *
 * Every error that can reach the MCP client is an {@link AppError} carrying a
 * machine-readable `code` and a `safeMessage` that is guaranteed to contain no
 * secrets, no upstream response bodies and no request headers. Handlers should
 * only ever surface `error.safeMessage` to callers.
 */

export type AppErrorCode =
  | "CONFIGURATION_ERROR"
  | "VALIDATION_ERROR"
  | "UPSTREAM_AUTH_ERROR"
  | "RATE_LIMIT_ERROR"
  | "UPSTREAM_SERVER_ERROR"
  | "UPSTREAM_RESPONSE_ERROR"
  | "TIMEOUT_ERROR"
  | "NETWORK_ERROR"
  | "INTERNAL_ERROR";

export class AppError extends Error {
  readonly code: AppErrorCode;
  /** Message that is safe to return to an MCP client / log. */
  readonly safeMessage: string;
  /** Optional upstream HTTP status, for logging only. */
  readonly status?: number;

  constructor(
    code: AppErrorCode,
    safeMessage: string,
    options?: { cause?: unknown; status?: number },
  ) {
    super(safeMessage, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = new.target.name;
    this.code = code;
    this.safeMessage = safeMessage;
    if (options?.status !== undefined) {
      this.status = options.status;
    }
  }
}

export class ConfigurationError extends AppError {
  constructor(safeMessage = "RAPIDAPI_KEY is not configured.") {
    super("CONFIGURATION_ERROR", safeMessage);
  }
}

export class ValidationError extends AppError {
  constructor(safeMessage: string) {
    super("VALIDATION_ERROR", safeMessage);
  }
}

export class UpstreamAuthError extends AppError {
  constructor(
    safeMessage = "The domain availability service rejected the API credentials. Check that RAPIDAPI_KEY is valid and subscribed to the Domain Status API.",
    status?: number,
  ) {
    super("UPSTREAM_AUTH_ERROR", safeMessage, status !== undefined ? { status } : undefined);
  }
}

export class RateLimitError extends AppError {
  constructor(
    safeMessage = "The domain availability service is rate limiting requests. Please wait a moment and try again.",
    status = 429,
  ) {
    super("RATE_LIMIT_ERROR", safeMessage, { status });
  }
}

export class UpstreamServerError extends AppError {
  constructor(
    safeMessage = "The domain availability service is temporarily unavailable. Please try again shortly.",
    status?: number,
  ) {
    super("UPSTREAM_SERVER_ERROR", safeMessage, status !== undefined ? { status } : undefined);
  }
}

export class UpstreamResponseError extends AppError {
  constructor(
    safeMessage = "The domain availability service returned an unexpected response.",
    status?: number,
  ) {
    super("UPSTREAM_RESPONSE_ERROR", safeMessage, status !== undefined ? { status } : undefined);
  }
}

export class TimeoutError extends AppError {
  constructor(
    safeMessage = "The domain availability request timed out. Please try again.",
  ) {
    super("TIMEOUT_ERROR", safeMessage);
  }
}

export class NetworkError extends AppError {
  constructor(
    safeMessage = "Unable to reach the domain availability service. Please check connectivity and try again.",
  ) {
    super("NETWORK_ERROR", safeMessage);
  }
}

/**
 * Redacts a secret (e.g. the RapidAPI key) from an arbitrary string so it can
 * never leak into a log line or an error message.
 */
export function redactSecret(text: string, secret: string | undefined): string {
  if (!secret || secret.length < 4) {
    return text;
  }
  return text.split(secret).join("***REDACTED***");
}

/** Normalises an unknown thrown value into an {@link AppError}. */
export function toAppError(err: unknown): AppError {
  if (err instanceof AppError) {
    return err;
  }
  return new AppError(
    "INTERNAL_ERROR",
    "An unexpected error occurred while checking domain availability.",
    { cause: err },
  );
}
