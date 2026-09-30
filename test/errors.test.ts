import { describe, expect, test } from 'bun:test';
import {
  SyncoAuthError,
  SyncoDecryptionError,
  SyncoForbiddenError,
  SyncoNoThreadError,
  SyncoNotFoundError,
  SyncoRateLimitError,
  SyncoServerError,
  SyncoValidationError,
  SyncoWebhookError,
} from '../src/errors/classes.ts';
import { mapHttpError } from '../src/errors/map.ts';

// Corps d'erreur recopiés tels que synco_api les émet (webhookAuth.ts,
// webhookValidation.ts, controllers/webhooks.ts, webhookRateLimiter.ts).
const cases: Array<[number, Record<string, unknown>, string, new (...args: never[]) => SyncoWebhookError]> = [
  [400, { success: false, error: 'Validation error', message: 'Invalid payload format', details: [{ path: 'embeds.0.color', message: 'Invalid' }] }, 'VALIDATION', SyncoValidationError],
  [400, { success: false, error: 'Decryption failed', message: 'Failed to decrypt E2EE message' }, 'DECRYPTION_FAILED', SyncoDecryptionError],
  [400, { success: false, error: 'No thread found', message: 'No thread found in workspace to post the message' }, 'NO_THREAD', SyncoNoThreadError],
  [401, { success: false, error: 'Unauthorized', message: 'X-Synco-Signature and X-Synco-Timestamp headers are required for this webhook' }, 'SIGNATURE_REQUIRED', SyncoAuthError],
  [401, { success: false, error: 'Unauthorized', message: 'Invalid signature format' }, 'INVALID_SIGNATURE_FORMAT', SyncoAuthError],
  [401, { success: false, error: 'Unauthorized', message: 'Invalid signature' }, 'INVALID_SIGNATURE', SyncoAuthError],
  [401, { success: false, error: 'Unauthorized', message: 'Timestamp too old' }, 'TIMESTAMP_REJECTED', SyncoAuthError],
  [401, { success: false, error: 'Unauthorized', message: 'Invalid token' }, 'INVALID_TOKEN', SyncoAuthError],
  [403, { success: false, error: 'Forbidden', message: 'Webhook is disabled' }, 'WEBHOOK_DISABLED', SyncoForbiddenError],
  [403, { success: false, error: 'Forbidden', message: 'This webhook is not allowed to: send_embeds', missingPermissions: ['send_embeds'] }, 'MISSING_PERMISSIONS', SyncoForbiddenError],
  [403, { success: false, error: 'Forbidden', message: 'Target thread does not belong to this webhook workspace' }, 'THREAD_OUT_OF_SCOPE', SyncoForbiddenError],
  [404, { success: false, error: 'Not found', message: 'Webhook not found' }, 'NOT_FOUND', SyncoNotFoundError],
  [413, { success: false, error: 'Payload too large' }, 'PAYLOAD_TOO_LARGE', SyncoWebhookError],
  [429, { success: false, error: 'Rate limited', message: 'Too many requests for this webhook. Try again later.', retryAfter: 1759230000 }, 'RATE_LIMITED', SyncoRateLimitError],
  [500, { success: false, error: 'Internal Server Error', message: 'Failed to process webhook request' }, 'SERVER_ERROR', SyncoServerError],
  [503, {}, 'SERVER_ERROR', SyncoServerError],
];

describe('mapHttpError', () => {
  test.each(cases)('%i %j → %s', (status, body, code, Class) => {
    const error = mapHttpError(status, body);
    expect(error).toBeInstanceOf(Class);
    expect(error).toBeInstanceOf(SyncoWebhookError);
    expect(error.code).toBe(code as SyncoWebhookError['code']);
    expect(error.status).toBe(status);
  });

  test('détails de validation serveur conservés', () => {
    const error = mapHttpError(400, cases[0]![1]) as SyncoValidationError;
    expect(error.source).toBe('server');
    expect(error.issues).toEqual([{ path: 'embeds.0.color', message: 'Invalid' }]);
  });

  test('permissions manquantes exposées', () => {
    expect((mapHttpError(403, cases[9]![1]) as SyncoForbiddenError).missingPermissions).toEqual(['send_embeds']);
  });

  test('relançable : 429 et 502–504, pas 500 (doublon possible) ni les 4xx', () => {
    expect(mapHttpError(429, {}).retryable).toBe(true);
    expect(mapHttpError(502, {}).retryable).toBe(true);
    expect(mapHttpError(504, {}).retryable).toBe(true);
    expect(mapHttpError(500, {}).retryable).toBe(false);
    expect(mapHttpError(401, { message: 'Invalid token' }).retryable).toBe(false);
  });

  test('le message porte la cause probable', () => {
    expect(mapHttpError(401, { message: 'Invalid token' }).message).toMatch(/régénérée/);
  });
});
