import { mkdirSync, cpSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { root, outputs, npm, aws, run } from './common.mjs';
const o = outputs();
const identity = JSON.parse(aws(['sts', 'get-caller-identity', '--output', 'json'], true));
if (identity.Account !== o.Account) throw new Error('AWS account differs from stack outputs.');
const env = {
  ...process.env,
  VITE_API_BASE_URL: `${o.ApiUrl}/api/v1`,
  VITE_COGNITO_DOMAIN: o.CognitoDomain,
  VITE_COGNITO_ISSUER: o.CognitoIssuer,
  VITE_COGNITO_CLIENT_ID: o.ClientId,
  VITE_COGNITO_REDIRECT_URI: `${o.WebUrl}/auth/callback`,
};
npm(['run', 'build', '--workspace', '@campusfix/web'], { env });
const version = run('git', ['rev-parse', '--short=12', 'HEAD'], {
  stdio: ['ignore', 'pipe', 'inherit'],
}).trim();
const release = `${new Date().toISOString().replace(/[:.]/g, '-')}-${version}`;
const archive = resolve(root, '.artifacts/releases', release);
mkdirSync(archive, { recursive: true });
cpSync(resolve(root, 'apps/web/dist'), resolve(archive, 'web'), { recursive: true });
writeFileSync(
  resolve(archive, 'release.json'),
  JSON.stringify(
    {
      release,
      commit: version,
      web: o.WebUrl,
      api: o.ApiUrl,
      filesEnabled: false,
      aiEnabled: false,
    },
    null,
    2,
  ),
);
// Keep old hashed assets so already-open clients survive an update. Do not sync --delete.
aws([
  's3',
  'sync',
  'apps/web/dist/assets/',
  `s3://${o.WebBucket}/assets/`,
  '--cache-control',
  'public,max-age=31536000,immutable',
  '--only-show-errors',
]);
aws([
  's3',
  'sync',
  'apps/web/dist/',
  `s3://${o.WebBucket}/`,
  '--exclude',
  'assets/*',
  '--exclude',
  'index.html',
  '--cache-control',
  'no-cache',
  '--only-show-errors',
]);
aws([
  's3',
  'cp',
  'apps/web/dist/index.html',
  `s3://${o.WebBucket}/index.html`,
  '--cache-control',
  'no-store,max-age=0',
  '--content-type',
  'text/html',
  '--only-show-errors',
]);
const invalidation = JSON.parse(
  aws(
    [
      'cloudfront',
      'create-invalidation',
      '--distribution-id',
      o.DistributionId,
      '--paths',
      '/*',
      '--output',
      'json',
    ],
    true,
  ),
);
aws([
  'cloudfront',
  'wait',
  'invalidation-completed',
  '--distribution-id',
  o.DistributionId,
  '--id',
  invalidation.Invalidation.Id,
]);
console.log(`Release ${release} published at ${o.WebUrl}`);
