import { afterEach, describe, expect, test } from 'bun:test';
import { detectFormat, discordToMessage } from '../src/forward.ts';
import { SyncoValidationError, SyncoWebhook } from '../src/index.ts';
import { silentLogger, startMockSynco, type MockSynco } from './helpers/mock-synco.ts';

let mock: MockSynco | undefined;
afterEach(() => mock?.stop());

const githubPush = {
  ref: 'refs/heads/main',
  repository: { name: 'projet', full_name: 'org/projet', html_url: 'https://github.com/org/projet' },
  commits: [{ id: 'abc', message: 'Fix', author: { name: 'Camille' } }],
  sender: { login: 'camille' },
};

const discordPayload = {
  content: 'Nouveau commit',
  username: 'GitHub Bot',
  avatar_url: 'https://github.com/favicon.ico',
  tts: false,
  embeds: [
    {
      title: 'Commit abc1234',
      color: 3447003,
      author: { name: 'Camille', icon_url: 'https://exemple.fr/c.png' },
      fields: [{ name: 'Branche', value: 'main', inline: true }],
    },
  ],
  allowed_mentions: { parse: [] },
};

describe('detectFormat', () => {
  test('même ordre que le serveur', () => {
    expect(detectFormat({ content: 'x', _synco: {} })).toBe('synco');
    expect(detectFormat({ embeds: [] })).toBe('discord');
    expect(detectFormat({ content: 'x', username: 'y' })).toBe('discord');
    expect(detectFormat(githubPush)).toBe('github');
    expect(detectFormat({ action: 'opened' })).toBe('github');
    expect(detectFormat({ content: 'x' })).toBeUndefined();
  });
});

describe('discordToMessage', () => {
  test('couleur entière et champs Discord convertis', () => {
    expect(discordToMessage(discordPayload)).toEqual({
      content: 'Nouveau commit',
      username: 'GitHub Bot',
      avatarUrl: 'https://github.com/favicon.ico',
      embeds: [
        {
          title: 'Commit abc1234',
          color: 3447003,
          author: { name: 'Camille', iconUrl: 'https://exemple.fr/c.png' },
          fields: [{ name: 'Branche', value: 'main', inline: true }],
        },
      ],
    });
  });
});

describe('forward', () => {
  function client() {
    mock = startMockSynco();
    return new SyncoWebhook({ url: mock.url, secret: mock.secret, logger: silentLogger });
  }

  test('GitHub : relayé tel quel sur /github, signé', async () => {
    const wh = client();
    await wh.forward(githubPush);
    expect(mock!.received[0]!.path).toEndWith('/github');
    expect(JSON.parse(mock!.received[0]!.rawBody)).toEqual(githubPush);
  });

  test('Discord : converti localement, accepté par le schéma serveur malgré la couleur entière', async () => {
    const wh = client();
    await wh.forward(discordPayload);
    const { payload } = mock!.received[0]!;
    expect(payload._synco).toEqual({});
    expect((payload.embeds as Array<{ color: string }>)[0]!.color).toBe('#3498db');
    expect(payload).not.toHaveProperty('tts');
  });

  test('payload filaire Synco sans format reconnu : envoyé tel quel', async () => {
    const wh = client();
    await wh.forward({ content: 'brut' }, { threadId: 'thread_other' });
    expect(mock!.received[0]!.payload).toEqual({ content: 'brut', _synco: { targetThreadId: 'thread_other' } });
  });

  test('payload inconnu et vide refusé localement', async () => {
    const wh = client();
    expect(wh.forward({ foo: 1 })).rejects.toBeInstanceOf(SyncoValidationError);
    expect(wh.forward([1, 2])).rejects.toBeInstanceOf(SyncoValidationError);
  });
});
