import type { IssueService } from './issues.js';
import type { Item, Write } from './data/store.js';
export async function involvement(
  issues: IssueService,
  post: Item,
  users: string[],
): Promise<Write[]> {
  const writes: Write[] = [];
  for (const user of new Set(users)) {
    const key = { pk: post.pk, sk: `INVOLVED#${user}` };
    if (!(await issues.store.get(issues.config.CORE_TABLE, key)))
      writes.push({
        table: issues.config.CORE_TABLE,
        key,
        guard: { kind: 'absent' },
        item: {
          ...key,
          userId: user,
          campusId: post.campusId,
          postId: post.id,
          entityType: 'ISSUE_HANDLER_INVOLVEMENT',
          version: 1,
          schemaVersion: 1,
          createdAt: new Date().toISOString(),
        },
      });
  }
  return writes;
}
