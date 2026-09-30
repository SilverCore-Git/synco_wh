# Guide d'utilisation - `@silvercore/synco-wh`

> Version de la librairie : **0.1.0** · Dernière mise à jour : 30 septembre 2026
>
> Ce guide s'adresse aux développeurs qui veulent publier des messages dans
> Synco depuis un programme JavaScript ou TypeScript : scripts, serveurs,
> pipelines CI/CD, fonctions serverless, outils de supervision.

---

## Sommaire

1. [En bref](#1-en-bref)
2. [Avant de commencer](#2-avant-de-commencer)
3. [Installation](#3-installation)
4. [Premier message](#4-premier-message)
5. [Configurer le client](#5-configurer-le-client)
6. [Composer un message](#6-composer-un-message)
7. [Les cartes enrichies (embeds)](#7-les-cartes-enrichies-embeds)
8. [Envoyer : méthodes et résultats](#8-envoyer--méthodes-et-résultats)
9. [Gérer les erreurs](#9-gérer-les-erreurs)
10. [Relances, quotas et ordre des messages](#10-relances-quotas-et-ordre-des-messages)
11. [Signature et horloge](#11-signature-et-horloge)
12. [Chiffrement de bout en bout (E2EE)](#12-chiffrement-de-bout-en-bout-e2ee)
13. [Relayer des payloads GitHub, Discord ou Synco](#13-relayer-des-payloads-github-discord-ou-synco)
14. [Observabilité : hooks et avertissements](#14-observabilité--hooks-et-avertissements)
15. [Cycle de vie : `flush()` et `close()`](#15-cycle-de-vie--flush-et-close)
16. [L'outil en ligne de commande](#16-loutil-en-ligne-de-commande)
17. [Environnements d'exécution](#17-environnements-dexécution)
18. [Recettes](#18-recettes)
19. [Sécurité](#19-sécurité)
20. [Dépannage](#20-dépannage)
21. [Référence de l'API](#21-référence-de-lapi)
22. [Limites](#22-limites)

---

## 1. En bref

Un **webhook Synco** est une adresse privée qui permet à un programme de poster
dans un salon Synco, sans compte utilisateur. Le programme envoie une requête
HTTP ; le message apparaît dans le salon sous le nom et la photo du webhook.

Appeler cette adresse à la main demande de signer chaque requête, de respecter
un format strict et des quotas, et d'interpréter des erreurs peu parlantes. La
librairie fait tout cela pour vous :

```js
import { SyncoWebhook } from '@silvercore/synco-wh';

const wh = new SyncoWebhook({
  url: process.env.SYNCO_WEBHOOK_URL,
  secret: process.env.SYNCO_WEBHOOK_SECRET,
});

await wh.send('Déploiement terminé en 42 s');
```

Ce que la librairie gère automatiquement :

| Sujet | Ce qu'elle fait |
|---|---|
| Signature | Signe chaque requête (HMAC-SHA256) avec le secret, sur le corps exact envoyé. |
| Validation | Vérifie le message avec les mêmes règles que Synco, **avant** l'envoi, et liste toutes les anomalies. |
| Quotas | Espace les envois pour rester sous le plafond de Synco. |
| Relances | Réessaie ce qui peut l'être sans risque de publier deux fois le même message. |
| Horloge | Corrige un décalage d'horloge de la machine par rapport au serveur. |
| Ordre | Publie les messages dans l'ordre des appels. |
| Erreurs | Lève des erreurs typées, avec la cause probable et le remède. |
| Chiffrement | Chiffre le texte de bout en bout si vous l'activez. |

**Le sens de la communication compte :** un webhook Synco **reçoit**. Votre
programme appelle Synco, jamais l'inverse. La librairie ne permet pas d'être
notifié de ce qui se passe dans Synco.

---

## 2. Avant de commencer

### 2.1 Créer le webhook dans Synco

1. Ouvrez **Paramètres de l'organisation → Webhooks**, ou **Paramètres d'un
   espace → onglet Webhooks**.
2. Cliquez sur **+**.
3. Choisissez une photo (facultative), un nom affiché (« Déploiements »,
   « Alertes Grafana »…) et le salon de destination.
4. Cliquez sur **Créer le webhook**.

Synco affiche alors **une seule fois** deux valeurs. Copiez-les immédiatement :

| Valeur | Forme | Usage |
|---|---|---|
| Adresse d'envoi | `https://api.synco.fr/api/webhooks/<identifiant>/<jeton>` | Option `url` ou variable `SYNCO_WEBHOOK_URL`. |
| Secret | 36 caractères alphanumériques | Option `secret` ou variable `SYNCO_WEBHOOK_SECRET`. |

Si vous les perdez, **régénérez l'adresse** depuis la fiche du webhook : vous
obtenez un nouveau couple, et l'ancien cesse de fonctionner.

### 2.2 Réglages du webhook qui influencent la librairie

Dans la fiche du webhook, section **Réglages avancés** :

| Réglage Synco | Défaut | Effet côté librairie |
|---|---|---|
| Exiger une signature HMAC | activé | Sans `secret`, les envois échouent avec `SIGNATURE_REQUIRED`. |
| Envoyer des messages | autorisé | Nécessaire pour `content`. |
| Envoyer des cartes enrichies | autorisé | Nécessaire pour `embeds`, sinon `MISSING_PERMISSIONS`. |
| Joindre des fichiers | refusé | Nécessaire pour `attachments`. |
| Chiffrement de bout en bout | désactivé | Voir [§12](#12-chiffrement-de-bout-en-bout-e2ee). |

### 2.3 Prérequis techniques

- **Node.js 22 ou plus**, Bun, Deno 2, Cloudflare Workers ou Vercel Edge.
- Un environnement **serveur** : la librairie refuse de s'exécuter dans une
  page web (voir [§19](#19-sécurité)).

---

## 3. Installation

```bash
npm install @silvercore/synco-wh
# ou
bun add @silvercore/synco-wh
pnpm add @silvercore/synco-wh
yarn add @silvercore/synco-wh
```

> **Paquet pas encore publié.** En attendant, installez-le depuis une copie
> locale du dépôt :
>
> ```bash
> git clone https://github.com/SilverCore-Git/synco_wh.git
> cd synco_wh && bun install && bun run build
> cd ../mon-projet && npm install ../synco_wh
> ```

La librairie n'a **aucune dépendance**. Elle est distribuée en module ES, avec
ses déclarations TypeScript.

```js
// Module ES (recommandé)
import { SyncoWebhook } from '@silvercore/synco-wh';

// CommonJS : fonctionne à partir de Node 22.12, qui sait charger un module ES
const { SyncoWebhook } = require('@silvercore/synco-wh');
```

---

## 4. Premier message

### 4.1 Avec des variables d'environnement (recommandé)

```bash
export SYNCO_WEBHOOK_URL="https://api.synco.fr/api/webhooks/<identifiant>/<jeton>"
export SYNCO_WEBHOOK_SECRET="<secret>"
```

```js
import { SyncoWebhook } from '@silvercore/synco-wh';

const wh = new SyncoWebhook();               // lit les variables ci-dessus
const result = await wh.send('Bonjour depuis mon script 👋');
console.log(result.messageId);
await wh.close();
```

### 4.2 Vérifier la configuration sans rien publier

```bash
npx @silvercore/synco-wh check
```

```
Adresse    : https://api.synco.fr/api/webhooks/clabc123/*** (webhook clabc123)
Signature  : secret présent, format valide
E2EE       : non configuré

Vérification locale uniquement : rien n'a été envoyé à Synco.
```

`check` contrôle la forme de l'adresse, du secret et de la clé E2EE. Il ne peut
pas vérifier qu'ils sont acceptés par Synco : l'API n'offre pas encore de test
sans publication. Pour cela, envoyez un message ou utilisez le bouton **Test**
de la fiche du webhook.

### 4.3 En une ligne, sans instance

```js
import { sendSyncoMessage } from '@silvercore/synco-wh';

await sendSyncoMessage(process.env.SYNCO_WEBHOOK_URL, process.env.SYNCO_WEBHOOK_SECRET, 'Bonjour');
```

Pratique pour un envoi isolé. Pour plusieurs messages, gardez une instance :
elle conserve l'ordre, le quota et la correction d'horloge entre les envois.

---

## 5. Configurer le client

```ts
new SyncoWebhook(options?: SyncoWebhookOptions)
```

Toutes les options sont facultatives. Une option invalide lève
`SyncoConfigError` dès la construction.

### 5.1 Adresse du webhook

Trois façons, par ordre de priorité :

```js
// 1. Adresse complète
new SyncoWebhook({ url: 'https://api.synco.fr/api/webhooks/clabc123/AbCdEfGhIjKlMnOpQrStUvWx' });

// 2. En morceaux
new SyncoWebhook({ webhookId: 'clabc123', token: 'AbCdEfGhIjKlMnOpQrStUvWx', baseUrl: 'https://api.synco.fr' });

// 3. Variable d'environnement SYNCO_WEBHOOK_URL (si ni url ni webhookId)
new SyncoWebhook();
```

| Option | Type | Défaut |
|---|---|---|
| `url` | `string` | `SYNCO_WEBHOOK_URL` |
| `webhookId` | `string` | — (va avec `token`) |
| `token` | `string` | — (va avec `webhookId`) |
| `baseUrl` | `string` | `https://api.synco.fr` |

Règles appliquées à l'adresse :

- le jeton fait exactement **24 caractères alphanumériques**. Une adresse
  tronquée au copier-coller est détectée ;
- `https://` est obligatoire. `http://` n'est accepté que vers `localhost`,
  `127.x.x.x`, `::1`, `*.local` et les adresses privées (`10.x`, `172.16–31.x`,
  `192.168.x`), car le jeton voyage dans l'URL ;
- un préfixe de chemin est conservé (API derrière un mandataire :
  `https://intra.exemple.fr/synco/api/webhooks/…`) ;
- le suffixe `/github` est reconnu (voir [§13](#13-relayer-des-payloads-github-discord-ou-synco)).

L'identifiant du webhook est exposé en lecture seule : `wh.webhookId`.

### 5.2 Secret et chiffrement

| Option | Type | Défaut | Rôle |
|---|---|---|---|
| `secret` | `string \| null` | `SYNCO_WEBHOOK_SECRET` | Secret HMAC. `null` : ne pas signer, même si la variable existe. |
| `e2ee` | `{ publicKey: string; strict?: boolean } \| false` | `SYNCO_WEBHOOK_PUBLIC_KEY` | Chiffrement de bout en bout. `false` : ignorer la variable. |

Sans secret (ni option, ni variable), la librairie avertit : un webhook qui
exige la signature, comme c'est le cas par défaut, refusera les requêtes.
Passez `secret: null` pour un webhook dont la signature est désactivée : la
librairie ne signe pas et n'avertit pas.

### 5.3 Valeurs par défaut des messages

```js
const wh = new SyncoWebhook({
  defaults: {
    username: 'Déploiements',                  // nom affiché
    avatarUrl: 'https://exemple.fr/rocket.png', // photo
    threadId: 'cl…',                            // salon cible
  },
});
```

Chaque valeur s'applique aux messages qui ne la précisent pas eux-mêmes. Sans
`username` ni `avatarUrl`, Synco utilise le nom et la photo configurés sur le
webhook. Sans `threadId`, il utilise le salon de destination du webhook.

### 5.4 Réseau, relances, quotas

| Option | Type | Défaut | Rôle |
|---|---|---|---|
| `timeoutMs` | `number` | `30000` | Délai maximal d'une requête, lecture de la réponse comprise. |
| `retry` | `{ maxRetries?; maxDelayMs? } \| false` | `{ maxRetries: 3, maxDelayMs: 60000 }` | Relances sûres ([§10](#10-relances-quotas-et-ordre-des-messages)). `false` : aucune. |
| `rateLimit` | `{ perMinute? } \| false` | `{ perMinute: 50 }` | Quota local. `false` : désactivé. |
| `clock` | `{ autoSync?; skewMs? }` | `{ autoSync: true, skewMs: 1000 }` | Correction d'horloge ([§11](#11-signature-et-horloge)). |
| `fetch` | `(url, init) => Promise<Response>` | `globalThis.fetch` | Client HTTP à utiliser. |
| `userAgent` | `string` | — | Ajouté après `synco-wh/0.1.0` dans l'en-tête `User-Agent`. |

### 5.5 Validation

| Option | Type | Défaut | Rôle |
|---|---|---|---|
| `validate` | `boolean` | `true` | Validation locale avant envoi. À `false`, c'est Synco qui refuse (`VALIDATION` avec `source: 'server'`). |
| `onOverflow` | `'error' \| 'truncate'` | `'error'` | Textes trop longs : erreur, ou coupe avec « … ». |

`truncate` ne concerne que les **textes** (contenu, nom, titres, descriptions,
champs, pied, auteur, nom de fichier). Un nombre d'éléments trop grand (plus
de 10 embeds, plus de 25 champs) reste une erreur.

### 5.6 Journalisation et divers

| Option | Type | Défaut | Rôle |
|---|---|---|---|
| `logger` | `{ warn(message: string): void } \| false` | `console` | Reçoit les avertissements ([§14](#14-observabilité--hooks-et-avertissements)). |
| `hooks` | `SyncoHooks` | — | Fonctions appelées autour de chaque requête. |
| `dangerouslyAllowBrowser` | `boolean` | `false` | Autorise l'exécution dans une page web. **Déconseillé**, voir [§19](#19-sécurité). |

### 5.7 Exemple complet

```js
const wh = new SyncoWebhook({
  url: process.env.SYNCO_WEBHOOK_URL,
  secret: process.env.SYNCO_WEBHOOK_SECRET,
  defaults: { username: 'CI' },
  timeoutMs: 10_000,
  retry: { maxRetries: 5, maxDelayMs: 30_000 },
  onOverflow: 'truncate',
  logger: { warn: message => myLogger.warn(message) },
  hooks: {
    afterResponse: ({ status, durationMs }) => metrics.observe('synco_webhook', durationMs, { status }),
  },
});
```

---

## 6. Composer un message

### 6.1 Texte simple

Une chaîne est un raccourci pour `{ content }` :

```js
await wh.send('Sauvegarde terminée');
await wh.send({ content: 'Sauvegarde terminée' }); // équivalent
```

Le texte est limité à **4096 caractères**. Un texte vide ou fait uniquement
d'espaces est refusé.

### 6.2 Structure complète d'un message

```ts
interface SyncoMessage {
  content?: string;                              // texte, 4096 caractères max
  embeds?: Array<SyncoEmbed | EmbedBuilder>;     // 10 cartes max
  username?: string;                             // nom affiché pour ce message, 100 caractères max
  avatarUrl?: string;                            // photo pour ce message, URL http(s)
  threadId?: string;                             // salon cible
  attachments?: SyncoAttachment[];               // expérimental, voir 6.5
  mentions?: string[];                           // expérimental, voir 6.5
}
```

Un message doit contenir au moins un texte, une carte ou une pièce jointe.

### 6.3 Changer l'identité d'un message

```js
await wh.send({
  content: 'Sauvegarde nocturne terminée',
  username: 'Cron',
  avatarUrl: 'https://exemple.fr/cron.png',
});
```

Ces deux champs remplacent, pour ce message seulement, le nom et la photo du
webhook (et les `defaults` du client).

### 6.4 Viser un autre salon

Un webhook poste dans son salon de destination. Pour viser un autre salon
**du même espace** :

```js
await wh.send('Alerte disque', { threadId: 'cl0987654321' });  // option d'envoi
await wh.send({ content: 'Alerte disque', threadId: 'cl0987654321' }); // dans le message
```

Priorité : option d'envoi, puis `message.threadId`, puis `defaults.threadId`,
puis le salon de destination du webhook. Un salon d'un autre espace est refusé
(`THREAD_OUT_OF_SCOPE`) : un webhook ne sort jamais de son espace.

L'identifiant d'un salon se trouve dans l'URL de Synco quand le salon est
ouvert : `/<organisation>/<espace>/<salon>`.

### 6.5 Pièces jointes et mentions (expérimental)

```js
await wh.send({
  content: 'Journal de la nuit',
  attachments: [{ url: 'https://exemple.fr/logs/2026-09-30.log', filename: 'nuit.log', size: 10240 }],
  mentions: ['<identifiant utilisateur>'],
});
```

Synco **accepte** ces champs mais **ne les affiche pas encore** dans le fil.
Les pièces jointes exigent en plus la permission « Joindre des fichiers ».
Ce sont des liens vers des fichiers déjà hébergés : la librairie ne téléverse
rien.

### 6.6 Ce que Synco fait du texte

Synco retire tout ce qui ressemble à une balise HTML, c'est-à-dire tout texte
entre `<` et `>` : `si a < b et c > d` s'affiche `si a  d`. La librairie vous
avertit (une fois par client) quand un message est concerné. Pour afficher des
chevrons, remplacez-les, par exemple par `‹ ›` ou `≤ ≥`.

Synco retire aussi les espaces en début et en fin de texte.

### 6.7 Vérifier un message sans l'envoyer

```js
const issues = wh.validate({ embeds: [{ title: 'Build', color: 'rouge' }] });
// [{ path: 'embeds[0].color', message: "couleur non reconnue (« rouge ») : utilisez '#rrggbb', …" }]
```

`validate()` renvoie la liste de **toutes** les anomalies, avec leur chemin, et
un tableau vide si le message est valide. Elle n'envoie rien et n'utilise pas
le réseau.

---

## 7. Les cartes enrichies (embeds)

### 7.1 Structure

```ts
interface SyncoEmbed {
  title?: string;                                  // 256 caractères max
  description?: string;                            // 4096 caractères max
  url?: string;                                    // lien du titre, http(s)
  color?: string | number;                         // voir 7.2
  timestamp?: Date | string | number;              // voir 7.3
  author?: { name?: string; iconUrl?: string };    // nom : 256 caractères max
  footer?: { text?: string; iconUrl?: string };    // texte : 2048 caractères max
  fields?: Array<{                                 // 25 champs max
    name: string;                                  // 1 à 256 caractères
    value: string | number | boolean;              // 1 à 1024 caractères
    inline?: boolean;                              // côte à côte
  }>;
  image?: string | { url: string };                // grande image
  thumbnail?: string | { url: string };            // vignette
}
```

Une carte doit avoir au moins un titre, une description, un champ, une image,
une vignette ou un auteur. Toutes les URL doivent être en `http://` ou
`https://`.

### 7.2 Couleurs

Formats acceptés, tous convertis au format `#rrggbb` qu'attend Synco :

| Écriture | Résultat |
|---|---|
| `'#22C55E'`, `'22c55e'` | `#22c55e` |
| `'#2c5'` | `#22cc55` |
| `0x22c55e`, `2278750` (entier, format Discord) | `#22c55e` |
| `'success'` | `#22c55e` |
| `'warning'` | `#f59e0b` |
| `'danger'` | `#ef4444` |
| `'info'` | `#3b82f6` |
| `'neutral'` | `#64748b` |

La palette est exportée : `import { Colors } from '@silvercore/synco-wh'`, puis
`Colors.danger`.

### 7.3 Horodatage

`timestamp` accepte une `Date`, un nombre de millisecondes ou une chaîne lisible
par `new Date()`. La librairie le convertit en ISO 8601 UTC
(`2026-09-30T10:00:00.000Z`). Une date illisible est signalée par la validation.

### 7.4 Écrire une carte

Trois styles, équivalents :

```js
import { EmbedBuilder, embed } from '@silvercore/synco-wh';

// Objet littéral
await wh.send({
  embeds: [{
    title: '✅ Build réussie',
    description: 'Branche `main`, commit a1b2c3d',
    url: 'https://ci.exemple.fr/builds/1240',
    color: 'success',
    author: { name: 'GitHub Actions', iconUrl: 'https://github.com/favicon.ico' },
    fields: [
      { name: 'Durée', value: '2 min 34 s', inline: true },
      { name: 'Tests', value: 412, inline: true },
    ],
    footer: { text: 'Pipeline #1240' },
    timestamp: new Date(),
  }],
});

// Fonction embed() : identité typée, pour l'autocomplétion en TypeScript
const card = embed({ title: 'Incident résolu', color: 'success' });

// EmbedBuilder, chaînable
const builder = new EmbedBuilder()
  .title('Incident résolu')
  .description('API de paiement rétablie')
  .color('success')
  .field('Durée', '12 min', true)
  .field('Impact', '3 % des requêtes', true)
  .footer('Supervision')
  .timestamp();                 // sans argument : maintenant

await wh.send({ content: 'Fin d\'incident', embeds: [card, builder] });
```

Méthodes d'`EmbedBuilder` :

| Méthode | Effet |
|---|---|
| `title(texte)` | Titre. |
| `description(texte)` | Description. |
| `url(lien)` | Lien du titre. |
| `color(couleur)` | Couleur ([§7.2](#72-couleurs)). |
| `timestamp(date?)` | Horodatage, maintenant par défaut. |
| `author(nom, iconUrl?)` | Auteur. |
| `footer(texte, iconUrl?)` | Pied. |
| `field(nom, valeur, inline = false)` | Ajoute un champ. |
| `image(url)` | Grande image. |
| `thumbnail(url)` | Vignette. |
| `build()` | Renvoie une copie de la carte sous forme d'objet. |

Un `EmbedBuilder` peut être passé directement dans `embeds`. Il est lu au
moment de l'appel à `send()` : le modifier ensuite n'a pas d'effet sur le
message déjà envoyé.

### 7.5 Cartes sans texte

```js
await wh.sendEmbed({ title: 'Seule' });
await wh.sendEmbed([carteA, carteB]);
```

---

## 8. Envoyer : méthodes et résultats

### 8.1 `send(message, options?)`

```ts
send(input: string | SyncoMessage, options?: SendOptions): Promise<SendResult>
```

| Option d'envoi | Type | Rôle |
|---|---|---|
| `threadId` | `string` | Salon cible pour ce message. |
| `signal` | `AbortSignal` | Annule l'envoi ([§8.5](#85-annuler-un-envoi)). |
| `idempotent` | `boolean` | Autorise la relance des échecs ambigus, au risque d'un doublon ([§10.2](#102-les-échecs-ambigus-et-loption-idempotent)). |

### 8.2 Le résultat

```ts
interface SendResult {
  messageId: string;      // identifiant du message publié
  threadId: string;       // salon où il a été publié
  receivedAt: Date;       // horodatage de réception par Synco
  attempts: number;       // nombre de requêtes HTTP, relances comprises
  rateLimit?: {           // état du quota annoncé par Synco
    limit?: number;
    remaining?: number;
    resetAt?: Date;
  };
}
```

`rateLimit` reflète le compteur par webhook de Synco (100 par minute). Le
plafond effectif d'un émetteur est plus bas (50 par minute, voir [§10.3](#103-quotas)).

### 8.3 Quand une erreur est-elle levée ?

- **Tout de suite**, avant toute requête : message invalide
  (`SyncoValidationError`), message trop volumineux, client fermé.
- **Après l'envoi** : refus de Synco ou échec réseau, une fois les relances
  épuisées.

`send()` renvoie toujours une promesse ; une erreur immédiate est une promesse
rejetée, pas une exception synchrone.

### 8.4 `buildRequest(message, options?)`

Construit la requête exacte, sans l'envoyer :

```js
const { url, headers, body } = await wh.buildRequest('Bonjour');
// url     : https://api.synco.fr/api/webhooks/clabc123/***   (jeton masqué)
// headers : { 'Content-Type', 'User-Agent', 'X-Synco-Timestamp', 'X-Synco-Signature' }
// body    : '{"_synco":{},"content":"Bonjour"}'
```

Utile pour journaliser, déboguer ou comparer avec un autre client. L'URL
renvoyée ne contient pas le jeton ; pour envoyer la requête vous-même,
reconstruisez-la à partir de votre adresse. La signature est valable 5 minutes.

### 8.5 Annuler un envoi

```js
const controller = new AbortController();
setTimeout(() => controller.abort(), 5000);

try {
  await wh.send('Peut-être trop tard', { signal: controller.signal });
} catch (error) {
  if (error.code === 'ABORTED') console.log('annulé');
}
```

Un envoi annulé pendant qu'il attend son tour dans la file est rejeté dès
qu'il atteint la tête de la file, sans être envoyé. Pendant une attente de
relance ou de quota, ou pendant la requête elle-même, l'annulation est
immédiate. Une requête annulée en cours de route a pu atteindre Synco.

---

## 9. Gérer les erreurs

### 9.1 La hiérarchie

Toutes les erreurs de la librairie héritent de `SyncoWebhookError` :

```
SyncoWebhookError
├── SyncoConfigError            configuration invalide
├── SyncoValidationError        message invalide (localement ou selon Synco)
├── SyncoAuthError              401 : adresse, secret, signature, horloge
├── SyncoForbiddenError         403 : pause, permission, salon
├── SyncoNotFoundError          404 : webhook introuvable
├── SyncoPayloadTooLargeError   413 : plus de 1 Mo
├── SyncoRateLimitError         429 : quota dépassé
├── SyncoDecryptionError        400 : échec du déchiffrement E2EE
├── SyncoNoThreadError          400 : aucun salon où publier
├── SyncoServerError            5xx
├── SyncoNetworkError           échec réseau
├── SyncoTimeoutError           pas de réponse à temps
└── SyncoAbortError             envoi annulé
```

Propriétés communes :

| Propriété | Type | Contenu |
|---|---|---|
| `code` | `SyncoErrorCode` | Code stable, à utiliser dans votre code (voir ci-dessous). |
| `message` | `string` | Description lisible, suivie de la cause probable. |
| `hint` | `string \| undefined` | Cause probable et remède, seuls. |
| `status` | `number \| undefined` | Statut HTTP, absent pour une erreur locale ou réseau. |
| `serverMessage` | `string \| undefined` | Message d'origine de Synco. |
| `retryable` | `boolean` | Vrai si réessayer plus tard a une chance d'aboutir sans doublon. |
| `attempts` | `number` | Nombre de tentatives d'envoi avant l'abandon ; 0 pour une erreur levée avant tout envoi (validation, configuration). |

Aucune erreur ne contient le jeton ni le secret : l'adresse y apparaît sous la
forme `…/api/webhooks/<identifiant>/***`.

### 9.2 Tous les codes

| Code | Classe | HTTP | Cause la plus fréquente | Que faire |
|---|---|---|---|---|
| `CONFIG` | `SyncoConfigError` | — | Adresse tronquée, option invalide, clé E2EE illisible. | Corriger la configuration. |
| `CLOSED` | `SyncoWebhookError` | — | Envoi après `close()`. | Créer un nouveau client. |
| `VALIDATION` | `SyncoValidationError` | — ou 400 | Champ trop long, couleur inconnue, message vide… | Lire `error.issues`. |
| `BAD_REQUEST` | `SyncoWebhookError` | 400 | Requête refusée pour une autre raison. | Lire `serverMessage`. |
| `DECRYPTION_FAILED` | `SyncoDecryptionError` | 400 | Clé publique E2EE périmée, ou E2EE désactivé côté Synco. | Recopier la clé publique actuelle. |
| `NO_THREAD` | `SyncoNoThreadError` | 400 | L'espace du webhook n'a aucun salon. | Créer un salon ou choisir une destination. |
| `SIGNATURE_REQUIRED` | `SyncoAuthError` | 401 | Aucun secret fourni. | Définir `secret` ou `SYNCO_WEBHOOK_SECRET`. |
| `INVALID_SIGNATURE_FORMAT` | `SyncoAuthError` | 401 | En-tête de signature altéré (mandataire ?). | Vérifier qu'aucun intermédiaire ne réécrit les en-têtes. |
| `INVALID_SIGNATURE` | `SyncoAuthError` | 401 | Mauvais secret, ou secret régénéré. | Recopier le secret. |
| `TIMESTAMP_REJECTED` | `SyncoAuthError` | 401 | Horloge de la machine décalée. | Synchroniser l'horloge (NTP), voir [§11.2](#112-horloge). |
| `INVALID_TOKEN` | `SyncoAuthError` | 401 | Adresse régénérée entre-temps. | Recopier la nouvelle adresse. |
| `UNAUTHORIZED` | `SyncoAuthError` | 401 | Autre refus d'authentification. | Lire `serverMessage`. |
| `WEBHOOK_DISABLED` | `SyncoForbiddenError` | 403 | Webhook en pause. | Le réactiver dans Synco. |
| `MISSING_PERMISSIONS` | `SyncoForbiddenError` | 403 | Cartes ou pièces jointes non autorisées. | Lire `error.missingPermissions`, accorder la permission ou retirer la partie concernée. |
| `THREAD_OUT_OF_SCOPE` | `SyncoForbiddenError` | 403 | Salon cible hors de l'espace du webhook. | Viser un salon du même espace. |
| `FORBIDDEN` | `SyncoForbiddenError` | 403 | Autre refus. | Lire `serverMessage`. |
| `NOT_FOUND` | `SyncoNotFoundError` | 404 | Webhook supprimé, ou identifiant faux. | Recréer le webhook ou corriger l'adresse. |
| `PAYLOAD_TOO_LARGE` | `SyncoPayloadTooLargeError` | 413 ou — | Corps de plus de 1 Mo. | Alléger le message. |
| `RATE_LIMITED` | `SyncoRateLimitError` | 429 | Quota dépassé malgré les relances. | Attendre `error.retryAfterMs`, regrouper les messages. |
| `SERVER_ERROR` | `SyncoServerError` | 5xx | Incident côté Synco. | Réessayer plus tard ; avec un 500, vérifier d'abord que le message n'a pas été publié. |
| `UNEXPECTED_RESPONSE` | `SyncoWebhookError` | 2xx ou autre | La réponse n'est pas celle de Synco (portail captif, mauvaise adresse). | Vérifier l'adresse et le réseau. |
| `NETWORK` | `SyncoNetworkError` | — | Serveur injoignable, connexion coupée. | Voir `error.maybeDelivered`. |
| `TIMEOUT` | `SyncoTimeoutError` | — | Pas de réponse dans `timeoutMs`. | Le message a peut-être été publié. |
| `ABORTED` | `SyncoAbortError` | — | `AbortSignal` déclenché. | — |

### 9.3 Propriétés spécifiques

| Classe | Propriété | Contenu |
|---|---|---|
| `SyncoValidationError` | `issues` | `Array<{ path: string; message: string }>`, toutes les anomalies. |
| `SyncoValidationError` | `source` | `'local'` : refusé avant envoi ; `'server'` : refusé par Synco. |
| `SyncoForbiddenError` | `missingPermissions` | Par exemple `['send_embeds']`. |
| `SyncoRateLimitError` | `retryAfterMs` | Délai conseillé avant de réessayer. |
| `SyncoNetworkError` | `maybeDelivered` | `false` seulement si l'on sait que rien n'est parti (DNS, connexion refusée). |

### 9.4 Exemple de gestion

```js
import {
  SyncoWebhookError,
  SyncoValidationError,
  SyncoRateLimitError,
} from '@silvercore/synco-wh';

try {
  await wh.send(message);
} catch (error) {
  if (error instanceof SyncoValidationError) {
    for (const issue of error.issues) console.error(`${issue.path || 'message'} : ${issue.message}`);
  } else if (error instanceof SyncoRateLimitError) {
    await remettreEnFile(message, error.retryAfterMs);
  } else if (error instanceof SyncoWebhookError) {
    switch (error.code) {
      case 'INVALID_TOKEN':
      case 'INVALID_SIGNATURE':
      case 'NOT_FOUND':
        alerterExploitation(`Webhook Synco à reconfigurer : ${error.message}`);
        break;
      case 'WEBHOOK_DISABLED':
        break; // pause volontaire : on ignore
      default:
        console.error(`[${error.code}] ${error.message}`);
    }
  } else {
    throw error; // pas une erreur de la librairie
  }
}
```

Testez `error.code` plutôt que le texte de `error.message` : le code est stable,
le texte peut évoluer.

---

## 10. Relances, quotas et ordre des messages

### 10.1 Ce qui est relancé

Synco n'a pas de mécanisme d'idempotence : si une requête a abouti mais que la
réponse s'est perdue, la renvoyer publie le message une deuxième fois. La
librairie ne relance donc automatiquement que ce qui est **sûr** :

| Situation | Relancé ? | Pourquoi |
|---|---|---|
| 429, quota dépassé | oui | Refusé avant tout traitement. |
| 502, 503, 504 | oui | Émis par le mandataire, la requête n'a pas atteint l'API. |
| DNS introuvable, connexion refusée | oui | Rien n'est parti. |
| Horodatage refusé | une fois | Après recalage de l'horloge ([§11.2](#112-horloge)). |
| 500 | **non** | Le message a pu être créé avant l'erreur. |
| Délai dépassé | **non** | Le message a pu être publié. |
| Connexion coupée en cours de route | **non** | Idem. |
| Autres 4xx | jamais | Réessayer donnerait le même résultat. |

Chaque relance est **re-signée** avec un horodatage neuf. Le nombre de relances
est borné par `retry.maxRetries` (3 par défaut), en plus de la première tentative.

Délai avant chaque relance :

- **429** : la durée annoncée par Synco (`Retry-After`, sinon `RateLimit-Reset`,
  sinon le champ `retryAfter` de la réponse, plafonné à 60 s), plus 100 ms ;
- **autres cas** : 500 ms, 1 s, 2 s, 4 s… plus un aléa de 0 à 250 ms ;
- toujours plafonné par `retry.maxDelayMs` (60 s par défaut).

### 10.2 Les échecs ambigus et l'option `idempotent`

Si un doublon occasionnel vous importe moins qu'un message perdu, par exemple
pour une alerte, autorisez la relance des échecs ambigus (500, délai dépassé,
connexion coupée) :

```js
await wh.send(alerte, { idempotent: true });
```

Sinon, gérez-les vous-même avec `error.maybeDelivered` (erreur réseau) ou le
code `TIMEOUT` / `SERVER_ERROR` : vérifiez dans le salon avant de renvoyer.

### 10.3 Quotas

Plafonds appliqués par Synco à un émetteur :

| Portée | Plafond |
|---|---|
| Par webhook, depuis une même adresse IP | **50 requêtes par minute** |
| Depuis une même adresse IP, tous webhooks confondus | 100 requêtes par minute |

La librairie respecte le premier par défaut : au-delà de 50 envois sur une
fenêtre glissante de 60 secondes, les suivants **attendent** au lieu d'échouer.
Elle se cale aussi sur les en-têtes `RateLimit-*` de Synco quand plusieurs
processus partagent le même webhook.

- Si plusieurs processus ou machines utilisent le même webhook, répartissez le
  quota : `rateLimit: { perMinute: 25 }` pour deux processus.
- Si un même processus utilise **plusieurs** webhooks, pensez au plafond de
  100 par IP.
- `rateLimit: false` désactive le quota local ; Synco répondra alors 429 et la
  librairie relancera.

Le meilleur moyen de tenir le quota reste de **regrouper** : dix commits dans
une carte plutôt que dix messages (voir [§18.6](#186-regrouper-des-événements)).

### 10.4 Ordre des messages

Un client envoie **un message à la fois**, dans l'ordre des appels, relances
comprises. Vous pouvez lancer plusieurs `send()` sans attendre : ils seront
publiés dans cet ordre.

```js
await Promise.all([wh.send('1'), wh.send('2'), wh.send('3')]); // publiés 1, 2, 3
```

Conséquence : un message bloqué (quota, relances) retarde ceux qui le suivent.
Deux clients distincts ne partagent ni leur file ni leur ordre.

---

## 11. Signature et horloge

### 11.1 Signature

Quand un secret est fourni, chaque requête porte deux en-têtes :

```
X-Synco-Timestamp: 1759226400000
X-Synco-Signature: t=1759226400000,v1=<HMAC-SHA256 hexadécimal>
```

La signature porte sur l'horodatage suivi du corps **exact** envoyé. La
librairie sérialise le corps une seule fois et envoie la chaîne signée : la
cause d'échec la plus courante des implémentations manuelles est ainsi écartée.

Pour signer une requête envoyée par un autre client HTTP :

```js
import { signPayload } from '@silvercore/synco-wh';

const body = JSON.stringify({ content: 'Bonjour', _synco: {} });
const timestamp = String(Date.now());
const signature = await signPayload(secret, timestamp, body);
// en-têtes : X-Synco-Timestamp: timestamp, X-Synco-Signature: signature
```

### 11.2 Horloge

Synco refuse un horodatage de plus de **5 minutes**, et aussi un horodatage
**dans le futur**, même d'une milliseconde. Une machine dont l'horloge avance
voit donc ses requêtes refusées. La librairie s'en protège de deux façons :

1. **Marge** : elle retire 1 seconde à l'horodatage (`clock.skewMs`).
2. **Recalage** : au premier refus d'horodatage, elle mesure l'écart avec
   l'en-tête `Date` de la réponse, le mémorise pour tous les envois suivants,
   et réessaie une fois (`clock.autoSync`).

Si le recalage est désactivé ou ne suffit pas, l'erreur `TIMESTAMP_REJECTED`
chiffre l'écart : « l'horloge de cette machine est en avance de 3 min 12 s sur
celle du serveur ». Synchronisez alors l'horloge (NTP).

```js
new SyncoWebhook({ clock: { autoSync: false, skewMs: 2000 } });
```

---

## 12. Chiffrement de bout en bout (E2EE)

### 12.1 Principe

Par défaut, le message arrive en clair sur le serveur Synco (sur une connexion
HTTPS). Avec l'E2EE, la librairie chiffre le texte avant l'envoi et seul le
serveur Synco peut le déchiffrer, avec la clé privée du webhook.

### 12.2 Activation

1. Dans Synco, fiche du webhook → **Réglages avancés** → activer le
   **chiffrement de bout en bout**. Synco affiche la **clé publique** du webhook.
2. Passez-la à la librairie :

```js
const wh = new SyncoWebhook({
  url, secret,
  e2ee: { publicKey: process.env.SYNCO_WEBHOOK_PUBLIC_KEY },
});

await wh.send('Mot de passe du coffre tourné');
```

La variable `SYNCO_WEBHOOK_PUBLIC_KEY` suffit : le client l'utilise
automatiquement si l'option `e2ee` est absente. La clé peut y être écrite sur
une ligne, avec des `\n` littéraux :

```bash
export SYNCO_WEBHOOK_PUBLIC_KEY="-----BEGIN PUBLIC KEY-----\nMFkwEwYH…\n-----END PUBLIC KEY-----"
```

La clé est vérifiée à la construction : ce doit être une clé publique ECDH
P-256, sinon `SyncoConfigError`.

### 12.3 Ce qui est chiffré, et ce qui ne l'est pas

**Seul le texte (`content`) est chiffré.** Les cartes, le nom affiché, la photo,
les pièces jointes et les mentions voyagent en clair.

Le mode strict interdit d'envoyer ces éléments avec un texte chiffré :

```js
new SyncoWebhook({ e2ee: { publicKey, strict: true } });

await wh.send({ content: 'Secret', embeds: [{ title: 'Fuite' }] });
// SyncoValidationError : embeds — voyagerait en clair : seul le texte est chiffré (mode E2EE strict)
```

En mode strict, `defaults.username` et `defaults.avatarUrl` sont concernés
aussi : ne les définissez pas.

### 12.4 Limites

- Le texte chiffré est limité à **3072 octets UTF-8** (environ 3000 caractères
  latins, moins avec des accents ou des emojis). Au-delà : `SyncoValidationError`.
- Un message sans texte (cartes seules) part en clair.
- Si l'E2EE n'est **pas** activé côté Synco, le texte chiffré est publié tel
  quel, illisible. La librairie ne peut pas le détecter avant l'envoi : testez
  après activation.
- Si le webhook est recréé ou ses clés changent, l'ancienne clé publique
  provoque `DECRYPTION_FAILED`.

### 12.5 Détail cryptographique

Pour chaque message : une paire de clés ECDH P-256 éphémère ; un secret partagé
avec la clé publique du webhook ; une clé AES-256 dérivée par
`HMAC-SHA256(sel aléatoire de 16 octets, secret partagé)` ; un chiffrement
AES-256-GCM avec un IV aléatoire de 12 octets. Le tout repose sur l'API Web
Crypto du runtime.

---

## 13. Relayer des payloads GitHub, Discord ou Synco

```ts
forward(payload: object, options?: ForwardOptions): Promise<SendResult>
```

`forward()` transmet un payload déjà formé par un autre outil. Il accepte les
mêmes options que `send()` (`threadId`, `signal`, `idempotent`), plus `format` :

| `format` | Traitement |
|---|---|
| `'auto'` (défaut) | Détecte le format comme le fait Synco, puis applique l'un des cas ci-dessous. |
| `'github'` | Relaie le payload **tel quel** vers `…/github`, où Synco le met en forme (pushs, tickets, demandes de fusion, publications). Pas de validation locale. |
| `'discord'` | Convertit localement un payload de webhook Discord (`content`, `username`, `avatar_url`, `embeds`) en message Synco, puis l'envoie comme `send()`. |
| `'synco'` | Envoie le payload au format de l'API Synco (champs `avatar_url`, `icon_url`…) après validation. |

```js
// Relais GitHub
await wh.forward(githubEvent, { format: 'github' });

// Outil qui sait parler « webhook Discord »
await wh.forward({
  content: 'Nouveau commit',
  username: 'GitHub Bot',
  embeds: [{ title: 'abc1234', color: 3447003 }],
});
```

Pourquoi convertir Discord localement : Synco refuse les couleurs entières
(format Discord) avant même de convertir le payload. La librairie les convertit.
Les champs propres à Discord sans équivalent (`tts`, `components`,
`allowed_mentions`) sont ignorés.

Détection automatique, dans l'ordre :

| Format | Reconnu à |
|---|---|
| Synco | présence de `_synco` |
| Discord | `embeds` tableau, ou `content` et `username` textes, ou `tts`, `file`, `attachments` |
| GitHub | `action` texte, ou `repository`, `sender`, `issue`, `pull_request` |
| aucun | traité comme Synco (donc validé : un objet sans contenu est refusé) |

La fonction de détection est exportée : `detectFormat(payload)`.

Un payload GitHub n'est jamais chiffré. En mode E2EE strict, son relais est refusé.

---

## 14. Observabilité : hooks et avertissements

### 14.1 Hooks

```js
const wh = new SyncoWebhook({
  hooks: {
    beforeRequest: ({ url, attempt, bodyBytes, signed }) => {},
    afterResponse: ({ url, attempt, status, durationMs, rateLimit }) => {},
    onRetry: ({ attempt, delayMs, error }) => {},
  },
});
```

| Hook | Appelé | Données |
|---|---|---|
| `beforeRequest` | avant chaque requête HTTP, relances comprises | `url` (jeton masqué), `attempt`, `bodyBytes`, `signed` |
| `afterResponse` | à chaque réponse reçue, succès ou non | `url`, `attempt`, `status`, `durationMs`, `rateLimit` |
| `onRetry` | avant l'attente d'une relance | `attempt` (tentative échouée), `delayMs`, `error` |

Les hooks sont synchrones et ne doivent pas lever d'erreur : une exception est
ignorée et signalée par un avertissement, sans interrompre l'envoi.

### 14.2 Avertissements

Envoyés à `logger.warn`, préfixés par `[synco-wh]` :

| Avertissement | Quand |
|---|---|
| Aucun secret fourni | À la construction, sans secret ni `secret: null`. |
| Le secret ne ressemble pas à un secret Synco | Secret qui n'a pas 36 caractères alphanumériques. |
| Synco supprime tout texte entre chevrons | Premier message concerné, une fois par client. |
| Le hook … a levé une erreur | À chaque exception de hook. |

```js
new SyncoWebhook({ logger: pino });           // tout objet avec une méthode warn
new SyncoWebhook({ logger: false });          // silence
```

---

## 15. Cycle de vie : `flush()` et `close()`

Les envois sont asynchrones et passent par une file. Dans un script court,
attendez-les avant de terminer :

```js
const wh = new SyncoWebhook();
wh.send('Étape 1');
wh.send('Étape 2');
await wh.close();   // attend les deux envois, puis refuse les suivants
```

| Méthode | Effet |
|---|---|
| `flush()` | Attend la fin de tous les envois déjà demandés. Le client reste utilisable. |
| `close()` | Refuse les nouveaux envois (`CLOSED`), puis attend ceux déjà demandés. |

Ni `flush()` ni `close()` ne rejettent si un envoi a échoué : l'échec est
porté par la promesse de l'envoi concerné. Gardez ces promesses ou attachez-y
un `.catch()`, sinon Node signalera un rejet non géré.

Dans un serveur de longue durée, créez **un client par webhook** au démarrage et
réutilisez-le : il conserve l'ordre, le quota et la correction d'horloge.

---

## 16. L'outil en ligne de commande

Le paquet fournit `synco-webhook`, utilisable dans un shell ou un pipeline sans
écrire de JavaScript.

```bash
npx @silvercore/synco-wh send "Déploiement terminé"
```

### 16.1 Configuration

**Par variables d'environnement uniquement** : `SYNCO_WEBHOOK_URL`,
`SYNCO_WEBHOOK_SECRET`, `SYNCO_WEBHOOK_PUBLIC_KEY`. Les options `--url`,
`--secret`, `--token` et `--webhook-url` sont refusées exprès : un argument
finit dans l'historique du shell et dans les journaux de CI.

### 16.2 Commandes

| Commande | Effet |
|---|---|
| `send [texte…]` | Envoie un message. Les mots du texte sont joints par des espaces. |
| `check` | Vérifie localement l'adresse, le secret et la clé E2EE. N'envoie rien. |
| `--help`, `-h` | Aide. |
| `--version`, `-v` | Version. |

### 16.3 Options de `send`

| Option | Effet |
|---|---|
| `--stdin` | Lit le texte sur l'entrée standard (le saut de ligne final est retiré). |
| `--json <fichier>` | Relaie un payload JSON (Synco, Discord ou GitHub, détecté automatiquement). `-` pour l'entrée standard. |
| `--title <texte>` | Titre de la carte. |
| `--description <texte>` | Description de la carte. |
| `--color <couleur>` | `#rrggbb` ou `success`, `warning`, `danger`, `info`, `neutral`. |
| `--field <Nom=Valeur>` | Champ de la carte, répétable. Le premier `=` sépare le nom de la valeur. |
| `--inline` | Affiche les champs côte à côte. |
| `--link <url>` | Lien du titre de la carte. |
| `--image <url>` | Image de la carte. |
| `--footer <texte>` | Pied de la carte. |
| `--timestamp` | Horodate la carte à l'instant présent. |
| `--username <nom>` | Nom affiché pour ce message. |
| `--avatar-url <url>` | Photo pour ce message. |
| `--thread <id>` | Salon cible, du même espace. |
| `--truncate` | Coupe les textes trop longs au lieu d'échouer. |
| `--quiet`, `-q` | N'affiche pas l'identifiant du message publié. |

Une option de carte (`--title`, `--field`…) crée une carte ; texte et carte
peuvent être combinés.

### 16.4 Sortie et codes de retour

- Succès : l'identifiant du message sur la sortie standard (sauf `--quiet`).
- Échec : `synco-webhook : [CODE] message` sur la sortie d'erreur, suivi du
  détail par champ pour une erreur de validation.

| Code | Signification |
|---|---|
| `0` | Message publié (ou `check` réussi). |
| `1` | Envoi refusé par Synco, ou échec réseau. |
| `2` | Erreur d'usage ou de configuration. |

### 16.5 Exemples

```bash
# Texte
synco-webhook send "Sauvegarde terminée"

# Carte
synco-webhook send "Build #1240" \
  --title "Build réussie" --color success \
  --field "Branche=main" --field "Durée=2 min 34 s" --inline \
  --link "https://ci.exemple.fr/1240" --timestamp

# Sortie d'une commande
df -h / | synco-webhook send --stdin --username "Disques"

# Payload préparé par un autre outil
curl -s https://exemple.fr/rapport.json | synco-webhook send --json -

# Dans un script shell
if ! synco-webhook send -q "Import terminé"; then
  echo "Notification Synco en échec" >&2
fi
```

---

## 17. Environnements d'exécution

| Environnement | Prise en charge | Remarques |
|---|---|---|
| Node.js 22+ | oui | ESM ; `require()` à partir de 22.12. |
| Bun | oui | Environnement de développement de la librairie. |
| Deno 2 | oui | `import { SyncoWebhook } from 'npm:@silvercore/synco-wh'` ; lancer avec `--allow-net --allow-env`. |
| Cloudflare Workers | oui | Passer l'adresse et le secret explicitement (voir [§18.4](#184-cloudflare-worker)). |
| Vercel / Netlify Edge | oui | Idem. |
| Navigateur | **non** | Refusé à la construction ; voir [§19](#19-sécurité). |

La librairie n'utilise que des API standard : `fetch`, `crypto.subtle`,
`TextEncoder`, `AbortController`, `btoa`/`atob`.

> Seul Bun a été testé à ce jour. Les autres environnements sont pris en charge
> par conception mais pas encore couverts par l'intégration continue.

### 17.1 Certificat auto-signé (environnement de développement)

Ajoutez l'autorité de certification plutôt que de désactiver la vérification :

```bash
NODE_EXTRA_CA_CERTS=/chemin/vers/ca.pem node mon-script.mjs
```

### 17.2 Mandataire HTTP sortant

Le `fetch` de Node n'utilise pas les variables `HTTP_PROXY` par défaut. Passez un
client adapté avec l'option `fetch`, par exemple avec `undici` :

```js
import { ProxyAgent, fetch as undiciFetch } from 'undici';

const dispatcher = new ProxyAgent(process.env.HTTPS_PROXY);
const wh = new SyncoWebhook({
  fetch: (url, init) => undiciFetch(url, { ...init, dispatcher }),
});
```

---

## 18. Recettes

### 18.1 GitHub Actions

```yaml
# .github/workflows/notify-synco.yml — secrets : SYNCO_WEBHOOK_URL, SYNCO_WEBHOOK_SECRET
name: Notifier Synco
on:
  workflow_run:
    workflows: [CI]
    types: [completed]

jobs:
  notify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - env:
          SYNCO_WEBHOOK_URL: ${{ secrets.SYNCO_WEBHOOK_URL }}
          SYNCO_WEBHOOK_SECRET: ${{ secrets.SYNCO_WEBHOOK_SECRET }}
          CONCLUSION: ${{ github.event.workflow_run.conclusion }}
          BRANCH: ${{ github.event.workflow_run.head_branch }}
          RUN_URL: ${{ github.event.workflow_run.html_url }}
        run: |
          npx --yes @silvercore/synco-wh send -q \
            --title "CI ${CONCLUSION} sur ${BRANCH}" \
            --color "$([ "$CONCLUSION" = success ] && echo success || echo danger)" \
            --link "$RUN_URL" \
            --field "Dépôt=${GITHUB_REPOSITORY}" --inline --timestamp
```

### 18.2 GitLab CI

```yaml
# Variables CI/CD masquées : SYNCO_WEBHOOK_URL, SYNCO_WEBHOOK_SECRET
.notify_synco:
  stage: .post
  image: node:22-alpine
  script:
    - |
      npx --yes @silvercore/synco-wh send -q \
        --title "Pipeline #$CI_PIPELINE_ID : $RESULT" \
        --color "$COLOR" --link "$CI_PIPELINE_URL" \
        --field "Branche=$CI_COMMIT_REF_NAME" --field "Commit=$CI_COMMIT_SHORT_SHA" --inline

# Un job par issue : dans un job de notification, $CI_JOB_STATUS décrirait
# ce job lui-même, pas le pipeline.
notify_synco_success:
  extends: .notify_synco
  when: on_success
  variables: { RESULT: "réussi", COLOR: "success" }

notify_synco_failure:
  extends: .notify_synco
  when: on_failure
  variables: { RESULT: "échoué", COLOR: "danger" }
```

### 18.3 Script planifié (cron)

```js
// rapport-quotidien.mjs — lancé chaque matin par cron
import { SyncoWebhook, Colors } from '@silvercore/synco-wh';

const wh = new SyncoWebhook({ defaults: { username: 'Rapport quotidien' } });
const stats = await calculerStatistiques();

try {
  await wh.send({
    embeds: [{
      title: `Activité du ${new Date().toLocaleDateString('fr-FR')}`,
      color: stats.erreurs > 0 ? Colors.warning : Colors.success,
      fields: [
        { name: 'Commandes', value: stats.commandes, inline: true },
        { name: 'Chiffre d\'affaires', value: `${stats.ca} €`, inline: true },
        { name: 'Erreurs', value: stats.erreurs, inline: true },
      ],
      timestamp: new Date(),
    }],
  });
} finally {
  await wh.close();
}
```

### 18.4 Cloudflare Worker

Les workers ne lisent pas `process.env` : passez la configuration explicitement.

```js
import { SyncoWebhook } from '@silvercore/synco-wh';

export default {
  async scheduled(event, env, ctx) {
    const wh = new SyncoWebhook({ url: env.SYNCO_WEBHOOK_URL, secret: env.SYNCO_WEBHOOK_SECRET });
    ctx.waitUntil(wh.send('Tâche planifiée exécutée'));
  },
};
```

### 18.5 Relais depuis un serveur Express

Pour un outil qui envoie ses propres webhooks mais ne sait pas signer au format
Synco (GitHub signe avec son propre en-tête, que Synco ne lit pas) :

```js
import express from 'express';
import { SyncoWebhook, SyncoWebhookError } from '@silvercore/synco-wh';

const synco = new SyncoWebhook();
const app = express();
app.use(express.json({ limit: '1mb' }));

app.post('/hooks/github', async (req, res) => {
  // Vérifier ici X-Hub-Signature-256 avec le secret GitHub.
  try {
    await synco.forward(req.body, { format: 'github' });
    res.sendStatus(204);
  } catch (error) {
    res.status(error instanceof SyncoWebhookError && error.status ? 502 : 500).send(error.message);
  }
});

app.listen(8080);
```

### 18.6 Regrouper des événements

Un message par événement épuise vite le quota et noie le salon. Accumulez et
envoyez un résumé :

```js
const pending = [];
let timer;

function notifier(event) {
  pending.push(event);
  timer ??= setTimeout(envoyerResume, 30_000);   // au plus un message toutes les 30 s
}

async function envoyerResume() {
  const batch = pending.splice(0);
  timer = undefined;
  const lignes = batch.slice(0, 25).map(e => ({ name: e.titre, value: e.detail }));
  await wh.send({
    content: `${batch.length} événement(s)`,
    embeds: [{ title: 'Résumé', color: 'info', fields: lignes }],
  }).catch(err => console.error(err.message));
}
```

Une carte contient au plus 25 champs, et un message au plus 10 cartes.

### 18.7 Alertes de supervision

```js
const severite = { critical: 'danger', warning: 'warning', resolved: 'success' };

async function relayerAlerte(alerte) {
  await wh.send(
    {
      username: 'Supervision',
      embeds: [{
        title: `${alerte.status === 'resolved' ? '✅' : '🚨'} ${alerte.name}`,
        description: alerte.summary,
        color: severite[alerte.severity] ?? 'neutral',
        url: alerte.dashboardUrl,
        fields: Object.entries(alerte.labels).slice(0, 25).map(([name, value]) => ({ name, value, inline: true })),
        timestamp: alerte.startsAt,
      }],
    },
    { idempotent: true }   // un doublon vaut mieux qu'une alerte perdue
  );
}
```

### 18.8 Tester son code sans Synco

Injectez un faux `fetch` :

```js
const sent = [];
const wh = new SyncoWebhook({
  url: 'https://api.synco.fr/api/webhooks/test/AAAAAAAAAAAAAAAAAAAAAAAA',
  secret: null,
  logger: false,
  fetch: async (url, init) => {
    sent.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ success: true, messageId: 'm1', threadId: 't1', receivedAt: new Date().toISOString() }));
  },
});

await wh.send('test');
// sent[0] → { content: 'test', _synco: {} }
```

Pour vérifier seulement le contenu d'un message, `wh.validate()` et
`wh.buildRequest()` n'ont besoin d'aucun réseau.

---

## 19. Sécurité

**L'adresse vaut mot de passe.** Quiconque la détient peut poster dans votre
salon sous l'identité du webhook. **Le secret** empêche qu'une adresse qui a
fuité (journaux d'un mandataire, capture d'écran) suffise.

Bonnes pratiques :

- rangez l'adresse et le secret dans les secrets de votre outil (variables
  d'environnement, coffre-fort, *repository secrets*), jamais dans le code, un
  ticket ou un salon ;
- gardez la signature exigée côté Synco (réglage par défaut) et fournissez
  toujours le secret ;
- un webhook par usage : révoquer l'un ne coupe pas les autres ;
- régénérez l'adresse au moindre doute sur sa confidentialité ;
- n'utilisez pas la librairie dans une page web : le secret y serait lisible
  par tout visiteur. De toute façon, Synco n'autorise pas l'en-tête de signature
  depuis un navigateur. Passez par votre serveur.

Ce que la librairie garantit :

- le jeton et le secret n'apparaissent dans aucune erreur, aucun avertissement,
  aucun hook ni aucun résultat de `buildRequest()` ;
- une adresse `http://` vers Internet est refusée ;
- les redirections HTTP sont refusées : un corps signé n'est jamais renvoyé
  vers une autre adresse ;
- la signature porte sur le corps exact envoyé et expire au bout de 5 minutes.

---

## 20. Dépannage

**`SIGNATURE_REQUIRED` alors que je fournis un secret.**
Vérifiez que la variable est bien définie dans l'environnement du processus
(`npx @silvercore/synco-wh check`). Une option `secret: null` l'ignore.

**`INVALID_SIGNATURE`.**
Le secret ne correspond pas au webhook : mal copié, ou régénéré depuis. Il n'est
affiché qu'une fois ; en cas de doute, régénérez l'adresse et reprenez le
nouveau couple adresse + secret.

**`TIMESTAMP_REJECTED` malgré le recalage automatique.**
L'horloge de la machine dérive pendant l'exécution, ou un mandataire retire
l'en-tête `Date`. Synchronisez l'horloge (NTP).

**`INVALID_TOKEN`.**
L'adresse a été régénérée. Mettez à jour tous les outils qui l'utilisaient.

**`MISSING_PERMISSIONS`.**
Le webhook n'a pas le droit d'envoyer des cartes (`send_embeds`) ou des pièces
jointes (`send_attachments`). Accordez-le dans les réglages avancés, ou retirez
la partie concernée.

**`DECRYPTION_FAILED`.**
La clé publique utilisée n'est plus celle du webhook, ou l'E2EE a été désactivé.
Recopiez la clé publique affichée dans Synco.

**Le message part sans erreur mais je ne le vois pas.**
Il est sans doute arrivé dans un autre salon : vérifiez le salon de destination
du webhook et `result.threadId`. Le bouton **Test** de la fiche du webhook lève
le doute.

**Une partie du texte a disparu.**
Synco supprime tout texte entre chevrons (`< … >`), voir [§6.6](#66-ce-que-synco-fait-du-texte).

**Le texte chiffré apparaît en clair dans le salon, illisible.**
L'E2EE est configuré dans la librairie mais pas activé sur le webhook.

**Les envois sont lents.**
Le quota local fait patienter au-delà de 50 envois par minute, et les messages
partent un par un. Regroupez les événements ([§18.6](#186-regrouper-des-événements)).

**Mon script se termine avant l'envoi.**
Attendez les promesses, ou appelez `await wh.close()` avant la fin ([§15](#15-cycle-de-vie--flush-et-close)).

**`UNEXPECTED_RESPONSE`.**
La réponse ne vient pas de Synco : portail captif, mandataire d'entreprise, ou
adresse qui pointe ailleurs.

**`SyncoConfigError : SyncoWebhook ne s'utilise pas dans une page web`.**
Voir [§19](#19-sécurité).

---

## 21. Référence de l'API

### 21.1 Exports

```ts
import {
  // Client
  SyncoWebhook, sendSyncoMessage,
  // Composition
  EmbedBuilder, embed, Colors, LIMITS,
  // Utilitaires
  parseWebhookUrl, detectFormat, signPayload, VERSION,
  // Erreurs
  SyncoWebhookError, SyncoConfigError, SyncoValidationError, SyncoAuthError,
  SyncoForbiddenError, SyncoNotFoundError, SyncoPayloadTooLargeError,
  SyncoRateLimitError, SyncoDecryptionError, SyncoNoThreadError,
  SyncoServerError, SyncoNetworkError, SyncoTimeoutError, SyncoAbortError,
} from '@silvercore/synco-wh';

import type {
  SyncoWebhookOptions, SendOptions, ForwardOptions, SyncoHooks, BuiltRequest,
  SyncoMessage, SyncoEmbed, SyncoEmbedField, SyncoAttachment, MessageInput,
  MessageDefaults, EmbedSource, ColorInput, ColorName, SendResult,
  RateLimitInfo, ValidationIssue, SyncoErrorCode, OverflowMode,
  ForwardFormat, PayloadFormat, WebhookEndpoint, WirePayload,
} from '@silvercore/synco-wh';
```

### 21.2 `SyncoWebhook`

| Membre | Signature | Voir |
|---|---|---|
| constructeur | `new SyncoWebhook(options?: SyncoWebhookOptions)` | [§5](#5-configurer-le-client) |
| `webhookId` | `readonly string` | [§5.1](#51-adresse-du-webhook) |
| `send` | `(input: string \| SyncoMessage, options?: SendOptions) => Promise<SendResult>` | [§8](#8-envoyer--méthodes-et-résultats) |
| `sendEmbed` | `(embeds: SyncoEmbed \| EmbedSource \| Array<…>, options?: SendOptions) => Promise<SendResult>` | [§7.5](#75-cartes-sans-texte) |
| `forward` | `(payload: object, options?: ForwardOptions) => Promise<SendResult>` | [§13](#13-relayer-des-payloads-github-discord-ou-synco) |
| `validate` | `(input: string \| SyncoMessage) => ValidationIssue[]` | [§6.7](#67-vérifier-un-message-sans-lenvoyer) |
| `buildRequest` | `(input, options?: { threadId?: string }) => Promise<BuiltRequest>` | [§8.4](#84-buildrequestmessage-options) |
| `flush` | `() => Promise<void>` | [§15](#15-cycle-de-vie--flush-et-close) |
| `close` | `() => Promise<void>` | [§15](#15-cycle-de-vie--flush-et-close) |

### 21.3 Fonctions

| Fonction | Signature | Rôle |
|---|---|---|
| `sendSyncoMessage` | `(url: string, secret: string \| undefined, input, options?) => Promise<SendResult>` | Envoi ponctuel. `options` réunit les options du client (sauf `url`, `secret`) et celles d'envoi. Sans secret, la requête n'est pas signée. |
| `embed` | `(data: SyncoEmbed) => SyncoEmbed` | Identité typée. |
| `parseWebhookUrl` | `(url: string) => WebhookEndpoint` | Découpe une adresse en `{ base, webhookId, token, github }` ; lève `SyncoConfigError`. |
| `detectFormat` | `(payload: unknown) => 'synco' \| 'discord' \| 'github' \| undefined` | Détection du format, comme Synco. |
| `signPayload` | `(secret: string, timestamp: string \| number, body: string) => Promise<string>` | Valeur de `X-Synco-Signature`. |

### 21.4 Constantes

| Constante | Contenu |
|---|---|
| `VERSION` | Version de la librairie (`'0.1.0'`). |
| `Colors` | Palette nommée ([§7.2](#72-couleurs)). |
| `LIMITS` | Toutes les bornes ([§22](#22-limites)), par exemple `LIMITS.contentLength`. |

---

## 22. Limites

| Élément | Limite | Constante |
|---|---|---|
| Texte (`content`) | 4096 caractères | `LIMITS.contentLength` |
| Texte chiffré (E2EE) | 3072 octets UTF-8 | `LIMITS.encryptedPlaintextBytes` |
| Nom affiché | 100 caractères | `LIMITS.usernameLength` |
| Cartes par message | 10 | `LIMITS.embeds` |
| Titre de carte | 256 caractères | `LIMITS.embedTitleLength` |
| Description de carte | 4096 caractères | `LIMITS.embedDescriptionLength` |
| Nom d'auteur | 256 caractères | `LIMITS.embedAuthorNameLength` |
| Texte de pied | 2048 caractères | `LIMITS.embedFooterTextLength` |
| Champs par carte | 25 | `LIMITS.embedFields` |
| Nom de champ | 1 à 256 caractères | `LIMITS.fieldNameLength` |
| Valeur de champ | 1 à 1024 caractères | `LIMITS.fieldValueLength` |
| Pièces jointes | 10 ; nom de fichier 256 caractères | `LIMITS.attachments` |
| Mentions | 50 ; 100 caractères chacune | `LIMITS.mentions` |
| Corps de la requête | 1 Mo | `LIMITS.bodyBytes` |
| Envois par minute | 50 par webhook et par IP ; 100 par IP | — |
| Validité d'une signature | 5 minutes, jamais dans le futur | — |

Les longueurs en caractères sont comptées comme en JavaScript (`.length`) : un
emoji compte souvent pour deux.
