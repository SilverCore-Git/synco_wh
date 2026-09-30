import { afterEach, describe, expect, test } from 'bun:test';
import {
  SyncoAbortError,
  SyncoAuthError,
  SyncoConfigError,
  SyncoForbiddenError,
  SyncoNetworkError,
  SyncoRateLimitError,
  SyncoServerError,
  SyncoTimeoutError,
  SyncoValidationError,
  SyncoWebhook,
  sendSyncoMessage,
  type SyncoWebhookOptions,
} from '../src/index.ts';
import { jsonResponse, silentLogger, startMockSynco, type MockSynco, type MockSyncoOptions } from './helpers/mock-synco.ts';
import { generateWebhookKeyPair } from './helpers/server.ts';

let mock: MockSynco | undefined;
afterEach(() => mock?.stop());

function setup(mockOptions: MockSyncoOptions = {}, clientOptions: SyncoWebhookOptions = {}) {
  mock = startMockSynco(mockOptions);
  const client = new SyncoWebhook({
    url: mock.url,
    secret: mock.secret,
    logger: silentLogger,
    retry: { maxDelayMs: 20 },
    ...clientOptions,
  });
  return { mock, client };
}

describe('envoi', () => {
  test('texte simple, signé, publié dans le salon par défaut', async () => {
    const { mock, client } = setup();
    const result = await client.send('Déploiement terminé en 42 s');
    expect(result).toMatchObject({ messageId: 'msg_1', threadId: 'thread_default', attempts: 1 });
    expect(result.receivedAt).toBeInstanceOf(Date);
    expect(result.rateLimit).toMatchObject({ limit: 100, remaining: 99 });
    expect(mock.received[0]!.publishedContent).toBe('Déploiement terminé en 42 s');
    expect(mock.received[0]!.headers.get('user-agent')).toMatch(/^synco-wh\//);
  });

  test('embeds, identité et salon cible', async () => {
    const { mock, client } = setup();
    await client.send(
      { content: 'Build', username: 'CI', embeds: [{ title: 'OK', color: 'success', fields: [{ name: 'Durée', value: '2 min' }] }] },
      { threadId: 'thread_other' }
    );
    const { payload, threadId } = mock.received[0]!;
    expect(threadId).toBe('thread_other');
    expect(payload).toMatchObject({ username: 'CI', embeds: [{ title: 'OK', color: '#22c55e' }], _synco: { targetThreadId: 'thread_other' } });
  });

  test('sendEmbed', async () => {
    const { mock, client } = setup();
    await client.sendEmbed({ title: 'Seul' });
    expect(mock.received[0]!.payload.embeds).toEqual([{ title: 'Seul' }]);
  });

  test('raccourci sendSyncoMessage', async () => {
    mock = startMockSynco();
    const result = await sendSyncoMessage(mock.url, mock.secret, 'ponctuel', { logger: silentLogger });
    expect(result.messageId).toBe('msg_1');
  });

  test('variables d\'environnement', async () => {
    mock = startMockSynco();
    process.env.SYNCO_WEBHOOK_URL = mock.url;
    process.env.SYNCO_WEBHOOK_SECRET = mock.secret;
    try {
      await new SyncoWebhook({ logger: silentLogger }).send('depuis l\'environnement');
      expect(mock.received).toHaveLength(1);
    } finally {
      delete process.env.SYNCO_WEBHOOK_URL;
      delete process.env.SYNCO_WEBHOOK_SECRET;
    }
  });

  test('ordre des messages préservé', async () => {
    const { mock, client } = setup();
    await Promise.all(Array.from({ length: 5 }, (_, i) => client.send(`m${i}`)));
    expect(mock.received.map(r => r.publishedContent)).toEqual(['m0', 'm1', 'm2', 'm3', 'm4']);
  });
});

describe('validation locale', () => {
  test('refus avant tout appel réseau', async () => {
    const { mock, client } = setup();
    const error = await client.send({ embeds: [{ title: 't', color: 'rouge' }] }).catch(e => e);
    expect(error).toBeInstanceOf(SyncoValidationError);
    expect(error.source).toBe('local');
    expect(mock.hits).toBe(0);
  });

  test('désactivable : c\'est alors le serveur qui refuse', async () => {
    const { client } = setup({}, { validate: false });
    const error = await client.send({ embeds: [{ title: 't', color: 'rouge' }] }).catch(e => e);
    expect(error).toBeInstanceOf(SyncoValidationError);
    expect(error.source).toBe('server');
  });

  test('validate() ne fait aucun appel', () => {
    const { mock, client } = setup();
    expect(client.validate('')).toHaveLength(1);
    expect(client.validate('ok')).toEqual([]);
    expect(mock.hits).toBe(0);
  });
});

describe('authentification', () => {
  test('sans secret, un webhook qui exige la signature répond 401', async () => {
    const { client } = setup({}, { secret: null });
    const error = await client.send('x').catch(e => e);
    expect(error).toBeInstanceOf(SyncoAuthError);
    expect(error.code).toBe('SIGNATURE_REQUIRED');
  });

  test('sans secret, accepté si le webhook ne l\'exige pas', async () => {
    const { mock, client } = setup({ requireSignature: false }, { secret: null });
    await client.send('x');
    expect(mock.received[0]!.headers.get('x-synco-signature')).toBeNull();
  });

  test('mauvais secret', async () => {
    const { client } = setup({}, { secret: 'X'.repeat(36) });
    expect((await client.send('x').catch(e => e)).code).toBe('INVALID_SIGNATURE');
  });

  test('jeton régénéré', async () => {
    mock = startMockSynco();
    const client = new SyncoWebhook({ url: mock.url.replace(mock.token, 'Z'.repeat(24)), secret: mock.secret, logger: silentLogger });
    const error = await client.send('x').catch(e => e);
    expect(error.code).toBe('INVALID_TOKEN');
    expect(error.message).not.toContain(mock.token);
  });

  test('avertit sans secret, sauf refus explicite', () => {
    mock = startMockSynco();
    const warnings: string[] = [];
    new SyncoWebhook({ url: mock.url, logger: { warn: m => warnings.push(m) } });
    new SyncoWebhook({ url: mock.url, secret: null, logger: { warn: m => warnings.push(m) } });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/aucun secret/);
  });
});

describe('horloge', () => {
  test('horloge locale en avance : recalage automatique puis succès', async () => {
    const { mock, client } = setup({ clockOffsetMs: -120_000 });
    const result = await client.send('x');
    expect(result.attempts).toBe(2);
    expect(mock.received).toHaveLength(1);
  });

  test('horloge locale en retard de plus de 5 min', async () => {
    const { client } = setup({ clockOffsetMs: 600_000 });
    expect((await client.send('x')).attempts).toBe(2);
  });

  test('sans recalage : erreur qui chiffre le décalage', async () => {
    const { client } = setup({ clockOffsetMs: -192_000 }, { clock: { autoSync: false } });
    const error = await client.send('x').catch(e => e);
    expect(error.code).toBe('TIMESTAMP_REJECTED');
    expect(error.message).toMatch(/en avance de 3 min 1\d s/);
  });
});

describe('refus métier', () => {
  test('permission manquante', async () => {
    const { client } = setup({ permissions: ['send_messages'] });
    const error = await client.send({ content: 'x', embeds: [{ title: 't' }] }).catch(e => e);
    expect(error).toBeInstanceOf(SyncoForbiddenError);
    expect(error.missingPermissions).toEqual(['send_embeds']);
  });

  test('webhook en pause', async () => {
    const { client } = setup({ active: false });
    expect((await client.send('x').catch(e => e)).code).toBe('WEBHOOK_DISABLED');
  });

  test('salon hors de l\'espace', async () => {
    const { client } = setup();
    expect((await client.send('x', { threadId: 'ailleurs' }).catch(e => e)).code).toBe('THREAD_OUT_OF_SCOPE');
  });

  test('webhook supprimé', async () => {
    mock = startMockSynco();
    const client = new SyncoWebhook({ url: mock.url.replace(mock.webhookId, 'autre'), secret: mock.secret, logger: silentLogger });
    expect((await client.send('x').catch(e => e)).code).toBe('NOT_FOUND');
  });
});

describe('relances', () => {
  test('429 relancé, nouvelle signature à chaque tentative', async () => {
    const { mock, client } = setup();
    mock.intercept(() => jsonResponse(429, { success: false, error: 'Rate limited', retryAfter: 1_759_230_000 }, { 'Retry-After': '0' }));
    const retries: number[] = [];
    const hooked = new SyncoWebhook({ url: mock.url, secret: mock.secret, logger: silentLogger, hooks: { onRetry: i => retries.push(i.delayMs) } });
    const result = await hooked.send('x');
    expect(result.attempts).toBe(2);
    expect(retries).toEqual([100]);
    void client;
  });

  test('429 persistant : SyncoRateLimitError après maxRetries', async () => {
    const { mock, client } = setup({}, { retry: { maxRetries: 2, maxDelayMs: 5 } });
    const limited = () => jsonResponse(429, { success: false, error: 'Rate limited' }, { 'Retry-After': '30' });
    mock.intercept(limited, limited, limited);
    const error = await client.send('x').catch(e => e);
    expect(error).toBeInstanceOf(SyncoRateLimitError);
    expect(error.attempts).toBe(3);
    expect(error.retryAfterMs).toBe(30_000);
  });

  test('503 du mandataire relancé', async () => {
    const { mock, client } = setup();
    mock.intercept(() => new Response('Service Unavailable', { status: 503 }));
    expect((await client.send('x')).attempts).toBe(2);
  });

  test('500 non relancé par défaut (doublon possible)', async () => {
    const { mock, client } = setup();
    mock.intercept(() => jsonResponse(500, { success: false, error: 'Internal Server Error' }));
    const error = await client.send('x').catch(e => e);
    expect(error).toBeInstanceOf(SyncoServerError);
    expect(mock.hits).toBe(1);
  });

  test('500 relancé si l\'appelant accepte les doublons', async () => {
    const { mock, client } = setup();
    mock.intercept(() => jsonResponse(500, { success: false, error: 'Internal Server Error' }));
    expect((await client.send('x', { idempotent: true })).attempts).toBe(2);
  });

  test('serveur injoignable : relancé, puis erreur réseau sans livraison possible', async () => {
    const closed = startMockSynco();
    const url = closed.url;
    closed.stop();
    const client = new SyncoWebhook({ url, secret: closed.secret, logger: silentLogger, retry: { maxRetries: 1, maxDelayMs: 5 } });
    const error = await client.send('x').catch(e => e);
    expect(error).toBeInstanceOf(SyncoNetworkError);
    expect(error.maybeDelivered).toBe(false);
    expect(error.attempts).toBe(2);
    expect(error.message).not.toContain(closed.token);
  });

  test('délai dépassé : pas de relance implicite', async () => {
    const { mock, client } = setup({}, { timeoutMs: 50 });
    mock.intercept(async () => {
      await Bun.sleep(200);
      return jsonResponse(200, { success: true, messageId: 'late' });
    });
    const error = await client.send('x').catch(e => e);
    expect(error).toBeInstanceOf(SyncoTimeoutError);
    expect(error.attempts).toBe(1);
  });

  test('annulation par AbortSignal', async () => {
    const { mock, client } = setup();
    mock.intercept(async () => {
      await Bun.sleep(200);
      return jsonResponse(200, { success: true, messageId: 'late' });
    });
    const controller = new AbortController();
    const pending = client.send('x', { signal: controller.signal }).catch(e => e);
    setTimeout(() => controller.abort(), 20);
    expect(await pending).toBeInstanceOf(SyncoAbortError);
  });
});

describe('quota local', () => {
  test('le N+1e envoi attend la fenêtre suivante', async () => {
    const { client } = setup({}, { rateLimit: { perMinute: 2 } });
    await client.send('1');
    await client.send('2');
    const controller = new AbortController();
    const third = client.send('3', { signal: controller.signal }).catch(e => e);
    await Bun.sleep(30);
    controller.abort();
    expect(await third).toBeInstanceOf(SyncoAbortError);
  });
});

describe('E2EE', () => {
  test('texte chiffré de bout en bout, publié en clair après déchiffrement serveur', async () => {
    const keys = generateWebhookKeyPair();
    const { mock, client } = setup({ privateKey: keys.privateKey }, { e2ee: { publicKey: keys.publicKey } });
    await client.send({ content: 'Mot de passe tourné', username: 'Coffre' });
    const { payload, publishedContent } = mock.received[0]!;
    expect(payload.encrypted).toBe(true);
    expect(payload.content).not.toContain('Mot de passe');
    expect(payload._synco).toEqual({ encrypted: true });
    expect(publishedContent).toBe('Mot de passe tourné');
  });

  test('mode strict : rien en clair à côté du chiffré', async () => {
    const keys = generateWebhookKeyPair();
    const { mock, client } = setup({ privateKey: keys.privateKey }, { e2ee: { publicKey: keys.publicKey, strict: true } });
    const error = await client.send({ content: 'x', embeds: [{ title: 'fuite' }] }).catch(e => e);
    expect(error).toBeInstanceOf(SyncoValidationError);
    expect(error.issues[0].path).toBe('embeds');
    expect(mock.hits).toBe(0);
  });

  test('clair limité à 3072 octets', () => {
    const keys = generateWebhookKeyPair();
    const { client } = setup({}, { e2ee: { publicKey: keys.publicKey } });
    expect(client.validate('é'.repeat(1537))[0]!.path).toBe('content');
    expect(client.validate('é'.repeat(1536))).toEqual([]);
  });

  test('clé du serveur différente : SyncoDecryptionError', async () => {
    const { client } = setup({ privateKey: generateWebhookKeyPair().privateKey }, { e2ee: { publicKey: generateWebhookKeyPair().publicKey } });
    expect((await client.send('x').catch(e => e)).code).toBe('DECRYPTION_FAILED');
  });
});

describe('cycle de vie et divers', () => {
  test('close() attend la file puis refuse', async () => {
    const { mock, client } = setup();
    const pending = client.send('dernier');
    await client.close();
    expect(mock.received).toHaveLength(1);
    await pending;
    expect(client.send('trop tard')).rejects.toThrow(/fermé/);
  });

  test('E2EE : l\'ordre des appels est l\'ordre de publication', async () => {
    const keys = generateWebhookKeyPair();
    const { mock, client } = setup({ privateKey: keys.privateKey }, { e2ee: { publicKey: keys.publicKey } });
    const long = 'x'.repeat(3000);
    await Promise.all([client.send(long), client.send('court'), client.send(long.slice(0, 1500))]);
    expect(mock.received.map(r => (r.publishedContent as string).length)).toEqual([3000, 5, 1500]);
  });

  test('buildRequest : corps exact, signature valide, jeton masqué', async () => {
    const { mock, client } = setup();
    const built = await client.buildRequest('inspecté');
    expect(built.url).not.toContain(mock.token);
    expect(JSON.parse(built.body)).toEqual({ content: 'inspecté', _synco: {} });
    expect(built.headers['X-Synco-Signature']).toStartWith(`t=${built.headers['X-Synco-Timestamp']},v1=`);
  });

  test('hooks sans jeton dans l\'URL, et une exception de hook n\'interrompt rien', async () => {
    const urls: string[] = [];
    const { mock, client } = setup(
      {},
      {
        hooks: {
          beforeRequest: i => urls.push(i.url),
          afterResponse: () => {
            throw new Error('hook cassé');
          },
        },
      }
    );
    await client.send('x');
    expect(urls[0]).toEndWith('/***');
    expect(urls[0]).not.toContain(mock.token);
  });

  test('avertit une fois si du texte sera supprimé comme balise', async () => {
    mock = startMockSynco();
    const warnings: string[] = [];
    const client = new SyncoWebhook({ url: mock.url, secret: mock.secret, logger: { warn: m => warnings.push(m) } });
    await client.send('si a <b> c');
    await client.send('encore <x>');
    expect(warnings.filter(w => w.includes('chevrons'))).toHaveLength(1);
  });

  test('options invalides', () => {
    mock = startMockSynco();
    expect(() => new SyncoWebhook({ url: mock!.url, secret: null, timeoutMs: 0 })).toThrow(SyncoConfigError);
    expect(() => new SyncoWebhook({ webhookId: 'x', secret: null })).toThrow(/vont ensemble/);
    expect(() => new SyncoWebhook({ secret: null })).toThrow(/manquante/);
  });

  test('réponse 200 qui n\'est pas celle de Synco', async () => {
    const { mock, client } = setup();
    mock.intercept(() => new Response('<html>portail captif</html>', { status: 200 }));
    expect((await client.send('x').catch(e => e)).code).toBe('UNEXPECTED_RESPONSE');
  });
});
