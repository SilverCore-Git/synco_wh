#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { SyncoWebhook } from './client.js';
import { isWellFormedSecret, parseWebhookUrl, readEnv, redactedUrl } from './config.js';
import { parseWebhookPublicKey } from './e2ee/encrypt.js';
import { SyncoValidationError, SyncoWebhookError } from './errors/classes.js';
import type { SyncoEmbed, SyncoMessage } from './message/types.js';
import { VERSION } from './version.js';

const HELP = `synco-webhook ${VERSION} — poster dans un salon Synco

Usage :
  synco-webhook send [texte] [options]
  synco-webhook check
  synco-webhook --help | --version

Configuration (variables d'environnement uniquement, jamais en argument :
elles finiraient dans l'historique du shell et les journaux de CI) :
  SYNCO_WEBHOOK_URL         adresse d'envoi du webhook (obligatoire)
  SYNCO_WEBHOOK_SECRET      secret de signature
  SYNCO_WEBHOOK_PUBLIC_KEY  clé publique E2EE (active le chiffrement)

Options de send :
  --stdin                 lit le texte sur l'entrée standard
  --json <fichier>        relaie un payload JSON (Synco, Discord ou GitHub) ; « - » pour l'entrée standard
  --title <texte>         titre de la carte
  --description <texte>   description de la carte
  --color <couleur>       #rrggbb, ou success | warning | danger | info | neutral
  --field <Nom=Valeur>    champ de la carte (répétable)
  --inline                affiche les champs côte à côte
  --link <url>            lien du titre
  --image <url>           image de la carte
  --footer <texte>        pied de la carte
  --timestamp             horodate la carte
  --username <nom>        nom affiché pour ce message
  --avatar-url <url>      photo pour ce message
  --thread <id>           salon cible (du même espace)
  --truncate              coupe les textes trop longs au lieu d'échouer
  --quiet                 n'affiche pas l'identifiant du message

Codes de sortie : 0 succès, 1 envoi refusé ou échoué, 2 usage ou configuration.

Exemples :
  synco-webhook send "Déploiement terminé"
  synco-webhook send --title "Build #1240" --color success --field "Branche=main" --field "Durée=2 min" --inline
  git log -1 --format=%s | synco-webhook send --stdin
`;

const OPTIONS = {
  stdin: { type: 'boolean' },
  json: { type: 'string' },
  title: { type: 'string' },
  description: { type: 'string' },
  color: { type: 'string' },
  field: { type: 'string', multiple: true },
  inline: { type: 'boolean' },
  link: { type: 'string' },
  image: { type: 'string' },
  footer: { type: 'string' },
  timestamp: { type: 'boolean' },
  username: { type: 'string' },
  'avatar-url': { type: 'string' },
  thread: { type: 'string' },
  truncate: { type: 'boolean' },
  quiet: { type: 'boolean', short: 'q' },
  help: { type: 'boolean', short: 'h' },
  version: { type: 'boolean', short: 'v' },
} as const;

class UsageError extends Error {}

async function main(argv: string[]): Promise<number> {
  if (argv.some(a => /^--(secret|webhook-url|url|token)(=|$)/.test(a))) {
    throw new UsageError(
      'l\'adresse et le secret ne se passent pas en argument ; définissez SYNCO_WEBHOOK_URL et SYNCO_WEBHOOK_SECRET'
    );
  }

  let parsed;
  try {
    parsed = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true, strict: true });
  } catch (error) {
    throw new UsageError((error as Error).message);
  }
  const { values, positionals } = parsed;

  if (values.version) {
    process.stdout.write(`${VERSION}\n`);
    return 0;
  }
  const [command, ...rest] = positionals;
  if (values.help || !command) {
    process.stdout.write(HELP);
    return values.help ? 0 : 2;
  }

  if (command === 'check') return check();
  if (command !== 'send') throw new UsageError(`commande inconnue : ${command} (voir --help)`);

  const client = new SyncoWebhook({ onOverflow: values.truncate ? 'truncate' : 'error', logger: { warn: m => process.stderr.write(`${m}\n`) } });
  const options = values.thread ? { threadId: values.thread } : {};

  if (values.json !== undefined) {
    const raw = values.json === '-' ? await readStdin() : await readFile(values.json, 'utf8');
    let payload: unknown;
    try {
      payload = JSON.parse(raw);
    } catch {
      throw new UsageError(`${values.json === '-' ? 'l\'entrée standard' : values.json} n'est pas du JSON valide`);
    }
    return report(await client.forward(payload, options), values.quiet);
  }

  const message: SyncoMessage = {};
  const text = values.stdin ? (await readStdin()).replace(/\r?\n$/, '') : rest.join(' ');
  if (text) message.content = text;
  if (values.username) message.username = values.username;
  if (values['avatar-url']) message.avatarUrl = values['avatar-url'];

  const embed: SyncoEmbed = {};
  if (values.title) embed.title = values.title;
  if (values.description) embed.description = values.description;
  if (values.color) embed.color = values.color;
  if (values.link) embed.url = values.link;
  if (values.image) embed.image = values.image;
  if (values.footer) embed.footer = { text: values.footer };
  if (values.timestamp) embed.timestamp = new Date();
  if (values.field?.length) {
    embed.fields = values.field.map(field => {
      const index = field.indexOf('=');
      if (index <= 0) throw new UsageError(`--field attend « Nom=Valeur », reçu « ${field} »`);
      return { name: field.slice(0, index), value: field.slice(index + 1), inline: Boolean(values.inline) };
    });
  }
  if (Object.keys(embed).length) message.embeds = [embed];

  return report(await client.send(message, options), values.quiet);
}

function check(): number {
  const url = readEnv('SYNCO_WEBHOOK_URL');
  if (!url) throw new UsageError('SYNCO_WEBHOOK_URL n\'est pas définie');
  const endpoint = parseWebhookUrl(url);
  const secret = readEnv('SYNCO_WEBHOOK_SECRET');
  const publicKey = readEnv('SYNCO_WEBHOOK_PUBLIC_KEY');
  if (publicKey) parseWebhookPublicKey(publicKey);

  const lines = [
    `Adresse    : ${redactedUrl(endpoint)} (webhook ${endpoint.webhookId})`,
    `Signature  : ${secret ? (isWellFormedSecret(secret) ? 'secret présent, format valide' : 'secret présent, format INATTENDU (36 caractères alphanumériques attendus)') : 'aucun secret — requêtes non signées'}`,
    `E2EE       : ${publicKey ? 'clé publique P-256 valide' : 'non configuré'}`,
    '',
    'Vérification locale uniquement : rien n\'a été envoyé à Synco.',
  ];
  process.stdout.write(`${lines.join('\n')}\n`);
  return 0;
}

function report(result: { messageId: string }, quiet: boolean | undefined): number {
  if (!quiet) process.stdout.write(`${result.messageId}\n`);
  return 0;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

main(process.argv.slice(2)).then(
  code => {
    process.exitCode = code;
  },
  (error: unknown) => {
    if (error instanceof UsageError) {
      process.stderr.write(`synco-webhook : ${error.message}\n`);
      process.exitCode = 2;
      return;
    }
    if (error instanceof SyncoWebhookError) {
      process.stderr.write(`synco-webhook : [${error.code}] ${error.message}\n`);
      if (error instanceof SyncoValidationError) {
        for (const issue of error.issues) process.stderr.write(`  - ${issue.path || 'message'} : ${issue.message}\n`);
      }
      process.exitCode = error.code === 'CONFIG' ? 2 : 1;
      return;
    }
    process.stderr.write(`synco-webhook : ${String(error)}\n`);
    process.exitCode = 1;
  }
);
