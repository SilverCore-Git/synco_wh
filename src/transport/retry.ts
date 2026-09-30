import type { RateLimitInfo } from '../message/types.js';

/** Plafond appliqué au champ `retryAfter` du corps, que `webhookLimiter` calcule mal (≈ 55 ans). */
const BODY_RETRY_AFTER_CAP_MS = 60_000;
const BASE_BACKOFF_MS = 500;
const JITTER_MS = 250;
/** Marge ajoutée à un délai annoncé par le serveur, pour ne pas arriver pile au bord de la fenêtre. */
const SERVER_DELAY_MARGIN_MS = 100;

/** `Retry-After` en secondes ou en date HTTP. */
export function parseRetryAfter(headers: Headers, now = Date.now()): number | undefined {
  const value = headers.get('retry-after');
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, date - now);
}

/** En-têtes `RateLimit-*` (express-rate-limit, `standardHeaders: true`, brouillon 6). */
export function parseRateLimit(headers: Headers, now = Date.now()): RateLimitInfo | undefined {
  const limit = toNumber(headers.get('ratelimit-limit'));
  const remaining = toNumber(headers.get('ratelimit-remaining'));
  const reset = toNumber(headers.get('ratelimit-reset'));
  if (limit === undefined && remaining === undefined && reset === undefined) return undefined;
  return {
    ...(limit !== undefined && { limit }),
    ...(remaining !== undefined && { remaining }),
    ...(reset !== undefined && { resetAt: new Date(now + reset * 1000) }),
  };
}

export interface RetryDelayInput {
  status?: number;
  headers?: Headers;
  bodyRetryAfterSeconds?: number;
  /** Rang de la relance, à partir de 1. */
  retry: number;
  maxDelayMs: number;
  random?: () => number;
  now?: number;
}

/**
 * Délai avant la relance suivante. Pour un 429 : `Retry-After`, puis
 * `RateLimit-Reset`, puis le `retryAfter` du corps borné à 60 s. Sinon, ou à
 * défaut : backoff exponentiel avec gigue.
 */
export function computeRetryDelay(input: RetryDelayInput): number {
  const now = input.now ?? Date.now();
  let announced: number | undefined;

  if (input.status === 429 && input.headers) {
    announced = parseRetryAfter(input.headers, now);
    if (announced === undefined) {
      const resetAt = parseRateLimit(input.headers, now)?.resetAt;
      if (resetAt) announced = Math.max(0, resetAt.getTime() - now);
    }
  }
  if (announced === undefined && input.status === 429 && input.bodyRetryAfterSeconds !== undefined) {
    announced = Math.min(Math.max(0, input.bodyRetryAfterSeconds * 1000), BODY_RETRY_AFTER_CAP_MS);
  }

  const delay =
    announced !== undefined
      ? announced + SERVER_DELAY_MARGIN_MS
      : BASE_BACKOFF_MS * 2 ** (input.retry - 1) + (input.random ?? Math.random)() * JITTER_MS;

  return Math.min(Math.round(delay), input.maxDelayMs);
}

function toNumber(value: string | null): number | undefined {
  if (value === null || value.trim() === '') return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}
