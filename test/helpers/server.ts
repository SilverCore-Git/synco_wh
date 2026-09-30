// Accès au code serveur de synco_api, pour que les tests confrontent la
// librairie à la VRAIE vérification plutôt qu'à notre lecture de celle-ci.
//
// Le dépôt synco_api est cherché à côté de celui-ci (ou via SYNCO_API_DIR).
// Absent, on retombe sur des copies fidèles ; `REAL_SERVER` le signale et
// les tests « croisés » qui n'ont de sens qu'avec le vrai code sont sautés.

import crypto from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

export const API_DIR = process.env.SYNCO_API_DIR ?? resolve(import.meta.dir, '../../../synco_api');
export const REAL_SERVER = existsSync(resolve(API_DIR, 'src/utils/webhookSecurity.ts'));

interface SecurityModule {
  parseSignature(header: string | undefined): { timestamp: string; signature: string } | null;
  verifySignature(signature: string, timestamp: string, body: string, secret: string): boolean;
  createSignature(timestamp: string, body: string, secret: string): string;
}

interface ZodLike {
  safeParse(value: unknown): { success: boolean; error?: { issues: Array<{ path: PropertyKey[]; message: string }> } };
}

// Copies de synco_api/src/utils/webhookSecurity.ts, utilisées sans le dépôt.
const fallbackSecurity: SecurityModule = {
  parseSignature(header) {
    const match = header?.match(/^t=(\d+),v1=([a-f0-9]+)$/);
    return match ? { timestamp: match[1]!, signature: match[2]! } : null;
  },
  verifySignature(signature, timestamp, body, secret) {
    const expected = crypto.createHmac('sha256', secret).update(timestamp + body).digest('hex');
    return signature.length === expected.length && crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  },
  createSignature(timestamp, body, secret) {
    return `t=${timestamp},v1=${crypto.createHmac('sha256', secret).update(timestamp + body).digest('hex')}`;
  },
};

export const security: SecurityModule = REAL_SERVER
  ? await import(resolve(API_DIR, 'src/utils/webhookSecurity.ts'))
  : fallbackSecurity;

/** `webhookPayloadSchema` réel, ou `undefined` sans le dépôt. */
export const payloadSchema: ZodLike | undefined = REAL_SERVER
  ? (await import(resolve(API_DIR, 'src/middleware/webhookValidation.ts'))).webhookPayloadSchema
  : undefined;

export const missingWebhookPermissions: (payload: Record<string, unknown>, granted: readonly string[]) => string[] =
  REAL_SERVER
    ? (await import(resolve(API_DIR, 'src/utils/webhookPermissions.ts'))).missingWebhookPermissions
    : (payload, granted) => {
        const missing: string[] = [];
        if (payload.content && !granted.includes('send_messages')) missing.push('send_messages');
        if ((payload.embeds as unknown[] | undefined)?.length && !granted.includes('send_embeds')) missing.push('send_embeds');
        if ((payload.attachments as unknown[] | undefined)?.length && !granted.includes('send_attachments')) {
          missing.push('send_attachments');
        }
        return missing;
      };

/**
 * Déchiffrement côté serveur, recopié de receiveWebhook +
 * deriveWebhookAESKeyFromECDH + decryptMessage (src/utils/webhookCrypto.ts).
 * Ce module-là n'est pas importable hors de synco_api (Prisma, clé maître) ;
 * test/drift.test.ts vérifie que le code source n'a pas changé de protocole.
 */
export function serverDecrypt(
  privateKeyPem: string,
  payload: { content?: string; nonce?: string; tag?: string; salt?: string; senderPublicKey?: string }
): string {
  if (!payload.senderPublicKey || !payload.salt || !payload.tag) {
    throw new Error('Missing senderPublicKey/salt/tag for encrypted payload');
  }
  const shared = crypto.diffieHellman({
    privateKey: crypto.createPrivateKey(privateKeyPem),
    publicKey: crypto.createPublicKey(payload.senderPublicKey),
  });
  const hkdf = crypto.createHmac('sha256', Buffer.from(payload.salt, 'base64'));
  hkdf.update(shared);
  const key = hkdf.digest().subarray(0, 32);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(payload.nonce ?? '', 'base64'));
  decipher.setAuthTag(Buffer.from(payload.tag, 'base64'));
  return decipher.update(payload.content ?? '', 'base64', 'utf8') + decipher.final('utf8');
}

/** Paire ECDH d'un webhook E2EE, générée comme generateECDHKeyPair(). */
export function generateWebhookKeyPair(): { publicKey: string; privateKey: string } {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', {
    namedCurve: 'prime256v1',
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  return { publicKey, privateKey };
}

/** Jeton et secret au format de generateToken() / generateSecret(). */
export function randomBase62(length: number): string {
  const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  return [...crypto.randomBytes(length)].map(b => charset[b % charset.length]).join('');
}
