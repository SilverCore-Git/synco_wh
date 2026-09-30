/**
 * Horodatage des requêtes signées.
 *
 * synco_api refuse tout horodatage dans le futur (`age >= 0`), même d'une
 * milliseconde : `skewMs` retranche une marge qui absorbe une horloge locale
 * légèrement en avance. Au-delà, `offsetMs` est recalé sur l'en-tête `Date`
 * d'une réponse du serveur.
 */
export class Clock {
  offsetMs = 0;

  constructor(
    private readonly skewMs: number,
    private readonly now: () => number = Date.now
  ) {}

  timestamp(): string {
    return String(Math.floor(this.now() + this.offsetMs - this.skewMs));
  }

  /**
   * Écart serveur − local mesuré sur l'en-tête `Date` (précision : la
   * seconde, tronquée, donc jamais en avance sur le serveur). `undefined` si
   * l'en-tête manque ou est illisible.
   */
  measure(dateHeader: string | null, receivedAt: number): number | undefined {
    if (!dateHeader) return undefined;
    const serverTime = Date.parse(dateHeader);
    return Number.isNaN(serverTime) ? undefined : serverTime - receivedAt;
  }
}
