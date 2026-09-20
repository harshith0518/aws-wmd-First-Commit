import { idSchema, subjectSchema } from '@campusfix/contracts';
export const keys = {
  campus: (campus: string) => ({ pk: `C#${idSchema.parse(campus)}`, sk: 'CONFIG' }),
  member: (campus: string, user: string) => ({
    pk: `C#${idSchema.parse(campus)}`,
    sk: `MEMBER#${subjectSchema.parse(user)}`,
  }),
  profile: (user: string) => ({ pk: `U#${subjectSchema.parse(user)}`, sk: 'PROFILE' }),
  post: (campus: string, post: string) => ({
    pk: `C#${idSchema.parse(campus)}#POST#${idSchema.parse(post)}`,
    sk: 'META',
  }),
  membershipIndex: (user: string) => `USER#${subjectSchema.parse(user)}`,
};
