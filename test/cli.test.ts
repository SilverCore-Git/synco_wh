import { afterEach, describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { startMockSynco, type MockSynco } from './helpers/mock-synco.ts';

const CLI = resolve(import.meta.dir, '../src/cli.ts');

let mock: MockSynco | undefined;
afterEach(() => mock?.stop());

async function run(args: string[], env: Record<string, string> = {}, stdin?: string) {
  const proc = Bun.spawn([process.execPath, CLI, ...args], {
    env: { PATH: process.env.PATH ?? '', ...env },
    stdin: stdin === undefined ? 'ignore' : new TextEncoder().encode(stdin),
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  return { stdout, stderr, code };
}

function env(m: MockSynco) {
  return { SYNCO_WEBHOOK_URL: m.url, SYNCO_WEBHOOK_SECRET: m.secret };
}

describe('CLI', () => {
  test('send texte : affiche l\'identifiant du message', async () => {
    mock = startMockSynco();
    const { stdout, code } = await run(['send', 'Déploiement', 'terminé'], env(mock));
    expect(code).toBe(0);
    expect(stdout.trim()).toBe('msg_1');
    expect(mock.received[0]!.publishedContent).toBe('Déploiement terminé');
  });

  test('send carte complète', async () => {
    mock = startMockSynco();
    const { code } = await run(
      ['send', '--title', 'Build #1240', '--color', 'success', '--field', 'Branche=main', '--field', 'Durée=2 min', '--inline', '-q'],
      env(mock)
    );
    expect(code).toBe(0);
    expect(mock.received[0]!.payload.embeds).toEqual([
      {
        title: 'Build #1240',
        color: '#22c55e',
        fields: [
          { name: 'Branche', value: 'main', inline: true },
          { name: 'Durée', value: '2 min', inline: true },
        ],
      },
    ]);
  });

  test('--stdin', async () => {
    mock = startMockSynco();
    await run(['send', '--stdin', '-q'], env(mock), 'Fix login\n');
    expect(mock.received[0]!.publishedContent).toBe('Fix login');
  });

  test('--json - relaie un payload GitHub', async () => {
    mock = startMockSynco();
    const { code } = await run(['send', '--json', '-', '-q'], env(mock), JSON.stringify({ action: 'opened', issue: { title: 'Bug' } }));
    expect(code).toBe(0);
    expect(mock.received[0]!.path).toEndWith('/github');
  });

  test('refus serveur : code 1 et message lisible', async () => {
    mock = startMockSynco({ active: false });
    const { stderr, code } = await run(['send', 'x'], env(mock));
    expect(code).toBe(1);
    expect(stderr).toContain('[WEBHOOK_DISABLED]');
  });

  test('message invalide : détail par champ', async () => {
    mock = startMockSynco();
    const { stderr, code } = await run(['send', '--title', 't', '--color', 'rouge'], env(mock));
    expect(code).toBe(1);
    expect(stderr).toContain('embeds[0].color');
    expect(mock.hits).toBe(0);
  });

  test('secret en argument refusé', async () => {
    const { stderr, code } = await run(['send', 'x', '--secret', 'abc']);
    expect(code).toBe(2);
    expect(stderr).toContain('SYNCO_WEBHOOK_SECRET');
  });

  test('configuration manquante : code 2', async () => {
    const { stderr, code } = await run(['send', 'x']);
    expect(code).toBe(2);
    expect(stderr).toContain('SYNCO_WEBHOOK_URL');
  });

  test('check : vérification locale, jeton masqué', async () => {
    mock = startMockSynco();
    const { stdout, code } = await run(['check'], env(mock));
    expect(code).toBe(0);
    expect(stdout).toContain('format valide');
    expect(stdout).not.toContain(mock.token);
    expect(mock.hits).toBe(0);
  });

  test('--version et --help', async () => {
    expect((await run(['--version'])).stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
    expect((await run(['--help'])).stdout).toContain('SYNCO_WEBHOOK_URL');
  });
});
