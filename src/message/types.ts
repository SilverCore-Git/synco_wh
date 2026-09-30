// ============================================
// Types publics (camelCase)
// ============================================

export type ColorName = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

/** `'#22c55e'`, `'#2c5'`, `0x22c55e`, ou un nom de la palette `Colors`. */
export type ColorInput = ColorName | (string & {}) | number;

export interface SyncoEmbedField {
  name: string;
  value: string | number | boolean;
  inline?: boolean;
}

export interface SyncoEmbed {
  title?: string;
  description?: string;
  url?: string;
  color?: ColorInput;
  timestamp?: Date | string | number;
  author?: { name?: string; iconUrl?: string };
  footer?: { text?: string; iconUrl?: string };
  fields?: SyncoEmbedField[];
  /** URL de l'image, ou `{ url }`. */
  image?: string | { url: string };
  thumbnail?: string | { url: string };
}

/** Tout objet capable de produire un embed, comme `EmbedBuilder`. */
export interface EmbedSource {
  build(): SyncoEmbed;
}

/** @experimental Accepté par l'API mais pas encore rendu dans le fil. */
export interface SyncoAttachment {
  url: string;
  filename?: string;
  size?: number;
}

export interface SyncoMessage {
  content?: string;
  embeds?: Array<SyncoEmbed | EmbedSource>;
  /** Surcharge, pour ce message, le nom affiché du webhook. */
  username?: string;
  /** Surcharge, pour ce message, la photo du webhook. */
  avatarUrl?: string;
  /** Salon cible, qui doit appartenir à l'espace du webhook. */
  threadId?: string;
  /** @experimental Accepté par l'API mais pas encore rendu dans le fil. */
  attachments?: SyncoAttachment[];
  /** @experimental Accepté par l'API mais pas encore rendu dans le fil. */
  mentions?: string[];
}

export type MessageInput = string | SyncoMessage;

export interface MessageDefaults {
  username?: string;
  avatarUrl?: string;
  threadId?: string;
}

export interface ValidationIssue {
  /** Chemin du champ fautif, format `embeds[0].fields[2].value` ; vide pour le message entier. */
  path: string;
  message: string;
}

export interface RateLimitInfo {
  limit?: number;
  remaining?: number;
  resetAt?: Date;
}

export interface SendResult {
  messageId: string;
  threadId: string;
  receivedAt: Date;
  /** Nombre de requêtes HTTP émises, relances comprises. */
  attempts: number;
  rateLimit?: RateLimitInfo;
}

// ============================================
// Format filaire (celui que lit synco_api)
// ============================================

export interface WireEmbed {
  title?: string;
  description?: string;
  url?: string;
  color?: string;
  timestamp?: string;
  author?: { name?: string; icon_url?: string };
  footer?: { text?: string; icon_url?: string };
  fields?: Array<{ name: string; value: string; inline?: boolean }>;
  image?: { url: string };
  thumbnail?: { url: string };
}

export interface WireSyncoOptions {
  targetThreadId?: string;
  encrypted?: boolean;
  mappings?: Record<string, string>;
}

export interface WirePayload {
  content?: string;
  username?: string;
  avatar_url?: string;
  embeds?: WireEmbed[];
  attachments?: Array<{ url: string; filename?: string; size?: number }>;
  mentions?: string[];
  encrypted?: boolean;
  nonce?: string;
  tag?: string;
  salt?: string;
  senderPublicKey?: string;
  /**
   * Toujours présent : c'est ce qui fait reconnaître le format natif. Sans
   * lui, un payload avec embeds ou `username` part dans le mapper Discord du
   * serveur, qui repart du payload d'origine — en E2EE, du texte chiffré.
   */
  _synco: WireSyncoOptions;
}
