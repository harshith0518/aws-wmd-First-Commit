import { randomUUID } from 'node:crypto';
import { issueFixture } from './issue-fixture.js';
import { keys } from '../src/data/keys.js';
import { hash } from '../src/identity-service.js';
import { ReviewService } from '../src/reviews.js';
export async function reviewFixture(configured = true) {
  const f = issueFixture(),
    reviewer = randomUUID();
  f.store.seed(f.config.CORE_TABLE, {
    ...f.profile,
    ...keys.profile(reviewer),
    id: reviewer,
    displayName: 'Independent reviewer',
    verifiedEmail: 'reviewer@example.test',
  });
  f.store.seed(f.config.CORE_TABLE, {
    ...f.member,
    ...keys.member(f.campus, reviewer),
    id: randomUUID(),
    userId: reviewer,
    groupIds: [],
    verifiedEmailHash: hash('reviewer@example.test'),
    roles: [
      {
        id: randomUUID(),
        role: 'REVIEWER',
        scope: 'UNIT',
        scopeId: f.unit,
        expiresAt: '2099-01-01T00:00:00Z',
      },
    ],
  });
  if (configured) {
    const c = (await f.store.get(f.config.CORE_TABLE, keys.campus(f.campus)))!;
    f.store.seed(f.config.CORE_TABLE, { ...c, independentReviewerId: reviewer });
  }
  const post = await f.issues.publish(f.user, f.campus, f.input, randomUUID());
  return {
    ...f,
    reviewer,
    post,
    reviews: new ReviewService(f.issues),
    reviewInput: {
      issueId: post.id,
      reasonCode: 'INCOMPLETE_FIX',
      description: 'The reported problem is still occurring.',
      desiredOutcome: 'Please verify the full repair.',
    },
  };
}
