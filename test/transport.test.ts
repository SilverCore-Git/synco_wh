import { describe, expect, test } from 'bun:test';
import { Clock } from '../src/transport/clock.ts';
import { RateLimiter, SerialQueue } from '../src/transport/queue.ts';
import { computeRetryDelay, parseRateLimit, parseRetryAfter } from '../src/transport/retry.ts';
import { formatDuration } from '../src/util/sleep.ts';

describe('computeRetryDelay', () => {
  const now = 1_000_000;

  test('429 : Retry-After en priorité', () => {
    const headers = new Headers({ 'Retry-After': '7', 'RateLimit-Reset': '30' });
    expect(computeRetryDelay({ status: 429, headers, retry: 1, maxDelayMs: 60_000, now })).toBe(7100);
  });

  test('429 : puis RateLimit-Reset', () => {
    const headers = new Headers({ 'RateLimit-Reset': '12' });
    expect(computeRetryDelay({ status: 429, headers, retry: 1, maxDelayMs: 60_000, now })).toBe(12_100);
  });

  test('429 : retryAfter absurde du corps borné à 60 s', () => {
    expect(
      computeRetryDelay({ status: 429, headers: new Headers(), bodyRetryAfterSeconds: 1_759_230_000, retry: 1, maxDelayMs: 120_000, now })
    ).toBe(60_100);
  });

  test('backoff exponentiel plafonné', () => {
    const base = { retry: 1, maxDelayMs: 60_000, random: () => 0 };
    expect(computeRetryDelay({ ...base, status: 503 })).toBe(500);
    expect(computeRetryDelay({ ...base, status: 503, retry: 3 })).toBe(2000);
    expect(computeRetryDelay({ ...base, status: 503, retry: 20, maxDelayMs: 5000 })).toBe(5000);
  });

  test('Retry-After en date HTTP', () => {
    const date = new Date(now + 5000).toUTCString();
    expect(parseRetryAfter(new Headers({ 'Retry-After': date }), now)).toBeGreaterThan(4000);
  });

  test('RateLimit-*', () => {
    const info = parseRateLimit(new Headers({ 'RateLimit-Limit': '100', 'RateLimit-Remaining': '0', 'RateLimit-Reset': '42' }), now);
    expect(info).toEqual({ limit: 100, remaining: 0, resetAt: new Date(now + 42_000) });
    expect(parseRateLimit(new Headers(), now)).toBeUndefined();
  });
});

describe('RateLimiter', () => {
  function fakeTime() {
    let current = 0;
    const waits: number[] = [];
    return {
      now: () => current,
      sleep: async (ms: number) => {
        waits.push(ms);
        current += ms;
      },
      waits,
    };
  }

  test('au plus N envois par fenêtre glissante de 60 s', async () => {
    const time = fakeTime();
    const limiter = new RateLimiter(3, time.now, time.sleep);
    for (let i = 0; i < 4; i++) await limiter.acquire();
    expect(time.waits).toEqual([60_000]);
  });

  test('se cale sur RateLimit-Remaining: 0', async () => {
    const time = fakeTime();
    const limiter = new RateLimiter(null, time.now, time.sleep);
    limiter.observe({ remaining: 0, resetAt: new Date(15_000) });
    await limiter.acquire();
    expect(time.waits).toEqual([15_000]);
  });
});

describe('SerialQueue', () => {
  test('ordre préservé, une erreur ne bloque pas la suite', async () => {
    const queue = new SerialQueue();
    const order: number[] = [];
    const slow = queue.run(async () => {
      await Bun.sleep(20);
      order.push(1);
    });
    const failing = queue.run(async () => {
      order.push(2);
      throw new Error('x');
    });
    const fast = queue.run(async () => {
      order.push(3);
    });
    await Promise.allSettled([slow, failing, fast]);
    await queue.idle();
    expect(order).toEqual([1, 2, 3]);
    expect(failing).rejects.toThrow('x');
  });
});

describe('Clock', () => {
  test('marge retranchée et décalage appliqué', () => {
    const clock = new Clock(1000, () => 10_000);
    expect(clock.timestamp()).toBe('9000');
    clock.offsetMs = -3000;
    expect(clock.timestamp()).toBe('6000');
  });

  test('mesure sur l\'en-tête Date', () => {
    const clock = new Clock(0);
    const received = Date.parse('2026-09-30T10:00:05Z');
    expect(clock.measure('Wed, 30 Sep 2026 10:00:00 GMT', received)).toBe(-5000);
    expect(clock.measure(null, received)).toBeUndefined();
  });
});

test('formatDuration', () => {
  expect(formatDuration(850)).toBe('850 ms');
  expect(formatDuration(-192_000)).toBe('3 min 12 s');
  expect(formatDuration(120_000)).toBe('2 min');
});
