import { randomUUID } from 'node:crypto';
import { fixture } from './fixtures.js';
import { IssueService } from '../src/issues.js';
import { keys } from '../src/data/keys.js';
import { hash } from '../src/identity-service.js';
import type { Item } from '../src/data/store.js';
export function issueFixture() {
  const f = fixture();
  const owner = randomUUID(),
    bob = randomUUID(),
    category = randomUUID();
  const base = (id: string) => ({
    id,
    campusId: f.campus,
    version: 1,
    schemaVersion: 1,
    createdAt: f.now,
    updatedAt: f.now,
  });
  const calendar = {
    timezone: 'Asia/Kolkata',
    workingDays: ['MON', 'TUE', 'WED', 'THU', 'FRI'],
    opensAt: '09:00',
    closesAt: '17:00',
    holidays: [],
  };
  f.store.seed(f.config.CORE_TABLE, {
    ...keys.campus(f.campus),
    ...base(f.campus),
    name: 'Test campus',
    slug: 'test',
    status: 'ACTIVE',
    policyVersion: 1,
    businessCalendar: calendar,
    serviceTargets: { acknowledgeWorkingDays: 1, updateWorkingDays: 3, reviewWorkingDays: 5 },
    featureFlags: {
      questions: false,
      activities: false,
      marketplace: false,
      ai: false,
      sensitiveCases: false,
    },
    emergencyContacts: [],
  });
  for (const [user, name, groups, roles] of [
    [
      owner,
      'Owner',
      [],
      [
        {
          id: randomUUID(),
          role: 'UNIT_LEAD',
          scope: 'UNIT',
          scopeId: f.unit,
          expiresAt: '2099-01-01T00:00:00Z',
        },
      ],
    ],
    [bob, 'Bob', [f.otherHostel], []],
  ] as const) {
    f.store.seed(f.config.CORE_TABLE, {
      ...keys.profile(user),
      id: user,
      displayName: name,
      verifiedEmail: `${name.toLowerCase()}@example.test`,
      emailVerified: true,
      mfaEnrolled: false,
      version: 1,
      createdAt: f.now,
      updatedAt: f.now,
    });
    f.store.seed(f.config.CORE_TABLE, {
      ...f.member,
      ...keys.member(f.campus, user),
      id: randomUUID(),
      userId: user,
      groupIds: [...groups],
      roles: [...roles],
      verifiedEmailHash: hash(`${name.toLowerCase()}@example.test`),
      gsi1pk: keys.membershipIndex(user),
    });
  }
  f.store.seed(f.config.CORE_TABLE, {
    pk: `C#${f.campus}`,
    sk: `UNIT#${f.unit}`,
    ...base(f.unit),
    name: 'IT help desk',
    leadId: owner,
    backupId: owner,
    escalationId: owner,
    active: true,
  });
  f.store.seed(f.config.CORE_TABLE, {
    pk: `C#${f.campus}`,
    sk: `CATEGORY#${category}`,
    ...base(category),
    name: 'Network connectivity',
    description: 'Network service reports',
    defaultUnitId: f.unit,
    sensitiveDefault: false,
    allowedPostTypes: ['ISSUE'],
    active: true,
  });
  for (const group of [f.hostel, f.otherHostel])
    f.store.seed(f.config.CORE_TABLE, {
      pk: `C#${f.campus}`,
      sk: `GROUP#${group}`,
      ...base(group),
      name: group === f.hostel ? 'Hostel A' : 'Hostel B',
      kind: 'HOSTEL',
      approverIds: [owner],
      active: true,
    });
  const input = {
    title: 'Hostel Wi-Fi is unavailable',
    body: 'The network has not connected since yesterday.',
    categoryId: category,
    unitId: f.unit,
    audience: { kind: 'GROUPS' as const, groupIds: [f.hostel] },
    audienceConfirmed: true as const,
  };
  const issues = new IssueService(f.service);
  return { ...f, owner, bob, category, calendar, input, issues };
}
export function cloneItem(item: Item, changes: Record<string, unknown>) {
  return { ...structuredClone(item), ...changes };
}
