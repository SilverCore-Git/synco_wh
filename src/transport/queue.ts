import type { RateLimitInfo } from '../message/types.js';
import { sleep as defaultSleep } from '../util/sleep.js';

const WINDOW_MS = 60_000;

/**
 * Limiteur local à fenêtre glissante : au plus `perMinute` requêtes sur
 * toute période de 60 s. Se cale aussi sur `RateLimit-Remaining: 0` quand
 * d'autres processus partagent le même webhook.
 */
export class RateLimiter {
  private readonly sent: number[] = [];
  private blockedUntil = 0;

  constructor(
    private readonly perMinute: number | null,
    private readonly now: () => number = Date.now,
    private readonly sleep: (ms: number, signal?: AbortSignal) => Promise<void> = defaultSleep
  ) {}

  async acquire(signal?: AbortSignal): Promise<void> {
    for (;;) {
      const now = this.now();
      while (this.sent.length && this.sent[0]! <= now - WINDOW_MS) this.sent.shift();

      let wait = Math.max(0, this.blockedUntil - now);
      if (this.perMinute !== null && this.sent.length >= this.perMinute) {
        wait = Math.max(wait, this.sent[0]! + WINDOW_MS - now);
      }
      if (wait <= 0) {
        this.sent.push(now);
        return;
      }
      await this.sleep(wait, signal);
    }
  }

  observe(info: RateLimitInfo | undefined): void {
    if (info?.remaining === 0 && info.resetAt) {
      this.blockedUntil = Math.max(this.blockedUntil, info.resetAt.getTime());
    }
  }

  /** Bloque les envois jusqu'à `until` (après un 429). */
  pauseUntil(until: number): void {
    this.blockedUntil = Math.max(this.blockedUntil, until);
  }
}

/**
 * File FIFO à un seul envoi à la fois : les messages arrivent dans le salon
 * dans l'ordre des appels, relances comprises.
 */
export class SerialQueue {
  private tail: Promise<void> = Promise.resolve();

  run<T>(task: () => Promise<T>): Promise<T> {
    const result = this.tail.then(task);
    this.tail = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }

  /** Résout quand toutes les tâches déjà soumises sont terminées. */
  idle(): Promise<void> {
    return this.tail;
  }
}
