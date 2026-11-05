/**
 * Safe, stable error codes. Only these codes (and their fixed messages) ever leave the server.
 * Raw SDK / Telegram errors are mapped to one of them and never echoed.
 */
export const ERROR_CODES = {
  UNAUTHENTICATED: 'Authentication required',
  FORBIDDEN: 'Operation not permitted for this grant',
  GRANT_REVOKED: 'This connection was revoked',
  ACCOUNT_NOT_IN_GRANT: 'Account is not available for this grant',
  ACCOUNT_NOT_ACTIVE: 'Telegram account is not connected',
  QUOTA_EXCEEDED: 'Monthly beta quota exhausted',
  INVALID_INPUT: 'Invalid input',
  INVALID_CURSOR: 'Invalid or expired cursor',
  FEATURE_DISABLED: 'This feature is not enabled in the current beta',
  FILE_TOO_LARGE: 'File exceeds the enabled beta limit',
  RATE_LIMITED: 'Telegram asked to retry later',
  UPSTREAM_UNAVAILABLE: 'Telegram is temporarily unavailable',
  CONFIG_MISSING: 'Service is not configured',
  CONFLICT: 'Operation already in progress',
  NOT_FOUND: 'Not found',
  INTERNAL: 'Internal error'
} as const;

export type ErrorCode = keyof typeof ERROR_CODES;

export class PostunError extends Error {
  readonly code: ErrorCode;
  readonly retryAfterSeconds: number | undefined;
  constructor(code: ErrorCode, retryAfterSeconds?: number) {
    super(ERROR_CODES[code]);
    this.name = 'PostunError';
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/** Converts any thrown value into a safe public shape. Unknown errors become INTERNAL without details. */
export function toSafeError(err: unknown): { code: ErrorCode; message: string; retryAfterSeconds?: number } {
  if (err instanceof PostunError) {
    return err.retryAfterSeconds === undefined
      ? { code: err.code, message: err.message }
      : { code: err.code, message: err.message, retryAfterSeconds: err.retryAfterSeconds };
  }
  return { code: 'INTERNAL', message: ERROR_CODES.INTERNAL };
}

export const HTTP_STATUS: Readonly<Record<ErrorCode, number>> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  GRANT_REVOKED: 403,
  ACCOUNT_NOT_IN_GRANT: 403,
  ACCOUNT_NOT_ACTIVE: 409,
  QUOTA_EXCEEDED: 429,
  INVALID_INPUT: 400,
  INVALID_CURSOR: 400,
  FEATURE_DISABLED: 501,
  FILE_TOO_LARGE: 413,
  RATE_LIMITED: 429,
  UPSTREAM_UNAVAILABLE: 503,
  CONFIG_MISSING: 503,
  CONFLICT: 409,
  NOT_FOUND: 404,
  INTERNAL: 500
};
