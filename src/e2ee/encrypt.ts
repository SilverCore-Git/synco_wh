import { SyncoConfigError } from '../errors/classes.js';
import { base64ToBytes, bytesToBase64, utf8 } from '../util/encoding.js';

// Protocole de receiveWebhook (synco_api, src/controllers/webhooks.ts) :
//   secret = ECDH(éphémère, clé publique du webhook)       — P-256, coordonnée x
//   clé    = HMAC-SHA256(key = sel, data = secret)          — 32 octets
//   chiffré, tag = AES-256-GCM(clé, iv, content)
// Seul `content` est chiffré ; le reste du payload voyage en clair.

export interface EncryptedFields {
  content: string;
  nonce: string;
  tag: string;
  salt: string;
  senderPublicKey: string;
}

export type ContentEncryptor = (plaintext: string) => Promise<EncryptedFields>;

// En-tête DER d'une clé publique SPKI ecPublicKey / prime256v1, point non
// compressé (0x04 ‖ X ‖ Y) — la forme générée par synco_api.
const P256_SPKI_PREFIX = Uint8Array.from([
  0x30, 0x59, 0x30, 0x13, 0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01, 0x06, 0x08, 0x2a, 0x86, 0x48, 0xce,
  0x3d, 0x03, 0x01, 0x07, 0x03, 0x42, 0x00, 0x04,
]);
const P256_SPKI_LENGTH = 91;
const SALT_BYTES = 16;
const IV_BYTES = 12;
const TAG_BYTES = 16;

/**
 * Vérifie, sans rien importer, que `pem` est bien la clé publique ECDH P-256
 * d'un webhook. Accepte les `\n` littéraux des variables d'environnement.
 */
export function parseWebhookPublicKey(pem: string): Uint8Array<ArrayBuffer> {
  const text = pem.replace(/\\n/g, '\n').trim();
  const match = /-----BEGIN PUBLIC KEY-----([\s\S]+?)-----END PUBLIC KEY-----/.exec(text);
  const hint = 'copiez la clé publique affichée dans les réglages avancés du webhook, en-têtes BEGIN/END compris';
  if (!match) throw new SyncoConfigError('Clé publique E2EE illisible', hint);

  let der: Uint8Array<ArrayBuffer>;
  try {
    der = base64ToBytes(match[1]!.replace(/\s+/g, ''));
  } catch {
    throw new SyncoConfigError('Clé publique E2EE : base64 invalide', hint);
  }
  const isP256 = der.length === P256_SPKI_LENGTH && P256_SPKI_PREFIX.every((byte, i) => der[i] === byte);
  if (!isP256) {
    throw new SyncoConfigError('Clé publique E2EE : ce n\'est pas une clé ECDH P-256', hint);
  }
  return der;
}

export function createContentEncryptor(publicKeyPem: string): ContentEncryptor {
  const der = parseWebhookPublicKey(publicKeyPem);
  let webhookKey: Promise<CryptoKey> | undefined;

  return async plaintext => {
    webhookKey ??= crypto.subtle.importKey('spki', der, { name: 'ECDH', namedCurve: 'P-256' }, false, []);

    const ephemeral = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
      'deriveBits',
    ])) as CryptoKeyPair;
    const shared = await crypto.subtle.deriveBits({ name: 'ECDH', public: await webhookKey }, ephemeral.privateKey, 256);

    const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
    const hmacKey = await crypto.subtle.importKey('raw', salt, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const aesBytes = await crypto.subtle.sign('HMAC', hmacKey, shared);
    const aesKey = await crypto.subtle.importKey('raw', aesBytes, { name: 'AES-GCM' }, false, ['encrypt']);

    const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
    const sealed = new Uint8Array(
      await crypto.subtle.encrypt({ name: 'AES-GCM', iv, tagLength: TAG_BYTES * 8 }, aesKey, utf8.encode(plaintext))
    );

    const spki = new Uint8Array(await crypto.subtle.exportKey('spki', ephemeral.publicKey));

    return {
      content: bytesToBase64(sealed.subarray(0, sealed.length - TAG_BYTES)),
      nonce: bytesToBase64(iv),
      tag: bytesToBase64(sealed.subarray(sealed.length - TAG_BYTES)),
      salt: bytesToBase64(salt),
      senderPublicKey: toPem(spki),
    };
  };
}

function toPem(spki: Uint8Array): string {
  const lines = bytesToBase64(spki).match(/.{1,64}/g) ?? [];
  return `-----BEGIN PUBLIC KEY-----\n${lines.join('\n')}\n-----END PUBLIC KEY-----\n`;
}
