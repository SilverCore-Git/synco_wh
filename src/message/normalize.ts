import { normalizeColor } from './colors.js';
import { LIMITS } from './limits.js';
import type {
  EmbedSource,
  MessageDefaults,
  MessageInput,
  SyncoEmbed,
  SyncoMessage,
  WireEmbed,
  WirePayload,
} from './types.js';

export type OverflowMode = 'error' | 'truncate';

export interface NormalizeOptions {
  defaults?: MessageDefaults;
  /** Prioritaire sur `message.threadId` et `defaults.threadId`. */
  threadId?: string;
  /** `truncate` coupe les textes trop longs avec « … » ; `error` les laisse à la validation. */
  onOverflow?: OverflowMode;
}

export function toMessage(input: MessageInput): SyncoMessage {
  return typeof input === 'string' ? { content: input } : input;
}

/** Passe du format public (camelCase) au format filaire lu par synco_api. */
export function normalizeMessage(input: MessageInput, options: NormalizeOptions = {}): WirePayload {
  const message = toMessage(input);
  const fit = options.onOverflow === 'truncate' ? truncate : keep;
  const defaults = options.defaults ?? {};

  const wire: WirePayload = { _synco: {} };

  if (message.content !== undefined) wire.content = fit(message.content, LIMITS.contentLength);

  const username = message.username ?? defaults.username;
  if (username !== undefined) wire.username = fit(username, LIMITS.usernameLength);

  const avatarUrl = message.avatarUrl ?? defaults.avatarUrl;
  if (avatarUrl !== undefined) wire.avatar_url = avatarUrl;

  if (message.embeds?.length) {
    wire.embeds = message.embeds.map(source => normalizeEmbed(resolveEmbed(source), fit));
  }

  if (message.attachments?.length) {
    wire.attachments = message.attachments.map(a => ({
      url: a.url,
      ...(a.filename !== undefined && { filename: fit(a.filename, LIMITS.attachmentFilenameLength) }),
      ...(a.size !== undefined && { size: a.size }),
    }));
  }

  if (message.mentions?.length) wire.mentions = [...message.mentions];

  const threadId = options.threadId ?? message.threadId ?? defaults.threadId;
  if (threadId) wire._synco.targetThreadId = threadId;

  return wire;
}

function resolveEmbed(source: SyncoEmbed | EmbedSource): SyncoEmbed {
  return typeof (source as EmbedSource).build === 'function' ? (source as EmbedSource).build() : (source as SyncoEmbed);
}

function normalizeEmbed(embed: SyncoEmbed, fit: (text: string, max: number) => string): WireEmbed {
  const wire: WireEmbed = {};

  if (embed.title !== undefined) wire.title = fit(embed.title, LIMITS.embedTitleLength);
  if (embed.description !== undefined) wire.description = fit(embed.description, LIMITS.embedDescriptionLength);
  if (embed.url !== undefined) wire.url = embed.url;
  if (embed.color !== undefined) wire.color = normalizeColor(embed.color);
  if (embed.timestamp !== undefined) wire.timestamp = normalizeTimestamp(embed.timestamp);

  if (embed.author) {
    wire.author = {
      ...(embed.author.name !== undefined && { name: fit(embed.author.name, LIMITS.embedAuthorNameLength) }),
      ...(embed.author.iconUrl !== undefined && { icon_url: embed.author.iconUrl }),
    };
  }
  if (embed.footer) {
    wire.footer = {
      ...(embed.footer.text !== undefined && { text: fit(embed.footer.text, LIMITS.embedFooterTextLength) }),
      ...(embed.footer.iconUrl !== undefined && { icon_url: embed.footer.iconUrl }),
    };
  }

  if (embed.fields?.length) {
    wire.fields = embed.fields.map(field => ({
      name: fit(String(field.name), LIMITS.fieldNameLength),
      value: fit(String(field.value), LIMITS.fieldValueLength),
      ...(field.inline !== undefined && { inline: field.inline }),
    }));
  }

  if (embed.image !== undefined) wire.image = { url: typeof embed.image === 'string' ? embed.image : embed.image.url };
  if (embed.thumbnail !== undefined) {
    wire.thumbnail = { url: typeof embed.thumbnail === 'string' ? embed.thumbnail : embed.thumbnail.url };
  }

  return wire;
}

/**
 * synco_api attend un `datetime` ISO en UTC (`toISOString()`). Une valeur
 * illisible est laissée telle quelle pour que la validation la signale.
 */
function normalizeTimestamp(value: Date | string | number): string {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

function keep(text: string): string {
  return text;
}

/** Coupe à `max` unités UTF-16 avec « … », sans séparer une paire de substitution. */
export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  let end = max - 1;
  const code = text.charCodeAt(end - 1);
  if (code >= 0xd800 && code <= 0xdbff) end -= 1;
  return `${text.slice(0, end)}…`;
}
