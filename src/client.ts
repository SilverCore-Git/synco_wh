import {
  endpointFromParts,
  endpointUrl,
  isBrowserPage,
  isWellFormedSecret,
  parseWebhookUrl,
  readEnv,
  redactedUrl,
  type WebhookEndpoint,
} from './config.js';
import { createContentEncryptor, type ContentEncryptor } from './e2ee/encrypt.js';
import {
  SyncoAuthError,
  SyncoConfigError,
  SyncoPayloadTooLargeError,
  SyncoValidationError,
  SyncoWebhookError,
} from './errors/classes.js';
import { mapHttpError, type ServerErrorBody } from './errors/map.js';
import { detectFormat, discordToMessage, type ForwardFormat } from './forward.js';
import {
  DEFAULT_CLOCK_SKEW_MS,
  DEFAULT_MAX_RETRIES,
  DEFAULT_MAX_RETRY_DELAY_MS,
  DEFAULT_RATE_LIMIT_PER_MINUTE,
  DEFAULT_TIMEOUT_MS,
  LIMITS,
} from './message/limits.js';
import { normalizeMessage, toMessage, type OverflowMode } from './message/normalize.js';
import type {
  EmbedSource,
  MessageDefaults,
  MessageInput,
  RateLimitInfo,
  SendResult,
  SyncoEmbed,
  ValidationIssue,
  WirePayload,
} from './message/types.js';
import { validatePayload } from './message/validate.js';
import { Clock } from './transport/clock.js';
import { RateLimiter, SerialQueue } from './transport/queue.js';
import { post, type FetchLike, type HttpResponse } from './transport/request.js';
import { computeRetryDelay, parseRateLimit, parseRetryAfter } from './transport/retry.js';
import { createSigner, type Signer } from './transport/sign.js';
import { byteLength } from './util/encoding.js';
import { formatDuration, sleep } from './util/sleep.js';
import { VERSION } from './version.js';

export interface SyncoWebhookOptions {
  /** Adresse complète du webhook, avec ou sans `/github`. Défaut : `SYNCO_WEBHOOK_URL`. */
  url?: string;
  /** Alternative à `url`, avec `token` et `baseUrl`. */
  webhookId?: string;
  token?: string;
  /** Défaut : https://api.synco.fr */
  baseUrl?: string;
  /**
   * Secret HMAC du webhook. Défaut : `SYNCO_WEBHOOK_SECRET`.
   * `null` désactive explicitement la signature (webhook sans `requireSignature`).
   */
  secret?: string | null;
  /**
   * Chiffrement de bout en bout. Défaut : activé si `SYNCO_WEBHOOK_PUBLIC_KEY`
   * est définie. `strict` refuse d'envoyer quoi que ce soit en clair à côté du
   * texte chiffré (embeds, identité, pièces jointes).
   */
  e2ee?: { publicKey: string; strict?: boolean } | false;
  /** Identité et salon appliqués aux messages qui n'en précisent pas. */
  defaults?: MessageDefaults;
  /** Délai maximal d'une requête. Défaut : 30 000 ms. */
  timeoutMs?: number;
  /** Relances des échecs sûrs (429, 502–504, serveur injoignable). `false` : aucune. */
  retry?: { maxRetries?: number; maxDelayMs?: number } | false;
  /** Quota local. Défaut : 50/min, le plafond réel d'un émetteur. `false` : désactivé. */
  rateLimit?: { perMinute?: number } | false;
  clock?: {
    /** Recaler l'horloge sur celle du serveur après un refus d'horodatage. Défaut : vrai. */
    autoSync?: boolean;
    /** Marge retranchée à l'horodatage. Défaut : 1000 ms. */
    skewMs?: number;
  };
  /** Validation locale avant envoi. Défaut : vrai. */
  validate?: boolean;
  /** Textes trop longs : `error` (défaut) ou `truncate` (coupés avec « … »). */
  onOverflow?: OverflowMode;
  /** `fetch` à utiliser (tests, mandataire, certificat auto-signé). */
  fetch?: FetchLike;
  /** Ajouté après `synco-wh/<version>` dans l'en-tête User-Agent. */
  userAgent?: string;
  /** Destination des avertissements. Défaut : `console`. `false` : silence. */
  logger?: { warn(message: string): void } | false;
  hooks?: SyncoHooks;
  /** Le secret serait lisible par tout visiteur de la page : refusé par défaut. */
  dangerouslyAllowBrowser?: boolean;
}

export interface SyncoHooks {
  beforeRequest?(info: { url: string; attempt: number; bodyBytes: number; signed: boolean }): void;
  afterResponse?(info: { url: string; attempt: number; status: number; durationMs: number; rateLimit?: RateLimitInfo }): void;
  onRetry?(info: { attempt: number; delayMs: number; error: SyncoWebhookError }): void;
}

export interface SendOptions {
  /** Salon cible pour ce message. */
  threadId?: string;
  signal?: AbortSignal;
  /**
   * Autorise la relance des échecs ambigus (erreur 500, délai dépassé,
   * connexion coupée) où le message a peut-être déjà été publié. Défaut : faux.
   */
  idempotent?: boolean;
}

export interface ForwardOptions extends SendOptions {
  /**
   * `auto` (défaut) détecte comme le serveur. `github` relaie tel quel vers
   * `…/github` ; `discord` convertit localement ; `synco` envoie le payload filaire tel quel.
   */
  format?: ForwardFormat;
}

export interface BuiltRequest {
  /** Adresse sans le jeton. */
  url: string;
  headers: Record<string, string>;
  body: string;
}

export class SyncoWebhook {
  readonly webhookId: string;

  private readonly endpoint: WebhookEndpoint;
  private readonly signer: Signer | undefined;
  private readonly encrypt: ContentEncryptor | undefined;
  private readonly e2eeStrict: boolean;
  private readonly defaults: MessageDefaults;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly maxDelayMs: number;
  private readonly autoSync: boolean;
  private readonly validateEnabled: boolean;
  private readonly onOverflow: OverflowMode;
  private readonly fetchFn: FetchLike;
  private readonly userAgent: string;
  private readonly logger: { warn(message: string): void } | undefined;
  private readonly hooks: SyncoHooks;
  private readonly clock: Clock;
  private readonly limiter: RateLimiter;
  private readonly queue = new SerialQueue();
  private closed = false;
  private warnedAboutHtml = false;

  constructor(options: SyncoWebhookOptions = {}) {
    if (isBrowserPage() && !options.dangerouslyAllowBrowser) {
      throw new SyncoConfigError(
        'SyncoWebhook ne s\'utilise pas dans une page web',
        'le secret y serait lisible par tout visiteur ; appelez Synco depuis votre serveur'
      );
    }

    this.logger = options.logger === false ? undefined : (options.logger ?? console);
    this.endpoint = resolveEndpoint(options);
    this.webhookId = this.endpoint.webhookId;

    const secret = options.secret === undefined ? readEnv('SYNCO_WEBHOOK_SECRET') : options.secret;
    if (secret) {
      if (!isWellFormedSecret(secret)) {
        this.warn('le secret ne ressemble pas à un secret Synco (36 caractères alphanumériques) ; vérifiez le copier-coller');
      }
      this.signer = createSigner(secret);
    } else if (options.secret !== null) {
      this.warn(
        'aucun secret fourni : les requêtes ne seront pas signées, et un webhook qui exige la signature (réglage par défaut) les refusera'
      );
    }

    const e2ee =
      options.e2ee === false
        ? undefined
        : (options.e2ee ?? (readEnv('SYNCO_WEBHOOK_PUBLIC_KEY') ? { publicKey: readEnv('SYNCO_WEBHOOK_PUBLIC_KEY')! } : undefined));
    this.encrypt = e2ee ? createContentEncryptor(e2ee.publicKey) : undefined;
    this.e2eeStrict = Boolean(e2ee?.strict);

    this.defaults = { ...options.defaults };
    this.timeoutMs = positive(options.timeoutMs, 'timeoutMs') ?? DEFAULT_TIMEOUT_MS;
    this.maxRetries = options.retry === false ? 0 : (nonNegative(options.retry?.maxRetries, 'retry.maxRetries') ?? DEFAULT_MAX_RETRIES);
    this.maxDelayMs = (options.retry ? nonNegative(options.retry.maxDelayMs, 'retry.maxDelayMs') : undefined) ?? DEFAULT_MAX_RETRY_DELAY_MS;
    this.autoSync = options.clock?.autoSync ?? true;
    this.validateEnabled = options.validate ?? true;
    this.onOverflow = options.onOverflow ?? 'error';
    this.hooks = options.hooks ?? {};
    this.userAgent = `synco-wh/${VERSION}${options.userAgent ? ` ${options.userAgent}` : ''}`;

    const fetchFn = options.fetch ?? (globalThis.fetch as FetchLike | undefined);
    if (!fetchFn) throw new SyncoConfigError('Aucune implémentation de fetch disponible', 'Node 22 ou plus, ou option `fetch`');
    this.fetchFn = fetchFn;

    this.clock = new Clock(nonNegative(options.clock?.skewMs, 'clock.skewMs') ?? DEFAULT_CLOCK_SKEW_MS);
    const perMinute =
      options.rateLimit === false ? null : (positive(options.rateLimit?.perMinute, 'rateLimit.perMinute') ?? DEFAULT_RATE_LIMIT_PER_MINUTE);
    this.limiter = new RateLimiter(perMinute);
  }

  /** Publie un message. Une chaîne est un raccourci pour `{ content }`. */
  async send(input: MessageInput, options: SendOptions = {}): Promise<SendResult> {
    this.assertOpen();
    const body = await this.prepareMessage(input, options.threadId);
    return this.enqueue(body, false, options);
  }

  /** Publie un ou plusieurs embeds sans texte. */
  sendEmbed(embeds: SyncoEmbed | EmbedSource | Array<SyncoEmbed | EmbedSource>, options: SendOptions = {}): Promise<SendResult> {
    return this.send({ embeds: Array.isArray(embeds) ? embeds : [embeds] }, options);
  }

  /** Relaie un payload tiers (GitHub, Discord) ou filaire Synco. */
  async forward(payload: unknown, options: ForwardOptions = {}): Promise<SendResult> {
    this.assertOpen();
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new SyncoValidationError([{ path: '', message: 'le payload à relayer doit être un objet JSON' }], 'local');
    }

    const format = !options.format || options.format === 'auto' ? (detectFormat(payload) ?? 'synco') : options.format;

    if (format === 'github') {
      if (this.encrypt && this.e2eeStrict) {
        throw new SyncoValidationError(
          [{ path: '', message: 'un payload GitHub ne peut pas être chiffré ; relais refusé en mode E2EE strict' }],
          'local'
        );
      }
      const body = JSON.stringify(payload);
      assertBodySize(body);
      return this.enqueue(body, true, options);
    }

    if (format === 'discord') {
      return this.enqueue(await this.prepareMessage(discordToMessage(payload), options.threadId), false, options);
    }

    const raw = payload as Partial<WirePayload>;
    const wire = {
      ...raw,
      _synco: { ...raw._synco, ...(options.threadId && { targetThreadId: options.threadId }) },
    } as WirePayload;
    return this.enqueue(await this.prepareWire(wire), false, options);
  }

  /** Anomalies qui feraient refuser ce message, sans rien envoyer. */
  validate(input: MessageInput): ValidationIssue[] {
    const wire = normalizeMessage(input, { defaults: this.defaults, onOverflow: this.onOverflow });
    return [...validatePayload(wire), ...this.e2eeIssues(wire)];
  }

  /** Requête exacte qui serait envoyée (jeton masqué), pour inspection ou envoi par un autre client. */
  async buildRequest(input: MessageInput, options: Pick<SendOptions, 'threadId'> = {}): Promise<BuiltRequest> {
    const body = await this.prepareMessage(input, options.threadId);
    return { url: redactedUrl(this.endpoint, false), headers: await this.headersFor(body), body };
  }

  /** Attend la fin des envois en cours et en file. */
  flush(): Promise<void> {
    return this.queue.idle();
  }

  /** Refuse les nouveaux envois puis attend ceux en cours. */
  async close(): Promise<void> {
    this.closed = true;
    await this.queue.idle();
  }

  // ============================================
  // Préparation
  // ============================================

  private prepareMessage(input: MessageInput, threadId: string | undefined): Promise<string> {
    const wire = normalizeMessage(toMessage(input), { defaults: this.defaults, threadId, onOverflow: this.onOverflow });
    return this.prepareWire(wire);
  }

  private async prepareWire(wire: WirePayload): Promise<string> {
    const issues = [...(this.validateEnabled ? validatePayload(wire) : []), ...this.e2eeIssues(wire)];
    if (issues.length) throw new SyncoValidationError(issues, 'local');

    this.warnAboutHtml(wire);

    if (this.encrypt && typeof wire.content === 'string' && wire.content !== '' && !wire.encrypted) {
      const sealed = await this.encrypt(wire.content);
      wire = { ...wire, ...sealed, encrypted: true, _synco: { ...wire._synco, encrypted: true } };
    }

    const body = JSON.stringify(wire);
    assertBodySize(body);
    return body;
  }

  private e2eeIssues(wire: WirePayload): ValidationIssue[] {
    if (!this.encrypt || wire.encrypted) return [];
    const issues: ValidationIssue[] = [];

    if (typeof wire.content === 'string' && byteLength(wire.content) > LIMITS.encryptedPlaintextBytes) {
      issues.push({
        path: 'content',
        message: `${byteLength(wire.content)} octets : un texte chiffré est limité à ${LIMITS.encryptedPlaintextBytes} octets UTF-8`,
      });
    }
    if (this.e2eeStrict) {
      const clear = (
        [
          ['embeds', wire.embeds?.length],
          ['username', wire.username],
          ['avatarUrl', wire.avatar_url],
          ['attachments', wire.attachments?.length],
          ['mentions', wire.mentions?.length],
        ] as const
      ).filter(([, present]) => present);
      for (const [path] of clear) {
        issues.push({ path, message: 'voyagerait en clair : seul le texte est chiffré (mode E2EE strict)' });
      }
    }
    return issues;
  }

  /** Le serveur retire tout ce qui ressemble à une balise : `a < b > c` devient `a  c`. */
  private warnAboutHtml(wire: WirePayload): void {
    if (this.warnedAboutHtml) return;
    const texts = [
      wire.content,
      ...(wire.embeds ?? []).flatMap(e => [e.title, e.description, ...(e.fields ?? []).flatMap(f => [f.name, f.value])]),
    ];
    if (texts.some(t => typeof t === 'string' && /<[^>]*>/.test(t))) {
      this.warnedAboutHtml = true;
      this.warn('Synco supprime tout texte entre chevrons (< … >) : une partie de ce message ne sera pas affichée');
    }
  }

  // ============================================
  // Transport
  // ============================================

  private enqueue(body: string, github: boolean, options: SendOptions): Promise<SendResult> {
    return this.queue.run(() => this.transmit(body, github, options));
  }

  private async transmit(body: string, github: boolean, options: SendOptions): Promise<SendResult> {
    const url = endpointUrl(this.endpoint, github || this.endpoint.github);
    const displayUrl = redactedUrl(this.endpoint, github || this.endpoint.github);
    const bodyBytes = byteLength(body);
    let attempt = 0;
    let retries = 0;
    let resynced = false;

    for (;;) {
      attempt++;
      let error: SyncoWebhookError;
      let response: HttpResponse | undefined;

      try {
        await this.limiter.acquire(options.signal);
        const headers = await this.headersFor(body);
        this.callHook('beforeRequest', { url: displayUrl, attempt, bodyBytes, signed: Boolean(this.signer) });

        const startedAt = Date.now();
        response = await post({
          fetch: this.fetchFn,
          url,
          displayUrl,
          headers,
          body,
          timeoutMs: this.timeoutMs,
          signal: options.signal,
        });

        const rateLimit = parseRateLimit(response.headers, response.receivedAt);
        this.limiter.observe(rateLimit);
        this.callHook('afterResponse', {
          url: displayUrl,
          attempt,
          status: response.status,
          durationMs: response.receivedAt - startedAt,
          ...(rateLimit && { rateLimit }),
        });

        const success = readSuccess(response);
        if (success) return { ...success, attempts: attempt, ...(rateLimit && { rateLimit }) };

        error = this.errorFromResponse(response);
      } catch (thrown) {
        if (!(thrown instanceof SyncoWebhookError)) throw thrown;
        error = thrown;
      }

      error.attempts = attempt;
      if (error.code === 'ABORTED') throw error;

      if (error.code === 'TIMESTAMP_REJECTED' && response) {
        const offset = this.clock.measure(response.headers.get('date'), response.receivedAt);
        if (this.autoSync && !resynced && offset !== undefined) {
          this.clock.offsetMs = offset;
          resynced = true;
          continue;
        }
        if (offset !== undefined && Math.abs(offset) >= 1000) {
          const direction = offset > 0 ? 'en retard' : 'en avance';
          const clockError = new SyncoAuthError(
            `Horodatage refusé : l'horloge de cette machine est ${direction} de ${formatDuration(offset)} sur celle du serveur`,
            { code: 'TIMESTAMP_REJECTED', status: 401, serverMessage: error.serverMessage, hint: 'synchronisez-la (NTP)' }
          );
          clockError.attempts = attempt;
          throw clockError;
        }
      }

      const ambiguous =
        (error.code === 'SERVER_ERROR' && error.status === 500) ||
        error.code === 'TIMEOUT' ||
        (error.code === 'NETWORK' && !error.retryable);
      if (retries >= this.maxRetries || !(error.retryable || (options.idempotent && ambiguous))) throw error;

      retries++;
      const delayMs = computeRetryDelay({
        status: error.status,
        headers: response?.headers,
        bodyRetryAfterSeconds: (response?.json as ServerErrorBody | undefined)?.retryAfter,
        retry: retries,
        maxDelayMs: this.maxDelayMs,
      });
      if (error.status === 429) this.limiter.pauseUntil(Date.now() + delayMs);
      this.callHook('onRetry', { attempt, delayMs, error });
      await sleep(delayMs, options.signal);
    }
  }

  private async headersFor(body: string): Promise<Record<string, string>> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'User-Agent': this.userAgent,
    };
    if (this.signer) {
      const timestamp = this.clock.timestamp();
      headers['X-Synco-Timestamp'] = timestamp;
      headers['X-Synco-Signature'] = await this.signer(timestamp, body);
    }
    return headers;
  }

  private errorFromResponse(response: HttpResponse): SyncoWebhookError {
    if (response.status >= 200 && response.status < 300) {
      return new SyncoWebhookError(`Réponse inattendue de Synco (${response.status})`, {
        code: 'UNEXPECTED_RESPONSE',
        status: response.status,
        hint: 'l\'adresse pointe-t-elle bien vers une API Synco ?',
      });
    }
    const body = isObject(response.json) ? (response.json as ServerErrorBody) : undefined;
    let retryAfterMs: number | undefined;
    if (response.status === 429) {
      retryAfterMs = parseRetryAfter(response.headers, response.receivedAt);
      const resetAt = parseRateLimit(response.headers, response.receivedAt)?.resetAt;
      retryAfterMs ??= resetAt ? Math.max(0, resetAt.getTime() - response.receivedAt) : undefined;
      if (retryAfterMs === undefined && typeof body?.retryAfter === 'number') {
        retryAfterMs = Math.min(body.retryAfter * 1000, 60_000);
      }
    }
    return mapHttpError(response.status, body, retryAfterMs);
  }

  private assertOpen(): void {
    if (this.closed) {
      throw new SyncoWebhookError('Ce client a été fermé par close()', { code: 'CLOSED' });
    }
  }

  private callHook<K extends keyof SyncoHooks>(name: K, info: Parameters<NonNullable<SyncoHooks[K]>>[0]): void {
    try {
      (this.hooks[name] as ((i: typeof info) => void) | undefined)?.(info);
    } catch (error) {
      this.warn(`le hook ${name} a levé une erreur, ignorée : ${String(error)}`);
    }
  }

  private warn(message: string): void {
    this.logger?.warn(`[synco-wh] ${message}`);
  }
}

/**
 * Envoi ponctuel sans garder d'instance.
 * `secret` peut être `undefined` pour un webhook qui n'exige pas de signature.
 */
export function sendSyncoMessage(
  url: string,
  secret: string | undefined,
  input: MessageInput,
  options: Omit<SyncoWebhookOptions, 'url' | 'secret'> & SendOptions = {}
): Promise<SendResult> {
  const { threadId, signal, idempotent, ...clientOptions } = options;
  const client = new SyncoWebhook({ ...clientOptions, url, secret: secret ?? null });
  return client.send(input, { threadId, signal, idempotent });
}

function resolveEndpoint(options: SyncoWebhookOptions): WebhookEndpoint {
  if (options.url) return parseWebhookUrl(options.url);
  if (options.webhookId || options.token) {
    if (!options.webhookId || !options.token) {
      throw new SyncoConfigError('`webhookId` et `token` vont ensemble', 'ou passez l\'adresse complète dans `url`');
    }
    return endpointFromParts(options.webhookId, options.token, options.baseUrl);
  }
  const fromEnv = readEnv('SYNCO_WEBHOOK_URL');
  if (fromEnv) return parseWebhookUrl(fromEnv);
  throw new SyncoConfigError(
    'Adresse du webhook manquante',
    'passez `url`, ou définissez la variable d\'environnement SYNCO_WEBHOOK_URL'
  );
}

function readSuccess(response: HttpResponse): Omit<SendResult, 'attempts' | 'rateLimit'> | undefined {
  if (response.status < 200 || response.status >= 300 || !isObject(response.json)) return undefined;
  const data = response.json as { success?: unknown; messageId?: unknown; threadId?: unknown; receivedAt?: unknown };
  if (data.success !== true || typeof data.messageId !== 'string') return undefined;
  const receivedAt = typeof data.receivedAt === 'string' ? new Date(data.receivedAt) : new Date(response.receivedAt);
  return {
    messageId: data.messageId,
    threadId: typeof data.threadId === 'string' ? data.threadId : '',
    receivedAt: Number.isNaN(receivedAt.getTime()) ? new Date(response.receivedAt) : receivedAt,
  };
}

function assertBodySize(body: string): void {
  const bytes = byteLength(body);
  if (bytes > LIMITS.bodyBytes) {
    throw new SyncoPayloadTooLargeError(`Message trop volumineux : ${bytes} octets`, {
      code: 'PAYLOAD_TOO_LARGE',
      hint: `le corps de la requête est limité à ${LIMITS.bodyBytes} octets`,
    });
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function positive(value: number | undefined, name: string): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isFinite(value) || value <= 0) throw new SyncoConfigError(`Option \`${name}\` invalide : ${value}`, 'nombre strictement positif attendu');
  return value;
}

function nonNegative(value: number | undefined, name: string): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isFinite(value) || value < 0) throw new SyncoConfigError(`Option \`${name}\` invalide : ${value}`, 'nombre positif ou nul attendu');
  return value;
}
