import { Hono } from 'hono';
import { idSchema, replyQuerySchema } from '@campusfix/contracts';
import type { Principal } from './auth.js';
import { DiscussionService } from './discussion.js';
import { ApiError } from './errors.js';
import { pageQuery } from './identity-service.js';
export function discussionRoutes(d: DiscussionService) {
  const routes = new Hono<{ Variables: { principal: Principal; requestId: string } }>();
  const body = async (c: { req: { json: () => Promise<unknown> } }) => {
    try {
      return await c.req.json();
    } catch {
      throw new ApiError(422, 'INVALID_JSON', 'Send a valid JSON request.');
    }
  };
  routes.get('/:campusId/posts/:postId/replies', async (c) =>
    c.json(
      await d.list(
        c.get('principal').sub,
        idSchema.parse(c.req.param('campusId')),
        idSchema.parse(c.req.param('postId')),
        replyQuerySchema.parse(c.req.query()),
      ),
    ),
  );
  routes.post('/:campusId/posts/:postId/replies', async (c) =>
    c.json(
      await d.create(
        c.get('principal').sub,
        idSchema.parse(c.req.param('campusId')),
        idSchema.parse(c.req.param('postId')),
        await body(c),
        c.req.header('Idempotency-Key')!,
      ),
      201,
    ),
  );
  routes.patch('/:campusId/posts/:postId/replies/:replyId', async (c) =>
    c.json(
      await d.change(
        c.get('principal').sub,
        idSchema.parse(c.req.param('campusId')),
        idSchema.parse(c.req.param('postId')),
        idSchema.parse(c.req.param('replyId')),
        await body(c),
        c.req.header('Idempotency-Key')!,
      ),
    ),
  );
  routes.post('/:campusId/posts/:postId/replies/:replyId/remove', async (c) => {
    const r = await d.change(
      c.get('principal').sub,
      idSchema.parse(c.req.param('campusId')),
      idSchema.parse(c.req.param('postId')),
      idSchema.parse(c.req.param('replyId')),
      await body(c),
      c.req.header('Idempotency-Key')!,
      true,
    );
    return c.json({ id: r.id, version: r.version, removed: true });
  });
  routes.get('/:campusId/posts/:postId/replies/:replyId/revisions', async (c) => {
    const q = pageQuery.parse(c.req.query());
    return c.json(
      await d.revisions(
        c.get('principal').sub,
        idSchema.parse(c.req.param('campusId')),
        idSchema.parse(c.req.param('postId')),
        idSchema.parse(c.req.param('replyId')),
        q.limit,
        q.cursor,
      ),
    );
  });
  routes.get('/:campusId/issues/:postId/support', async (c) =>
    c.json(
      await d.supportState(
        c.get('principal').sub,
        idSchema.parse(c.req.param('campusId')),
        idSchema.parse(c.req.param('postId')),
      ),
    ),
  );
  routes.put('/:campusId/issues/:postId/support', async (c) =>
    c.json(
      await d.support(
        c.get('principal').sub,
        idSchema.parse(c.req.param('campusId')),
        idSchema.parse(c.req.param('postId')),
        await body(c),
        c.req.header('Idempotency-Key')!,
      ),
    ),
  );
  return routes;
}
