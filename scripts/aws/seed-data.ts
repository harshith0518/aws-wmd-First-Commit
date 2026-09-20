import { randomUUID } from 'node:crypto';
import { hash, IdentityService } from '../../apps/api/src/identity-service.js';
import { keys } from '../../apps/api/src/data/keys.js';
import type { Item } from '../../apps/api/src/data/store.js';
import { IssueService } from '../../apps/api/src/issues.js';
import { WorkflowService } from '../../apps/api/src/workflow.js';
import { KnowledgeService } from '../../apps/api/src/knowledge.js';
export const demoActors = [
  { key: 'student-a', name: 'Aarav · Demo student A' },
  { key: 'student-b', name: 'Meera · Demo student B' },
  { key: 'owner', name: 'Campus services · Demo lead' },
  { key: 'backup', name: 'Campus services · Demo backup' },
  { key: 'reviewer', name: 'Independent review · Demo reviewer' },
  { key: 'outsider', name: 'Other campus · Demo student' },
] as const;
export type DemoActor = (typeof demoActors)[number]['key'];
export const demoIds = {
  campus: 'd0000000-0000-4000-8000-000000000001',
  otherCampus: 'd0000000-0000-4000-8000-000000000002',
  hostelA: 'd0000000-0000-4000-8000-000000000003',
  hostelB: 'd0000000-0000-4000-8000-000000000004',
  department: 'd0000000-0000-4000-8000-000000000005',
  club: 'd0000000-0000-4000-8000-000000000006',
  unit: 'd0000000-0000-4000-8000-000000000010',
  network: 'd0000000-0000-4000-8000-000000000011',
  facilities: 'd0000000-0000-4000-8000-000000000012',
  fees: 'd0000000-0000-4000-8000-000000000013',
  placement: 'd0000000-0000-4000-8000-000000000014',
};
export function demoRecords(users: Record<DemoActor, string>, date: string): Item[] {
  const d = demoIds,
    base = (id: string, campus = d.campus) => ({
      id,
      campusId: campus,
      version: 1,
      schemaVersion: 1,
      createdAt: date,
      updatedAt: date,
    });
  const expires = new Date(Date.parse(date) + 14 * 86400000).toISOString();
  const config = (id: string, name: string, slug: string): Item => ({
    ...keys.campus(id),
    ...base(id, id),
    name,
    slug,
    status: 'ACTIVE',
    demoSeedVersion: 1,
    policyVersion: 1,
    independentReviewerId: users.reviewer,
    businessCalendar: {
      timezone: 'Asia/Kolkata',
      workingDays: ['MON', 'TUE', 'WED', 'THU', 'FRI'],
      opensAt: '09:00',
      closesAt: '17:00',
      holidays: [],
    },
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
  const records = [
    config(d.campus, 'CampusFix Synthetic Demo Campus', 'campusfix-demo'),
    config(d.otherCampus, 'Separate Synthetic Demo Campus', 'campusfix-other'),
  ];
  for (const a of demoActors) {
    const user = users[a.key],
      campus = a.key === 'outsider' ? d.otherCampus : d.campus;
    const role =
      a.key === 'owner' || a.key === 'backup'
        ? 'UNIT_LEAD'
        : a.key === 'reviewer'
          ? 'REVIEWER'
          : undefined;
    records.push({
      ...keys.profile(user),
      id: user,
      displayName: a.name,
      verifiedEmail: `${a.key}@campusfix.example`,
      emailVerified: true,
      mfaEnrolled: false,
      version: 1,
      createdAt: date,
      updatedAt: date,
    });
    records.push({
      ...keys.member(campus, user),
      ...base(randomUUID(), campus),
      userId: user,
      status: 'ACTIVE',
      authVersion: 1,
      groupIds:
        a.key === 'student-a'
          ? [d.hostelA, d.department, d.club]
          : a.key === 'student-b'
            ? [d.hostelB, d.department]
            : [],
      roles: role
        ? [{ id: randomUUID(), role, scope: 'UNIT', scopeId: d.unit, expiresAt: expires }]
        : [],
      expiresAt: expires,
      verifiedEmailHash: hash(`${a.key}@campusfix.example`),
      gsi1pk: keys.membershipIndex(user),
      gsi1sk: `CAMPUS#${campus}`,
    });
  }
  records.push({
    pk: `C#${d.campus}`,
    sk: `UNIT#${d.unit}`,
    ...base(d.unit),
    active: true,
    name: 'Campus services',
    description: 'Synthetic demo team for campus infrastructure and administration',
    leadId: users.owner,
    backupId: users.backup,
    escalationId: users.reviewer,
  });
  for (const [id, name] of [
    [d.network, 'Network connectivity'],
    [d.facilities, 'Hostel and campus facilities'],
    [d.fees, 'Fees and administration'],
    [d.placement, 'Placement cell'],
  ] as const)
    records.push({
      pk: `C#${d.campus}`,
      sk: `CATEGORY#${id}`,
      ...base(id),
      active: true,
      name,
      description: `${name} reports`,
      defaultUnitId: d.unit,
      sensitiveDefault: false,
      allowedPostTypes: ['ISSUE'],
    });
  for (const [id, name, kind] of [
    [d.hostelA, 'Hostel A', 'HOSTEL'],
    [d.hostelB, 'Hostel B', 'HOSTEL'],
    [d.department, 'Computer Science', 'DEPARTMENT'],
    [d.club, 'Coding club', 'CLUB'],
  ] as const)
    records.push({
      pk: `C#${d.campus}`,
      sk: `GROUP#${id}`,
      ...base(id),
      name,
      kind,
      active: true,
      approverIds: [users.owner],
    });
  return records;
}
export async function demoScenarios(
  identity: IdentityService,
  users: Record<DemoActor, string>,
  date: string,
) {
  const d = demoIds,
    issues = new IssueService(identity),
    workflow = new WorkflowService(issues),
    knowledge = new KnowledgeService(issues);
  const group = await issues.publish(
    users['student-a'],
    d.campus,
    {
      title: '[Demo] Hostel A water purifier needs repair',
      body: 'Synthetic scenario: the water purifier on the second floor is not working. Please inspect it and provide an update.',
      categoryId: d.facilities,
      unitId: d.unit,
      audience: { kind: 'GROUPS', groupIds: [d.hostelA] },
      audienceConfirmed: true,
    },
    'demo-seed-v1-hostel-report',
  );
  const campus = await issues.publish(
    users['student-b'],
    d.campus,
    {
      title: '[Demo] Placement registration link is unavailable',
      body: 'Synthetic scenario: students cannot open the placement registration page. Please restore the link and share the next update.',
      categoryId: d.placement,
      unitId: d.unit,
      audience: { kind: 'CAMPUS' },
      audienceConfirmed: true,
    },
    'demo-seed-v1-campus-report',
  );
  let closed = await issues.publish(
    users['student-a'],
    d.campus,
    {
      title: '[Demo] Library Wi-Fi restored after adapter replacement',
      body: 'Synthetic scenario: the library router stopped working. This sample follows the complete student-confirmed resolution workflow.',
      categoryId: d.network,
      unitId: d.unit,
      audience: { kind: 'CAMPUS' },
      audienceConfirmed: true,
    },
    'demo-seed-v1-resolved-report',
  );
  for (const action of ['acknowledge', 'start'] as const)
    closed = await workflow.command(
      users.owner,
      d.campus,
      closed.id,
      {
        action,
        expectedVersion: action === 'acknowledge' ? 1 : 2,
        nextAction: 'Inspect the router and replace the faulty adapter',
        nextUpdateAt: new Date(Date.parse(date) + 86400000).toISOString(),
      },
      `demo-seed-v1-resolved-${action}`,
    );
  const resolution = {
    symptom: 'Library wireless router outage',
    cause: 'Faulty power adapter',
    action: 'Replaced the adapter and checked connectivity',
    outcome: 'Student verified that library Wi-Fi works',
    evidenceOmissionReason: 'Synthetic demo; no real evidence attached',
  };
  closed = await workflow.command(
    users.owner,
    d.campus,
    closed.id,
    { action: 'propose-resolution', expectedVersion: 3, resolution },
    'demo-seed-v1-resolved-propose',
  );
  closed = await workflow.command(
    users['student-a'],
    d.campus,
    closed.id,
    { action: 'confirm', expectedVersion: 4, resolutionId: closed.detail.currentResolution!.id },
    'demo-seed-v1-resolved-confirm',
  );
  const card = await knowledge.create(
    users.owner,
    d.campus,
    {
      sourcePostId: closed.id,
      sourceExpectedVersion: 5,
      resolutionId: closed.detail.currentResolution!.id,
      symptom: resolution.symptom,
      cause: resolution.cause,
      fix: resolution.action,
      outcome: resolution.outcome,
      reviewDueAt: new Date(Date.parse(date) + 30 * 86400000).toISOString(),
    },
    'demo-seed-v1-knowledge',
  );
  return {
    groupIssue: group.id,
    campusIssue: campus.id,
    closedIssue: closed.id,
    knowledge: card.id,
  };
}
