import { mkdirSync } from 'node:fs';
import { root, npm, aws, run } from './common.mjs';
import { resolve } from 'node:path';
const identity = JSON.parse(aws(['sts', 'get-caller-identity', '--output', 'json'], true));
if (!/^\d{12}$/.test(identity.Account)) throw new Error('AWS authentication failed.');
console.log(
  `Deploying CampusFixDemo in account ${identity.Account}, Mumbai. Retained storage; uploads and AI disabled.`,
);
const env = {
  ...process.env,
  CDK_DEFAULT_ACCOUNT: identity.Account,
  CDK_DEFAULT_REGION: 'ap-south-1',
};
mkdirSync(resolve(root, '.artifacts'), { recursive: true });
npm(['run', 'aws:package']);
const cdk = (args) =>
  run(
    process.execPath,
    [
      'node_modules/aws-cdk/bin/cdk',
      ...args,
      '--app',
      'node --import tsx infra/app.ts',
      '--output',
      '.artifacts/cdk.out',
    ],
    { env },
  );
cdk(['bootstrap', `aws://${identity.Account}/ap-south-1`]);
cdk(['synth', '--quiet']);
cdk(['diff', 'CampusFixDemo']);
cdk([
  'deploy',
  'CampusFixDemo',
  '--outputs-file',
  '.artifacts/aws-outputs.json',
  '--require-approval',
  'never',
]);
npm(['run', 'aws:publish']);
npm(['run', 'aws:smoke']);
console.log(
  'Infrastructure and web published. Next: npm run aws:seed, then follow the browser acceptance steps in AWS-DEPLOY.md.',
);
