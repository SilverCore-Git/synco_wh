import { SyncoConfigError } from './errors/classes.js';
import { DEFAULT_BASE_URL } from './message/limits.js';

export interface WebhookEndpoint {
  /** Origine plus éventuel préfixe de chemin (API derrière un mandataire), sans `/` final. */
  base: string;
  webhookId: string;
  token: string;
  /** L'adresse fournie portait le suffixe `/github`. */
  github: boolean;
}

const TOKEN_PATTERN = /^[A-Za-z0-9]{24}$/;
const SECRET_PATTERN = /^[A-Za-z0-9]{36}$/;
const WEBHOOK_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const PATH_PATTERN = /^(.*)\/api\/webhooks\/([^/]+)\/([^/]+?)(\/github)?\/?$/;

/**
 * Découpe une adresse `https://api.synco.fr/api/webhooks/<id>/<jeton>[/github]`.
 * Lève `SyncoConfigError` avec un indice quand elle est incomplète ou suspecte.
 */
export function parseWebhookUrl(url: string): WebhookEndpoint {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    throw new SyncoConfigError('Adresse de webhook illisible', 'attendu : https://api.synco.fr/api/webhooks/<identifiant>/<jeton>');
  }

  assertTransport(parsed);

  const match = PATH_PATTERN.exec(parsed.pathname);
  if (!match) {
    throw new SyncoConfigError(
      'Ce n\'est pas une adresse de webhook Synco',
      'le chemin doit être de la forme /api/webhooks/<identifiant>/<jeton> ; avez-vous copié l\'adresse en entier ?'
    );
  }

  const [, prefix = '', webhookId = '', token = '', github] = match;
  return makeEndpoint(`${parsed.origin}${prefix}`, decodeURIComponent(webhookId), decodeURIComponent(token), Boolean(github));
}

/** Construit l'extrémité à partir de ses morceaux (options `webhookId` / `token` / `baseUrl`). */
export function endpointFromParts(webhookId: string, token: string, baseUrl: string = DEFAULT_BASE_URL): WebhookEndpoint {
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new SyncoConfigError('Option `baseUrl` illisible', `reçu : ${baseUrl}`);
  }
  assertTransport(parsed);
  const base = `${parsed.origin}${parsed.pathname.replace(/\/+$/, '')}`;
  return makeEndpoint(base, webhookId, token, false);
}

function makeEndpoint(base: string, webhookId: string, token: string, github: boolean): WebhookEndpoint {
  if (!WEBHOOK_ID_PATTERN.test(webhookId)) {
    throw new SyncoConfigError('Identifiant de webhook invalide', `reçu : « ${webhookId} »`);
  }
  if (!TOKEN_PATTERN.test(token)) {
    throw new SyncoConfigError(
      'Jeton de webhook invalide',
      'le jeton fait 24 caractères alphanumériques ; l\'adresse a peut-être été tronquée au copier-coller'
    );
  }
  return { base, webhookId, token, github };
}

/** Le jeton voyage dans l'URL : en clair, il n'est admis que vers une machine locale. */
function assertTransport(url: URL): void {
  if (url.protocol === 'https:') return;
  if (url.protocol === 'http:' && isLocalHost(url.hostname)) return;
  throw new SyncoConfigError(
    `Protocole refusé : ${url.protocol}//${url.hostname}`,
    'utilisez https:// ; http:// n\'est accepté que pour localhost et les adresses privées'
  );
}

function isLocalHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return true;
  if (host === '::1') return true;
  const octets = host.split('.').map(Number);
  if (octets.length !== 4 || octets.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const [a = 0, b = 0] = octets;
  return a === 127 || a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31);
}

export function endpointUrl(endpoint: WebhookEndpoint, github = endpoint.github): string {
  const id = encodeURIComponent(endpoint.webhookId);
  return `${endpoint.base}/api/webhooks/${id}/${endpoint.token}${github ? '/github' : ''}`;
}

/** Forme affichable : le jeton ne doit apparaître dans aucun log ni message d'erreur. */
export function redactedUrl(endpoint: WebhookEndpoint, github = endpoint.github): string {
  return `${endpoint.base}/api/webhooks/${encodeURIComponent(endpoint.webhookId)}/***${github ? '/github' : ''}`;
}

export function isWellFormedSecret(secret: string): boolean {
  return SECRET_PATTERN.test(secret);
}

/** Lit une variable d'environnement sans supposer Node (Deno 2 et Bun exposent `process`). */
export function readEnv(name: string): string | undefined {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  const value = env?.[name];
  return value && value.trim() ? value.trim() : undefined;
}

/**
 * Vrai dans une page web. Deno et les workers exposent aussi des globales
 * « navigateur », d'où les exclusions.
 */
export function isBrowserPage(): boolean {
  const g = globalThis as { window?: unknown; document?: unknown; Deno?: unknown };
  return typeof g.window !== 'undefined' && typeof g.document !== 'undefined' && typeof g.Deno === 'undefined';
}
