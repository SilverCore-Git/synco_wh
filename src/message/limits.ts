// Bornes du schéma de réception de synco_api
// (src/middleware/webhookValidation.ts, `webhookPayloadSchema`).
// Une seule source : la validation locale, la troncature et la doc s'y réfèrent.

export const LIMITS = {
  contentLength: 4096,
  usernameLength: 100,
  embeds: 10,
  embedTitleLength: 256,
  embedDescriptionLength: 4096,
  embedAuthorNameLength: 256,
  embedFooterTextLength: 2048,
  embedFields: 25,
  fieldNameLength: 256,
  fieldValueLength: 1024,
  attachments: 10,
  attachmentFilenameLength: 256,
  mentions: 50,
  mentionLength: 100,
  /** Corps brut maximal accepté par `extractRawBody()`, en octets. */
  bodyBytes: 1024 * 1024,
  /**
   * Le chiffré base64 doit tenir dans `content` (4096 caractères) :
   * 3072 octets de clair donnent exactement 4096 caractères base64.
   */
  encryptedPlaintextBytes: 3072,
} as const;

/**
 * Plafond effectif d'un émetteur : `unknownWebhookLimiter` (clé IP + webhookId,
 * 50/min) s'applique avant l'authentification, donc à toutes les requêtes.
 */
export const DEFAULT_RATE_LIMIT_PER_MINUTE = 50;

/** Fenêtre anti-rejeu de `validateTimestamp()` côté serveur. */
export const SIGNATURE_WINDOW_MS = 300_000;

export const DEFAULT_BASE_URL = 'https://api.synco.fr';
export const DEFAULT_TIMEOUT_MS = 30_000;
export const DEFAULT_MAX_RETRIES = 3;
export const DEFAULT_MAX_RETRY_DELAY_MS = 60_000;
export const DEFAULT_CLOCK_SKEW_MS = 1_000;
