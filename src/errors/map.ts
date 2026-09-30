import {
  SyncoAuthError,
  SyncoDecryptionError,
  SyncoForbiddenError,
  SyncoNoThreadError,
  SyncoNotFoundError,
  SyncoPayloadTooLargeError,
  SyncoRateLimitError,
  SyncoServerError,
  SyncoValidationError,
  SyncoWebhookError,
} from './classes.js';

/** Forme des corps d'erreur de synco_api (`{ success: false, … }`). */
export interface ServerErrorBody {
  success?: boolean;
  error?: string;
  message?: string;
  details?: Array<{ path?: string; message?: string }>;
  missingPermissions?: string[];
  retryAfter?: number;
}

// Les messages serveur sont la seule clé disponible pour distinguer les cas :
// chacun est couvert par test/errors.test.ts, pour qu'un changement côté API
// casse un test plutôt qu'un intégrateur.

/**
 * Traduit une réponse d'échec de synco_api en erreur typée.
 * `retryAfterMs` est le délai déjà déduit des en-têtes, pour un 429.
 */
export function mapHttpError(status: number, body: ServerErrorBody | undefined, retryAfterMs?: number): SyncoWebhookError {
  const error = body?.error ?? '';
  const message = body?.message ?? '';
  const serverMessage = message || error || undefined;
  const base = { status, serverMessage };

  switch (status) {
    case 400:
      if (error === 'Validation error') {
        const issues = (body?.details ?? []).map(d => ({ path: d.path ?? '', message: d.message ?? 'invalide' }));
        return new SyncoValidationError(issues, 'server', serverMessage);
      }
      if (error === 'Decryption failed') {
        return new SyncoDecryptionError('Synco n\'a pas pu déchiffrer le message', {
          ...base,
          code: 'DECRYPTION_FAILED',
          hint: 'vérifiez la clé publique E2EE : elle a peut-être changé, ou le chiffrement n\'est pas activé sur ce webhook',
        });
      }
      if (error === 'No thread found') {
        return new SyncoNoThreadError('Aucun salon où publier', {
          ...base,
          code: 'NO_THREAD',
          hint: 'l\'espace du webhook n\'a aucun salon ; créez-en un ou choisissez un salon de destination',
        });
      }
      return new SyncoWebhookError(`Requête refusée : ${serverMessage ?? 'Bad Request'}`, { ...base, code: 'BAD_REQUEST' });

    case 401:
      if (message.startsWith('X-Synco-Signature')) {
        return new SyncoAuthError('Ce webhook exige une signature', {
          ...base,
          code: 'SIGNATURE_REQUIRED',
          hint: 'fournissez l\'option `secret` (ou SYNCO_WEBHOOK_SECRET)',
        });
      }
      if (message === 'Invalid signature format') {
        return new SyncoAuthError('En-tête de signature mal formé', { ...base, code: 'INVALID_SIGNATURE_FORMAT' });
      }
      if (message === 'Invalid signature') {
        return new SyncoAuthError('Signature refusée', {
          ...base,
          code: 'INVALID_SIGNATURE',
          hint: 'le secret ne correspond pas à ce webhook ; s\'il a été régénéré, reprenez le nouveau',
        });
      }
      if (message === 'Timestamp too old') {
        return new SyncoAuthError('Horodatage refusé', {
          ...base,
          code: 'TIMESTAMP_REJECTED',
          hint: 'l\'horloge de cette machine est décalée de plus de 5 minutes, ou en avance sur celle du serveur',
        });
      }
      if (message === 'Invalid token') {
        return new SyncoAuthError('Adresse du webhook refusée', {
          ...base,
          code: 'INVALID_TOKEN',
          hint: 'l\'adresse a probablement été régénérée ; copiez la nouvelle depuis les réglages du webhook',
        });
      }
      return new SyncoAuthError(`Authentification refusée : ${serverMessage ?? 'Unauthorized'}`, { ...base, code: 'UNAUTHORIZED' });

    case 403:
      if (message === 'Webhook is disabled') {
        return new SyncoForbiddenError('Le webhook est en pause', {
          ...base,
          code: 'WEBHOOK_DISABLED',
          hint: 'réactivez-le depuis sa fiche dans Synco',
        });
      }
      if (body?.missingPermissions?.length || message.startsWith('This webhook is not allowed to')) {
        const missing = body?.missingPermissions ?? [];
        return new SyncoForbiddenError(`Permission manquante : ${missing.join(', ') || message}`, {
          ...base,
          code: 'MISSING_PERMISSIONS',
          missingPermissions: missing,
          hint: 'accordez-la dans les réglages avancés du webhook, ou retirez la partie concernée du message',
        });
      }
      if (message.startsWith('Target thread')) {
        return new SyncoForbiddenError('Salon cible hors de l\'espace du webhook', {
          ...base,
          code: 'THREAD_OUT_OF_SCOPE',
          hint: 'un webhook ne peut viser qu\'un salon de son propre espace',
        });
      }
      return new SyncoForbiddenError(`Accès refusé : ${serverMessage ?? 'Forbidden'}`, { ...base, code: 'FORBIDDEN' });

    case 404:
      return new SyncoNotFoundError('Webhook introuvable', {
        ...base,
        code: 'NOT_FOUND',
        hint: 'l\'identifiant de l\'adresse est faux, ou le webhook a été supprimé',
      });

    case 413:
      return new SyncoPayloadTooLargeError('Message trop volumineux', {
        ...base,
        code: 'PAYLOAD_TOO_LARGE',
        hint: 'le corps de la requête dépasse 1 Mo',
      });

    case 429:
      return new SyncoRateLimitError('Quota de requêtes dépassé', {
        ...base,
        code: 'RATE_LIMITED',
        retryable: true,
        retryAfterMs,
        hint: 'espacez les envois ou regroupez plusieurs événements dans un même message',
      });
  }

  if (status >= 500) {
    // 502/503/504 viennent du mandataire, la requête n'a pas été traitée.
    // Un 500 peut survenir APRÈS la création du message : pas de relance
    // implicite, sous peine de doublon.
    const gateway = status === 502 || status === 503 || status === 504;
    return new SyncoServerError(`Erreur du serveur Synco (${status})`, {
      ...base,
      code: 'SERVER_ERROR',
      retryable: gateway,
      hint: gateway ? undefined : 'le message a peut-être été publié malgré l\'erreur',
    });
  }

  return new SyncoWebhookError(`Réponse inattendue de Synco (${status})`, { ...base, code: 'UNEXPECTED_RESPONSE' });
}
