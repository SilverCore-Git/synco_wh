import { bytesToHex, utf8 } from '../util/encoding.js';

export type Signer = (timestamp: string, body: string) => Promise<string>;

/**
 * Signataire HMAC-SHA256 d'un webhook, clé importée une seule fois.
 * Produit la valeur de `X-Synco-Signature` : `t=<timestamp>,v1=<hex>`,
 * hex en minuscules (le serveur n'accepte que `[a-f0-9]+`).
 */
export function createSigner(secret: string): Signer {
  let key: Promise<CryptoKey> | undefined;

  return async (timestamp, body) => {
    key ??= crypto.subtle.importKey('raw', utf8.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const mac = await crypto.subtle.sign('HMAC', await key, utf8.encode(timestamp + body));
    return `t=${timestamp},v1=${bytesToHex(new Uint8Array(mac))}`;
  };
}

/**
 * Signe un corps pour un envoi fait à la main (autre client HTTP, proxy…).
 * `body` doit être la chaîne exacte envoyée, octet pour octet.
 */
export function signPayload(secret: string, timestamp: string | number, body: string): Promise<string> {
  return createSigner(secret)(String(timestamp), body);
}
