// Faux synco_api : rejoue, dans le même ordre, les contrôles de la route de
// réception (webhookAuth → webhookValidation → receiveWebhook), avec le vrai
// code serveur quand il est disponible (voir ./server.ts).

import { missingWebhookPermissions, payloadSchema, randomBase62, security, serverDecrypt } from './server.ts';

export interface MockSyncoOptions {
  webhookId?: string;
  token?: string;
  secret?: string;
  requireSignature?: boolean;
  active?: boolean;
  permissions?: string[];
  /** Clé privée PEM si le webhook a l'E2EE activé. */
  privateKey?: string;
  /** Décalage de l'horloge du serveur par rapport à la machine de test. */
  clockOffsetMs?: number;
  threads?: string[];
  defaultThreadId?: string;
}

export interface ReceivedRequest {
  path: string;
  headers: Headers;
  rawBody: string;
  payload: Record<string, unknown>;
  /** `content` publié dans le salon, après déchiffrement éventuel. */
  publishedContent: unknown;
  threadId: string;
}

/** Réponse forcée pour la prochaine requête ; `undefined` laisse passer au traitement normal. */
export type Interceptor = (request: Request) => Response | Promise<Response> | undefined;

export interface MockSynco {
  base: string;
  url: string;
  webhookId: string;
  token: string;
  secret: string;
  received: ReceivedRequest[];
  /** Nombre total de requêtes HTTP reçues, y compris refusées. */
  hits: number;
  options: Required<Pick<MockSyncoOptions, 'requireSignature' | 'active' | 'permissions' | 'clockOffsetMs'>> & MockSyncoOptions;
  intercept(...interceptors: Interceptor[]): void;
  stop(): void;
}

export function startMockSynco(options: MockSyncoOptions = {}): MockSynco {
  const state = {
    requireSignature: true,
    active: true,
    permissions: ['send_messages', 'send_embeds'],
    clockOffsetMs: 0,
    threads: ['thread_default', 'thread_other'],
    defaultThreadId: 'thread_default',
    ...options,
  };
  const webhookId = options.webhookId ?? 'clwebhook0000000000000001';
  const token = options.token ?? randomBase62(24);
  const secret = options.secret ?? randomBase62(36);
  const received: ReceivedRequest[] = [];
  const interceptors: Interceptor[] = [];
  let messageCounter = 0;

  const json = (status: number, body: unknown, extraHeaders: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), {
      status,
      headers: {
        'Content-Type': 'application/json',
        Date: new Date(Date.now() + state.clockOffsetMs).toUTCString(),
        ...extraHeaders,
      },
    });

  const mock: MockSynco = {
    base: '',
    url: '',
    webhookId,
    token,
    secret,
    received,
    hits: 0,
    options: state,
    intercept: (...list) => interceptors.push(...list),
    stop: () => server.stop(true),
  };

  const server = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    async fetch(request) {
      mock.hits++;
      const forced = await interceptors.shift()?.(request);
      if (forced) return forced;

      const url = new URL(request.url);
      const match = /^\/api\/webhooks\/([^/]+)\/([^/]+)(\/github)?$/.exec(url.pathname);
      if (!match) return json(404, { success: false, error: 'Not found', message: 'Webhook endpoint not found' });
      if (request.method !== 'POST') {
        return json(405, { success: false, error: 'Method not allowed', message: 'Only POST method is allowed for webhook reception' });
      }
      const [, id, tok, github] = match;
      const rawBody = await request.text();

      // --- webhookAuth
      if (id !== webhookId) return json(404, { success: false, error: 'Not found', message: 'Webhook not found' });
      if (!state.active) return json(403, { success: false, error: 'Forbidden', message: 'Webhook is disabled' });
      if (tok !== token) return json(401, { success: false, error: 'Unauthorized', message: 'Invalid token' });

      const signatureHeader = request.headers.get('X-Synco-Signature') ?? undefined;
      const timestampHeader = request.headers.get('X-Synco-Timestamp') ?? undefined;
      if (state.requireSignature && !(signatureHeader && timestampHeader)) {
        return json(401, {
          success: false,
          error: 'Unauthorized',
          message: 'X-Synco-Signature and X-Synco-Timestamp headers are required for this webhook',
        });
      }
      if (signatureHeader && timestampHeader) {
        const parsed = security.parseSignature(signatureHeader);
        if (!parsed) return json(401, { success: false, error: 'Unauthorized', message: 'Invalid signature format' });
        if (!security.verifySignature(parsed.signature, parsed.timestamp, rawBody, secret)) {
          return json(401, { success: false, error: 'Unauthorized', message: 'Invalid signature' });
        }
        // validateTimestamp(), avec l'horloge (éventuellement décalée) du serveur.
        const age = Date.now() + state.clockOffsetMs - Number.parseInt(parsed.timestamp, 10);
        if (!(age >= 0 && age <= 300_000)) {
          return json(401, { success: false, error: 'Unauthorized', message: 'Timestamp too old' });
        }
      }

      // --- extractRawBody : un JSON illisible devient {}
      let payload: Record<string, unknown>;
      try {
        payload = rawBody ? JSON.parse(rawBody) : {};
      } catch {
        payload = {};
      }

      // --- webhookValidation (sautée pour /github, comme le vrai serveur)
      if (!github && payloadSchema) {
        const result = payloadSchema.safeParse(payload);
        if (!result.success) {
          return json(400, {
            success: false,
            error: 'Validation error',
            message: 'Invalid payload format',
            details: result.error!.issues.map(i => ({ path: i.path.join('.'), message: i.message })),
          });
        }
      }

      // --- receiveWebhook
      let publishedContent = payload.content;
      if (payload.encrypted && state.privateKey) {
        try {
          publishedContent = serverDecrypt(state.privateKey, payload as Record<string, string>);
        } catch {
          return json(400, { success: false, error: 'Decryption failed', message: 'Failed to decrypt E2EE message' });
        }
      }

      const missing = missingWebhookPermissions({ ...payload, content: publishedContent }, state.permissions);
      if (missing.length) {
        return json(403, {
          success: false,
          error: 'Forbidden',
          message: `This webhook is not allowed to: ${missing.join(', ')}`,
          missingPermissions: missing,
        });
      }

      const target = ((payload._synco as Record<string, unknown> | undefined)?.targetThreadId as string | undefined) ?? state.defaultThreadId;
      if (!state.threads.includes(target)) {
        return json(403, { success: false, error: 'Forbidden', message: 'Target thread does not belong to this webhook workspace' });
      }

      received.push({ path: url.pathname, headers: request.headers, rawBody, payload, publishedContent, threadId: target });
      messageCounter++;
      return json(
        200,
        { success: true, messageId: `msg_${messageCounter}`, threadId: target, receivedAt: new Date().toISOString() },
        { 'RateLimit-Limit': '100', 'RateLimit-Remaining': String(100 - messageCounter), 'RateLimit-Reset': '60' }
      );
    },
  });

  mock.base = `http://127.0.0.1:${server.port}`;
  mock.url = `${mock.base}/api/webhooks/${webhookId}/${token}`;
  return mock;
}

export function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
}

export const silentLogger = { warn: () => {} };
