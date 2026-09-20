import { mkdir, readFile, writeFile, chmod } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import {
  CognitoIdentityProviderClient,
  AdminCreateUserCommand,
  AdminGetUserCommand,
  AdminSetUserPasswordCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { readConfig } from '../../apps/api/src/config.js';
import { DynamoStore } from '../../apps/api/src/data/dynamo.js';
import { IdentityService } from '../../apps/api/src/identity-service.js';
import { CursorCodec } from '../../apps/api/src/cursor.js';
import { keys } from '../../apps/api/src/data/keys.js';
import { demoActors, demoIds, demoRecords, demoScenarios, type DemoActor } from './seed-data.js';
// CLI helper contains no AWS secrets; ambient SDK credentials are supplied by CloudShell/SSO.
// @ts-expect-error Shared executable JS helper intentionally has no generated declarations.
import { outputs, aws, root } from './common.mjs';
const o = outputs();
const caller = JSON.parse(aws(['sts', 'get-caller-identity', '--output', 'json'], true));
if (caller.Account !== o.Account || o.ReleaseStage !== 'demo')
  throw new Error('Refusing to seed outside the authenticated demo account.');
const config = readConfig({
  APP_ENV: 'test',
  AWS_REGION: o.Region,
  CORE_TABLE: o.CoreTable,
  DISCOVERY_TABLE: o.DiscoveryTable,
  JOBS_TABLE: o.JobsTable,
});
const store = new DynamoStore(config),
  cognito = new CognitoIdentityProviderClient({ region: o.Region });
const folder = resolve(root, '.artifacts');
await mkdir(folder, { recursive: true });
const statePath = resolve(folder, 'demo-credentials.json');
type State = {
  pool: string;
  date: string;
  users: Partial<Record<DemoActor, { email: string; password: string; sub?: string }>>;
  complete?: boolean;
  scenarios?: Record<string, string>;
};
let state: State;
try {
  state = JSON.parse(await readFile(statePath, 'utf8'));
} catch (e) {
  if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
  state = { pool: o.UserPoolId, date: new Date().toISOString(), users: {} };
}
if (state.pool !== o.UserPoolId)
  throw new Error(
    'Saved seed state belongs to a different pool. Preserve it and use a separate checkout.',
  );
const save = async () => {
  await writeFile(statePath, JSON.stringify(state, null, 2), { mode: 0o600 });
  await chmod(statePath, 0o600);
};
try {
  const existing = await store.get(config.CORE_TABLE, keys.campus(demoIds.campus));
  if (existing && (existing.demoSeedVersion !== 1 || existing.createdAt !== state.date))
    throw new Error(
      'Demo records already exist without matching local seed state. Refusing to overwrite them.',
    );
  if (state.complete) {
    console.log(
      'Demo already initialized. Existing passwords and records preserved; see .artifacts/demo-credentials.json.',
    );
  } else {
    for (const actor of demoActors) {
      let saved = state.users[actor.key];
      if (!saved) {
        saved = {
          email: `${actor.key}@campusfix.example`,
          password: `Cf1!${randomBytes(18).toString('base64url')}`,
        };
        state.users[actor.key] = saved;
        await save();
      }
      let user;
      try {
        user = await cognito.send(
          new AdminGetUserCommand({ UserPoolId: o.UserPoolId, Username: saved.email }),
        );
      } catch (e) {
        if (!(e instanceof Error) || e.name !== 'UserNotFoundException') throw e;
        await cognito.send(
          new AdminCreateUserCommand({
            UserPoolId: o.UserPoolId,
            Username: saved.email,
            MessageAction: 'SUPPRESS',
            UserAttributes: [
              { Name: 'email', Value: saved.email },
              { Name: 'email_verified', Value: 'true' },
            ],
          }),
        );
        user = await cognito.send(
          new AdminGetUserCommand({ UserPoolId: o.UserPoolId, Username: saved.email }),
        );
      }
      const sub = user.UserAttributes?.find((a) => a.Name === 'sub')?.Value;
      if (!sub || (saved.sub && saved.sub !== sub))
        throw new Error('Cognito identity does not match saved demo identity.');
      if (!saved.sub) {
        // A fresh demo account only. Existing confirmed users are never silently reset.
        if (user.UserStatus !== 'FORCE_CHANGE_PASSWORD')
          throw new Error(
            'Existing confirmed demo user has no matching seed state; use the Cognito Console to recover it.',
          );
        await cognito.send(
          new AdminSetUserPasswordCommand({
            UserPoolId: o.UserPoolId,
            Username: saved.email,
            Password: saved.password,
            Permanent: true,
          }),
        );
        saved.sub = sub;
        await save();
      }
    }
    const users = Object.fromEntries(
      demoActors.map((a) => [a.key, state.users[a.key]!.sub!]),
    ) as Record<DemoActor, string>;
    if (!existing)
      await store.transact(
        demoRecords(users, state.date).map((item) => ({
          table: config.CORE_TABLE,
          key: { pk: item.pk, sk: item.sk },
          guard: { kind: 'absent' as const },
          item,
        })),
      );
    state.scenarios = await demoScenarios(
      new IdentityService(store, config, new CursorCodec(randomBytes(32).toString('hex'))),
      users,
      state.date,
    );
    state.complete = true;
    await save();
    console.log(
      `Synthetic demo initialized at ${o.WebUrl}. Six genuine Cognito accounts; passwords are only in .artifacts/demo-credentials.json. Do not commit or publish that file.`,
    );
  }
} finally {
  store.client.destroy();
  cognito.destroy();
}
