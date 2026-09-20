import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import sharp from 'sharp';
import {
  CreateTableCommand,
  DeleteTableCommand,
  type CreateTableCommandInput,
} from '@aws-sdk/client-dynamodb';
import { readConfig } from '../src/config.js';
import { DynamoStore } from '../src/data/dynamo.js';
import { IdentityService } from '../src/identity-service.js';
import { CursorCodec } from '../src/cursor.js';
import { IssueService } from '../src/issues.js';
import { WorkflowService } from '../src/workflow.js';
import { FileService } from '../src/files/service.js';
import { EvidenceWorker } from '../src/files/worker.js';
import { sha256 } from '../src/files/validation.js';
import { issueFixture } from '../test/issue-fixture.js';
import { TestEvidenceStorage } from '../test/evidence-storage.js';
test(
  'DynamoDB Local: evidence reservation races, version binding, resolution proof, scoped reads and worker deletion',
  { timeout: 60000 },
  async () => {
    const prefix = `campusfix-test-${randomUUID()}`,
      config = readConfig({
        APP_ENV: 'test',
        DYNAMODB_ENDPOINT: 'http://127.0.0.1:8000',
        CORE_TABLE: prefix + '-core',
        DISCOVERY_TABLE: prefix + '-discovery',
        JOBS_TABLE: prefix + '-jobs',
      }),
      store = new DynamoStore(config),
      created: string[] = [];
    try {
      const tables = JSON.parse(
        await readFile(new URL('../../../specs/dynamodb-tables.json', import.meta.url), 'utf8'),
      ) as CreateTableCommandInput[];
      for (const table of tables) {
        const name = table.TableName!.replace('campusfix-local', prefix);
        await store.client.send(new CreateTableCommand({ ...table, TableName: name }));
        created.push(name);
      }
      const f = issueFixture();
      await store.transact(
        [...f.store.items.values()].map((item) => ({
          table: config.CORE_TABLE,
          key: { pk: item.pk, sk: item.sk },
          guard: { kind: 'absent' as const },
          item,
        })),
      );
      const identity = new IdentityService(
          store,
          config,
          new CursorCodec('file-integration-secret-at-least-32-characters'),
        ),
        issues = new IssueService(identity),
        storage = new TestEvidenceStorage(),
        files = new FileService(issues, storage);
      const draft = await issues.createDraft(
          f.user,
          f.campus,
          { type: 'ISSUE', title: 'Proof attached' },
          randomUUID(),
        ),
        parent = { parentKind: 'POST' as const, parentId: draft.id };
      const bytes = await sharp({
        create: { width: 16, height: 16, channels: 3, background: '#55aa33' },
      })
        .png()
        .toBuffer();
      const request = {
          ...parent,
          scope: 'PUBLIC',
          originalName: 'synthetic.png',
          mime: 'image/png',
          bytes: bytes.length,
          sha256: sha256(bytes),
        },
        key = randomUUID();
      const reserved = await Promise.all([
        files.reserve(f.user, f.campus, request, key),
        files.reserve(f.user, f.campus, request, key),
      ]);
      assert.equal(reserved[0]!.attachment.id, reserved[1]!.attachment.id);
      const reservation = reserved[0]!,
        fileId = reservation.attachment.id,
        object = storage.put(reservation.fields.key!, bytes, 'image/png');
      const completeKey = randomUUID();
      await Promise.all([
        files.complete(
          f.user,
          f.campus,
          parent,
          fileId,
          { expectedVersion: 1, sha256: request.sha256 },
          completeKey,
        ),
        files.complete(
          f.user,
          f.campus,
          parent,
          fileId,
          { expectedVersion: 1, sha256: request.sha256 },
          completeKey,
        ),
      ]);
      await Promise.all([
        files.recordScan(
          f.campus,
          draft.id,
          fileId,
          object.version,
          'NO_THREATS_FOUND',
          'same-synthetic-event',
        ),
        files.recordScan(
          f.campus,
          draft.id,
          fileId,
          object.version,
          'NO_THREATS_FOUND',
          'same-synthetic-event',
        ),
      ]);
      assert.equal((await files.status(f.user, f.campus, parent, fileId)).state, 'CLEAN');
      const saved = await issues.getDraft(f.user, f.campus, draft.id);
      let post = await issues.publish(
        f.user,
        f.campus,
        {
          expectedVersion: saved.version,
          payload: { ...f.input, audience: { kind: 'CAMPUS' }, attachmentIds: [fileId] },
        },
        randomUUID(),
        draft.id,
      );
      const workflow = new WorkflowService(issues),
        next = {
          nextAction: 'Check repair',
          nextUpdateAt: new Date(Date.now() + 86400000).toISOString(),
        };
      post = await workflow.command(
        f.owner,
        f.campus,
        draft.id,
        { expectedVersion: post.version, action: 'acknowledge', ...next },
        randomUUID(),
      );
      post = await workflow.command(
        f.owner,
        f.campus,
        draft.id,
        { expectedVersion: post.version, action: 'start', ...next },
        randomUUID(),
      );
      post = await workflow.command(
        f.owner,
        f.campus,
        draft.id,
        {
          expectedVersion: post.version,
          action: 'propose-resolution',
          resolution: {
            symptom: 'Broken test point',
            action: 'Replaced test part',
            outcome: 'Synthetic test passes',
            evidenceIds: [fileId],
          },
        },
        randomUUID(),
      );
      assert.deepEqual(post.detail.currentResolution?.evidenceIds, [fileId]);
      assert.ok((await files.download(f.bob, f.campus, parent, fileId, 'SANITIZED')).url);
      const clean = await files.status(f.user, f.campus, parent, fileId);
      await files.remove(
        f.user,
        f.campus,
        parent,
        fileId,
        { expectedVersion: clean.version, reason: 'Remove synthetic fixture' },
        randomUUID(),
      );
      assert.deepEqual(
        (await issues.getIssue(f.bob, f.campus, draft.id)).detail.currentResolution?.evidenceIds,
        [],
      );
      assert.deepEqual(
        (await workflow.resolutions(f.bob, f.campus, draft.id, 25)).items[0]?.evidenceIds,
        [],
      );
      await new EvidenceWorker(files).reconcile(Date.now() + 1000);
      assert.equal(storage.objects.size, 0);
      const job = await store.get(config.JOBS_TABLE, files.jobKey(f.campus, fileId));
      assert.equal(job?.state, 'DONE');
      assert.equal(job?.readyPk, undefined);
    } finally {
      for (const name of created) {
        assert.ok(name.startsWith(prefix + '-'));
        await store.client.send(new DeleteTableCommand({ TableName: name }));
      }
      store.client.destroy();
    }
  },
);
