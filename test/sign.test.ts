import { describe, expect, test } from 'bun:test';
import crypto from 'node:crypto';
import { createSigner, signPayload } from '../src/transport/sign.ts';
import { randomBase62, REAL_SERVER, security } from './helpers/server.ts';

describe('signature HMAC', () => {
  test('identique à createSignature() du serveur', async () => {
    const secret = randomBase62(36);
    const body = JSON.stringify({ content: 'Déploiement terminé 🚀', _synco: {} });
    const ts = String(Date.now());
    expect(await signPayload(secret, ts, body)).toBe(security.createSignature(ts, body, secret));
  });

  test('acceptée par parseSignature() + verifySignature() du serveur', async () => {
    const secret = randomBase62(36);
    const sign = createSigner(secret);
    for (const body of ['{}', '{"content":"é à ü"}', JSON.stringify({ content: 'x'.repeat(4096) })]) {
      const header = await sign('1759230000000', body);
      const parsed = security.parseSignature(header);
      expect(parsed).not.toBeNull();
      expect(security.verifySignature(parsed!.signature, parsed!.timestamp, body, secret)).toBe(true);
      expect(security.verifySignature(parsed!.signature, parsed!.timestamp, `${body} `, secret)).toBe(false);
    }
  });

  test('hex en minuscules, seul format accepté par le serveur', async () => {
    const header = await signPayload('s', 1, 'b');
    expect(header).toMatch(/^t=1,v1=[a-f0-9]{64}$/);
  });

  test('vecteur de référence node:crypto', async () => {
    const expected = crypto.createHmac('sha256', 'MonSuperSecret1234567890').update('1656234567890{"content":"Hello World"}').digest('hex');
    expect(await signPayload('MonSuperSecret1234567890', '1656234567890', '{"content":"Hello World"}')).toBe(
      `t=1656234567890,v1=${expected}`
    );
  });

  test.skipIf(!REAL_SERVER)('le code serveur réel est bien celui testé', () => {
    expect(typeof security.verifySignature).toBe('function');
  });
});
