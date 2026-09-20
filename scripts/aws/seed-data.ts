import { OwnershipService } from '../../apps/api/src/ownership.js';
import { randomUUID } from 'node:crypto';
import { hash, IdentityService } from '../../apps/api/src/identity-service.js';
import { keys } from '../../apps/api/src/data/keys.js';
import type { Item } from '../../apps/api/src/data/store.js';
import { IssueService } from '../../apps/api/src/issues.js';
import { WorkflowService } from '../../apps/api/src/workflow.js';
import { DiscussionService } from '../../apps/api/src/discussion.js';
import { ReviewService } from '../../apps/api/src/reviews.js';
import { KnowledgeService } from '../../apps/api/src/knowledge.js';
export const demoActors = [
  {
    key: 'student-a',
    name: 'Aarav Sharma',
    detail: 'Final-year CSE · Kaveri hostel · Coding club',
    kind: 'Student',
  },
  {
    key: 'student-b',
    name: 'Meera Nair',
    detail: 'Final-year CSE · Narmada hostel',
    kind: 'Student',
  },
  {
    key: 'student-c',
    name: 'Kabir Rao',
    detail: 'Third-year CSE · Kaveri hostel · Coding club',
    kind: 'Student',
  },
  {
    key: 'student-d',
    name: 'Sana Khan',
    detail: 'Second-year Mechanical · Narmada hostel',
    kind: 'Student',
  },
  {
    key: 'owner',
    name: 'Prakash Varma',
    detail: 'Campus services lead · Accountable issue owner',
    kind: 'Staff',
  },
  {
    key: 'backup',
    name: 'Neha Iyer',
    detail: 'Deputy lead · Collaborator and handover recipient',
    kind: 'Staff',
  },
  {
    key: 'reviewer',
    name: 'Dr Saira Rao',
    detail: 'Independent student service reviewer',
    kind: 'Reviewer',
  },
  {
    key: 'outsider',
    name: 'Rohan Sen',
    detail: 'Separate college · Cross-campus isolation check',
    kind: 'Visitor',
  },
] as const;
export const demoDatasetVersion = 2;
export const demoCampusName = 'IIT Dholakpur';
export type DemoActor = (typeof demoActors)[number]['key'];
export const demoIds = {
  campus: 'd0000000-0000-4000-8000-000000000001',
  otherCampus: 'd0000000-0000-4000-8000-000000000002',
  hostelA: 'd0000000-0000-4000-8000-000000000003',
  hostelB: 'd0000000-0000-4000-8000-000000000004',
  department: 'd0000000-0000-4000-8000-000000000005',
  club: 'd0000000-0000-4000-8000-000000000006',
  mechanical: 'd0000000-0000-4000-8000-000000000007',
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
    demoSeedVersion: demoDatasetVersion,
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
    config(d.campus, demoCampusName, 'iit-dholakpur'),
    config(d.otherCampus, 'Dholakpur Institute of Design', 'dholakpur-design'),
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
        a.key === 'student-a' || a.key === 'student-c'
          ? [d.hostelA, d.department, d.club]
          : a.key === 'student-b'
            ? [d.hostelB, d.department]
            : a.key === 'student-d'
              ? [d.hostelB, d.mechanical]
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
    [d.hostelA, 'Kaveri hostel', 'HOSTEL'],
    [d.hostelB, 'Narmada hostel', 'HOSTEL'],
    [d.department, 'Computer Science', 'DEPARTMENT'],
    [d.club, 'Coding club', 'CLUB'],
    [d.mechanical, 'Mechanical Engineering', 'DEPARTMENT'],
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
      title: '[Demo] Kaveri hostel water purifier needs repair',
      body: 'Synthetic scenario: the second-floor water purifier in Kaveri hostel is not dispensing water. Thirty residents use this dispenser. Please inspect it and provide an update.',
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

  const discussion = new DiscussionService(issues),
    reviews = new ReviewService(issues);
  const publish = async (
    actor: DemoActor,
    key: string,
    title: string,
    body: string,
    categoryId: string,
    audience: { kind: 'CAMPUS' } | { kind: 'GROUPS'; groupIds: string[] },
  ) =>
    issues.publish(
      users[actor],
      d.campus,
      {
        title,
        body: 'Fictional IIT Dholakpur demo: ' + body,
        categoryId,
        unitId: d.unit,
        audience,
        audienceConfirmed: true,
      },
      'dholakpur-v2-' + key,
    );
  const dept = await publish(
    'student-c',
    'department',
    '[Demo] CSE lab LAN ports are intermittent',
    'Lab 204 loses wired connectivity during practical sessions. Check the switch and the affected ports.',
    d.network,
    { kind: 'GROUPS', groupIds: [d.department] },
  );
  const club = await publish(
    'student-a',
    'club',
    '[Demo] Coding club projector HDMI input fails',
    'The seminar-room projector does not detect laptops before the weekend coding workshop.',
    d.facilities,
    { kind: 'GROUPS', groupIds: [d.club] },
  );
  const fees = await publish(
    'student-b',
    'fees',
    '[Demo] Fee portal receipt download fails',
    'The common portal accepts payment but the download receipt button returns an error. No student payment details are shared here.',
    d.fees,
    { kind: 'CAMPUS' },
  );
  const mess = await publish(
    'student-d',
    'mess',
    '[Demo] Narmada mess drinking-water tap leaks',
    'The tap beside the Narmada mess entrance leaks continuously; the floor is slippery.',
    d.facilities,
    { kind: 'GROUPS', groupIds: [d.hostelB] },
  );
  const ramp = await publish(
    'student-c',
    'ramp',
    '[Demo] Library access ramp needs a handrail repair',
    'A handrail section near the library entrance is loose. Please secure it and provide a clear update.',
    d.facilities,
    { kind: 'CAMPUS' },
  );
  const light = await publish(
    'student-d',
    'light',
    '[Demo] Workshop corridor lights need replacement',
    'Two lights on the Mechanical workshop corridor are flickering during evening labs.',
    d.facilities,
    { kind: 'GROUPS', groupIds: [d.mechanical] },
  );
  const next = {
    nextAction: 'Inspect the reported location and update the students',
    nextUpdateAt: new Date(Date.parse(date) + 86400000).toISOString(),
  };
  // Hero report is ready for a short, real owner-proposal -> student-confirmation video flow.
  for (const post of [group, dept, fees, ramp]) {
    for (const action of ['acknowledge', 'start'] as const)
      await workflow.command(
        users.owner,
        d.campus,
        post.id,
        { action, expectedVersion: action === 'acknowledge' ? 1 : 2, ...next },
        `dholakpur-v2-${post.id}-${action}`,
      );
  }
  await workflow.command(
    users.owner,
    d.campus,
    fees.id,
    {
      action: 'wait',
      expectedVersion: 3,
      reason: 'The receipt service vendor is investigating the PDF generation failure.',
      nextUpdateAt: next.nextUpdateAt,
    },
    'dholakpur-v2-fees-wait',
  );
  await workflow.command(
    users.owner,
    d.campus,
    club.id,
    { action: 'acknowledge', expectedVersion: 1, ...next },
    'dholakpur-v2-club-ack',
  );
  await new OwnershipService(issues).assign(
    users.owner,
    d.campus,
    group.id,
    {
      expectedVersion: 3,
      collaboratorIds: [users.backup],
      reason: 'Neha will coordinate the Kaveri purifier repair with the maintenance technician.',
    },
    'dholakpur-v2-water-collaborator',
  );
  await discussion.create(
    users['student-c'],
    d.campus,
    group.id,
    {
      scope: 'PUBLIC',
      body: 'I checked the Kaveri dispenser this morning. The first-floor unit works, but residents on our floor are affected too.',
    },
    'dholakpur-v2-water-student-reply',
  );
  await discussion.create(
    users.owner,
    d.campus,
    group.id,
    {
      scope: 'PUBLIC',
      body: 'The maintenance team has identified a failed inlet valve. We will replace it and ask residents to verify water flow.',
    },
    'dholakpur-v2-water-owner-reply',
  );
  await discussion.create(
    users.owner,
    d.campus,
    group.id,
    {
      scope: 'STAFF',
      body: 'Internal work note: Neha will coordinate the technician visit. Share only the confirmed repair update with residents.',
    },
    'dholakpur-v2-water-private-note',
  );
  await discussion.create(
    users['student-b'],
    d.campus,
    campus.id,
    {
      scope: 'PUBLIC',
      body: 'This affects the final-year registration window. Please post the corrected link here once it is available.',
    },
    'dholakpur-v2-placement-reply',
  );
  const review = await reviews.create(
    users['student-c'],
    d.campus,
    {
      issueId: ramp.id,
      reasonCode: 'INCOMPLETE_FIX',
      description:
        'Fictional demonstration: a temporary tape barrier was added, but the handrail still needs repair.',
      desiredOutcome: 'An independent check and a dated plan for a lasting repair.',
    },
    'dholakpur-v2-independent-review',
  );
  const draft = await issues.createDraft(
    users['student-b'],
    d.campus,
    { type: 'ISSUE', title: '[Demo] Narmada study-room fan is noisy' },
    'dholakpur-v2-private-draft',
  );
  return {
    groupIssue: group.id,
    departmentIssue: dept.id,
    clubIssue: club.id,
    feesIssue: fees.id,
    messIssue: mess.id,
    rampIssue: ramp.id,
    mechanicalIssue: light.id,
    privateReview: review.id,
    privateDraft: draft.id,
    campusIssue: campus.id,
    closedIssue: closed.id,
    knowledge: card.id,
  };
}
