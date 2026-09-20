import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { generateKeyPair, exportJWK, createLocalJWKSet, SignJWT } from 'jose';
import { createAuthenticator } from '../src/auth.js';
import { createApp } from '../src/app.js';
import { readConfig } from '../src/config.js';
import { CursorCodec } from '../src/cursor.js';
import { canReadPost, memberRecordSchema, postAccessSchema } from '../src/policy.js';
import { ApiError } from '../src/errors.js';
import { keys } from '../src/data/keys.js';
import { fixture } from './fixtures.js';

const pair = await generateKeyPair('RS256');
const jwk = await exportJWK(pair.publicKey);
jwk.kid = 'test-key';
const issuer = 'https://cognito-idp.ap-south-1.amazonaws.com/ap-south-1_test';
const clientId = 'test-client';
const verifier = createAuthenticator(
  { issuer, clientId, domain: 'https://example.auth.ap-south-1.amazoncognito.com' },
  createLocalJWKSet({ keys: [jwk] }),
);
async function token(sub: string, changes: Record<string, unknown> = {}) {
  return new SignJWT({
    sub,
    iss: issuer,
    client_id: clientId,
    token_use: 'access',
    scope: 'openid email campusfix/api',
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 300,
    ...changes,
  })
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
    .sign(pair.privateKey);
}
const apiError = (code: string) => (e: unknown) => e instanceof ApiError && e.code === code;
test('access tokens verify signature, issuer, client, purpose, expiry and scope', async () => {
  const sub = 'opaque-subject-with-no-uuid';
  assert.equal((await verifier.authenticate(`Bearer ${await token(sub)}`)).sub, sub);
  for (const changes of [
    { iss: `${issuer}wrong` },
    { client_id: 'wrong' },
    { token_use: 'id' },
    { exp: 1 },
    { scope: 'openid email' },
    { sub: 'malicious#partition' },
  ])
    await assert.rejects(
      verifier.authenticate(`Bearer ${await token(sub, changes)}`),
      apiError('UNAUTHENTICATED'),
    );
  const parts = (await token(sub)).split('.');
  parts[1] = Buffer.from(JSON.stringify({ sub: 'attacker' })).toString('base64url');
  await assert.rejects(
    verifier.authenticate(`Bearer ${parts.join('.')}`),
    apiError('UNAUTHENTICATED'),
  );
  await assert.rejects(verifier.authenticate(undefined), apiError('UNAUTHENTICATED'));
});
test('userInfo must independently verify subject and email', async () => {
  for (const data of [
    { sub: 'other', email: 'alice@example.test', email_verified: true },
    { sub: 'alice', email: 'alice@example.test', email_verified: false },
  ]) {
    const auth = createAuthenticator(
      { issuer, clientId, domain: 'https://identity.example.test' },
      createLocalJWKSet({ keys: [jwk] }),
      async () => Response.json(data),
    );
    await assert.rejects(
      auth.identity({ sub: 'alice', token: 'unused' }),
      apiError('EMAIL_NOT_VERIFIED'),
    );
  }
});
test('profile sync is atomic, idempotent and rejects conflicting replay', async () => {
  const f = fixture();
  const identity = { sub: f.user, email: 'alice@example.test', emailVerified: true as const };
  const results = await Promise.all([
    f.service.sync(identity, 'Alice updated', 'one-request-123456'),
    f.service.sync(identity, 'Alice updated', 'one-request-123456'),
  ]);
  assert.deepEqual(results[0], results[1]);
  assert.equal((await f.store.get(f.config.CORE_TABLE, keys.profile(f.user)))?.version, 2);
  assert.equal(
    [...f.store.items.values()].filter((i) => i.entityType === 'IDENTITY_EVENT').length,
    1,
  );
  assert.equal([...f.store.items.values()].filter((i) => i.kind === 'PROFILE_SYNCED').length, 1);
  await assert.rejects(
    f.service.sync(identity, 'Different', 'one-request-123456'),
    apiError('IDEMPOTENCY_CONFLICT'),
  );
});
test('membership uses fresh canonical reads; revocation and changed email deny active access', async () => {
  const f = fixture();
  assert.equal((await f.service.member(f.user, f.campus)).member.userId, f.user);
  await assert.rejects(f.service.member(f.user, f.otherCampus), apiError('NOT_FOUND'));
  f.store.seed(f.config.CORE_TABLE, { ...f.member, status: 'REVOKED', version: 2, authVersion: 2 });
  await assert.rejects(f.service.member(f.user, f.campus), apiError('NOT_FOUND'));
  assert.equal((await f.service.membership(f.user, f.campus)).status, 'REVOKED');
  assert.equal((await f.service.campuses(f.user, 25)).items[0]?.membershipStatus, 'REVOKED');
  f.store.seed(f.config.CORE_TABLE, f.member);
  f.store.seed(f.config.CORE_TABLE, { ...f.profile, verifiedEmail: 'changed@example.test' });
  await assert.rejects(f.service.member(f.user, f.campus), apiError('NOT_FOUND'));
});
test('stale or forged index entries never grant a campus membership', async () => {
  const f = fixture();
  f.store.seed(f.config.CORE_TABLE, {
    pk: `C#${f.otherCampus}`,
    sk: `MEMBER#${randomUUID()}`,
    gsi1pk: keys.membershipIndex(f.user),
    gsi1sk: `CAMPUS#${f.otherCampus}`,
  });
  assert.deepEqual(
    (await f.service.campuses(f.user, 25)).items.map((i) => i.id),
    [f.campus],
  );
});
test('post policy isolates campuses, hostels, drafts, removed records and sensitive cases', () => {
  const f = fixture();
  const member = memberRecordSchema.parse(f.member);
  const post = postAccessSchema.parse({
    id: randomUUID(),
    campusId: f.campus,
    version: 1,
    createdAt: f.now,
    updatedAt: f.now,
    authorId: randomUUID(),
    audience: { kind: 'GROUPS', groupIds: [f.hostel] },
    publication: 'PUBLISHED',
    detail: { unitId: f.unit },
  });
  assert.equal(canReadPost(member, post), true);
  for (const m of [
    { ...member, campusId: f.otherCampus },
    { ...member, groupIds: [f.otherHostel] },
    { ...member, status: 'REVOKED' as const },
    { ...member, expiresAt: '2000-01-01T00:00:00Z' },
  ])
    assert.equal(canReadPost(m, post), false);
  assert.equal(canReadPost(member, { ...post, publication: 'DRAFT' }), false);
  assert.equal(
    canReadPost(member, { ...post, publication: 'REMOVED', authorId: member.userId }),
    false,
  );
  const restricted = {
    ...post,
    audience: { kind: 'RESTRICTED' as const },
    detail: { ...post.detail, caseHandlerIds: [member.userId] },
  };
  const grant = {
    id: randomUUID(),
    role: 'ADMIN' as const,
    scope: 'CAMPUS' as const,
    expiresAt: '2099-01-01T00:00:00Z',
  };
  assert.equal(canReadPost({ ...member, roles: [grant] }, restricted), false);
  assert.equal(
    canReadPost(
      {
        ...member,
        roles: [{ ...grant, role: 'SENSITIVE_HANDLER', scope: 'UNIT', scopeId: f.unit }],
      },
      restricted,
    ),
    true,
  );
  assert.equal(
    canReadPost(
      {
        ...member,
        roles: [{ ...grant, role: 'SENSITIVE_HANDLER', scope: 'UNIT', scopeId: randomUUID() }],
      },
      restricted,
    ),
    false,
  );
  assert.equal(canReadPost(member, { ...restricted, authorId: member.userId }), true);
});
test('cursor encryption rejects tampering, wrong actor and expiry', () => {
  const codec = new CursorCodec('a-test-secret-with-thirty-two-characters');
  const key = { pk: 'private-partition', sk: 'private-key' };
  const cursor = codec.encode('alice:campus:auth1:filter', key, 1000);
  assert.deepEqual(codec.decode(cursor, 'alice:campus:auth1:filter', 2000), key);
  for (const binding of ['bob:campus:auth1:filter', 'alice:campus:auth2:filter'])
    assert.throws(() => codec.decode(cursor, binding, 2000), apiError('INVALID_CURSOR'));
  assert.throws(
    () => codec.decode(cursor, 'alice:campus:auth1:filter', 999999),
    apiError('INVALID_CURSOR'),
  );
  assert.throws(
    () => codec.decode(cursor.slice(0, -5) + 'abcde', 'alice:campus:auth1:filter', 2000),
    apiError('INVALID_CURSOR'),
  );
});
test('environment validation refuses remote local endpoints and partial production configuration', () => {
  assert.throws(() =>
    readConfig({ DYNAMODB_ENDPOINT: 'https://dynamodb.ap-south-1.amazonaws.com' }),
  );
  assert.throws(() => readConfig({ APP_ENV: 'production' }));
  assert.throws(() => readConfig({ COGNITO_CLIENT_ID: 'partial' }));
  assert.throws(() => readConfig({ PORT: 'not-a-number' }));
});
test('API rejects actor spoofing, unknown fields, missing idempotency and oversized JSON', async () => {
  const f = fixture();
  const auth = {
    ...verifier,
    async identity() {
      return { sub: f.user, email: 'alice@example.test', emailVerified: true as const };
    },
  };
  const app = createApp({ auth, identity: f.service });
  const bearer = `Bearer ${await token(f.user)}`;
  const me = await app.request('/api/v1/me', { headers: { Authorization: bearer } });
  assert.equal(me.status, 200);
  assert.equal(me.headers.get('cache-control'), 'private, no-store');
  assert.ok(me.headers.get('x-request-id'));
  const denied = await app.request('/api/v1/me', { headers: { 'X-Test-User': f.user } });
  assert.equal(denied.status, 401);
  for (const input of [
    { displayName: 'Alice', actorId: 'admin' },
    { displayName: 'Alice', emailVerified: true },
    { displayName: ' ' },
  ]) {
    const result = await app.request('/api/v1/me', {
      method: 'PUT',
      headers: {
        Authorization: bearer,
        'Content-Type': 'application/json',
        'Idempotency-Key': 'test-request-123456',
      },
      body: JSON.stringify(input),
    });
    assert.equal(result.status, 422);
  }
  assert.equal(
    (
      await app.request('/api/v1/me', {
        method: 'PUT',
        headers: { Authorization: bearer, 'Content-Type': 'application/json' },
        body: '{}',
      })
    ).status,
    422,
  );
  assert.equal(
    (
      await app.request('/api/v1/me', {
        method: 'PUT',
        headers: {
          Authorization: bearer,
          'Content-Type': 'application/json',
          'Idempotency-Key': 'test-request-123456',
        },
        body: 'x'.repeat(65537),
      })
    ).status,
    413,
  );
});
