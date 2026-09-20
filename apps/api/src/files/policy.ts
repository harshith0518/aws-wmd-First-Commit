import type { Item } from '../data/store.js';
import { canReadPost, canManageIssue, postAccessSchema, type MemberRecord } from '../policy.js';
export function canReadAttachment(member: MemberRecord, post: Item, file: Item) {
  if (
    file.campusId !== post.campusId ||
    file.parentId !== post.id ||
    file.parentKind !== 'POST' ||
    file.state === 'DELETED' ||
    !canReadPost(member, attachmentPostAccess(post))
  )
    return false;
  if (!((post.attachmentIds as string[]) ?? []).includes(String(file.id)))
    return file.ownerId === member.userId;
  if (file.scope === 'PUBLIC') return true;
  if (file.scope === 'REPORTER_HANDLERS' && post.authorId === member.userId) return true;
  return canManageIssue(member, attachmentPostAccess(post), true);
}
export const canWriteAttachment = (member: MemberRecord, post: Item) =>
  canReadPost(member, attachmentPostAccess(post)) &&
  (post.authorId === member.userId || canManageIssue(member, attachmentPostAccess(post), true));
export const fileKey = (campus: string, post: string, file: string) => ({
  pk: `C#${campus}#POST#${post}`,
  sk: `FILE#${file}`,
});

export const attachmentPostAccess = (post: Item) =>
  postAccessSchema.parse(
    post.publication === 'DRAFT'
      ? { ...post, audience: post.audience ?? { kind: 'CAMPUS' }, detail: {} }
      : post,
  );
