import { describe, expect, test } from 'bun:test';
import { Colors, normalizeColor } from '../src/message/colors.ts';
import { EmbedBuilder } from '../src/message/embed-builder.ts';
import { LIMITS } from '../src/message/limits.ts';
import { normalizeMessage, truncate } from '../src/message/normalize.ts';
import type { SyncoMessage } from '../src/message/types.ts';
import { validatePayload } from '../src/message/validate.ts';
import { payloadSchema, REAL_SERVER } from './helpers/server.ts';

describe('normalizeMessage', () => {
  test('une chaîne devient { content } avec _synco toujours présent', () => {
    expect(normalizeMessage('Bonjour')).toEqual({ content: 'Bonjour', _synco: {} });
  });

  test('camelCase → format filaire', () => {
    const wire = normalizeMessage({
      content: 'Build',
      avatarUrl: 'https://exemple.fr/a.png',
      threadId: 'th1',
      embeds: [
        {
          title: 'OK',
          color: 'success',
          timestamp: new Date('2026-09-30T10:00:00Z'),
          author: { name: 'CI', iconUrl: 'https://exemple.fr/ci.png' },
          footer: { text: 'pied', iconUrl: 'https://exemple.fr/f.png' },
          fields: [{ name: 'Durée', value: 42, inline: true }],
          image: 'https://exemple.fr/i.png',
          thumbnail: { url: 'https://exemple.fr/t.png' },
        },
      ],
    });
    expect(wire).toEqual({
      content: 'Build',
      avatar_url: 'https://exemple.fr/a.png',
      embeds: [
        {
          title: 'OK',
          color: Colors.success,
          timestamp: '2026-09-30T10:00:00.000Z',
          author: { name: 'CI', icon_url: 'https://exemple.fr/ci.png' },
          footer: { text: 'pied', icon_url: 'https://exemple.fr/f.png' },
          fields: [{ name: 'Durée', value: '42', inline: true }],
          image: { url: 'https://exemple.fr/i.png' },
          thumbnail: { url: 'https://exemple.fr/t.png' },
        },
      ],
      _synco: { targetThreadId: 'th1' },
    });
  });

  test('priorité du salon : option d\'envoi > message > défauts', () => {
    const defaults = { threadId: 'd', username: 'Bot' };
    expect(normalizeMessage({ content: 'x' }, { defaults })._synco.targetThreadId).toBe('d');
    expect(normalizeMessage({ content: 'x', threadId: 'm' }, { defaults })._synco.targetThreadId).toBe('m');
    expect(normalizeMessage({ content: 'x', threadId: 'm' }, { defaults, threadId: 'o' })._synco.targetThreadId).toBe('o');
    expect(normalizeMessage('x', { defaults }).username).toBe('Bot');
  });

  test('EmbedBuilder accepté tel quel', () => {
    const builder = new EmbedBuilder().title('T').color(0x22c55e).field('a', 'b', true);
    expect(normalizeMessage({ embeds: [builder] }).embeds).toEqual([
      { title: 'T', color: '#22c55e', fields: [{ name: 'a', value: 'b', inline: true }] },
    ]);
  });

  test('troncature à la demande, sans casser un emoji', () => {
    const long = 'a'.repeat(5000);
    expect(normalizeMessage(long, { onOverflow: 'truncate' }).content).toHaveLength(LIMITS.contentLength);
    expect(truncate('abc😀def', 5)).toBe('abc…');
    expect(normalizeMessage(long).content).toHaveLength(5000);
  });
});

describe('normalizeColor', () => {
  test('formats acceptés', () => {
    expect(normalizeColor('#22C55E')).toBe('#22c55e');
    expect(normalizeColor('22c55e')).toBe('#22c55e');
    expect(normalizeColor('#2c5')).toBe('#22cc55');
    expect(normalizeColor(3447003)).toBe('#3498db');
    expect(normalizeColor('danger')).toBe(Colors.danger);
  });

  test('valeur inconnue rendue telle quelle pour être signalée', () => {
    expect(normalizeColor('rouge')).toBe('rouge');
    expect(normalizeColor(-1)).toBe('-1');
  });
});

describe('validatePayload', () => {
  const issuesOf = (message: SyncoMessage | string) => validatePayload(normalizeMessage(message));

  test('message valide', () => {
    expect(issuesOf('Bonjour')).toEqual([]);
  });

  test('message vide ou blanc refusé', () => {
    expect(issuesOf({})).toHaveLength(1);
    expect(issuesOf('   ')[0]!.message).toMatch(/vide/);
  });

  test('bornes exactes', () => {
    expect(issuesOf('a'.repeat(4096))).toEqual([]);
    expect(issuesOf('a'.repeat(4097))[0]!.path).toBe('content');
    const fields = Array.from({ length: 26 }, (_, i) => ({ name: `n${i}`, value: 'v' }));
    expect(issuesOf({ embeds: [{ fields }] }).map(i => i.path)).toEqual(['embeds[0].fields']);
    expect(issuesOf({ embeds: Array.from({ length: 11 }, () => ({ title: 't' })) }).map(i => i.path)).toEqual(['embeds']);
  });

  test('toutes les anomalies sont rapportées, avec leur chemin', () => {
    const paths = issuesOf({
      content: 'x',
      avatarUrl: 'ftp://exemple.fr/a.png',
      embeds: [{ title: 't', color: 'rouge', timestamp: 'hier', fields: [{ name: '', value: '' }] }],
    }).map(i => i.path);
    expect(paths).toEqual([
      'avatarUrl',
      'embeds[0].color',
      'embeds[0].timestamp',
      'embeds[0].fields[0].name',
      'embeds[0].fields[0].value',
    ]);
  });

  test('embed vide refusé', () => {
    expect(issuesOf({ embeds: [{ color: 'info' }] })[0]!.path).toBe('embeds[0]');
  });
});

// Ce que la librairie produit doit passer le VRAI schéma Zod du serveur, et
// ce qu'elle refuse doit l'être aussi par le serveur (hors règles plus strictes).
describe.skipIf(!REAL_SERVER)('croisé avec webhookPayloadSchema de synco_api', () => {
  const accepted: Array<SyncoMessage | string> = [
    'Bonjour 👋',
    'a'.repeat(4096),
    {
      content: 'Build #1240',
      username: 'CI',
      avatarUrl: 'https://exemple.fr/a.png',
      threadId: 'th1',
      embeds: [
        new EmbedBuilder()
          .title('Build réussie')
          .description('Branche main')
          .url('https://exemple.fr/build/1240')
          .color('success')
          .timestamp(new Date())
          .author('CI', 'https://exemple.fr/ci.png')
          .footer('GitHub Actions', 'https://exemple.fr/gh.png')
          .field('Commit', 'a1b2c3d', true)
          .image('https://exemple.fr/i.png')
          .thumbnail('https://exemple.fr/t.png'),
      ],
      attachments: [{ url: 'https://exemple.fr/log.txt', filename: 'log.txt', size: 1024 }],
      mentions: ['u1'],
    },
    { embeds: Array.from({ length: 10 }, (_, i) => ({ title: `e${i}`, fields: Array.from({ length: 25 }, () => ({ name: 'n', value: 'v' })) })) },
  ];

  test.each(accepted.map(m => [m]))('accepté par le serveur : %#', message => {
    const wire = normalizeMessage(message);
    expect(validatePayload(wire)).toEqual([]);
    expect(payloadSchema!.safeParse(wire).success).toBe(true);
  });

  const rejected: SyncoMessage[] = [
    { content: 'a'.repeat(4097) },
    { content: 'x', username: 'u'.repeat(101) },
    { embeds: [{ title: 't', color: 'rouge' }] },
    { embeds: [{ title: 't', fields: [{ name: 'n', value: '' }] }] },
    { embeds: Array.from({ length: 11 }, () => ({ title: 't' })) },
    { content: 'x', attachments: [{ url: 'https://exemple.fr/a', size: 0 }] },
  ];

  test.each(rejected.map(m => [m]))('refusé par les deux : %#', message => {
    const wire = normalizeMessage(message);
    expect(validatePayload(wire).length).toBeGreaterThan(0);
    expect(payloadSchema!.safeParse(wire).success).toBe(false);
  });
});
