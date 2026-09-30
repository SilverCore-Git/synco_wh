# @synco/webhook

Poster dans un salon Synco depuis JavaScript, avec l'**adresse** et le **secret**
d'un webhook. La librairie s'occupe de la signature HMAC, de la validation, des
quotas, des relances et, si vous l'activez, du chiffrement de bout en bout.

```js
import { SyncoWebhook } from '@synco/webhook';

const wh = new SyncoWebhook({
  url: process.env.SYNCO_WEBHOOK_URL,
  secret: process.env.SYNCO_WEBHOOK_SECRET,
});

await wh.send('Déploiement terminé en 42 s');
```

- Aucune dépendance. Node 22+, Bun, Deno, Cloudflare Workers, Vercel Edge.
- ESM uniquement (Node 22 sait le charger avec `require()`).
- Côté serveur uniquement : dans une page web, le secret serait lisible par
  tout visiteur, et l'API Synco n'autorise pas l'en-tête de signature en CORS.

> **Statut :** 0.1.0, non publiée. Le paquet est marqué `private` tant que sa
> licence d'utilisation n'est pas choisie (voir `PLAN.md`, §9).

## Sommaire

1. [Obtenir l'adresse et le secret](#obtenir-ladresse-et-le-secret)
2. [Configurer le client](#configurer-le-client)
3. [Envoyer des messages](#envoyer-des-messages)
4. [Gérer les erreurs](#gérer-les-erreurs)
5. [Relances, quotas, horloge](#relances-quotas-horloge)
6. [Chiffrement de bout en bout](#chiffrement-de-bout-en-bout)
7. [Relayer GitHub ou Discord](#relayer-github-ou-discord)
8. [En ligne de commande](#en-ligne-de-commande)
9. [Limites](#limites)
10. [Développement](#développement)

## Obtenir l'adresse et le secret

Dans Synco : **Paramètres de l'organisation → Webhooks** (ou l'onglet Webhooks
d'un espace), bouton **+**. À la création, Synco affiche une seule fois :

- l'**adresse d'envoi**, `https://api.synco.fr/api/webhooks/<identifiant>/<jeton>` ;
- le **secret**, 36 caractères.

Les deux valent mot de passe : rangez-les dans les secrets de votre outil
(variables d'environnement, coffre-fort, *repository secrets*), jamais dans le code.

## Configurer le client

```js
const wh = new SyncoWebhook(); // lit SYNCO_WEBHOOK_URL, SYNCO_WEBHOOK_SECRET, SYNCO_WEBHOOK_PUBLIC_KEY
```

| Option | Défaut | Rôle |
|---|---|---|
| `url` | `SYNCO_WEBHOOK_URL` | Adresse complète, avec ou sans `/github`. |
| `webhookId`, `token`, `baseUrl` | — , — , `https://api.synco.fr` | Alternative à `url`. |
| `secret` | `SYNCO_WEBHOOK_SECRET` | Secret HMAC. `null` : ne pas signer (webhook dont la signature est désactivée). |
| `e2ee` | `SYNCO_WEBHOOK_PUBLIC_KEY` | `{ publicKey, strict? }`, voir [E2EE](#chiffrement-de-bout-en-bout). `false` pour ignorer la variable. |
| `defaults` | — | `{ username, avatarUrl, threadId }` appliqués aux messages qui n'en précisent pas. |
| `timeoutMs` | `30000` | Délai maximal d'une requête. |
| `retry` | `{ maxRetries: 3, maxDelayMs: 60000 }` | Relances sûres. `false` : aucune. |
| `rateLimit` | `{ perMinute: 50 }` | Quota local. `false` : désactivé. |
| `clock` | `{ autoSync: true, skewMs: 1000 }` | Voir [horloge](#horloge). |
| `validate` | `true` | Validation locale avant envoi. |
| `onOverflow` | `'error'` | `'truncate'` coupe les textes trop longs avec « … ». |
| `fetch` | `globalThis.fetch` | Implémentation à utiliser (tests, mandataire, certificat auto-signé). |
| `userAgent` | — | Ajouté après `synco-wh/<version>`. |
| `logger` | `console` | Reçoit les avertissements. `false` : silence. |
| `hooks` | — | `beforeRequest`, `afterResponse`, `onRetry` (jeton toujours masqué). |

Une adresse `http://` n'est acceptée que vers `localhost` ou une adresse privée :
le jeton voyage dans l'URL.

## Envoyer des messages

```js
// Texte
await wh.send('Sauvegarde terminée');

// Carte enrichie
await wh.send({
  content: 'Build #1240',
  embeds: [{
    title: 'Build réussie',
    description: 'Branche main',
    url: 'https://ci.exemple.fr/1240',
    color: 'success',               // '#22c55e', '#2c5', 0x22c55e ou un nom de Colors
    author: { name: 'CI', iconUrl: 'https://exemple.fr/ci.png' },
    fields: [
      { name: 'Commit', value: 'a1b2c3d', inline: true },
      { name: 'Durée', value: '2 min 34 s', inline: true },
    ],
    image: 'https://exemple.fr/graph.png',
    footer: { text: 'GitHub Actions' },
    timestamp: new Date(),
  }],
});

// Identité pour ce message, autre salon du même espace
await wh.send({ content: 'Nuit calme', username: 'Cron', avatarUrl: 'https://exemple.fr/cron.png' });
await wh.send('Alerte', { threadId: 'cl…' });

// Embeds seuls, ou construits en chaîne
import { EmbedBuilder } from '@synco/webhook';
await wh.sendEmbed(new EmbedBuilder().title('Incident résolu').color('success').field('Durée', '12 min'));
```

`send()` renvoie `{ messageId, threadId, receivedAt, attempts, rateLimit }`.

Autres méthodes :

- `validate(message)` : liste des anomalies, sans rien envoyer ;
- `buildRequest(message)` : en-têtes et corps exacts, pour un autre client HTTP ;
- `flush()` : attend la fin des envois en cours ;
- `close()` : refuse les nouveaux envois et attend les autres (à appeler avant la fin d'un script court).

Envoi ponctuel, sans instance :

```js
import { sendSyncoMessage } from '@synco/webhook';
await sendSyncoMessage(url, secret, 'Bonjour');
```

**Chevrons.** Synco retire tout ce qui ressemble à une balise HTML : `a < b > c`
s'affiche `a  c`. La librairie vous avertit une fois quand un message est concerné.

## Gérer les erreurs

Toutes les erreurs dérivent de `SyncoWebhookError`, avec un `code` stable, le
`status` HTTP éventuel, le `serverMessage` d'origine et une `hint` (cause probable).
Aucune ne contient le jeton ni le secret.

```js
import { SyncoWebhookError, SyncoValidationError } from '@synco/webhook';

try {
  await wh.send(message);
} catch (error) {
  if (error instanceof SyncoValidationError) console.error(error.issues); // [{ path: 'embeds[0].color', message: '…' }]
  else if (error instanceof SyncoWebhookError) console.error(error.code, error.message);
  else throw error;
}
```

| Code | Classe | Cause la plus fréquente |
|---|---|---|
| `VALIDATION` | `SyncoValidationError` | Message invalide (`source: 'local'` avant envoi, `'server'` si refusé par Synco). |
| `CONFIG` | `SyncoConfigError` | Adresse tronquée, option invalide, clé E2EE illisible. |
| `SIGNATURE_REQUIRED` | `SyncoAuthError` | Le webhook exige une signature et aucun secret n'est fourni. |
| `INVALID_SIGNATURE` | `SyncoAuthError` | Mauvais secret, ou secret régénéré. |
| `TIMESTAMP_REJECTED` | `SyncoAuthError` | Horloge de la machine décalée (le message chiffre l'écart). |
| `INVALID_TOKEN` | `SyncoAuthError` | Adresse régénérée entre-temps. |
| `WEBHOOK_DISABLED` | `SyncoForbiddenError` | Webhook en pause. |
| `MISSING_PERMISSIONS` | `SyncoForbiddenError` | Embeds ou pièces jointes non autorisés (`missingPermissions`). |
| `THREAD_OUT_OF_SCOPE` | `SyncoForbiddenError` | Salon cible hors de l'espace du webhook. |
| `NOT_FOUND` | `SyncoNotFoundError` | Webhook supprimé ou identifiant faux. |
| `NO_THREAD` | `SyncoNoThreadError` | L'espace n'a aucun salon. |
| `DECRYPTION_FAILED` | `SyncoDecryptionError` | Clé publique E2EE périmée ou E2EE désactivé. |
| `PAYLOAD_TOO_LARGE` | `SyncoPayloadTooLargeError` | Corps de plus de 1 Mo. |
| `RATE_LIMITED` | `SyncoRateLimitError` | Quota dépassé malgré les relances (`retryAfterMs`). |
| `SERVER_ERROR` | `SyncoServerError` | Erreur 5xx. |
| `NETWORK` | `SyncoNetworkError` | Serveur injoignable (`maybeDelivered` indique s'il a pu recevoir le message). |
| `TIMEOUT` | `SyncoTimeoutError` | Pas de réponse dans `timeoutMs`. |
| `ABORTED` | `SyncoAbortError` | `AbortSignal` déclenché. |
| `CLOSED` | `SyncoWebhookError` | Envoi après `close()`. |

## Relances, quotas, horloge

### Relances

Synco n'a pas de clé d'idempotence : relancer une requête qui a peut-être abouti
peut publier le message deux fois. La librairie ne relance donc que ce qui est sûr :

| Situation | Relancé |
|---|---|
| 429 (quota) | oui, après `Retry-After` / `RateLimit-Reset` |
| 502, 503, 504 (mandataire) | oui, backoff exponentiel |
| DNS, connexion refusée | oui |
| Horodatage refusé | une fois, après recalage de l'horloge |
| 500, délai dépassé, connexion coupée | **non**, sauf `send(msg, { idempotent: true })` |
| autres 4xx | jamais |

Chaque relance est re-signée avec un horodatage neuf. Les messages partent un par
un, dans l'ordre des appels, relances comprises.

### Quotas

Un émetteur est limité en pratique à **50 requêtes par minute et par webhook**,
et 100 par minute depuis une même adresse IP, tous webhooks confondus. La file
locale respecte le premier plafond par défaut et se cale sur les en-têtes
`RateLimit-*` quand plusieurs processus partagent le webhook.

### Horloge

Synco refuse un horodatage de plus de 5 minutes, **ou situé dans le futur**. La
librairie retranche 1 s de marge (`clock.skewMs`), et au premier refus se
recale sur l'en-tête `Date` du serveur (`clock.autoSync`) avant de réessayer.

## Chiffrement de bout en bout

À activer d'abord dans Synco (réglages avancés du webhook), qui affiche alors la
clé publique du webhook :

```js
const wh = new SyncoWebhook({
  url, secret,
  e2ee: { publicKey: process.env.SYNCO_WEBHOOK_PUBLIC_KEY },
});
await wh.send('Mot de passe du coffre tourné');
```

Pour chaque message : paire ECDH P-256 éphémère, clé AES-256 dérivée par
HMAC-SHA256, chiffrement AES-256-GCM. La clé publique peut contenir des `\n`
littéraux (format courant des variables d'environnement).

À savoir :

- **seul le texte (`content`) est chiffré**. Embeds, nom et photo voyagent en
  clair. `e2ee: { publicKey, strict: true }` refuse d'envoyer un message qui en contient ;
- le texte chiffré est limité à **3072 octets UTF-8** ;
- si l'E2EE n'est pas activé côté Synco, le texte chiffré est publié tel quel,
  illisible. Rien ne permet à la librairie de le détecter avant envoi.

## Relayer GitHub ou Discord

```js
await wh.forward(githubEventBody, { format: 'github' });  // relayé tel quel vers …/github
await wh.forward(discordWebhookBody);                      // converti localement (couleurs entières, etc.)
await wh.forward(payload);                                 // format détecté comme le fait Synco
```

Un payload GitHub n'est jamais chiffré. Voir `examples/github-relay.ts`.

## En ligne de commande

```bash
export SYNCO_WEBHOOK_URL=… SYNCO_WEBHOOK_SECRET=…

npx @synco/webhook send "Déploiement terminé"
npx @synco/webhook send --title "Build #1240" --color success --field "Branche=main" --field "Durée=2 min" --inline
git log -1 --format=%s | npx @synco/webhook send --stdin
npx @synco/webhook send --json event.json
npx @synco/webhook check      # vérifie la configuration, sans rien envoyer
```

L'adresse et le secret ne se passent **jamais** en argument : ils finiraient
dans l'historique du shell et les journaux de CI. Codes de sortie : 0 succès,
1 envoi refusé ou échoué, 2 usage ou configuration. Voir `examples/github-actions.yml`.

## Limites

| Élément | Limite |
|---|---|
| Texte | 4096 caractères (3072 octets en E2EE) |
| Nom affiché | 100 caractères |
| Embeds par message | 10 |
| Titre / description d'embed | 256 / 4096 caractères |
| Champs par embed | 25 ; nom 256, valeur 1024, jamais vides |
| Pied / auteur d'embed | 2048 / 256 caractères |
| Corps de la requête | 1 Mo |
| Pièces jointes, mentions | 10 / 50 : acceptées par l'API mais **pas encore affichées** |

Les bornes sont exportées dans `LIMITS`.

## Développement

```bash
bun install
bun run check   # typecheck + tests + build
```

Les tests confrontent la librairie au **vrai code** de `synco_api` (vérification
de signature, schéma Zod, permissions) quand le dépôt est présent à côté de
celui-ci, ou désigné par `SYNCO_API_DIR`. `test/drift.test.ts` signale un
changement de protocole côté API.
