import { randomBytes } from 'node:crypto';
import { createApp } from './app.js';
import { createAuthenticator, unconfiguredAuth } from './auth.js';
import { readConfig } from './config.js';
import { CursorCodec } from './cursor.js';
import { DynamoStore } from './data/dynamo.js';
import { IdentityService } from './identity-service.js';
export function createRuntime() {
  const config = readConfig();
  const auth =
    config.COGNITO_ISSUER && config.COGNITO_CLIENT_ID && config.COGNITO_DOMAIN
      ? createAuthenticator({
          issuer: config.COGNITO_ISSUER,
          clientId: config.COGNITO_CLIENT_ID,
          domain: config.COGNITO_DOMAIN,
        })
      : unconfiguredAuth;
  const identity = new IdentityService(
    new DynamoStore(config),
    config,
    new CursorCodec(config.CURSOR_SECRET ?? randomBytes(32).toString('hex')),
  );
  return { config, app: createApp({ auth, identity }) };
}
