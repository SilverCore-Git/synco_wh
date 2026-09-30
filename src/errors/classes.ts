import type { ValidationIssue } from '../message/types.js';

export type SyncoErrorCode =
  | 'CONFIG'
  | 'CLOSED'
  | 'VALIDATION'
  | 'BAD_REQUEST'
  | 'DECRYPTION_FAILED'
  | 'NO_THREAD'
  | 'SIGNATURE_REQUIRED'
  | 'INVALID_SIGNATURE_FORMAT'
  | 'INVALID_SIGNATURE'
  | 'TIMESTAMP_REJECTED'
  | 'INVALID_TOKEN'
  | 'UNAUTHORIZED'
  | 'WEBHOOK_DISABLED'
  | 'MISSING_PERMISSIONS'
  | 'THREAD_OUT_OF_SCOPE'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'PAYLOAD_TOO_LARGE'
  | 'RATE_LIMITED'
  | 'SERVER_ERROR'
  | 'UNEXPECTED_RESPONSE'
  | 'NETWORK'
  | 'TIMEOUT'
  | 'ABORTED';

export interface SyncoErrorOptions {
  code: SyncoErrorCode;
  /** Statut HTTP, absent pour une erreur locale ou réseau. */
  status?: number;
  /** Champ `message` renvoyé par synco_api. */
  serverMessage?: string;
  /** Vrai si relancer la même requête a une chance d'aboutir sans risque de doublon. */
  retryable?: boolean;
  /** Cause probable et remède. */
  hint?: string;
  cause?: unknown;
}

export class SyncoWebhookError extends Error {
  override name = 'SyncoWebhookError';
  readonly code: SyncoErrorCode;
  readonly status: number | undefined;
  readonly serverMessage: string | undefined;
  readonly retryable: boolean;
  readonly hint: string | undefined;
  /** Nombre de requêtes émises avant l'abandon ; renseigné par le client. */
  attempts = 0;

  constructor(message: string, options: SyncoErrorOptions) {
    super(options.hint ? `${message} — ${options.hint}` : message, { cause: options.cause });
    this.code = options.code;
    this.status = options.status;
    this.serverMessage = options.serverMessage;
    this.retryable = options.retryable ?? false;
    this.hint = options.hint;
  }
}

export class SyncoConfigError extends SyncoWebhookError {
  override name = 'SyncoConfigError';
  constructor(message: string, hint?: string) {
    super(message, { code: 'CONFIG', hint });
  }
}

export class SyncoValidationError extends SyncoWebhookError {
  override name = 'SyncoValidationError';
  readonly issues: ValidationIssue[];
  /** `local` : refusé avant envoi ; `server` : 400 renvoyé par synco_api. */
  readonly source: 'local' | 'server';

  constructor(issues: ValidationIssue[], source: 'local' | 'server', serverMessage?: string) {
    const list = issues.map(i => (i.path ? `${i.path} : ${i.message}` : i.message)).join(' ; ');
    super(
      source === 'local' ? `Message invalide : ${list}` : `Synco a refusé le message : ${list || serverMessage || 'format invalide'}`,
      { code: 'VALIDATION', status: source === 'server' ? 400 : undefined, serverMessage }
    );
    this.issues = issues;
    this.source = source;
  }
}

export class SyncoAuthError extends SyncoWebhookError {
  override name = 'SyncoAuthError';
}

export class SyncoForbiddenError extends SyncoWebhookError {
  override name = 'SyncoForbiddenError';
  readonly missingPermissions: string[];
  constructor(message: string, options: SyncoErrorOptions & { missingPermissions?: string[] }) {
    super(message, options);
    this.missingPermissions = options.missingPermissions ?? [];
  }
}

export class SyncoNotFoundError extends SyncoWebhookError {
  override name = 'SyncoNotFoundError';
}

export class SyncoPayloadTooLargeError extends SyncoWebhookError {
  override name = 'SyncoPayloadTooLargeError';
}

export class SyncoRateLimitError extends SyncoWebhookError {
  override name = 'SyncoRateLimitError';
  /** Délai conseillé avant de réessayer, en millisecondes. */
  readonly retryAfterMs: number | undefined;
  constructor(message: string, options: SyncoErrorOptions & { retryAfterMs?: number }) {
    super(message, options);
    this.retryAfterMs = options.retryAfterMs;
  }
}

export class SyncoDecryptionError extends SyncoWebhookError {
  override name = 'SyncoDecryptionError';
}

export class SyncoNoThreadError extends SyncoWebhookError {
  override name = 'SyncoNoThreadError';
}

export class SyncoServerError extends SyncoWebhookError {
  override name = 'SyncoServerError';
}

export class SyncoNetworkError extends SyncoWebhookError {
  override name = 'SyncoNetworkError';
  /**
   * Faux seulement quand on sait que rien n'est parti (DNS, connexion
   * refusée). Vrai ou inconnu : le message a peut-être été publié.
   */
  readonly maybeDelivered: boolean;
  constructor(message: string, options: SyncoErrorOptions & { maybeDelivered: boolean }) {
    super(message, options);
    this.maybeDelivered = options.maybeDelivered;
  }
}

export class SyncoTimeoutError extends SyncoWebhookError {
  override name = 'SyncoTimeoutError';
}

export class SyncoAbortError extends SyncoWebhookError {
  override name = 'SyncoAbortError';
  constructor(cause?: unknown) {
    super('Envoi annulé', { code: 'ABORTED', cause });
  }
}
