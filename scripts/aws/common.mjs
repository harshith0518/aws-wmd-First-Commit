import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
export const root = fileURLToPath(new URL('../../', import.meta.url));
export function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed (exit ${result.status}).`);
  return result.stdout?.toString();
}
export function npm(args, options = {}) {
  const cli = process.env.npm_execpath;
  if (!cli) throw new Error('Run this command through npm run (see AWS-DEPLOY.md).');
  return run(process.execPath, [cli, ...args], options);
}
export function aws(args, capture = false) {
  return run(
    'aws',
    [...args, '--region', 'ap-south-1', '--no-cli-pager'],
    capture ? { stdio: ['ignore', 'pipe', 'inherit'] } : {},
  );
}
export function outputs(file = '.artifacts/aws-outputs.json') {
  const raw = JSON.parse(readFileSync(new URL('../../' + file, import.meta.url), 'utf8'));
  const o = raw.CampusFixDemo;
  if (!o || o.ReleaseStage !== 'demo' || o.Region !== 'ap-south-1' || !/^\d{12}$/.test(o.Account))
    throw new Error('Expected CampusFixDemo outputs in Mumbai.');
  for (const key of ['WebUrl', 'ApiUrl', 'CognitoDomain', 'CognitoIssuer']) {
    const url = new URL(o[key]);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash)
      throw new Error(`Unsafe ${key}.`);
  }
  if (
    !/^[a-z0-9]+\.cloudfront\.net$/.test(new URL(o.WebUrl).hostname) ||
    !/^[a-z0-9]+\.execute-api\.ap-south-1\.amazonaws\.com$/.test(new URL(o.ApiUrl).hostname)
  )
    throw new Error('Unexpected AWS deployment origins.');
  return o;
}
