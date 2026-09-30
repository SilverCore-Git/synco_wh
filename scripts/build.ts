// Compile src/ vers dist/ (ESM + déclarations) et rend le CLI exécutable.
import { chmodSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dir, '..');
rmSync(resolve(root, 'dist'), { recursive: true, force: true });

const tsc = Bun.spawnSync([process.execPath, '--bun', resolve(root, 'node_modules/.bin/tsc'), '-p', 'tsconfig.build.json'], {
  cwd: root,
  stdout: 'inherit',
  stderr: 'inherit',
});
if (tsc.exitCode !== 0) process.exit(tsc.exitCode ?? 1);

chmodSync(resolve(root, 'dist/cli.js'), 0o755);
console.log('dist/ prêt');
