import { randomUUID } from 'node:crypto';
import { issueFixture } from './issue-fixture.js';
import { KnowledgeService } from '../src/knowledge.js';
import { WorkflowService } from '../src/workflow.js';
export async function knowledgeFixture(create = true) {
  const f = issueFixture(),
    w = new WorkflowService(f.issues),
    k = new KnowledgeService(f.issues),
    next = {
      nextAction: 'Inspect equipment',
      nextUpdateAt: new Date(Date.now() + 86400000).toISOString(),
    };
  let post = await f.issues.publish(f.user, f.campus, f.input, randomUUID());
  post = await w.command(
    f.owner,
    f.campus,
    post.id,
    { action: 'acknowledge', expectedVersion: post.version, ...next },
    randomUUID(),
  );
  post = await w.command(
    f.owner,
    f.campus,
    post.id,
    { action: 'start', expectedVersion: post.version, ...next },
    randomUUID(),
  );
  post = await w.command(
    f.owner,
    f.campus,
    post.id,
    {
      action: 'propose-resolution',
      expectedVersion: post.version,
      resolution: {
        symptom: 'Wireless router outage',
        cause: 'Power supply failure',
        action: 'Replace the damaged adapter',
        outcome: 'Network service restored and verified',
        evidenceOmissionReason: 'Synthetic text fixture',
      },
    },
    randomUUID(),
  );
  post = await w.command(
    f.user,
    f.campus,
    post.id,
    {
      action: 'confirm',
      expectedVersion: post.version,
      resolutionId: post.detail.currentResolution!.id,
    },
    randomUUID(),
  );
  const input = {
    sourcePostId: post.id,
    sourceExpectedVersion: post.version,
    resolutionId: post.detail.currentResolution!.id,
    symptom: 'Wireless router outage',
    cause: 'Power supply failure',
    fix: 'Replace the damaged adapter',
    outcome: 'Network service restored and verified',
    reviewDueAt: new Date(Date.now() + 30 * 86400000).toISOString(),
  };
  const card = create ? await k.create(f.owner, f.campus, input, randomUUID()) : undefined;
  return { ...f, w, k, post, knowledgeInput: input, card };
}
