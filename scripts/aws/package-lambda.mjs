import { mkdirSync, cpSync, existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { root, npm } from './common.mjs';
npm(['run', 'build', '--workspace', '@campusfix/api']);
const folder = resolve(root, '.artifacts/lambda');
mkdirSync(folder, { recursive: true });
cpSync(resolve(root, 'apps/api/dist'), folder, { recursive: true });
for (const file of ['package.json', 'package-lock.json'])
  cpSync(resolve(root, 'scripts/aws/lambda-runtime', file), resolve(folder, file));
npm([
  'ci',
  '--prefix',
  folder,
  '--os=linux',
  '--cpu=x64',
  '--libc=glibc',
  '--include=optional',
  '--ignore-scripts',
  '--no-audit',
  '--no-fund',
]);
for (const path of [
  'lambda.mjs',
  'workers/workflow.mjs',
  'node_modules/sharp/dist/index.mjs',
  'node_modules/@img/sharp-linux-x64/lib/sharp-linux-x64-0.35.4.node',
  'node_modules/@img/sharp-libvips-linux-x64/lib/libvips-cpp.so.8.18.6',
]) {
  // libvips patch versions may change only with a deliberately updated sharp dependency.
  if (!existsSync(resolve(folder, path))) throw new Error(`Missing Lambda artifact: ${path}`);
}
const native = readFileSync(
  resolve(folder, 'node_modules/@img/sharp-linux-x64/lib/sharp-linux-x64-0.35.4.node'),
);
if (native.subarray(0, 4).toString('hex') !== '7f454c46')
  throw new Error('Sharp is not a Linux ELF binary.');
if (!existsSync(resolve(folder, 'node_modules/@img/sharp-libvips-linux-x64/package.json')))
  throw new Error('Linux libvips dependency missing.');
console.log('Lambda package ready: Node 24, Linux x64 Sharp, no environment secrets.');

if (process.platform === 'linux') {
  const { run } = await import('./common.mjs');
  const { pathToFileURL } = await import('node:url');
  run(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `const m = await import(${JSON.stringify(pathToFileURL(resolve(folder, 'lambda.mjs')).href)}); if(typeof m.handler !== 'function') throw Error('Missing handler'); console.log('Linux Lambda cold-start import passed.');`,
    ],
    {
      env: {
        ...process.env,
        APP_ENV: 'test',
        CORE_TABLE: 'package-test-core',
        DISCOVERY_TABLE: 'package-test-discovery',
        JOBS_TABLE: 'package-test-jobs',
        FILES_ENABLED: 'false',
      },
    },
  );
}
