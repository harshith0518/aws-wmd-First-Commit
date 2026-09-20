import { ReviewService } from './reviews.js';
import { reviewRoutes } from './review-routes.js';
import { DiscussionService } from './discussion.js';
import { discussionRoutes } from './discussion-routes.js';
import { FileService } from './files/service.js';
import { fileRoutes } from './files/routes.js';
import type { EvidenceStorage } from './files/storage.js';
import { IssueService } from './issues.js';
import { issueRoutes } from './issue-routes.js';
import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z, ZodError } from 'zod';
import { healthResponseSchema, idSchema, profileSyncSchema } from '@campusfix/contracts';
import { ApiError } from './errors.js';
import { type Authenticator, type Principal, unconfiguredAuth } from './auth.js';
import { type IdentityService, pageQuery } from './identity-service.js';

type Environment = { Variables: { principal: Principal; requestId: string } };
export function createApp(
  dependencies: {
    auth?: Authenticator;
    identity?: IdentityService;
    evidence?: EvidenceStorage;
  } = {},
) {
  const app = new Hono<Environment>();
  const auth = dependencies.auth ?? unconfiguredAuth;
  app.use('*', async (c, next) => {
    c.set('requestId', randomUUID());
    c.header('X-Request-Id', c.get('requestId'));
    c.header('Cache-Control', 'private, no-store');
    c.header('X-Content-Type-Options', 'nosniff');
    await next();
  });
  app.use(
    '*',
    bodyLimit({
      maxSize: 65536,
      onError: () => {
        throw new ApiError(413, 'BODY_TOO_LARGE', 'The request exceeds 64 KB.');
      },
    }),
  );
  for (const route of ['/health', '/api/health'])
    app.get(route, (c) =>
      c.json(
        healthResponseSchema.parse({ status: 'ok', service: 'campusfix-api', stage: 'foundation' }),
      ),
    );
  app.use('/api/v1/*', async (c, next) => {
    c.set('principal', await auth.authenticate(c.req.header('Authorization')));
    await next();
  });
  app.use('/api/v1/*', async (c, next) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method)) {
      z.string()
        .min(16)
        .max(128)
        .regex(/^[A-Za-z0-9_-]+$/)
        .parse(c.req.header('Idempotency-Key'));
      if (!c.req.header('Content-Type')?.toLowerCase().startsWith('application/json'))
        throw new ApiError(422, 'JSON_REQUIRED', 'Send a JSON request body.');
    }
    await next();
  });
  const service = () => {
    if (!dependencies.identity)
      throw new ApiError(503, 'DATABASE_NOT_CONFIGURED', 'Campus storage is not configured yet.');
    return dependencies.identity;
  };
  app.get('/api/v1/me', async (c) => c.json(await service().profile(c.get('principal').sub)));
  app.put('/api/v1/me', async (c) => {
    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      throw new ApiError(422, 'INVALID_JSON', 'The request body must be valid JSON.');
    }
    const input = profileSyncSchema.parse(raw);
    const identity = await auth.identity(c.get('principal'));
    return c.json(
      await service().sync(identity, input.displayName, c.req.header('Idempotency-Key')!),
    );
  });
  app.get('/api/v1/me/campuses', async (c) => {
    const q = pageQuery.parse(c.req.query());
    return c.json(await service().campuses(c.get('principal').sub, q.limit, q.cursor));
  });
  app.get('/api/v1/campuses/:campusId/membership', async (c) =>
    c.json(
      await service().membership(c.get('principal').sub, idSchema.parse(c.req.param('campusId'))),
    ),
  );
  if (dependencies.identity) {
    const issues = new IssueService(dependencies.identity);
    app.route('/api/v1/campuses', issueRoutes(issues));
    app.route('/api/v1/campuses', reviewRoutes(new ReviewService(issues)));
    app.route('/api/v1/campuses', discussionRoutes(new DiscussionService(issues)));
    app.route('/api/v1/campuses', fileRoutes(new FileService(issues, dependencies.evidence)));
  }
  app.notFound((c) =>
    c.json(
      { code: 'NOT_FOUND', message: 'This item is unavailable.', requestId: c.get('requestId') },
      404,
    ),
  );
  app.onError((error, c) => {
    if (error instanceof ApiError) {
      if (error.status === 503) c.header('Retry-After', '30');
      return c.json(
        {
          code: error.code,
          message: error.message,
          requestId: c.get('requestId'),
          ...(error.latestVersion ? { latestVersion: error.latestVersion } : {}),
        },
        error.status,
      );
    }
    if (error instanceof ZodError)
      return c.json(
        {
          code: 'VALIDATION_ERROR',
          message: 'Check the submitted fields.',
          requestId: c.get('requestId'),
          fieldErrors: z.flattenError(error).fieldErrors,
        },
        422,
      );
    // Log a category and correlation ID only: SDK errors and tokens can contain private information.
    console.error(JSON.stringify({ requestId: c.get('requestId'), code: 'DEPENDENCY_FAILURE' }));
    return c.json(
      {
        code: 'SERVICE_UNAVAILABLE',
        message: 'The service is temporarily unavailable.',
        requestId: c.get('requestId'),
      },
      503,
    );
  });
  return app;
}
export const app = createApp();
