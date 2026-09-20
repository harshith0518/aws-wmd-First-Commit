import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import { z } from 'zod';
import { subjectSchema } from '@campusfix/contracts';
import { ApiError } from './errors.js';

export type Principal = { sub: string; token: string };
export type Identity = { sub: string; email: string; emailVerified: true };
export interface Authenticator {
  authenticate(header: string | undefined): Promise<Principal>;
  identity(principal: Principal): Promise<Identity>;
}
export function createAuthenticator(
  config: { issuer: string; clientId: string; domain: string },
  key?: JWTVerifyGetKey,
  fetcher: typeof fetch = fetch,
): Authenticator {
  const jwks =
    key ??
    createRemoteJWKSet(new URL(`${config.issuer}/.well-known/jwks.json`), {
      timeoutDuration: 5000,
      cooldownDuration: 30000,
    });
  return {
    async authenticate(header) {
      const match = /^Bearer ([A-Za-z0-9_.-]+)$/i.exec(header ?? '');
      if (!match || !match[1] || match[1].length > 16384)
        throw new ApiError(401, 'UNAUTHENTICATED', 'Sign in to continue.');
      const token = match[1];
      try {
        const { payload } = await jwtVerify(token, jwks, {
          issuer: config.issuer,
          algorithms: ['RS256'],
          requiredClaims: ['sub', 'exp', 'iat', 'token_use', 'client_id', 'scope'],
          clockTolerance: 0,
        });
        if (
          payload.token_use !== 'access' ||
          payload.client_id !== config.clientId ||
          typeof payload.scope !== 'string' ||
          !payload.scope.split(' ').includes('campusfix/api')
        )
          throw new Error('Wrong token purpose.');
        return { sub: subjectSchema.parse(payload.sub), token };
      } catch {
        throw new ApiError(
          401,
          'UNAUTHENTICATED',
          'Your session has expired or is invalid. Sign in again.',
        );
      }
    },
    async identity(principal) {
      let response: Response;
      try {
        response = await fetcher(`${config.domain}/oauth2/userInfo`, {
          headers: { Authorization: `Bearer ${principal.token}` },
          signal: AbortSignal.timeout(5000),
          redirect: 'error',
        });
      } catch {
        throw new ApiError(
          503,
          'IDENTITY_UNAVAILABLE',
          'Identity verification is temporarily unavailable.',
        );
      }
      if (response.status === 401) throw new ApiError(401, 'UNAUTHENTICATED', 'Sign in again.');
      if (!response.ok)
        throw new ApiError(
          503,
          'IDENTITY_UNAVAILABLE',
          'Identity verification is temporarily unavailable.',
        );
      const result = z
        .object({
          sub: subjectSchema,
          email: z.email(),
          email_verified: z.union([z.literal(true), z.literal('true')]),
        })
        .safeParse(await response.json());
      if (!result.success || result.data.sub !== principal.sub)
        throw new ApiError(
          403,
          'EMAIL_NOT_VERIFIED',
          'Verify your account email before continuing.',
        );
      return { sub: principal.sub, email: result.data.email.toLowerCase(), emailVerified: true };
    },
  };
}
export const unconfiguredAuth: Authenticator = {
  async authenticate(header) {
    if (!header) throw new ApiError(401, 'UNAUTHENTICATED', 'Sign in to continue.');
    throw new ApiError(503, 'AUTH_NOT_CONFIGURED', 'Campus sign-in is not configured yet.');
  },
  async identity() {
    throw new ApiError(503, 'AUTH_NOT_CONFIGURED', 'Campus sign-in is not configured yet.');
  },
};
