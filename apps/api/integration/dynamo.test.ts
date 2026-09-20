import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import {
  CreateTableCommand,
  DeleteTableCommand,
  type CreateTableCommandInput,
} from '@aws-sdk/client-dynamodb';
import { readFile } from 'node:fs/promises';
import { readConfig } from '../src/config.js';
import { DynamoStore } from '../src/data/dynamo.js';
import { WriteConflict } from '../src/data/store.js';
import { IdentityService, hash } from '../src/identity-service.js';
import { CursorCodec } from '../src/cursor.js';
import { keys } from '../src/data/keys.js';

test(
  'DynamoDB Local: transactions, retry replay, GSI rehydration, revocation and cross-campus isolation',
  { timeout: 60000 },
  async () => {
    const suffix = randomUUID();
    const names = {
      CORE_TABLE: `campusfix-test-${suffix}-core`,
      DISCOVERY_TABLE: `campusfix-test-${suffix}-discovery`,
      JOBS_TABLE: `campusfix-test-${suffix}-jobs`,
    };
    // Fixed loopback endpoint and unique test-only tables prevent accidental cloud access or seed deletion.
    const config = readConfig({
      APP_ENV: 'test',
      DYNAMODB_ENDPOINT: 'http://127.0.0.1:8000',
      ...names,
    });
    const store = new DynamoStore(config);
    const definitions = JSON.parse(
      await readFile(new URL('../../../specs/dynamodb-tables.json', import.meta.url), 'utf8'),
    ) as CreateTableCommandInput[];
    const created: string[] = [];
    try {
      for (const d of definitions) {
        const tableName = d.TableName!.replace('campusfix-local', `campusfix-test-${suffix}`);
        await store.client.send(new CreateTableCommand({ ...d, TableName: tableName }));
        created.push(tableName);
      }
      const service = new IdentityService(
        store,
        config,
        new CursorCodec('integration-test-secret-at-least-thirty-two'),
      );
      const user = randomUUID(),
        campus = randomUUID(),
        now = new Date().toISOString();
      const identity = { sub: user, email: 'alice@example.test', emailVerified: true as const };
      const results = await Promise.all([
        service.sync(identity, 'Alice', 'parallel-test-123456'),
        service.sync(identity, 'Alice', 'parallel-test-123456'),
      ]);
      assert.deepEqual(results[0], results[1]);
      assert.equal((await store.get(config.CORE_TABLE, keys.profile(user)))?.version, 1);
      const member = {
        ...keys.member(campus, user),
        id: randomUUID(),
        campusId: campus,
        userId: user,
        status: 'ACTIVE',
        version: 1,
        authVersion: 1,
        createdAt: now,
        updatedAt: now,
        groupIds: [],
        roles: [],
        verifiedEmailHash: hash(identity.email),
        gsi1pk: keys.membershipIndex(user),
        gsi1sk: `CAMPUS#${campus}`,
      };
      await store.transact([
        {
          table: config.CORE_TABLE,
          key: keys.campus(campus),
          guard: { kind: 'absent' },
          item: {
            ...keys.campus(campus),
            id: campus,
            name: 'Integration campus',
            slug: 'integration',
            status: 'ACTIVE',
          },
        },
        {
          table: config.CORE_TABLE,
          key: keys.member(campus, user),
          guard: { kind: 'absent' },
          item: member,
        },
      ]);
      assert.equal((await service.member(user, campus)).member.status, 'ACTIVE');
      assert.equal((await service.campuses(user, 25)).items[0]?.id, campus);
      const race = await Promise.allSettled(
        ['SUSPENDED', 'REVOKED'].map((status) =>
          store.transact([
            {
              table: config.CORE_TABLE,
              key: keys.member(campus, user),
              guard: { kind: 'version', version: 1 },
              item: { ...member, status, version: 2, authVersion: 2 },
            },
          ]),
        ),
      );
      assert.equal(race.filter((r) => r.status === 'fulfilled').length, 1);
      assert.ok(race.some((r) => r.status === 'rejected' && r.reason instanceof WriteConflict));
      await assert.rejects(service.member(user, campus));
      await assert.rejects(service.member(user, randomUUID()));
      assert.notEqual((await service.campuses(user, 25)).items[0]?.membershipStatus, 'ACTIVE');
    } finally {
      for (const name of created) {
        if (!name.startsWith(`campusfix-test-${suffix}-`))
          throw new Error('Unsafe cleanup target.');
        await store.client.send(new DeleteTableCommand({ TableName: name }));
      }
      store.client.destroy();
    }
  },
);
