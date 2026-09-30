// Relais minimal : reçoit les événements GitHub et les transmet à Synco.
// Utile quand le dépôt ne peut pas signer au format Synco (GitHub signe avec
// son propre en-tête X-Hub-Signature-256, que Synco ne lit pas).
//
//   SYNCO_WEBHOOK_URL=… SYNCO_WEBHOOK_SECRET=… bun examples/github-relay.ts

import { SyncoWebhook, SyncoWebhookError } from '@synco/webhook';

const synco = new SyncoWebhook();

Bun.serve({
  port: 8080,
  async fetch(request) {
    if (request.method !== 'POST') return new Response('POST uniquement', { status: 405 });
    // En production : vérifier ici X-Hub-Signature-256 avec le secret GitHub.
    try {
      await synco.forward(await request.json(), { format: 'github' });
      return new Response('ok');
    } catch (error) {
      const status = error instanceof SyncoWebhookError && error.status ? 502 : 500;
      return new Response(error instanceof Error ? error.message : 'erreur', { status });
    }
  },
});
