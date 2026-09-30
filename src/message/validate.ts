import { LIMITS } from './limits.js';
import type { ValidationIssue, WireEmbed, WirePayload } from './types.js';

// Miroir de `webhookPayloadSchema` (synco_api, src/middleware/webhookValidation.ts).
// Les longueurs sont comptées en unités UTF-16, comme `z.string().max()`.
// Deux règles vont plus loin que le serveur, qui accepte ces cas mais publie
// un message vide ou une URL vidée : message sans contenu, URL non http(s).

const COLOR_PATTERN = /^#[0-9A-Fa-f]{6}$/;
const ISO_DATETIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?Z$/;

export function validatePayload(wire: WirePayload): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const add = (path: string, message: string) => issues.push({ path, message });

  const hasContent = typeof wire.content === 'string' && wire.content.trim().length > 0;
  const hasEmbeds = (wire.embeds?.length ?? 0) > 0;
  const hasAttachments = (wire.attachments?.length ?? 0) > 0;
  if (!hasContent && !hasEmbeds && !hasAttachments) {
    add('', 'le message est vide : il faut au moins un texte (`content`), un embed ou une pièce jointe');
  }

  maxLength(add, 'content', wire.content, LIMITS.contentLength);
  maxLength(add, 'username', wire.username, LIMITS.usernameLength);
  httpUrl(add, 'avatarUrl', wire.avatar_url);

  if (wire.embeds) {
    maxItems(add, 'embeds', wire.embeds, LIMITS.embeds);
    wire.embeds.forEach((embed, i) => validateEmbed(add, `embeds[${i}]`, embed));
  }

  if (wire.attachments) {
    maxItems(add, 'attachments', wire.attachments, LIMITS.attachments);
    wire.attachments.forEach((attachment, i) => {
      const path = `attachments[${i}]`;
      if (!attachment.url) add(`${path}.url`, 'obligatoire');
      else httpUrl(add, `${path}.url`, attachment.url);
      maxLength(add, `${path}.filename`, attachment.filename, LIMITS.attachmentFilenameLength);
      if (attachment.size !== undefined && !(Number.isInteger(attachment.size) && attachment.size > 0)) {
        add(`${path}.size`, 'doit être un entier positif (octets)');
      }
    });
  }

  if (wire.mentions) {
    maxItems(add, 'mentions', wire.mentions, LIMITS.mentions);
    wire.mentions.forEach((mention, i) => maxLength(add, `mentions[${i}]`, mention, LIMITS.mentionLength));
  }

  if (wire._synco.targetThreadId !== undefined && !wire._synco.targetThreadId.trim()) {
    add('threadId', 'ne peut pas être vide');
  }

  return issues;
}

function validateEmbed(add: (path: string, message: string) => void, path: string, embed: WireEmbed): void {
  const hasBody =
    embed.title || embed.description || embed.fields?.length || embed.image?.url || embed.thumbnail?.url || embed.author?.name;
  if (!hasBody) add(path, 'embed vide : il faut au moins un titre, une description, un champ ou une image');

  maxLength(add, `${path}.title`, embed.title, LIMITS.embedTitleLength);
  maxLength(add, `${path}.description`, embed.description, LIMITS.embedDescriptionLength);
  httpUrl(add, `${path}.url`, embed.url);

  if (embed.color !== undefined && !COLOR_PATTERN.test(embed.color)) {
    add(`${path}.color`, `couleur non reconnue (« ${embed.color} ») : utilisez '#rrggbb', un entier 0xrrggbb ou un nom de Colors`);
  }
  if (embed.timestamp !== undefined && !ISO_DATETIME_PATTERN.test(embed.timestamp)) {
    add(`${path}.timestamp`, 'date illisible : passez une Date, un nombre de millisecondes ou une chaîne ISO 8601');
  }

  if (embed.author) {
    maxLength(add, `${path}.author.name`, embed.author.name, LIMITS.embedAuthorNameLength);
    httpUrl(add, `${path}.author.iconUrl`, embed.author.icon_url);
  }
  if (embed.footer) {
    maxLength(add, `${path}.footer.text`, embed.footer.text, LIMITS.embedFooterTextLength);
    httpUrl(add, `${path}.footer.iconUrl`, embed.footer.icon_url);
  }

  if (embed.fields) {
    maxItems(add, `${path}.fields`, embed.fields, LIMITS.embedFields);
    embed.fields.forEach((field, i) => {
      const fieldPath = `${path}.fields[${i}]`;
      if (!field.name) add(`${fieldPath}.name`, 'ne peut pas être vide');
      if (!field.value) add(`${fieldPath}.value`, 'ne peut pas être vide');
      maxLength(add, `${fieldPath}.name`, field.name, LIMITS.fieldNameLength);
      maxLength(add, `${fieldPath}.value`, field.value, LIMITS.fieldValueLength);
    });
  }

  if (embed.image) httpUrl(add, `${path}.image`, embed.image.url);
  if (embed.thumbnail) httpUrl(add, `${path}.thumbnail`, embed.thumbnail.url);
}

function maxLength(add: (path: string, message: string) => void, path: string, value: string | undefined, max: number): void {
  if (value !== undefined && value.length > max) {
    add(path, `${value.length} caractères, maximum ${max} (option onOverflow: 'truncate' pour couper automatiquement)`);
  }
}

function maxItems(add: (path: string, message: string) => void, path: string, items: unknown[], max: number): void {
  if (items.length > max) add(path, `${items.length} éléments, maximum ${max}`);
}

function httpUrl(add: (path: string, message: string) => void, path: string, value: string | undefined): void {
  if (value === undefined) return;
  let ok = false;
  try {
    const url = new URL(value);
    ok = url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    ok = false;
  }
  if (!ok) add(path, `doit être une URL http(s) valide (reçu « ${value.slice(0, 80)} »)`);
}
