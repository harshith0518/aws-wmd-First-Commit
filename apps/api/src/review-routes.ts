import { Hono } from 'hono';
import { idSchema } from '@campusfix/contracts';
import type { Principal } from './auth.js';
import { ReviewService } from './reviews.js';
import { pageQuery } from './identity-service.js';
import { ApiError } from './errors.js';
export function reviewRoutes(s: ReviewService) {
  const r = new Hono<{ Variables: { principal: Principal; requestId: string } }>(),
    body = async (c: { req: { json: () => Promise<unknown> } }) => {
      try {
        return await c.req.json();
      } catch {
        throw new ApiError(422, 'INVALID_JSON', 'Send valid JSON.');
      }
    };
  r.get('/:campusId/service-reviews', async (c) => {
    const q = pageQuery.parse(c.req.query());
    return c.json(
      await s.list(
        c.get('principal').sub,
        idSchema.parse(c.req.param('campusId')),
        q.limit,
        q.cursor,
      ),
    );
  });
  r.post('/:campusId/service-reviews', async (c) =>
    c.json(
      await s.create(
        c.get('principal').sub,
        idSchema.parse(c.req.param('campusId')),
        await body(c),
        c.req.header('Idempotency-Key')!,
      ),
      201,
    ),
  );
  r.get('/:campusId/service-reviews/:reviewId', async (c) =>
    c.json(
      await s.get(
        c.get('principal').sub,
        idSchema.parse(c.req.param('campusId')),
        idSchema.parse(c.req.param('reviewId')),
      ),
    ),
  );
  r.post('/:campusId/service-reviews/:reviewId/commands', async (c) =>
    c.json(
      await s.command(
        c.get('principal').sub,
        idSchema.parse(c.req.param('campusId')),
        idSchema.parse(c.req.param('reviewId')),
        await body(c),
        c.req.header('Idempotency-Key')!,
      ),
    ),
  );
  r.get('/:campusId/service-reviews/:reviewId/handler-candidates', async (c) => {
    const q = pageQuery.parse(c.req.query());
    return c.json(
      await s.candidates(
        c.get('principal').sub,
        idSchema.parse(c.req.param('campusId')),
        idSchema.parse(c.req.param('reviewId')),
        q.limit,
        q.cursor,
      ),
    );
  });
  r.post('/:campusId/service-reviews/:reviewId/responses', async (c) =>
    c.json(
      await s.respond(
        c.get('principal').sub,
        idSchema.parse(c.req.param('campusId')),
        idSchema.parse(c.req.param('reviewId')),
        await body(c),
        c.req.header('Idempotency-Key')!,
      ),
      201,
    ),
  );
  for (const [path, kind] of [
    ['responses', 'RESPONSE'],
    ['history', 'EVENT'],
  ] as const)
    r.get(`/:campusId/service-reviews/:reviewId/${path}`, async (c) => {
      const q = pageQuery.parse(c.req.query());
      return c.json(
        await s.children(
          c.get('principal').sub,
          idSchema.parse(c.req.param('campusId')),
          idSchema.parse(c.req.param('reviewId')),
          kind,
          q.limit,
          q.cursor,
        ),
      );
    });
  return r;
}
