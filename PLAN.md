# Plan — `synco_wh`, librairie JavaScript des webhooks Synco

> Statut : **v0.1.0 implémentée** (jalons 0 à 8, voir §10 et §11 pour les
> écarts au plan). Plan rédigé le 30/09/2026 d'après la doc
> (`synco_app/doc/08-webhooks.md`, `synco_api/doc/webhook/*.md`) **et surtout
> le code** de réception de `synco_api` (routes, middlewares, contrôleur,
> utilitaires crypto), qui fait foi quand il contredit la doc.

---

## 1. Objectif

Avec **une adresse de webhook et son secret**, un programme JavaScript doit pouvoir
poster dans un salon Synco en une ligne :

```js
import { SyncoWebhook } from '@synco/webhook';

const wh = new SyncoWebhook({
  url: process.env.SYNCO_WEBHOOK_URL,
  secret: process.env.SYNCO_WEBHOOK_SECRET,
});

await wh.send('Déploiement terminé en 42 s');
```

La librairie prend en charge tout ce qu'un intégrateur rate aujourd'hui en
recopiant les exemples cURL : la signature HMAC sur le corps exact, l'horodatage
en millisecondes, les limites du schéma, les quotas, les erreurs lisibles, et le
chiffrement de bout en bout quand il est activé.

### Dans le périmètre

- Envoi de messages : texte, cartes enrichies (embeds), identité par message
  (`username`, `avatar_url`), salon cible (`_synco.targetThreadId`).
- Signature HMAC-SHA256 + anti-rejeu, automatiques dès qu'un secret est fourni.
- Chiffrement E2EE (ECDH P-256 + AES-256-GCM) si l'utilisateur fournit la clé
  publique du webhook.
- Validation locale identique au schéma Zod du serveur, avant tout envoi.
- Erreurs typées, relances sûres (429, 502/503/504), file d'attente qui respecte
  les quotas.
- Relais de payloads bruts (GitHub via le suffixe `/github`, Discord).
- Un petit CLI (`npx @synco/webhook send "…"`) pour les scripts shell et la CI.

### Hors périmètre (v1)

- **API de gestion** (`/api/space/:id/webhooks`, régénération, stats…) : elle
  exige un JWT utilisateur, donc un compte — l'inverse de la promesse « URL +
  secret ». Candidat v2, dans un sous-module séparé.
- **Usage navigateur** : impossible en l'état (voir §3.9, CORS) et dangereux
  (le secret serait exposé à tout visiteur). La librairie refuse explicitement
  de s'exécuter dans une page web.
- Recevoir quoi que ce soit : un webhook Synco est **entrant uniquement**.

---

## 2. Contrat serveur réel (vérifié dans `synco_api`)

### 2.1 Point d'entrée

| Élément | Valeur | Source |
|---|---|---|
| URL | `POST {base}/api/webhooks/{webhookId}/{token}` | `routes/webhookReception.ts` |
| Variante GitHub | `POST …/{webhookId}/{token}/github` — **saute la validation Zod**, force le mapper GitHub | idem |
| Autres méthodes | 405 | idem |
| `token` | 24 caractères base62 | `utils/webhookSecurity.ts` |
| `secret` | 36 caractères base62 | idem |
| Corps | lu brut (≤ 1 Mo, 413 au-delà), puis `JSON.parse` ; un JSON invalide devient `{}` **sans erreur** | `extractRawBody()` |

### 2.2 Authentification (`middleware/webhookAuth.ts`)

Ordre des contrôles, et donc ordre des erreurs possibles :

1. `webhookId` inconnu → **404** `Webhook not found`
2. webhook en pause → **403** `Webhook is disabled`
3. token faux → **401** `Invalid token`
4. `requireSignature` (vrai par défaut) et l'un des deux en-têtes absent → **401**
   `X-Synco-Signature and X-Synco-Timestamp headers are required…`
5. en-tête mal formé → **401** `Invalid signature format` — regex
   **`^t=(\d+),v1=([a-f0-9]+)$`** : le hex doit être **en minuscules**.
6. HMAC faux → **401** `Invalid signature`
7. horodatage hors fenêtre → **401** `Timestamp too old`

Signature : `hex(HMAC-SHA256(key = secret, data = t + rawBody))`, où `t` est
**celui de l'en-tête `X-Synco-Signature`** (pas `X-Synco-Timestamp`, qui doit
seulement être présent). La fenêtre est `0 ≤ now_serveur − t ≤ 300 000 ms` :
**un horodatage dans le futur est refusé**, même d'1 ms. Une horloge client en
avance produit donc « Timestamp too old », message trompeur.

### 2.3 Schéma du payload (`middleware/webhookValidation.ts`)

| Champ | Contrainte |
|---|---|
| `content` | string ≤ 4096 |
| `username` | string ≤ 100 |
| `avatar_url` | URL |
| `embeds` | ≤ 10 |
| `embed.title` / `description` | ≤ 256 / ≤ 4096 |
| `embed.url`, `image.url`, `thumbnail.url`, `author.icon_url`, `footer.icon_url` | URL (http/https conservées, autres schémas vidés) |
| `embed.color` | **string `#RRGGBB` uniquement** (un entier Discord est rejeté en 400) |
| `embed.timestamp` | ISO 8601 `datetime` (format `toISOString()`) |
| `embed.author.name` / `footer.text` | ≤ 256 / ≤ 2048 |
| `embed.fields` | ≤ 25 ; `name` 1–256, `value` 1–1024 (**vides interdits**) ; `inline` bool |
| `attachments` | ≤ 10 ; `url` requis, `filename` ≤ 256, `size` entier > 0 — **acceptés mais pas rendus** |
| `mentions` | ≤ 50 strings ≤ 100 — **acceptés mais pas rendus** |
| `encrypted`, `nonce` (≤ 64), `tag` (≤ 64), `salt` (≤ 64), `senderPublicKey` (≤ 512) | E2EE |
| `_synco` | `{ targetThreadId?, encrypted?, mappings? }` |
| `null` | toléré partout, ramené à absent |

Assainissement serveur : balises HTML retirées (`<[^>]*>`) et `trim()` sur
`content`, titres, descriptions, champs. Conséquence : **`a < b > c` devient
`a  c`**. À documenter ; la librairie avertira (mode debug) si le texte contient
un motif `<…>`.

Le serveur **n'exige ni `content` ni `embeds`** : un `{}` publie un message vide.
La librairie, elle, l'interdira.

### 2.4 Détection de format (`utils/webhookMappers.ts`)

Ordre : Synco (`_synco` présent) → Discord (`embeds` tableau, ou `content` +
`username` strings, ou `tts`/`file`/`attachments`) → GitHub (`action` string, ou
`repository`/`sender`/`issue`/`pull_request`, ou route `/github`).

**Règle impérative pour la librairie : toujours envoyer `_synco: {}`**, même
vide. Sans lui, un message avec embeds ou `username` passe dans le mapper
Discord, qui repart du payload **d'origine** — donc, en E2EE, du **texte chiffré**
(le déchiffré est jeté). Voir §3.2.

### 2.5 Permissions (`utils/webhookPermissions.ts`)

Évaluées après mapping : `content` → `send_messages`, `embeds` non vides →
`send_embeds`, `attachments` non vides → `send_attachments`. Refus : **403**
`This webhook is not allowed to: …` avec `missingPermissions: string[]` dans le
corps.

### 2.6 Salon cible

`_synco.targetThreadId` sinon salon par défaut du webhook sinon premier salon de
l'espace. Salon hors de l'espace du webhook → **403** `Target thread does not
belong to this webhook workspace`. Aucun salon → **400** `No thread found`.

### 2.7 E2EE (contrôleur `receiveWebhook` + `utils/webhookCrypto.ts`)

Côté émetteur, pour chaque message :

1. paire ECDH P-256 éphémère ;
2. `shared = ECDH(éphémère.privée, webhook.publique)` (32 octets, coordonnée x) ;
3. `salt` aléatoire (16 octets) ; `key = HMAC-SHA256(key = salt, data = shared)` (32 octets) ;
4. `AES-256-GCM(key, iv)` sur **`content` seulement** ;
5. envoi : `encrypted: true`, `content` = chiffré base64, `nonce` = IV base64,
   `tag` = tag GCM base64, `salt` base64, `senderPublicKey` = SPKI PEM.

Points d'attention :
- **Seul `content` est chiffré.** Embeds, `username`, `avatar_url` voyagent en
  clair. La librairie le dira et proposera `e2ee.strict` qui refuse d'envoyer
  des embeds en E2EE.
- Le chiffré base64 doit tenir dans 4096 caractères → **clair ≤ 3072 octets UTF-8**.
- Échec de déchiffrement → **400** `Decryption failed`.
- Si le webhook n'a **pas** l'E2EE activé, le serveur publie le base64 tel quel.
  Impossible à détecter côté client ; à documenter.
- La clé publique n'est pas dérivable de l'URL/secret : l'utilisateur la copie
  depuis les réglages avancés du webhook et la passe en option.

### 2.8 Réponses

Succès **200** : `{ success: true, messageId, threadId, receivedAt }`.
Échec : `{ success: false, error, message, details?, missingPermissions?, retryAfter? }`.

### 2.9 Quotas réels

La route empile quatre limiteurs (`middleware/webhookRateLimiter.ts`) ; tous
tournent **avant** l'authentification, donc leur `skip` sur
`webhookAuthenticated` ne se déclenche jamais :

| Limiteur | Clé | Limite / min |
|---|---|---|
| `webhookIPLimiter` | IP | 1000 |
| `unknownWebhookIpLimiter` | IP | **100** (env `WEBHOOK_UNKNOWN_IP_RATE_LIMIT_PER_MINUTE`) |
| `unknownWebhookLimiter` | IP + webhookId | **50** |
| `webhookLimiter` | webhookId | 100 |

**Plafond effectif pour un émetteur : 50 req/min par webhook, 100 req/min par IP
tous webhooks confondus** — pas les 100/1000 annoncés par la doc.

En-têtes : `standardHeaders: true` (express-rate-limit 8) → `RateLimit-Limit`,
`RateLimit-Remaining`, `RateLimit-Reset` (secondes), et `Retry-After` sur 429.
Le champ `retryAfter` du corps renvoyé par `webhookLimiter` est **faux**
(`resetTime` est une `Date`, divisée par 1000 → un horodatage en secondes, soit
~55 ans). Ne jamais s'y fier sans borne.

### 2.10 CORS

`allowedHeaders: ['Content-Type', 'Authorization']` et origines limitées au
front Synco : un navigateur ne peut pas envoyer `X-Synco-Signature`. Confirme le
choix « serveur uniquement ».

### 2.11 Idempotence

Aucune clé d'idempotence côté serveur. Une erreur **500** peut survenir **après**
la création du message (ex. échec de la mise à jour `webhookMessage`), et une
coupure réseau après envoi est ambiguë. Relancer ces cas risque un **doublon**.

---

## 3. Écarts doc ↔ code à remonter à `synco_api`

À traiter côté API (hors de ce dépôt), mais la librairie s'en protège déjà :

1. **Quotas** : 50/min/webhook/IP et 100/min/IP en réalité (§2.9) ; la doc dit 100 et 1000.
2. **E2EE + Discord** : sans `_synco`, un payload chiffré avec embeds ou
   `username` est publié **chiffré** — `mapDiscordToSynco(payload)` devrait
   recevoir `processedPayload`. Idem pour le mapper GitHub.
3. **`retryAfter`** de `webhookLimiter` : valeur absurde (§2.9).
4. **Horodatage futur** refusé sans tolérance, avec un message « too old ».
5. **JSON invalide** silencieusement transformé en `{}` puis publié vide.
6. Doc développeur : en-têtes de signature marqués « ❌ Non » obligatoires, E2EE
   décrit avec l'ancien schéma symétrique, `color` Discord entier présenté comme
   accepté — tous obsolètes.
7. `embed.color` numérique rejeté par Zod avant même le mapper Discord qui sait
   le convertir.

---

## 4. API publique

### 4.1 Client

```ts
new SyncoWebhook(options: SyncoWebhookOptions)

interface SyncoWebhookOptions {
  url?: string;               // adresse complète, avec ou sans /github
  webhookId?: string;         // alternative à url
  token?: string;
  baseUrl?: string;           // défaut https://api.synco.fr
  secret?: string;            // absent ⇒ requêtes non signées (+ avertissement)
  e2ee?: { publicKey: string; strict?: boolean };
  defaults?: { username?: string; avatarUrl?: string; threadId?: string };
  timeoutMs?: number;         // défaut 30 000
  retry?: { maxRetries?: number; maxDelayMs?: number } | false; // défaut 3 / 60 000
  rateLimit?: { perMinute?: number } | false;                   // défaut 50
  clock?: { autoSync?: boolean; skewMs?: number };              // défaut true / 1000
  validate?: boolean;         // défaut true
  fetch?: typeof fetch;       // injectable (tests, proxy, TLS auto-signé en dev)
  userAgent?: string;         // ajouté à `synco-wh/<version>`
  hooks?: {
    beforeRequest?(info: RequestInfo): void;
    afterResponse?(info: ResponseInfo): void;
    onRetry?(info: RetryInfo): void;
  };
}
```

Variables d'environnement lues si les options manquent :
`SYNCO_WEBHOOK_URL`, `SYNCO_WEBHOOK_SECRET`, `SYNCO_WEBHOOK_PUBLIC_KEY`.
`new SyncoWebhook()` sans argument fonctionne donc en CI.

### 4.2 Méthodes

```ts
wh.send(input: string | SyncoMessage, opts?: SendOptions): Promise<SendResult>
wh.sendEmbed(embed: SyncoEmbed | SyncoEmbed[], opts?): Promise<SendResult>
wh.forward(rawPayload: object, opts?: { format?: 'auto' | 'github' | 'discord' }): Promise<SendResult>
wh.validate(input: string | SyncoMessage): ValidationIssue[]   // sans réseau
wh.buildRequest(input): Promise<{ url; headers; body }>         // pour logguer / tester
wh.flush(): Promise<void>                                        // attend la file
wh.close(): Promise<void>                                        // flush + refuse les nouveaux envois

// raccourci sans instance
sendSyncoMessage(url, secret, input, options?): Promise<SendResult>
```

```ts
interface SyncoMessage {
  content?: string;
  embeds?: SyncoEmbed[];
  username?: string;
  avatarUrl?: string;
  threadId?: string;
  attachments?: { url: string; filename?: string; size?: number }[];
  mentions?: string[];
}

interface SyncoEmbed {
  title?: string;
  description?: string;
  url?: string;
  color?: string | number | ColorName;   // '#22c55e', 0x22c55e, 'success'
  timestamp?: Date | string | number;
  author?: { name?: string; iconUrl?: string };
  footer?: { text?: string; iconUrl?: string };
  fields?: { name: string; value: string | number | boolean; inline?: boolean }[];
  image?: string;       // raccourci de { url }
  thumbnail?: string;
}

interface SendOptions { threadId?: string; signal?: AbortSignal; idempotent?: boolean }

interface SendResult {
  messageId: string;
  threadId: string;
  receivedAt: Date;
  attempts: number;
  rateLimit?: { limit: number; remaining: number; resetAt: Date };
}
```

L'API publique est en **camelCase** ; la traduction vers le format filaire
(`avatar_url`, `icon_url`, `_synco.targetThreadId`, `{ url }`) est interne.

### 4.3 Aides

- `Colors` : `success`, `warning`, `danger`, `info`, `neutral` (palette Synco).
- `embed()` : fabrique typée, plus un `EmbedBuilder` chaînable pour ceux qui
  préfèrent (`.title().color().field()…`), qui produit le même objet.
- `truncate` : option `onOverflow: 'error' | 'truncate'` (défaut `error`) pour
  les textes trop longs, avec ellipse `…` en mode `truncate`.

### 4.4 Exemples cibles (serviront de tests de la doc)

```js
// Carte de CI
await wh.send({
  content: 'Build #1240',
  embeds: [{
    title: 'Build réussie',
    color: 'success',
    fields: [
      { name: 'Branche', value: 'main', inline: true },
      { name: 'Durée', value: '2 min 34 s', inline: true },
    ],
    timestamp: new Date(),
  }],
});

// Autre salon du même espace, autre identité
await wh.send('Sauvegarde OK', { threadId: 'cl…' });
await wh.send({ content: 'Nuit calme', username: 'Cron' });

// E2EE
const secure = new SyncoWebhook({ url, secret, e2ee: { publicKey: pem } });
await secure.send('Mot de passe du coffre tourné');

// Relais GitHub (ex. depuis une fonction serverless)
await wh.forward(githubEventBody, { format: 'github' });
```

---

## 5. Erreurs

Classe de base `SyncoWebhookError` (`name`, `code`, `status?`, `serverMessage?`,
`retryable`, `attempts`), sous-classes pour `instanceof` :

| Classe | `code` | Déclencheur |
|---|---|---|
| `SyncoValidationError` | `VALIDATION` | local, avant envoi, ou 400 `Validation error` (avec `issues[]` = `details`) |
| `SyncoConfigError` | `CONFIG` | URL illisible, secret mal formé, clé publique invalide, exécution navigateur |
| `SyncoAuthError` | `SIGNATURE_REQUIRED` · `INVALID_SIGNATURE_FORMAT` · `INVALID_SIGNATURE` · `TIMESTAMP_REJECTED` · `INVALID_TOKEN` | 401 |
| `SyncoForbiddenError` | `WEBHOOK_DISABLED` · `MISSING_PERMISSIONS` (+ `missingPermissions`) · `THREAD_OUT_OF_SCOPE` | 403 |
| `SyncoNotFoundError` | `NOT_FOUND` | 404 |
| `SyncoPayloadTooLargeError` | `PAYLOAD_TOO_LARGE` | 413 ou contrôle local |
| `SyncoRateLimitError` | `RATE_LIMITED` (+ `retryAfterMs`) | 429 après épuisement des relances |
| `SyncoDecryptionError` | `DECRYPTION_FAILED` | 400 `Decryption failed` |
| `SyncoNoThreadError` | `NO_THREAD` | 400 `No thread found` |
| `SyncoServerError` | `SERVER_ERROR` | 5xx |
| `SyncoNetworkError` / `SyncoTimeoutError` | `NETWORK` / `TIMEOUT` | fetch rejeté / délai dépassé |

Le mapping `status + message serveur → code` est centralisé dans une table
(`src/errors/map.ts`) et testé : les messages serveur sont la seule clé
disponible, il faut qu'un changement côté API casse un test, pas la prod.

Chaque message d'erreur **donne la cause probable et le remède** (reprise du
tableau « Que faire quand ça ne marche pas » du chapitre 8), par exemple
`INVALID_TOKEN` → « l'adresse a probablement été régénérée ».

**Aucune erreur, log ni hook ne contient le token ni le secret** : l'URL est
toujours rendue sous la forme `…/api/webhooks/<id>/***`.

---

## 6. Conception interne

### 6.1 Arborescence

```
synco_wh/
├── src/
│   ├── index.ts              # exports publics
│   ├── client.ts             # SyncoWebhook
│   ├── config.ts             # options, env, parsing d'URL
│   ├── message/
│   │   ├── types.ts          # SyncoMessage, SyncoEmbed…
│   │   ├── normalize.ts      # camelCase → filaire, couleurs, dates, _synco
│   │   ├── validate.ts       # miroir du schéma Zod serveur, sans Zod
│   │   ├── limits.ts         # constantes (4096, 256, 25…) — une seule source
│   │   └── embed-builder.ts
│   ├── transport/
│   │   ├── sign.ts           # HMAC Web Crypto
│   │   ├── clock.ts          # décalage d'horloge
│   │   ├── request.ts        # un appel fetch + timeout + lecture réponse
│   │   ├── retry.ts          # politique de relance
│   │   └── queue.ts          # seau à jetons + file FIFO
│   ├── e2ee/
│   │   └── encrypt.ts        # ECDH + HMAC-KDF + AES-GCM, Web Crypto
│   ├── errors/
│   │   ├── classes.ts
│   │   └── map.ts
│   ├── runtime.ts            # détection navigateur, versions
│   └── cli.ts
├── test/
│   ├── unit/…
│   ├── vectors/              # vecteurs générés avec le code de synco_api
│   └── integration/          # contre une synco_api locale (opt-in)
├── examples/                 # node, bun, deno, github-actions, cloudflare-worker
├── README.md
├── CHANGELOG.md
└── package.json
```

### 6.2 Parsing de l'adresse

Regex sur le chemin : `/api/webhooks/([^/]+)/([A-Za-z0-9]{24})(/github)?/?$`.
On garde l'origine telle quelle (auto-hébergement, `https://192.168.1.73:9000`
en dev). Un token qui n'a pas 24 caractères base62 → `SyncoConfigError` avec
indice (« avez-vous copié l'adresse en entier ? »). `http:` accepté seulement
pour `localhost`/IP privées, sinon erreur : le token voyagerait en clair.

### 6.3 Construction et signature d'une requête

1. `normalize(input)` → objet filaire, **toujours avec `_synco`**.
2. `validate()` → lève `SyncoValidationError` avec **toutes** les anomalies
   (chemin + message), pas seulement la première.
3. E2EE éventuel (§6.6) sur `content`.
4. `body = JSON.stringify(wire)` **une seule fois** ; contrôle ≤ 1 048 576
   **octets** (TextEncoder, pas `.length`).
5. `t = String(Date.now() + clockOffset − skewMs)`.
6. `sig = hexLower(HMAC-SHA256(secret, t + body))` via `crypto.subtle`
   (clé importée une fois et mise en cache par instance).
7. En-têtes : `Content-Type: application/json`, `X-Synco-Timestamp: t`,
   `X-Synco-Signature: t=${t},v1=${sig}`, `User-Agent`.
8. `fetch(url, { method: 'POST', body, signal })` — la chaîne signée est
   exactement celle envoyée.

**À chaque relance, étapes 5–8 sont refaites** (nouvel horodatage, nouvelle
signature). Le chiffrement E2EE, lui, n'est pas refait : même chiffré, rejoué.

### 6.4 Horloge

- `skewMs` (défaut 1000) retranche une marge à l'horodatage : absorbe une
  horloge client légèrement en avance, au prix d'une fenêtre de 4 min 59.
- `autoSync` : sur `TIMESTAMP_REJECTED`, lire l'en-tête `Date` de la réponse,
  calculer `offset = Date(serveur) − now_local`, le mémoriser, **relancer une
  fois**. Si ça échoue encore, lever l'erreur avec l'écart mesuré dans le
  message (« votre horloge est en avance de 3 min 12 s »).

### 6.5 Relances et quotas

| Situation | Relance ? | Pourquoi |
|---|---|---|
| 429 | oui | rejeté avant tout traitement |
| 502 / 503 / 504 | oui | émis par le proxy, pas par l'API |
| erreur réseau **avant** envoi (DNS, `ECONNREFUSED`) | oui | rien n'est parti |
| délai dépassé / coupure après envoi | **non** par défaut | doublon possible |
| 500 | **non** par défaut | le message peut exister déjà (§2.11) |
| `TIMESTAMP_REJECTED` | une fois, après resynchro | §6.4 |
| autres 4xx | jamais | erreur déterministe |

`SendOptions.idempotent: true` autorise la relance des cas ambigus (l'appelant
accepte le doublon). Délai : `Retry-After` → `RateLimit-Reset` → corps
`retryAfter` **borné à 60 s** → backoff exponentiel `500 ms × 2^n` + gigue,
plafonné par `maxDelayMs`. Respect de `AbortSignal` pendant les attentes.

**File locale** : seau à jetons à `perMinute` (défaut **50**, le vrai plafond
§2.9), FIFO, ordre des messages préservé. Mise à jour depuis
`RateLimit-Remaining` pour se caler sur le serveur quand plusieurs processus
partagent le webhook. `flush()` et `close()` pour les scripts courts qui
doivent attendre la fin avant `process.exit`.

### 6.6 E2EE (Web Crypto uniquement)

```
pub      = importKey('spki', pemToDer(publicKey), ECDH P-256)        // une fois
eph      = generateKey(ECDH P-256)                                   // par message
shared   = deriveBits({ name: 'ECDH', public: pub }, eph.private, 256)
salt     = getRandomValues(16)
aesKey   = HMAC-SHA256(key = salt, data = shared)                    // 32 octets
iv       = getRandomValues(12)
ct‖tag   = AES-GCM(aesKey, iv).encrypt(utf8(content))                // tag 16 o en fin
wire    += { encrypted: true, content: b64(ct), nonce: b64(iv), tag: b64(tag),
             salt: b64(salt), senderPublicKey: toPem(export('spki', eph.public)) }
```

- `deriveBits` ECDH de Web Crypto rend la coordonnée x, identique à
  `crypto.diffieHellman` de Node côté serveur.
- IV de 12 octets (standard GCM ; le serveur accepte toute taille, son propre
  test en utilise 16 — les deux seront couverts par les vecteurs).
- Clair limité à 3072 octets UTF-8 → `SyncoValidationError` explicite au-delà.
- Validation de la clé publique à la construction : PEM SPKI, courbe P-256.
- `e2ee.strict: true` → refus d'envoyer embeds / `username` / `avatarUrl` en
  clair à côté d'un contenu chiffré.

### 6.7 `forward()`

- `format: 'github'` → POST sur `…/github`, corps relayé **tel quel** (pas de
  validation locale, le serveur n'en fait pas non plus), signé normalement.
- `format: 'discord'` → conversion locale Discord → Synco (couleur entière →
  `#RRGGBB`, `allowed_mentions`/`tts`/`components` retirés) puis envoi natif
  avec `_synco` : on ne dépend pas du mapper serveur et on évite le bogue §3.2.
- `format: 'auto'` → détection locale avec les mêmes heuristiques que le
  serveur, puis l'une des deux branches.

### 6.8 CLI

```
npx @synco/webhook send "Déploiement OK"
npx @synco/webhook send --embed-title "Build" --color success --field "Branche=main"
npx @synco/webhook send --json payload.json
echo "log…" | npx @synco/webhook send --stdin
npx @synco/webhook check          # valide URL/secret sans poster (voir §9, question 4)
```

Lit `SYNCO_WEBHOOK_URL` / `SYNCO_WEBHOOK_SECRET`, **jamais** d'URL ou de secret
en argument (ils finiraient dans l'historique shell et les logs CI). Code de
sortie ≠ 0 et message lisible en cas d'erreur. Parsing d'arguments via
`node:util.parseArgs` — pas de dépendance.

---

## 7. Runtimes, packaging, outillage

> Révisé à l'implémentation : voir §11.

- **Zéro dépendance d'exécution.** Tout repose sur `fetch`, `crypto.subtle`,
  `TextEncoder`, `AbortController`, disponibles dans Node ≥ 18, Bun, Deno et les
  runtimes edge (Cloudflare Workers, Vercel Edge).
- Garde-fou navigateur : si `window` et `document` existent (hors Deno/Workers),
  `SyncoConfigError` sauf `dangerouslyAllowBrowser: true` — et même alors CORS
  bloquera tant que l'API ne l'autorise pas.
- TypeScript strict, sources en `src/`, sortie **ESM + CJS + `.d.ts`**,
  `exports` conditionnels, `sideEffects: false`, `bin` pour le CLI.
- Build avec **tsup** ; tests avec **Vitest** (Node) plus un passage `bun test`
  et `deno test` en CI pour la compatibilité ; lint ESLint comme `synco_api`.
- Dépendances de dev : uniquement des versions publiées depuis **au moins 7
  jours** (règle maison).
- Taille visée : < 8 Ko min+gzip hors CLI.
- Nom npm : `@synco/webhook` (à valider, §9).
- SemVer ; `0.x` tant que le contrat serveur bouge (§3).

---

## 8. Tests

1. **Unitaires** : parsing d'URL, normalisation (couleurs, dates, camelCase),
   chaque règle de validation aux bornes (4096/4097, 25/26 champs, champ vide…),
   taille en octets avec emojis, table d'erreurs, politique de relance (horloge
   et `fetch` simulés), file d'attente, redaction du token dans toutes les sorties.
2. **Vecteurs croisés avec `synco_api`** — le test qui compte :
   - signature produite par la lib vérifiée par `verifySignature()` +
     `parseSignature()` du serveur ;
   - payload E2EE produit par la lib déchiffré par `deriveWebhookAESKeyFromECDH()`
     + `decryptMessage()` du serveur ;
   - payloads produits par `normalize()` passés au vrai `webhookPayloadSchema`.
   Un script régénère les vecteurs depuis `synco_api` ; la CI échoue s'ils
   dérivent.
3. **Intégration (opt-in)** contre une `synco_api` locale : envoi texte, embeds,
   E2EE, salon cible, 403 permission, 401 signature, 429 (en abaissant les
   limites par variables d'environnement), webhook en pause.
4. **Exemples exécutés** : chaque bloc de code du README est extrait et compilé.

---

## 9. Questions ouvertes

1. **Licence.** Le dépôt porte « Tous droits réservés, aucune licence
   d'utilisation ». Une librairie que des clients doivent installer a besoin
   d'une licence d'usage (MIT, Apache-2.0, ou licence propriétaire explicite).
   **Bloquant avant publication.**
2. **Nom et registre** : `@synco/webhook` sur npm public ? L'organisation npm
   `@synco` est-elle disponible, sinon `@silvercore/synco-webhook` ?
3. **Correctifs API** (§3) : les faire avant la v1 permettrait de retirer les
   contournements (limite 50, borne de `retryAfter`, `_synco` forcé reste de
   toute façon une bonne pratique).
4. **`check` sans poster** : il n'existe pas d'endpoint de vérification. Deux
   options : (a) côté API, un `POST …/{id}/{token}` avec `{"_synco":{"dryRun":true}}`
   qui fait auth + validation sans publier ; (b) sans changement API, `check`
   se limite à la forme locale de l'URL/du secret. Recommandation : (a).
5. **Idempotence** : un en-tête `Idempotency-Key` côté API rendrait les relances
   sûres sur 500 et coupures ; la lib l'enverrait déjà (UUID par message) sans
   effet tant que le serveur l'ignore.
6. **Pièces jointes et mentions** : les exposer dès la v1 (acceptées, pas
   rendues) ou les masquer jusqu'à ce que le fil les affiche ?
   Recommandation : les exposer, marquées `@experimental`.

---

## 10. Jalons

| # | Livrable | Contenu |
|---|---|---|
| 0 | Socle | `package.json`, TS, tsup, Vitest, ESLint, CI, licence tranchée |
| 1 | Envoi minimal | parsing URL, normalisation, signature, `send()`, erreurs typées, vecteurs de signature |
| 2 | Validation | miroir complet du schéma, `validate()`, vecteurs Zod |
| 3 | Fiabilité | relances, horloge, file + quotas, `flush`/`close`, hooks |
| 4 | Confort | `Colors`, `embed()`, `EmbedBuilder`, `sendEmbed`, variables d'env, raccourci `sendSyncoMessage` |
| 5 | E2EE | `e2ee/encrypt.ts`, mode strict, vecteurs de déchiffrement |
| 6 | Relais | `forward()` GitHub / Discord |
| 7 | CLI | `send`, `--stdin`, `--json`, `check` |
| 8 | Doc & release | README (FR + EN), exemples par runtime, GitHub Action d'exemple, CHANGELOG, `0.1.0` |

Chaque jalon se termine par ses tests verts et un commit.

---

## 11. Écarts entre le plan et la v0.1.0

| Plan | Réalisé | Pourquoi |
|---|---|---|
| ESM + CJS, Node ≥ 18 | **ESM seul, Node ≥ 22** | Node 18 et 20 sont en fin de vie au 30/09/2026 ; Node 22 charge un module ESM avec `require()`. Un double build aurait produit des déclarations CJS fragiles. |
| tsup | `tsc` seul (`scripts/build.ts`) | Une dépendance de moins ; aucun bundling nécessaire. |
| Vitest + passages Bun/Deno | `bun test` | Bun est le seul runtime installé sur le poste de dev ; Node et Deno restent à couvrir en CI. |
| ESLint | `tsc` strict (`noUncheckedIndexedAccess`…) | Évite une dizaine de dépendances ; à reconsidérer si le dépôt grossit. |
| < 8 Ko min+gzip | **≈ 11,6 Ko** | Messages d'erreur et indices rédigés en clair ; jugé préférable à des codes nus. |
| README FR + EN | FR seul | EN à faire avant publication. |
| Vecteurs générés par script | Import direct du vrai code de `synco_api` dans les tests | Plus fort qu'un vecteur figé : signature, schéma Zod et permissions réels. Le déchiffrement E2EE (module non importable : Prisma, clé maître) est recopié, et `test/drift.test.ts` surveille sa source. |

Ajouts non prévus :

- La préparation d'un message est coupée en deux : validation synchrone (rejet
  immédiat), chiffrement E2EE **dans** la file. Sans cela, deux envois E2EE
  simultanés pouvaient être publiés dans le désordre, et `close()` pouvait
  manquer un envoi tout juste demandé.
- `redirect: 'error'` sur chaque requête : un corps signé n'est jamais renvoyé
  vers une autre adresse.
- `SyncoNetworkError.maybeDelivered` distingue « rien n'est parti » de « peut-être publié ».

Reste à faire : CI (Node 22/24, Bun, Deno), README anglais, choix de la
licence et du nom npm (§9), puis publication.
