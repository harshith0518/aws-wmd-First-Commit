import assert from 'node:assert/strict';
import { outputs } from './common.mjs';
const o = outputs();
const get = (url, init) =>
  fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(30000), ...init });
const health = await get(`${o.ApiUrl}/health`);
assert.equal(health.status, 200, 'Lambda health must work');
assert.equal((await health.json()).status, 'ok');
for (const headers of [{}, { Authorization: 'Bearer invalid-token' }]) {
  assert.equal(
    (await get(`${o.ApiUrl}/api/v1/me`, { headers })).status,
    401,
    'Business API rejects absent/invalid JWT',
  );
}
const preflight = await get(`${o.ApiUrl}/api/v1/me`, {
  method: 'OPTIONS',
  headers: {
    Origin: o.WebUrl,
    'Access-Control-Request-Method': 'PUT',
    'Access-Control-Request-Headers': 'authorization,content-type,idempotency-key',
  },
});
assert.ok([200, 204].includes(preflight.status), 'Browser preflight must work');
assert.equal(preflight.headers.get('access-control-allow-origin'), o.WebUrl);
const foreign = await get(`${o.ApiUrl}/api/v1/me`, {
  method: 'OPTIONS',
  headers: { Origin: 'https://foreign.example', 'Access-Control-Request-Method': 'PUT' },
});
assert.notEqual(foreign.headers.get('access-control-allow-origin'), 'https://foreign.example');
for (const path of ['/', '/auth/callback', '/campuses']) {
  const page = await get(o.WebUrl + path);
  assert.equal(page.status, 200, `SPA route ${path}`);
  assert.match(page.headers.get('content-type') ?? '', /text\/html/);
  assert.equal(page.headers.get('x-content-type-options'), 'nosniff');
}
const missing = await get(`${o.WebUrl}/assets/does-not-exist.js`);
assert.ok([403, 404].includes(missing.status), 'Missing assets must not become successful HTML');
assert.equal(
  (await get(`https://${o.WebBucket}.s3.${o.Region}.amazonaws.com/index.html`)).status,
  403,
  'S3 origin must be private',
);
const discovery = await get(`${o.CognitoIssuer}/.well-known/openid-configuration`);
assert.equal(discovery.status, 200);
console.log(
  'AWS smoke passed: health, JWT rejection, exact CORS, HTTPS SPA routes, missing assets, private S3, Cognito discovery. Browser login and role workflows still require acceptance.',
);
