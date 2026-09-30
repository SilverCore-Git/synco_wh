import { expect, test } from 'bun:test';
import pkg from '../package.json' with { type: 'json' };
import { VERSION } from '../src/version.ts';

test('VERSION suit package.json', () => {
  expect(VERSION).toBe(pkg.version);
});
