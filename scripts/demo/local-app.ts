import { IssueService } from '../../apps/api/src/issues.js';
import { ReviewService } from '../../apps/api/src/reviews.js';
import { KnowledgeService } from '../../apps/api/src/knowledge.js';
// Local demonstration surface only. Never import this module from apps/api or an AWS Lambda entry.
import { Hono } from 'hono';
import { generateKeyPair, exportJWK, createLocalJWKSet, SignJWT } from 'jose';
import { createAuthenticator } from '../../apps/api/src/auth.js';
import { createApp } from '../../apps/api/src/app.js';
import { IdentityService } from '../../apps/api/src/identity-service.js';
import { demoActors, demoIds, demoCampusName, type DemoActor } from '../aws/seed-data.js';
export const demoPort = 3002;
export function isLocalDemoRequest(
  host: string | undefined,
  origin: string | undefined,
  method: string,
) {
  if (!host || !['127.0.0.1:3002', 'localhost:3002'].includes(host)) return false;
  if (origin && ![`http://${host}`].includes(origin)) return false;
  return ['GET', 'HEAD', 'OPTIONS'].includes(method) || origin === `http://${host}`;
}
export async function createLocalDemoApp(
  identity: IdentityService,
  users: Record<DemoActor, string>,
  scenarios: Record<string, string>,
) {
  if (
    process.env.APP_ENV === 'production' ||
    identity.config.APP_ENV !== 'test' ||
    identity.config.DYNAMODB_ENDPOINT !== 'http://127.0.0.1:8000' ||
    !identity.config.CORE_TABLE.startsWith('campusfix-demo-')
  )
    throw new Error('The persona demo must use dedicated local test tables.');
  const pair = await generateKeyPair('RS256');
  const jwk = await exportJWK(pair.publicKey);
  jwk.kid = 'iit-dholakpur-local-demo';
  const issuer = 'https://cognito-idp.ap-south-1.amazonaws.com/ap-south-1_localDemo',
    clientId = 'iit-dholakpur-local-demo';
  const identities = new Map<string, { sub: string; email: string }>();
  const auth = createAuthenticator(
    { issuer, clientId, domain: 'https://local-demo.invalid' },
    createLocalJWKSet({ keys: [jwk] }),
    async (_url, init) => {
      const token = new Headers(init?.headers).get('Authorization')?.replace(/^Bearer /, '');
      const person = token ? identities.get(token) : undefined;
      return person
        ? Response.json({ ...person, email_verified: true })
        : Response.json({ error: 'invalid_token' }, { status: 401 });
    },
  );
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.header('Cache-Control', 'no-store');
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('X-Frame-Options', 'DENY');
    c.header(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'",
    );
    if (!isLocalDemoRequest(c.req.header('host'), c.req.header('origin'), c.req.method))
      return c.json({ error: 'LOCAL_DEMO_ONLY' }, 403);
    await next();
  });
  app.get('/demo/bootstrap', (c) =>
    c.json({ campusName: demoCampusName, actors: demoActors, datasetVersion: 2, localOnly: true }),
  );
  app.post('/demo/session/:actor', async (c) => {
    const actor = demoActors.find((a) => a.key === c.req.param('actor'));
    if (!actor) return c.json({ error: 'UNKNOWN_DEMO_PERSONA' }, 404);
    const user = users[actor.key],
      campusId = actor.key === 'outsider' ? demoIds.otherCampus : demoIds.campus;
    const token = await new SignJWT({
      token_use: 'access',
      client_id: clientId,
      scope: 'openid email profile campusfix/api',
    })
      .setSubject(user)
      .setIssuer(issuer)
      .setIssuedAt()
      .setExpirationTime('2h')
      .setProtectedHeader({ alg: 'RS256', kid: jwk.kid! })
      .sign(pair.privateKey);
    // Bound memory and never reuse these locally signed tokens in the production runtime.
    if (identities.size > 100) identities.clear();
    identities.set(token, { sub: user, email: `${actor.key}@campusfix.example` });
    const membership = await identity.membership(user, campusId),
      profile = await identity.profile(user);
    const issues = new IssueService(identity),
      shortcuts: Record<string, string> = {};
    if (campusId === demoIds.campus) {
      for (const key of ['campusIssue', 'closedIssue', 'groupIssue']) {
        if (scenarios[key])
          try {
            await issues.getIssue(user, campusId, scenarios[key]!);
            shortcuts[key] = scenarios[key]!;
          } catch {
            /* A current inaccessible source gets no shortcut. */
          }
      }
      if (scenarios.knowledge)
        try {
          await new KnowledgeService(issues).get(user, campusId, scenarios.knowledge);
          shortcuts.knowledge = scenarios.knowledge;
        } catch {
          /* Source permission can change during rehearsal. */
        }
      if (scenarios.privateReview)
        try {
          await new ReviewService(issues).get(user, campusId, scenarios.privateReview);
          shortcuts.privateReview = scenarios.privateReview;
        } catch {
          /* Private cases are not announced to original handlers. */
        }
    }
    return c.json({
      token,
      actor,
      profile,
      membership,
      campus: {
        id: campusId,
        name: actor.key === 'outsider' ? 'Dholakpur Institute of Design' : demoCampusName,
        slug: actor.key === 'outsider' ? 'dholakpur-design' : 'iit-dholakpur',
        status: 'ACTIVE',
        membershipStatus: 'ACTIVE',
      },
      shortcuts,
    });
  });
  app.route('/', createApp({ auth, identity }));
  return app;
}
