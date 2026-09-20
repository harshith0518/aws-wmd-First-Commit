import { Hono } from 'hono';
import { idSchema, knowledgeQuerySchema } from '@campusfix/contracts';
import type { Principal } from './auth.js';
import { KnowledgeService } from './knowledge.js';
import { ApiError } from './errors.js';
export function knowledgeRoutes(s: KnowledgeService) {
  const r = new Hono<{ Variables: { principal: Principal; requestId: string } }>();
  const body = async (c: { req: { json: () => Promise<unknown> } }) => {
    try {
      return await c.req.json();
    } catch {
      throw new ApiError(422, 'INVALID_JSON', 'Send valid JSON.');
    }
  };
  r.get('/:campusId/knowledge', async (c) =>
    c.json(
      await s.search(
        c.get('principal').sub,
        idSchema.parse(c.req.param('campusId')),
        knowledgeQuerySchema.parse(c.req.query()),
      ),
    ),
  );
  r.post('/:campusId/knowledge', async (c) =>
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
  r.get('/:campusId/knowledge/:knowledgeId', async (c) =>
    c.json(
      await s.get(
        c.get('principal').sub,
        idSchema.parse(c.req.param('campusId')),
        idSchema.parse(c.req.param('knowledgeId')),
      ),
    ),
  );
  r.post('/:campusId/knowledge/:knowledgeId/commands', async (c) =>
    c.json(
      await s.command(
        c.get('principal').sub,
        idSchema.parse(c.req.param('campusId')),
        idSchema.parse(c.req.param('knowledgeId')),
        await body(c),
        c.req.header('Idempotency-Key')!,
      ),
    ),
  );
  return r;
}
