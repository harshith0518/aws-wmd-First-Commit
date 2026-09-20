import assert from 'node:assert/strict';
import test from 'node:test';
import { healthResponseSchema } from '@campusfix/contracts';
import { app } from '../src/app.js';

test('health routes satisfy the shared client contract and expose no environment details', async () => {
  for (const path of ['/health', '/api/health']) {
    const response = await app.request(path);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') ?? '', /application\/json/);
    const body: unknown = await response.json();
    assert.deepEqual(healthResponseSchema.parse(body), {
      status: 'ok',
      service: 'campusfix-api',
      stage: 'foundation',
    });
  }
  const missing = await app.request('/api/issues');
  assert.equal(missing.status, 404);
});
