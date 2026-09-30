import { describe, expect, test } from 'bun:test';
import crypto from 'node:crypto';
import { createContentEncryptor, parseWebhookPublicKey } from '../src/e2ee/encrypt.ts';
import { SyncoConfigError } from '../src/errors/classes.ts';
import { generateWebhookKeyPair, serverDecrypt } from './helpers/server.ts';

describe('chiffrement E2EE', () => {
  test('déchiffré par le protocole du serveur', async () => {
    const keys = generateWebhookKeyPair();
    const encrypt = createContentEncryptor(keys.publicKey);
    for (const text of ['Mot de passe du coffre tourné', 'é🔐'.repeat(100), 'x']) {
      const fields = await encrypt(text);
      expect(serverDecrypt(keys.privateKey, fields)).toBe(text);
    }
  });

  test('champs dans les bornes du schéma serveur', async () => {
    const keys = generateWebhookKeyPair();
    const fields = await createContentEncryptor(keys.publicKey)('a'.repeat(3072));
    expect(fields.content.length).toBe(4096);
    expect(fields.nonce.length).toBeLessThanOrEqual(64);
    expect(fields.tag.length).toBeLessThanOrEqual(64);
    expect(fields.salt.length).toBeLessThanOrEqual(64);
    expect(fields.senderPublicKey.length).toBeLessThanOrEqual(512);
  });

  test('clé éphémère et sel neufs à chaque message', async () => {
    const encrypt = createContentEncryptor(generateWebhookKeyPair().publicKey);
    const [a, b] = await Promise.all([encrypt('même texte'), encrypt('même texte')]);
    expect(a.senderPublicKey).not.toBe(b.senderPublicKey);
    expect(a.salt).not.toBe(b.salt);
    expect(a.content).not.toBe(b.content);
  });

  test('une autre clé privée ne déchiffre pas', async () => {
    const fields = await createContentEncryptor(generateWebhookKeyPair().publicKey)('secret');
    expect(() => serverDecrypt(generateWebhookKeyPair().privateKey, fields)).toThrow();
  });
});

describe('parseWebhookPublicKey', () => {
  test('accepte les \\n littéraux d\'une variable d\'environnement', () => {
    const pem = generateWebhookKeyPair().publicKey.trim().replace(/\n/g, '\\n');
    expect(parseWebhookPublicKey(pem)).toHaveLength(91);
  });

  test('refuse une autre courbe, une clé RSA ou du texte', () => {
    const other = crypto.generateKeyPairSync('ec', { namedCurve: 'secp384r1', publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
    const rsa = crypto.generateKeyPairSync('rsa', { modulusLength: 2048, publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
    expect(() => parseWebhookPublicKey(other.publicKey)).toThrow(SyncoConfigError);
    expect(() => parseWebhookPublicKey(rsa.publicKey)).toThrow(SyncoConfigError);
    expect(() => parseWebhookPublicKey('Base64EncodedPublicKey...')).toThrow(SyncoConfigError);
  });
});
