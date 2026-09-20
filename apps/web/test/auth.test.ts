import assert from 'node:assert/strict';
import test from 'node:test';
import { authConfig, pkceChallenge, validateTransaction } from '../src/auth.js';
test('PKCE uses the RFC 7636 S256 challenge vector', async () => {
  assert.equal(
    await pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'),
    'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
  );
});
test('login transaction rejects mismatched state, stale or future timestamps and malformed verifier', () => {
  const t = { state: 'state', nonce: 'n'.repeat(43), verifier: 'v'.repeat(43), created: 1000 };
  assert.deepEqual(validateTransaction(t, 'state', 2000), t);
  for (const [value, state, time] of [
    [t, 'wrong', 2000],
    [t, 'state', 700000],
    [{ ...t, created: 3000 }, 'state', 2000],
    [{ ...t, verifier: 'bad' }, 'state', 2000],
    [null, 'state', 2000],
  ] as const)
    assert.throws(() => validateTransaction(value, state, time));
});
test('frontend identity configuration requires HTTPS identity and safe callback', () => {
  const c = {
    VITE_COGNITO_DOMAIN: 'https://example.auth.ap-south-1.amazoncognito.com',
    VITE_COGNITO_ISSUER: 'https://cognito-idp.ap-south-1.amazonaws.com/ap-south-1_test',
    VITE_COGNITO_CLIENT_ID: 'client',
    VITE_COGNITO_REDIRECT_URI: 'http://localhost:5173/auth/callback',
  };
  assert.ok(authConfig(c));
  assert.equal(authConfig({ ...c, VITE_COGNITO_DOMAIN: 'http://example.com' }), undefined);
  assert.equal(
    authConfig({ ...c, VITE_COGNITO_REDIRECT_URI: 'http://evil.example/auth/callback' }),
    undefined,
  );
  assert.equal(authConfig({}), undefined);
});
