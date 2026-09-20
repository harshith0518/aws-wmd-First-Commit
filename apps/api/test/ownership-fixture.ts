import { randomUUID } from 'node:crypto';
import { OwnershipService } from '../src/ownership.js';
import { issueFixture } from './issue-fixture.js';
import { keys } from '../src/data/keys.js';
export async function ownershipFixture(restricted = false) {
  const f = issueFixture(),
    nextUnit = randomUUID();
  const bob = (await f.store.get(f.config.CORE_TABLE, keys.member(f.campus, f.bob)))!;
  f.store.seed(f.config.CORE_TABLE, {
    ...bob,
    roles: [
      {
        id: randomUUID(),
        role: 'UNIT_LEAD',
        scope: 'UNIT',
        scopeId: nextUnit,
        expiresAt: '2099-01-01T00:00:00Z',
      },
      {
        id: randomUUID(),
        role: 'HANDLER',
        scope: 'UNIT',
        scopeId: f.unit,
        expiresAt: '2099-01-01T00:00:00Z',
      },
      ...(restricted
        ? [
            {
              id: randomUUID(),
              role: 'SENSITIVE_HANDLER',
              scope: 'CAMPUS',
              expiresAt: '2099-01-01T00:00:00Z',
            },
          ]
        : []),
    ],
  });
  const unit = (await f.store.get(f.config.CORE_TABLE, {
    pk: `C#${f.campus}`,
    sk: `UNIT#${f.unit}`,
  }))!;
  f.store.seed(f.config.CORE_TABLE, {
    ...unit,
    id: nextUnit,
    sk: `UNIT#${nextUnit}`,
    name: 'Maintenance',
    leadId: f.bob,
    backupId: f.bob,
    escalationId: f.bob,
  });
  if (restricted) {
    const c = (await f.store.get(f.config.CORE_TABLE, keys.campus(f.campus)))!;
    f.store.seed(f.config.CORE_TABLE, { ...c, featureFlags: { sensitiveCases: true } });
    const owner = (await f.store.get(f.config.CORE_TABLE, keys.member(f.campus, f.owner)))!;
    f.store.seed(f.config.CORE_TABLE, {
      ...owner,
      roles: [
        ...(owner.roles as object[]),
        {
          id: randomUUID(),
          role: 'SENSITIVE_HANDLER',
          scope: 'CAMPUS',
          expiresAt: '2099-01-01T00:00:00Z',
        },
      ],
    });
  }
  const post = await f.issues.publish(
    f.user,
    f.campus,
    { ...f.input, ...(restricted ? { audience: { kind: 'RESTRICTED' } } : {}) },
    randomUUID(),
  );
  return { ...f, post, nextUnit, ownership: new OwnershipService(f.issues) };
}
