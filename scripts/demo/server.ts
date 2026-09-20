import { randomBytes } from 'node:crypto';
import { readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { serve } from '@hono/node-server';
import {
  CreateTableCommand,
  DescribeTableCommand,
  DeleteTableCommand,
  ResourceNotFoundException,
  type CreateTableCommandInput,
} from '@aws-sdk/client-dynamodb';
import { readConfig } from '../../apps/api/src/config.js';
import { DynamoStore } from '../../apps/api/src/data/dynamo.js';
import { IdentityService } from '../../apps/api/src/identity-service.js';
import { CursorCodec } from '../../apps/api/src/cursor.js';
import {
  demoActors,
  demoDatasetVersion,
  demoIds,
  demoRecords,
  demoScenarios,
  type DemoActor,
} from '../aws/seed-data.js';
import { createLocalDemoApp, demoPort } from './local-app.js';
const root = fileURLToPath(new URL('../../', import.meta.url));
if (process.env.APP_ENV === 'production')
  throw new Error('Local persona demo is forbidden in production.');
const config = readConfig({
  APP_ENV: 'test',
  DYNAMODB_ENDPOINT: 'http://127.0.0.1:8000',
  CORE_TABLE: 'campusfix-demo-core',
  DISCOVERY_TABLE: 'campusfix-demo-discovery',
  JOBS_TABLE: 'campusfix-demo-jobs',
});
const store = new DynamoStore(config),
  reset = process.argv.includes('--reset');
const tables = JSON.parse(
  await readFile(resolve(root, 'specs/dynamodb-tables.json'), 'utf8'),
) as CreateTableCommandInput[];
for (const t of tables) {
  const name = t.TableName!.replace('campusfix-local', 'campusfix-demo');
  if (
    !['campusfix-demo-core', 'campusfix-demo-discovery', 'campusfix-demo-jobs'].includes(name) ||
    config.DYNAMODB_ENDPOINT !== 'http://127.0.0.1:8000'
  )
    throw new Error('Unsafe local demo table operation.');
  let exists = true;
  try {
    await store.client.send(new DescribeTableCommand({ TableName: name }));
  } catch (e) {
    if (!(e instanceof ResourceNotFoundException)) throw e;
    exists = false;
  }
  if (reset && exists) {
    await store.client.send(new DeleteTableCommand({ TableName: name }));
    exists = false;
  }
  if (!exists) await store.client.send(new CreateTableCommand({ ...t, TableName: name }));
}
const markerKey = { pk: 'DEMO#IIT_DHOLAKPUR', sk: 'SEED' };
let marker = await store.get(config.CORE_TABLE, markerKey);
if (marker && marker.datasetVersion !== demoDatasetVersion)
  throw new Error(
    'Demo dataset changed. Stop the server and run npm run demo:reset to replace only the local demo tables.',
  );
const users = Object.fromEntries(
  demoActors.map((a, i) => [a.key, `d1000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`]),
) as Record<DemoActor, string>;
if (!marker) {
  const date = new Date().toISOString();
  marker = { ...markerKey, datasetVersion: demoDatasetVersion, version: 1, date, complete: false };
  await store.transact(
    [...demoRecords(users, date), marker].map((item) => ({
      table: config.CORE_TABLE,
      key: { pk: item.pk, sk: item.sk },
      guard: { kind: 'absent' as const },
      item,
    })),
  );
}
const identity = new IdentityService(
  store,
  config,
  new CursorCodec(randomBytes(32).toString('hex')),
);
if (!marker.complete) {
  const scenarios = await demoScenarios(identity, users, String(marker.date));
  const complete = { ...marker, version: 2, complete: true, scenarios };
  await store.transact([
    {
      table: config.CORE_TABLE,
      key: markerKey,
      guard: { kind: 'version', version: 1 },
      item: complete,
    },
  ]);
  marker = complete;
}
const out = resolve(root, '.local/demo/web');
await mkdir(out, { recursive: true });
await build({
  entryPoints: [resolve(root, 'scripts/demo/ui.tsx')],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  jsx: 'automatic',
  target: 'es2022',
  outfile: resolve(out, 'demo.js'),
  define: { 'import.meta.env': '{}' },
  logLevel: 'silent',
});
const app = await createLocalDemoApp(identity, users, marker.scenarios as Record<string, string>);
const html =
  '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>IIT Dholakpur · CampusFix demo</title><link rel="stylesheet" href="/demo.css"></head><body><div id="root"></div><script type="module" src="/demo.js"></script></body></html>';
// Register static/page handlers before the application's not-found fallback by using the same Hono route list.
app.get('/demo.js', async (c) => {
  c.header('Content-Type', 'text/javascript');
  return c.body(await readFile(resolve(out, 'demo.js'), 'utf8'));
});
app.get('/demo.css', async (c) => {
  c.header('Content-Type', 'text/css');
  return c.body(await readFile(resolve(out, 'demo.css'), 'utf8'));
});
app.get('/', (c) => c.html(html));
app.get('/c/*', (c) => c.html(html));
const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: demoPort }, () =>
  console.log(
    `IIT Dholakpur is ready at http://127.0.0.1:${demoPort}\nFictional local demo: 8 personas, 9 reports, private review, draft and reviewed knowledge. No AWS account required.\nUse npm run demo:reset after stopping this server to restore the recording dataset.`,
  ),
);
const stop = () => {
  server.close();
  store.client.destroy();
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
