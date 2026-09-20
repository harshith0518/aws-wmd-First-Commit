import { Hono } from 'hono';
import { idSchema, fileParentSchema, fileVariantSchema } from '@campusfix/contracts';
import type { Principal } from '../auth.js';
import { ApiError } from '../errors.js';
import { FileService } from './service.js';
export function fileRoutes(files: FileService) {
  const routes = new Hono<{ Variables: { principal: Principal; requestId: string } }>();
  const body = async (c: { req: { json: () => Promise<unknown> } }) => {
    try {
      return await c.req.json();
    } catch {
      throw new ApiError(422, 'INVALID_JSON', 'Send a valid JSON request.');
    }
  };
  routes.get('/:campusId/posts/:postId/attachments', async (c) =>
    c.json(
      await files.list(c.get('principal').sub, idSchema.parse(c.req.param('campusId')), {
        parentKind: 'POST',
        parentId: idSchema.parse(c.req.param('postId')),
      }),
    ),
  );
  routes.post('/:campusId/attachments/reserve', async (c) =>
    c.json(
      await files.reserve(
        c.get('principal').sub,
        idSchema.parse(c.req.param('campusId')),
        await body(c),
        c.req.header('Idempotency-Key')!,
      ),
      201,
    ),
  );
  routes.get('/:campusId/attachments/:attachmentId', async (c) =>
    c.json(
      await files.status(
        c.get('principal').sub,
        idSchema.parse(c.req.param('campusId')),
        fileParentSchema.parse(c.req.query()),
        idSchema.parse(c.req.param('attachmentId')),
      ),
    ),
  );
  routes.post('/:campusId/attachments/:attachmentId/complete', async (c) =>
    c.json(
      await files.complete(
        c.get('principal').sub,
        idSchema.parse(c.req.param('campusId')),
        fileParentSchema.parse(c.req.query()),
        idSchema.parse(c.req.param('attachmentId')),
        await body(c),
        c.req.header('Idempotency-Key')!,
      ),
      202,
    ),
  );
  routes.get('/:campusId/attachments/:attachmentId/download', async (c) => {
    const { variant, ...parent } = c.req.query();
    return c.json(
      await files.download(
        c.get('principal').sub,
        idSchema.parse(c.req.param('campusId')),
        fileParentSchema.parse(parent),
        idSchema.parse(c.req.param('attachmentId')),
        fileVariantSchema.parse(variant),
      ),
    );
  });
  routes.post('/:campusId/attachments/:attachmentId/remove', async (c) =>
    c.json(
      await files.remove(
        c.get('principal').sub,
        idSchema.parse(c.req.param('campusId')),
        fileParentSchema.parse(c.req.query()),
        idSchema.parse(c.req.param('attachmentId')),
        await body(c),
        c.req.header('Idempotency-Key')!,
      ),
    ),
  );
  return routes;
}
