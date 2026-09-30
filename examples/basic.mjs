// node examples/basic.mjs — avec SYNCO_WEBHOOK_URL et SYNCO_WEBHOOK_SECRET définies.
import { SyncoWebhook, SyncoWebhookError } from '@synco/webhook';

const wh = new SyncoWebhook();

try {
  await wh.send('Sauvegarde nocturne terminée');

  await wh.send({
    content: 'Build #1240',
    embeds: [
      {
        title: 'Build réussie',
        color: 'success',
        fields: [
          { name: 'Branche', value: 'main', inline: true },
          { name: 'Durée', value: '2 min 34 s', inline: true },
        ],
        timestamp: new Date(),
      },
    ],
  });
} catch (error) {
  if (error instanceof SyncoWebhookError) {
    console.error(`[${error.code}] ${error.message}`);
    process.exitCode = 1;
  } else {
    throw error;
  }
} finally {
  await wh.close();
}
