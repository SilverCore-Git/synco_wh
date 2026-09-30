import { SyncoAbortError, SyncoNetworkError, SyncoTimeoutError } from '../errors/classes.js';

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export interface HttpResponse {
  status: number;
  headers: Headers;
  /** Corps JSON décodé, `undefined` s'il n'en est pas un. */
  json: unknown;
  /** Instant de réception (horloge locale), pour la mesure de décalage. */
  receivedAt: number;
}

export interface PostOptions {
  fetch: FetchLike;
  url: string;
  /** Adresse sans jeton, seule autorisée dans les messages d'erreur. */
  displayUrl: string;
  headers: Record<string, string>;
  body: string;
  timeoutMs: number;
  signal?: AbortSignal;
}

// Échecs qui garantissent que rien n'a quitté la machine : les relancer ne
// peut pas créer de doublon. Codes Node/undici, Bun et messages Deno.
const NOT_SENT_CODES = new Set([
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'UND_ERR_CONNECT_TIMEOUT',
  'ConnectionRefused',
  'FailedToOpenSocket',
]);
const NOT_SENT_MESSAGE = /ECONNREFUSED|ENOTFOUND|EAI_AGAIN|connection refused|dns error|failed to lookup/i;

/** Un POST, borné dans le temps, sans relance ni interprétation du statut. */
export async function post(options: PostOptions): Promise<HttpResponse> {
  const { signal } = options;
  if (signal?.aborted) throw new SyncoAbortError(signal.reason);

  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, options.timeoutMs);
  const onAbort = () => controller.abort(signal?.reason);
  signal?.addEventListener('abort', onAbort, { once: true });

  try {
    const response = await options.fetch(options.url, {
      method: 'POST',
      headers: options.headers,
      body: options.body,
      signal: controller.signal,
      redirect: 'error',
    });
    const text = await response.text();
    let json: unknown;
    try {
      json = text ? JSON.parse(text) : undefined;
    } catch {
      json = undefined;
    }
    return { status: response.status, headers: response.headers, json, receivedAt: Date.now() };
  } catch (error) {
    if (timedOut) {
      throw new SyncoTimeoutError(`Pas de réponse de ${options.displayUrl} en ${options.timeoutMs} ms`, {
        code: 'TIMEOUT',
        cause: error,
        hint: 'le message a peut-être été publié ; il n\'est pas renvoyé automatiquement pour éviter un doublon',
      });
    }
    if (signal?.aborted) throw new SyncoAbortError(signal.reason);

    const notSent = isNotSentError(error);
    throw new SyncoNetworkError(`Échec réseau vers ${options.displayUrl}`, {
      code: 'NETWORK',
      cause: error,
      retryable: notSent,
      maybeDelivered: !notSent,
      hint: notSent ? 'serveur injoignable (DNS ou connexion refusée)' : 'connexion interrompue ; le message a peut-être été publié',
    });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

function isNotSentError(error: unknown): boolean {
  for (let current: unknown = error, depth = 0; current && depth < 4; depth++) {
    const e = current as { code?: unknown; message?: unknown; cause?: unknown };
    if (typeof e.code === 'string' && NOT_SENT_CODES.has(e.code)) return true;
    if (typeof e.message === 'string' && NOT_SENT_MESSAGE.test(e.message)) return true;
    current = e.cause;
  }
  return false;
}
