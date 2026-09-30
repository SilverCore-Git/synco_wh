import type { ColorInput, EmbedSource, SyncoEmbed } from './types.js';

/** Identité typée, pour l'autocomplétion : `embed({ title: '…', color: 'success' })`. */
export function embed(data: SyncoEmbed): SyncoEmbed {
  return data;
}

/**
 * Variante chaînable, pour qui préfère :
 * `new EmbedBuilder().title('Build').color('success').field('Branche', 'main', true)`.
 * Accepté tel quel dans `embeds`, ou converti avec `build()`.
 */
export class EmbedBuilder implements EmbedSource {
  private readonly data: SyncoEmbed;

  constructor(initial: SyncoEmbed = {}) {
    this.data = { ...initial, fields: initial.fields ? [...initial.fields] : undefined };
  }

  title(title: string): this {
    this.data.title = title;
    return this;
  }

  description(description: string): this {
    this.data.description = description;
    return this;
  }

  url(url: string): this {
    this.data.url = url;
    return this;
  }

  color(color: ColorInput): this {
    this.data.color = color;
    return this;
  }

  timestamp(timestamp: Date | string | number = new Date()): this {
    this.data.timestamp = timestamp;
    return this;
  }

  author(name: string, iconUrl?: string): this {
    this.data.author = { name, ...(iconUrl !== undefined && { iconUrl }) };
    return this;
  }

  footer(text: string, iconUrl?: string): this {
    this.data.footer = { text, ...(iconUrl !== undefined && { iconUrl }) };
    return this;
  }

  field(name: string, value: string | number | boolean, inline = false): this {
    (this.data.fields ??= []).push({ name, value, inline });
    return this;
  }

  image(url: string): this {
    this.data.image = url;
    return this;
  }

  thumbnail(url: string): this {
    this.data.thumbnail = url;
    return this;
  }

  build(): SyncoEmbed {
    const copy: SyncoEmbed = { ...this.data };
    if (this.data.fields) copy.fields = this.data.fields.map(f => ({ ...f }));
    else delete copy.fields;
    return copy;
  }
}
