import { WorkflowService } from '../apps/api/src/workflow.js';
// Standalone synthetic browser test rig. Never imported by the application or deployment bundle.
import sharp from 'sharp';
import { writeFile } from 'node:fs/promises';
import { TestEvidenceStorage } from '../apps/api/test/evidence-storage.js';
import { FileService } from '../apps/api/src/files/service.js';
import { IssueService } from '../apps/api/src/issues.js';
import { sha256 } from '../apps/api/src/files/validation.js';
import { randomUUID } from 'node:crypto';
import { readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { build } from 'esbuild';
import { generateKeyPair, exportJWK, createLocalJWKSet, SignJWT } from 'jose';
import {
  CreateTableCommand,
  DeleteTableCommand,
  type CreateTableCommandInput,
} from '@aws-sdk/client-dynamodb';
import { createAuthenticator } from '../apps/api/src/auth.js';
import { createApp } from '../apps/api/src/app.js';
import { readConfig } from '../apps/api/src/config.js';
import { DynamoStore } from '../apps/api/src/data/dynamo.js';
import { IdentityService } from '../apps/api/src/identity-service.js';
import { CursorCodec } from '../apps/api/src/cursor.js';
import { issueFixture } from '../apps/api/test/issue-fixture.js';
import { keys } from '../apps/api/src/data/keys.js';
import { hash } from '../apps/api/src/identity-service.js';
const root = fileURLToPath(new URL('../', import.meta.url));
const id = randomUUID();
const prefix = `campusfix-browser-test-${id}`;
const folder = path.join(root, '.local', 'browser-test', id);
await mkdir(folder, { recursive: true });
const config = readConfig({
  APP_ENV: 'test',
  DYNAMODB_ENDPOINT: 'http://127.0.0.1:8000',
  CORE_TABLE: prefix + '-core',
  DISCOVERY_TABLE: prefix + '-discovery',
  JOBS_TABLE: prefix + '-jobs',
});
const store = new DynamoStore(config);
const created: string[] = [];
let server: ReturnType<typeof serve> | undefined;
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  server?.close();
  for (const name of created) {
    if (!name.startsWith(prefix + '-')) throw new Error('Unsafe cleanup.');
    await store.client.send(new DeleteTableCommand({ TableName: name }));
  }
  store.client.destroy();
}
try {
  const definitions = JSON.parse(
    await readFile(path.join(root, 'specs', 'dynamodb-tables.json'), 'utf8'),
  ) as CreateTableCommandInput[];
  for (const table of definitions) {
    const name = table.TableName!.replace('campusfix-local', prefix);
    await store.client.send(new CreateTableCommand({ ...table, TableName: name }));
    created.push(name);
  }
  const fixture = issueFixture();
  const testBob = (await fixture.store.get(
    fixture.config.CORE_TABLE,
    keys.member(fixture.campus, fixture.bob),
  ))!;
  fixture.store.seed(fixture.config.CORE_TABLE, {
    ...testBob,
    roles: [
      {
        id: randomUUID(),
        role: 'UNIT_LEAD',
        scope: 'UNIT',
        scopeId: fixture.unit,
        expiresAt: '2099-01-01T00:00:00Z',
      },
    ],
  });
  const reviewer = randomUUID();
  fixture.store.seed(fixture.config.CORE_TABLE, {
    ...fixture.profile,
    ...keys.profile(reviewer),
    id: reviewer,
    displayName: 'Independent reviewer',
    verifiedEmail: 'reviewer@example.test',
  });
  fixture.store.seed(fixture.config.CORE_TABLE, {
    ...fixture.member,
    ...keys.member(fixture.campus, reviewer),
    id: randomUUID(),
    userId: reviewer,
    groupIds: [],
    verifiedEmailHash: hash('reviewer@example.test'),
    roles: [
      {
        id: randomUUID(),
        role: 'REVIEWER',
        scope: 'UNIT',
        scopeId: fixture.unit,
        expiresAt: '2099-01-01T00:00:00Z',
      },
    ],
  });
  const testCampus = (await fixture.store.get(
    fixture.config.CORE_TABLE,
    keys.campus(fixture.campus),
  ))!;
  fixture.store.seed(fixture.config.CORE_TABLE, { ...testCampus, independentReviewerId: reviewer });
  await store.transact(
    [...fixture.store.items.values()].map((item) => ({
      table: config.CORE_TABLE,
      key: { pk: item.pk, sk: item.sk },
      guard: { kind: 'absent' as const },
      item,
    })),
  );
  const identity = new IdentityService(
    store,
    config,
    new CursorCodec('isolated-browser-test-cursor-secret-' + id),
  );
  const membership = await identity.membership(fixture.user, fixture.campus);
  const pair = await generateKeyPair('RS256');
  const jwk = await exportJWK(pair.publicKey);
  jwk.kid = 'synthetic-browser-key';
  const issuer = 'https://cognito-idp.ap-south-1.amazonaws.com/ap-south-1_browserFixture';
  const clientId = 'browser-fixture-client';
  const token = await new SignJWT({
    token_use: 'access',
    client_id: clientId,
    scope: 'openid email campusfix/api',
  })
    .setSubject(fixture.user)
    .setIssuer(issuer)
    .setIssuedAt()
    .setExpirationTime('2h')
    .setProtectedHeader({ alg: 'RS256', kid: jwk.kid })
    .sign(pair.privateKey);
  const auth = createAuthenticator(
    { issuer, clientId, domain: 'https://synthetic.invalid' },
    createLocalJWKSet({ keys: [jwk] }),
    async () =>
      Response.json({ sub: fixture.user, email: 'alice@example.test', email_verified: true }),
  );
  const ownerMembership = await identity.membership(fixture.owner, fixture.campus);
  const ownerToken = await new SignJWT({
    token_use: 'access',
    client_id: clientId,
    scope: 'openid email campusfix/api',
  })
    .setSubject(fixture.owner)
    .setIssuer(issuer)
    .setIssuedAt()
    .setExpirationTime('2h')
    .setProtectedHeader({ alg: 'RS256', kid: jwk.kid })
    .sign(pair.privateKey);
  const recipientMembership = await identity.membership(fixture.bob, fixture.campus);
  const recipientToken = await new SignJWT({
    token_use: 'access',
    client_id: clientId,
    scope: 'openid email campusfix/api',
  })
    .setSubject(fixture.bob)
    .setIssuer(issuer)
    .setIssuedAt()
    .setExpirationTime('2h')
    .setProtectedHeader({ alg: 'RS256', kid: jwk.kid })
    .sign(pair.privateKey);
  const reviewerMembership = await identity.membership(reviewer, fixture.campus);
  const reviewerToken = await new SignJWT({
    token_use: 'access',
    client_id: clientId,
    scope: 'openid email campusfix/api',
  })
    .setSubject(reviewer)
    .setIssuer(issuer)
    .setIssuedAt()
    .setExpirationTime('2h')
    .setProtectedHeader({ alg: 'RS256', kid: jwk.kid })
    .sign(pair.privateKey);
  const campus = {
    id: fixture.campus,
    name: 'Synthetic Browser Test Campus',
    slug: 'browser-test',
    status: 'ACTIVE',
    membershipStatus: 'ACTIVE',
  };
  const contents = `import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {IssueWorkspace} from './src/issues';import {ApiContext,createApi} from './src/api';import './src/styles.css';const actors=[{label:'Synthetic student',token:${JSON.stringify(token)},membership:${JSON.stringify(membership)}},{label:'Synthetic owner',token:${JSON.stringify(ownerToken)},membership:${JSON.stringify(ownerMembership)}},{label:'Synthetic recipient',token:${JSON.stringify(recipientToken)},membership:${JSON.stringify(recipientMembership)}},{label:'Synthetic reviewer',token:${JSON.stringify(reviewerToken)},membership:${JSON.stringify(reviewerMembership)}}];const clients=actors.map(a=>createApi(()=>a.token));function TestApp(){const [role,setRole]=useState(0);const [route,setRoute]=useState('/c/${fixture.campus}/issues');function navigate(next){history.pushState(null,'',next);setRoute(next);}return <ApiContext.Provider value={clients[role]}><div className="shell"><header className="header"><strong>CampusFix browser verification</strong><span className="badge">Synthetic identities and test-only tables</span><label>Test identity<select value={role} onChange={e=>{setRole(Number(e.target.value));navigate('/c/${fixture.campus}/issues');}}>{actors.map((a,i)=><option key={i} value={i}>{a.label}</option>)}</select></label></header><main><IssueWorkspace key={role} campus={${JSON.stringify(campus)}} membership={actors[role].membership} path={route} navigate={navigate}/></main></div></ApiContext.Provider>;}createRoot(document.getElementById('root')).render(<TestApp/>);`;
  await writeFile(path.join(folder, 'ui-entry.tsx'), contents);
  await build({
    stdin: { contents, loader: 'tsx', resolveDir: path.join(root, 'apps', 'web') },
    bundle: true,
    format: 'esm',
    platform: 'browser',
    jsx: 'automatic',
    outfile: path.join(folder, 'ui.js'),
    logLevel: 'silent',
  });
  const evidence = new TestEvidenceStorage(),
    files = new FileService(new IssueService(identity), evidence);
  const harmless = await sharp({
    create: { width: 32, height: 32, channels: 3, background: '#4e8777' },
  })
    .png()
    .toBuffer();
  const fixturePath = path.join(folder, 'synthetic-proof.png');
  await writeFile(fixturePath, harmless);
  console.log(`Harmless upload fixture: ${fixturePath}`);
  const demoDraft = await files.issues.createDraft(
    fixture.user,
    fixture.campus,
    { type: 'ISSUE', title: 'Synthetic evidence example' },
    randomUUID(),
  );
  const demoParent = { parentKind: 'POST' as const, parentId: demoDraft.id };
  const demoReservation = await files.reserve(
    fixture.user,
    fixture.campus,
    {
      ...demoParent,
      scope: 'PUBLIC',
      originalName: 'synthetic-proof.png',
      mime: 'image/png',
      bytes: harmless.length,
      sha256: sha256(harmless),
    },
    randomUUID(),
  );
  const demoObject = evidence.put(demoReservation.fields.key!, harmless, 'image/png');
  await files.complete(
    fixture.user,
    fixture.campus,
    demoParent,
    demoReservation.attachment.id,
    { expectedVersion: 1, sha256: sha256(harmless) },
    randomUUID(),
  );
  await files.recordScan(
    fixture.campus,
    demoDraft.id,
    demoReservation.attachment.id,
    demoObject.version,
    'NO_THREATS_FOUND',
    'synthetic-seed-only',
  );
  // Confirmed historical sample created through the same domain commands as the UI.
  const workflow = new WorkflowService(files.issues);
  let historical = await files.issues.publish(
    fixture.user,
    fixture.campus,
    { ...fixture.input, title: 'Synthetic confirmed router repair' },
    randomUUID(),
  );
  const next = {
    nextAction: 'Inspect the router',
    nextUpdateAt: new Date(Date.now() + 86400000).toISOString(),
  };
  historical = await workflow.command(
    fixture.owner,
    fixture.campus,
    historical.id,
    { action: 'acknowledge', expectedVersion: historical.version, ...next },
    randomUUID(),
  );
  historical = await workflow.command(
    fixture.owner,
    fixture.campus,
    historical.id,
    { action: 'start', expectedVersion: historical.version, ...next },
    randomUUID(),
  );
  historical = await workflow.command(
    fixture.owner,
    fixture.campus,
    historical.id,
    {
      action: 'propose-resolution',
      expectedVersion: historical.version,
      resolution: {
        symptom: 'Router power adapter fails',
        cause: 'Faulty power adapter',
        action: 'Replace the router adapter',
        outcome: 'Students confirmed stable network access',
        evidenceOmissionReason: 'Synthetic text-only browser fixture',
      },
    },
    randomUUID(),
  );
  await workflow.command(
    fixture.user,
    fixture.campus,
    historical.id,
    {
      action: 'confirm',
      expectedVersion: historical.version,
      resolutionId: historical.detail.currentResolution!.id,
    },
    randomUUID(),
  );
  const currentDraft = await files.issues.getDraft(fixture.user, fixture.campus, demoDraft.id);
  await files.issues.publish(
    fixture.user,
    fixture.campus,
    {
      expectedVersion: currentDraft.version,
      payload: {
        ...fixture.input,
        title: 'Synthetic evidence example',
        attachmentIds: [demoReservation.attachment.id],
      },
    },
    randomUUID(),
    demoDraft.id,
  );
  const app = new Hono();
  app.post('/synthetic-upload/:token', async (c) => {
    if (Number(c.req.header('content-length') ?? 0) > 6000000) return c.text('Too large', 413);
    const ticket = evidence.tickets.get(c.req.param('token'));
    if (!ticket) return c.text('Unknown test reservation', 404);
    const form = await c.req.formData(),
      file = form.get('file');
    if (!(file instanceof File)) return c.text('Missing file', 400);
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (
      sha256(bytes) !== sha256(harmless) ||
      bytes.length !== ticket.bytes ||
      sha256(bytes) !== ticket.sha256
    )
      return c.text('Only the generated harmless test image is accepted', 422);
    evidence.put(ticket.key, bytes, ticket.mime);
    return c.text('Stored synthetic fixture', 201);
  });
  app.get('/synthetic-download/:token', async (c) => {
    const ref = evidence.downloads.get(c.req.param('token'));
    if (!ref) return c.text('Unknown test link', 404);
    c.header('Content-Type', 'image/png');
    c.header('Content-Disposition', 'attachment; filename="synthetic-proof.png"');
    return c.body((await evidence.read(ref)) as never);
  });
  const fixtureScan = setInterval(() => {
    void (async () => {
      for (const { receipt } of evidence.objects.values()) {
        if (!receipt.key.startsWith('evidence/')) continue;
        const parts = receipt.key.split('/');
        await files.recordScan(
          parts[1]!,
          parts[2]!,
          parts[3]!,
          receipt.version,
          'NO_THREATS_FOUND',
          'synthetic-fixture-only',
        );
      }
    })().catch(() => {});
  }, 2000);
  fixtureScan.unref();
  app.get('/', (c) =>
    c.html(
      '<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><title>CampusFix synthetic browser test</title><link rel="stylesheet" href="/ui.css"><div id="root"></div><script type="module" src="/ui.js"></script></html>',
    ),
  );
  app.get('/ui.js', async (c) => {
    c.header('Content-Type', 'application/javascript');
    return c.body(await readFile(path.join(folder, 'ui.js'), 'utf8'));
  });
  app.get('/ui.css', async (c) => {
    c.header('Content-Type', 'text/css');
    return c.body(await readFile(path.join(folder, 'ui.css'), 'utf8'));
  });
  app.route('/', createApp({ auth, identity, evidence }));
  server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 3002 });
  console.log(
    'Synthetic browser test ready at http://127.0.0.1:3002/ — stop with Ctrl+C to remove only its test tables.',
  );
  for (const signal of ['SIGINT', 'SIGTERM'] as const)
    process.on(signal, () => void stop().then(() => process.exit(0)));
} catch (error) {
  await stop();
  throw error;
}
