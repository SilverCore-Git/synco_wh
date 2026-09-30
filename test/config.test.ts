import { describe, expect, test } from 'bun:test';
import { endpointFromParts, endpointUrl, parseWebhookUrl, redactedUrl } from '../src/config.ts';
import { SyncoConfigError } from '../src/errors/classes.ts';

const TOKEN = 'AbCdEfGhIjKlMnOpQrStUvWx';

describe('parseWebhookUrl', () => {
  test('adresse de production', () => {
    const ep = parseWebhookUrl(`https://api.synco.fr/api/webhooks/clabc123def456/${TOKEN}`);
    expect(ep).toEqual({ base: 'https://api.synco.fr', webhookId: 'clabc123def456', token: TOKEN, github: false });
  });

  test('suffixe /github et barre finale', () => {
    expect(parseWebhookUrl(`https://api.synco.fr/api/webhooks/id1/${TOKEN}/github/`).github).toBe(true);
  });

  test('préfixe de chemin conservé (API derrière un mandataire)', () => {
    const ep = parseWebhookUrl(`https://intra.example.com/synco/api/webhooks/id1/${TOKEN}`);
    expect(ep.base).toBe('https://intra.example.com/synco');
    expect(endpointUrl(ep)).toBe(`https://intra.example.com/synco/api/webhooks/id1/${TOKEN}`);
  });

  test('http accepté pour localhost et les adresses privées', () => {
    for (const host of ['localhost:9000', '127.0.0.1', '192.168.1.73:9000', '10.0.0.4', '172.20.1.1', '[::1]']) {
      expect(() => parseWebhookUrl(`http://${host}/api/webhooks/id1/${TOKEN}`)).not.toThrow();
    }
  });

  test('http refusé vers Internet : le jeton voyagerait en clair', () => {
    expect(() => parseWebhookUrl(`http://api.synco.fr/api/webhooks/id1/${TOKEN}`)).toThrow(SyncoConfigError);
    expect(() => parseWebhookUrl(`http://172.32.0.1/api/webhooks/id1/${TOKEN}`)).toThrow(SyncoConfigError);
  });

  test('jeton tronqué au copier-coller', () => {
    expect(() => parseWebhookUrl('https://api.synco.fr/api/webhooks/id1/AbCdEf')).toThrow(/24 caractères/);
  });

  test('chemin étranger', () => {
    expect(() => parseWebhookUrl('https://example.com/hooks/abc')).toThrow(/pas une adresse de webhook/);
    expect(() => parseWebhookUrl('pas une url')).toThrow(SyncoConfigError);
  });

  test('forme masquée sans jeton', () => {
    const ep = parseWebhookUrl(`https://api.synco.fr/api/webhooks/id1/${TOKEN}`);
    expect(redactedUrl(ep)).toBe('https://api.synco.fr/api/webhooks/id1/***');
    expect(redactedUrl(ep, true)).not.toContain(TOKEN);
  });
});

describe('endpointFromParts', () => {
  test('base par défaut', () => {
    expect(endpointFromParts('id1', TOKEN).base).toBe('https://api.synco.fr');
  });

  test('base personnalisée, barre finale retirée', () => {
    expect(endpointFromParts('id1', TOKEN, 'https://192.168.1.73:9000/').base).toBe('https://192.168.1.73:9000');
  });
});
