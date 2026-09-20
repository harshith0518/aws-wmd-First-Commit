import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { readConfig } from '../config.js';
import { DynamoStore } from '../data/dynamo.js';
import { IdentityService } from '../identity-service.js';
import { CursorCodec } from '../cursor.js';
import { IssueService } from '../issues.js';
import { OwnershipService } from '../ownership.js';
const eventSchema = z.object({
  source: z.literal('aws.events'),
  'detail-type': z.literal('Scheduled Event'),
  account: z.string(),
  region: z.string(),
  resources: z.array(z.string()).max(10),
});
export async function handler(input: unknown) {
  const e = eventSchema.parse(input),
    c = readConfig();
  if (
    !c.WORKFLOW_SCHEDULE_ARN ||
    e.account !== c.WORKFLOW_SCHEDULE_ARN.split(':')[4] ||
    e.region !== c.AWS_REGION ||
    !e.resources.includes(c.WORKFLOW_SCHEDULE_ARN)
  )
    throw new Error('Untrusted workflow schedule.');
  const store = new DynamoStore(c);
  try {
    return await new OwnershipService(
      new IssueService(
        new IdentityService(
          store,
          c,
          new CursorCodec(c.CURSOR_SECRET ?? randomBytes(32).toString('hex')),
        ),
      ),
    ).expire();
  } finally {
    store.client.destroy();
  }
}
