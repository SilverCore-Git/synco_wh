export {
  SyncoWebhook,
  sendSyncoMessage,
  type BuiltRequest,
  type ForwardOptions,
  type SendOptions,
  type SyncoHooks,
  type SyncoWebhookOptions,
} from './client.js';

export { Colors } from './message/colors.js';
export { embed, EmbedBuilder } from './message/embed-builder.js';
export { LIMITS } from './message/limits.js';
export type { OverflowMode } from './message/normalize.js';
export type {
  ColorInput,
  ColorName,
  EmbedSource,
  MessageDefaults,
  MessageInput,
  RateLimitInfo,
  SendResult,
  SyncoAttachment,
  SyncoEmbed,
  SyncoEmbedField,
  SyncoMessage,
  ValidationIssue,
  WirePayload,
} from './message/types.js';

export { parseWebhookUrl, type WebhookEndpoint } from './config.js';
export { detectFormat, type ForwardFormat, type PayloadFormat } from './forward.js';
export { signPayload } from './transport/sign.js';

export {
  SyncoAbortError,
  SyncoAuthError,
  SyncoConfigError,
  SyncoDecryptionError,
  SyncoForbiddenError,
  SyncoNetworkError,
  SyncoNoThreadError,
  SyncoNotFoundError,
  SyncoPayloadTooLargeError,
  SyncoRateLimitError,
  SyncoServerError,
  SyncoTimeoutError,
  SyncoValidationError,
  SyncoWebhookError,
  type SyncoErrorCode,
} from './errors/classes.js';

export { VERSION } from './version.js';
