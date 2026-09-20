import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readConfig } from '../../../apps/api/src/config.js';
import { IdentityService } from '../../../apps/api/src/identity-service.js';
import { CursorCodec } from '../../../apps/api/src/cursor.js';
import { MemoryStore } from '../../../apps/api/test/fixtures.js';
import { createLocalDemoApp, isLocalDemoRequest } from '../local-app.js';
import {
  demoActors,
  demoIds,
  demoRecords,
  demoScenarios,
  type DemoActor,
} from '../../aws/seed-data.js';
import { readFile } from 'node:fs/promises';
test('local persona surface denies remote hosts, foreign origins and originless writes', () => {
  assert.equal(isLocalDemoRequest('127.0.0.1:3002', undefined, 'GET'), true);
  assert.equal(isLocalDemoRequest('localhost:3002', 'http://localhost:3002', 'POST'), true);
  for (const [host, origin, method] of [
    ['attacker.example:3002', undefined, 'GET'],
    ['127.0.0.1:3002', 'https://foreign.example', 'GET'],
    ['localhost:3002', undefined, 'POST'],
    ['127.0.0.1:3002', 'http://localhost:3002', 'POST'],
  ] as const)
    assert.equal(isLocalDemoRequest(host, origin, method), false);
});
test('real signed local sessions keep per-person group, note and independent-review boundaries', async () => {
  const config = readConfig({
    APP_ENV: 'test',
    DYNAMODB_ENDPOINT: 'http://127.0.0.1:8000',
    CORE_TABLE: 'campusfix-demo-core',
    DISCOVERY_TABLE: 'campusfix-demo-discovery',
    JOBS_TABLE: 'campusfix-demo-jobs',
  });
  const store = new MemoryStore(),
    identity = new IdentityService(
      store,
      config,
      new CursorCodec('local-demo-security-test-secret-32-characters'),
    );
  const users = Object.fromEntries(demoActors.map((a) => [a.key, randomUUID()])) as Record<
      DemoActor,
      string
    >,
    date = new Date().toISOString();
  for (const item of demoRecords(users, date)) store.seed(config.CORE_TABLE, item);
  const scenarios = await demoScenarios(identity, users, date),
    app = await createLocalDemoApp(identity, users, scenarios);
  const request = (path: string, init: RequestInit = {}) =>
    app.request(`http://127.0.0.1:3002${path}`, {
      ...init,
      headers: { host: '127.0.0.1:3002', ...Object.fromEntries(new Headers(init.headers)) },
    });
  const session = async (actor: string) => {
    const r = await request(`/demo/session/${actor}`, {
      method: 'POST',
      headers: { origin: 'http://127.0.0.1:3002' },
    });
    assert.equal(r.status, 200);
    return (await r.json()) as { token: string; shortcuts: Record<string, string> };
  };
  const a = await session('student-a'),
    b = await session('student-b'),
    owner = await session('owner'),
    reviewer = await session('reviewer');
  const api = (path: string, token: string) =>
    request('/api/v1' + path, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(
    (await api(`/campuses/${demoIds.campus}/posts/${scenarios.groupIssue}`, a.token)).status,
    200,
  );
  assert.equal(
    (await api(`/campuses/${demoIds.campus}/posts/${scenarios.groupIssue}`, b.token)).status,
    404,
  );
  assert.equal(b.shortcuts.groupIssue, undefined);
  assert.equal(
    (
      await api(
        `/campuses/${demoIds.campus}/service-reviews/${scenarios.privateReview}`,
        owner.token,
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await api(
        `/campuses/${demoIds.campus}/service-reviews/${scenarios.privateReview}`,
        reviewer.token,
      )
    ).status,
    200,
  );
  assert.equal((await api('/me', 'not-a-valid-token')).status, 401);
  assert.equal(
    (
      await request('/demo/session/owner', {
        method: 'POST',
        headers: { origin: 'https://foreign.example' },
      })
    ).status,
    403,
  );
  const prodIdentity = new IdentityService(
    store,
    readConfig({ APP_ENV: 'test' }),
    identity.cursors,
  );
  await assert.rejects(createLocalDemoApp(prodIdentity, users, scenarios));
});
test('production API and web build entry points do not import the local persona surface', async () => {
  for (const path of [
    'apps/api/src/lambda.ts',
    'apps/api/src/runtime.ts',
    'apps/web/src/main.tsx',
    'infra/stack.ts',
  ]) {
    const source = await readFile(new URL('../../../' + path, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /scripts\/demo|local-app|\/demo\/session/);
  }
});
