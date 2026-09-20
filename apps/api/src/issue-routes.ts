import { OwnershipService } from './ownership.js';
import { ownerCandidatesQuerySchema } from '@campusfix/contracts';
import { WorkflowService } from './workflow.js';
import { queueQuerySchema } from '@campusfix/contracts';
import { Hono, type Context } from 'hono';
import { idSchema, issueFeedQuerySchema } from '@campusfix/contracts';
import type { Principal } from './auth.js';
import { IssueService } from './issues.js';
import { ApiError } from './errors.js';
import { pageQuery } from './identity-service.js';
export function issueRoutes(service: IssueService) {
  const routes = new Hono<{ Variables: { principal: Principal; requestId: string } }>();
  const body = async (c: { req: { json: () => Promise<unknown> } }) => {
    try {
      return await c.req.json();
    } catch {
      throw new ApiError(422, 'INVALID_JSON', 'The request body must be valid JSON.');
    }
  };
  routes.get('/:campusId/configuration', async (c) =>
    c.json(
      await service.configuration(c.get('principal').sub, idSchema.parse(c.req.param('campusId'))),
    ),
  );
  routes.get('/:campusId/drafts', async (c) => {
    const q = pageQuery.parse(c.req.query());
    return c.json(
      await service.drafts(
        c.get('principal').sub,
        idSchema.parse(c.req.param('campusId')),
        q.limit,
        q.cursor,
      ),
    );
  });
  routes.post('/:campusId/drafts', async (c) =>
    c.json(
      await service.createDraft(
        c.get('principal').sub,
        idSchema.parse(c.req.param('campusId')),
        await body(c),
        c.req.header('Idempotency-Key')!,
      ),
      201,
    ),
  );
  routes.get('/:campusId/drafts/:postId', async (c) =>
    c.json(
      await service.getDraft(
        c.get('principal').sub,
        idSchema.parse(c.req.param('campusId')),
        idSchema.parse(c.req.param('postId')),
      ),
    ),
  );
  routes.patch('/:campusId/drafts/:postId', async (c) =>
    c.json(
      await service.updateDraft(
        c.get('principal').sub,
        idSchema.parse(c.req.param('campusId')),
        idSchema.parse(c.req.param('postId')),
        await body(c),
        c.req.header('Idempotency-Key')!,
      ),
    ),
  );
  routes.post('/:campusId/drafts/:postId/discard', async (c) =>
    c.json(
      await service.discardDraft(
        c.get('principal').sub,
        idSchema.parse(c.req.param('campusId')),
        idSchema.parse(c.req.param('postId')),
        await body(c),
        c.req.header('Idempotency-Key')!,
      ),
    ),
  );
  routes.post('/:campusId/drafts/:postId/publish', async (c) =>
    c.json(
      await service.publish(
        c.get('principal').sub,
        idSchema.parse(c.req.param('campusId')),
        await body(c),
        c.req.header('Idempotency-Key')!,
        idSchema.parse(c.req.param('postId')),
      ),
    ),
  );
  routes.post('/:campusId/issues', async (c) =>
    c.json(
      await service.publish(
        c.get('principal').sub,
        idSchema.parse(c.req.param('campusId')),
        await body(c),
        c.req.header('Idempotency-Key')!,
      ),
      201,
    ),
  );
  routes.get('/:campusId/posts', async (c) =>
    c.json(
      await service.feed(
        c.get('principal').sub,
        idSchema.parse(c.req.param('campusId')),
        issueFeedQuerySchema.parse(c.req.query()),
      ),
    ),
  );
  routes.get('/:campusId/posts/:postId', async (c) =>
    c.json(
      await service.getIssue(
        c.get('principal').sub,
        idSchema.parse(c.req.param('campusId')),
        idSchema.parse(c.req.param('postId')),
      ),
    ),
  );
  const workflow = new WorkflowService(service),
    ownership = new OwnershipService(service);
  routes.get('/:campusId/issues/:postId/handler-candidates', async (c) => {
    const q = ownerCandidatesQuerySchema.parse(c.req.query());
    return c.json(
      await ownership.candidates(
        c.get('principal').sub,
        idSchema.parse(c.req.param('campusId')),
        idSchema.parse(c.req.param('postId')),
        q.unitId,
        q.limit,
        q.cursor,
      ),
    );
  });
  routes.put('/:campusId/issues/:postId/assignment', async (c) =>
    c.json(
      await ownership.assign(
        c.get('principal').sub,
        idSchema.parse(c.req.param('campusId')),
        idSchema.parse(c.req.param('postId')),
        await body(c),
        c.req.header('Idempotency-Key')!,
      ),
    ),
  );
  const command = async (
    c: Context<{ Variables: { principal: Principal; requestId: string } }>,
  ) => {
    const input = await body(c);
    const transfer =
      typeof input === 'object' &&
      input !== null &&
      'action' in input &&
      ['propose-transfer', 'accept-transfer', 'reject-transfer'].includes(String(input.action));
    return (transfer ? ownership : workflow).command(
      c.get('principal').sub,
      idSchema.parse(c.req.param('campusId')),
      idSchema.parse(c.req.param('postId')),
      input,
      c.req.header('Idempotency-Key')!,
    );
  };
  routes.post('/:campusId/issues/:postId/commands', async (c) => c.json(await command(c)));
  routes.get('/:campusId/posts/:postId/history', async (c) => {
    const q = pageQuery.parse(c.req.query());
    return c.json(
      await workflow.history(
        c.get('principal').sub,
        idSchema.parse(c.req.param('campusId')),
        idSchema.parse(c.req.param('postId')),
        q.limit,
        q.cursor,
      ),
    );
  });
  routes.get('/:campusId/issues/:postId/resolutions', async (c) => {
    const q = pageQuery.parse(c.req.query());
    return c.json(
      await workflow.resolutions(
        c.get('principal').sub,
        idSchema.parse(c.req.param('campusId')),
        idSchema.parse(c.req.param('postId')),
        q.limit,
        q.cursor,
      ),
    );
  });
  routes.get('/:campusId/staff/queue', async (c) =>
    c.json(
      await workflow.queue(
        c.get('principal').sub,
        idSchema.parse(c.req.param('campusId')),
        queueQuerySchema.parse(c.req.query()),
      ),
    ),
  );
  return routes;
}
