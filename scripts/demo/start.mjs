import { spawn, spawnSync } from 'node:child_process';
import { createConnection } from 'node:net';
import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve, join } from 'node:path';
const root = fileURLToPath(new URL('../../', import.meta.url));
if (process.env.APP_ENV === 'production')
  throw new Error('This local persona demo cannot run in production.');
const portOpen = (port) =>
  new Promise((resolve) => {
    const socket = createConnection({ host: '127.0.0.1', port });
    socket.setTimeout(1000);
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
    socket.once('timeout', () => {
      socket.destroy();
      resolve(false);
    });
  });
if (await portOpen(3002))
  throw new Error(
    'Port 3002 is already running. Open http://127.0.0.1:3002 or stop that demo before resetting.',
  );
let database;
const dbFolder = resolve(root, '.local/dynamodb');
if (!(await portOpen(8000))) {
  const java = process.env.JAVA_HOME
    ? join(process.env.JAVA_HOME, 'bin', process.platform === 'win32' ? 'java.exe' : 'java')
    : 'java';
  const version = spawnSync(java, ['-version'], { encoding: 'utf8', windowsHide: true });
  if (version.error || version.status !== 0)
    throw new Error(
      'Install Java 17+ (Amazon Corretto is supported), then run npm run demo again. See DEMO.md.',
    );
  await mkdir(dbFolder, { recursive: true });
  const archive = resolve(dbFolder, 'dynamodb.zip');
  let bytes;
  try {
    bytes = await readFile(archive);
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
    console.log(
      'Downloading the official DynamoDB Local distribution (one-time setup; no AWS login).',
    );
    const response = await fetch(
      'https://d1ni2b6xgvw0s0.cloudfront.net/v2.x/dynamodb_local_latest.zip',
      { signal: AbortSignal.timeout(120000) },
    );
    if (!response.ok) throw new Error('DynamoDB Local download failed.');
    bytes = Buffer.from(await response.arrayBuffer());
    if (
      createHash('sha256').update(bytes).digest('hex') !==
      '5b0d17dd3b4e929db64a9f624a3f96eaf0961e3cf4acece00091656aec5fc7ed'
    )
      throw new Error(
        'AWS distribution checksum changed; review the official download before updating the pinned checksum.',
      );
    await writeFile(archive, bytes);
  }
  if (
    createHash('sha256').update(bytes).digest('hex') !==
    '5b0d17dd3b4e929db64a9f624a3f96eaf0961e3cf4acece00091656aec5fc7ed'
  )
    throw new Error('DynamoDB archive failed its pinned checksum.');
  try {
    await access(resolve(dbFolder, 'DynamoDBLocal.jar'));
  } catch {
    // jar extraction avoids shell quoting and works on Windows, macOS and Linux with a JDK.
    const jar = process.env.JAVA_HOME
      ? join(process.env.JAVA_HOME, 'bin', process.platform === 'win32' ? 'jar.exe' : 'jar')
      : 'jar';
    const extract = spawnSync(jar, ['xf', archive], {
      cwd: dbFolder,
      stdio: 'inherit',
      windowsHide: true,
    });
    if (extract.error || extract.status !== 0)
      throw new Error(
        'Install a Java 17+ JDK (including jar), or extract .local/dynamodb/dynamodb.zip into that folder, then retry.',
      );
  }
  const data = resolve(root, '.local/demo/database');
  await mkdir(data, { recursive: true });
  database = spawn(
    java,
    [
      '-Djava.library.path=./DynamoDBLocal_lib',
      '-jar',
      'DynamoDBLocal.jar',
      '-sharedDb',
      '-dbPath',
      data,
      '-disableTelemetry',
      '-port',
      '8000',
    ],
    { cwd: dbFolder, stdio: 'inherit', windowsHide: true },
  );
  for (let i = 0; i < 60 && !(await portOpen(8000)); i++) {
    if (database.exitCode !== null) throw new Error('DynamoDB Local stopped during startup.');
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (!(await portOpen(8000))) {
    database.kill();
    throw new Error('DynamoDB Local did not start.');
  }
} else
  console.log(
    'Using the existing DynamoDB Local on port 8000; only campusfix-demo-* tables are touched. Persistence follows that server configuration.',
  );
const app = spawn(
  process.execPath,
  [
    '--import',
    'tsx',
    'scripts/demo/server.ts',
    ...(process.argv.includes('--reset') ? ['--reset'] : []),
  ],
  { cwd: root, stdio: 'inherit', windowsHide: true },
);
const stop = () => {
  app.kill();
  database?.kill();
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
app.once('exit', (code) => {
  database?.kill();
  process.exitCode = code ?? 1;
});
