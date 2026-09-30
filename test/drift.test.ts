// Garde-fous contre une évolution silencieuse de synco_api sur les points
// que la librairie ne peut pas tester en important le vrai code. Si l'un de
// ces tests casse, relire le changement côté API et adapter la librairie.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { API_DIR, REAL_SERVER } from './helpers/server.ts';

const read = (path: string) => readFileSync(resolve(API_DIR, path), 'utf8');

describe.skipIf(!REAL_SERVER)('contrat synco_api inchangé', () => {
  test('dérivation E2EE : HMAC-SHA256(sel, secret ECDH) tronqué à 32 octets, AES-256-GCM', () => {
    const crypto = read('src/utils/webhookCrypto.ts');
    expect(crypto).toContain("const ALGORITHM = 'aes-256-gcm'");
    expect(crypto).toContain('crypto.diffieHellman({ privateKey: ourPrivateKey, publicKey: theirPublicKey })');
    expect(crypto).toContain("const hkdf = crypto.createHmac('sha256', salt);");
    expect(crypto).toContain('return hkdf.digest().subarray(0, KEY_LENGTH);');
  });

  test('déchiffrement de `content` seul, dans receiveWebhook', () => {
    const controller = read('src/controllers/webhooks.ts');
    expect(controller).toContain('payload.senderPublicKey,');
    expect(controller).toContain("payload.content || '',");
    expect(controller).toContain('if (isSyncoPayload(payload)) {');
  });

  test('en-têtes et fenêtre anti-rejeu', () => {
    const auth = read('src/middleware/webhookAuth.ts');
    expect(auth).toContain("req.get('X-Synco-Signature')");
    expect(auth).toContain("req.get('X-Synco-Timestamp')");
    const security = read('src/utils/webhookSecurity.ts');
    expect(security).toContain('maxAgeMs: number = 300000');
    expect(security).toContain('return age >= 0 && age <= maxAgeMs;');
  });

  test('plafond de 50 requêtes/min par IP et webhook avant authentification', () => {
    expect(read('src/routes/webhookReception.ts')).toContain('createCustomWebhookLimiter(50, 60 * 1000)');
  });
});
