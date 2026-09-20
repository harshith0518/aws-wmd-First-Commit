import assert from 'node:assert/strict';
import test from 'node:test';
import { apiBaseUrl, workspacePath } from '../src/deployment.js';
test('deployment endpoint rejects unsafe schemes, credentials and URL suffixes', () => {
  assert.equal(apiBaseUrl(), '/api/v1');
  assert.equal(apiBaseUrl('https://api.example/api/v1'), 'https://api.example/api/v1');
  for (const value of [
    'http://api.example/api/v1',
    'https://u:p@api.example/api/v1',
    'https://api.example/api/v1?token=x',
    'https://api.example/api/v1#x',
    'https://api.example/wrong',
  ])
    assert.throws(() => apiBaseUrl(value));
});
test('page routing retains source issue query for review and knowledge creation', () => {
  for (const page of ['reviews', 'library'])
    assert.equal(
      workspacePath({ pathname: `/c/123/${page}/new`, search: '?issue=abc' }),
      `/c/123/${page}/new?issue=abc`,
    );
});
