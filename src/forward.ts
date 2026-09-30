import type { SyncoEmbed, SyncoMessage } from './message/types.js';

export type PayloadFormat = 'synco' | 'discord' | 'github';
export type ForwardFormat = 'auto' | PayloadFormat;

type Loose = Record<string, unknown>;

/**
 * Même ordre et mêmes heuristiques que synco_api (src/utils/webhookMappers.ts) :
 * Synco (`_synco`) → Discord → GitHub. `undefined` si rien ne correspond — le
 * serveur publie alors le payload tel quel, comme un message natif.
 */
export function detectFormat(payload: unknown): PayloadFormat | undefined {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return undefined;
  const p = payload as Loose;

  if (p._synco !== undefined) return 'synco';
  if (Array.isArray(p.embeds)) return 'discord';
  if (typeof p.content === 'string' && typeof p.username === 'string') return 'discord';
  if (typeof p.tts === 'boolean' || p.file || p.attachments) return 'discord';
  if (typeof p.action === 'string') return 'github';
  if (p.repository || p.sender || p.issue || p.pull_request) return 'github';
  return undefined;
}

/**
 * Convertit localement un payload de webhook Discord en message Synco. Fait
 * ici plutôt que par le mapper serveur : la couleur entière de Discord est
 * rejetée par la validation serveur avant même d'atteindre ce mapper.
 */
export function discordToMessage(payload: unknown): SyncoMessage {
  const p = (payload ?? {}) as Loose;
  const message: SyncoMessage = {};

  if (typeof p.content === 'string') message.content = p.content;
  if (typeof p.username === 'string') message.username = p.username;
  if (typeof p.avatar_url === 'string') message.avatarUrl = p.avatar_url;

  if (Array.isArray(p.embeds)) {
    message.embeds = p.embeds.filter(isObject).map(discordEmbed);
  }

  if (Array.isArray(p.attachments)) {
    const attachments = p.attachments.filter(isObject).flatMap(a => {
      const url = str(a.url) ?? str(a.proxy_url);
      if (!url) return [];
      return [{ url, ...(str(a.filename) && { filename: str(a.filename) }), ...(typeof a.size === 'number' && { size: a.size }) }];
    });
    if (attachments.length) message.attachments = attachments;
  }

  return message;
}

function discordEmbed(e: Loose): SyncoEmbed {
  const embed: SyncoEmbed = {};
  if (str(e.title)) embed.title = str(e.title);
  if (str(e.description)) embed.description = str(e.description);
  if (str(e.url)) embed.url = str(e.url);
  if (typeof e.color === 'number' || typeof e.color === 'string') embed.color = e.color;
  if (typeof e.timestamp === 'string' || typeof e.timestamp === 'number') embed.timestamp = e.timestamp;

  if (isObject(e.author)) {
    embed.author = {
      ...(str(e.author.name) && { name: str(e.author.name) }),
      ...(str(e.author.icon_url) && { iconUrl: str(e.author.icon_url) }),
    };
  }
  if (isObject(e.footer)) {
    embed.footer = {
      ...(str(e.footer.text) && { text: str(e.footer.text) }),
      ...(str(e.footer.icon_url) && { iconUrl: str(e.footer.icon_url) }),
    };
  }
  if (Array.isArray(e.fields)) {
    embed.fields = e.fields.filter(isObject).map(f => ({
      name: String(f.name ?? ''),
      value: String(f.value ?? ''),
      ...(typeof f.inline === 'boolean' && { inline: f.inline }),
    }));
  }
  if (isObject(e.image) && str(e.image.url)) embed.image = str(e.image.url);
  if (isObject(e.thumbnail) && str(e.thumbnail.url)) embed.thumbnail = str(e.thumbnail.url);

  return embed;
}

function isObject(value: unknown): value is Loose {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}
