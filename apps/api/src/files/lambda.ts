import { randomBytes } from 'node:crypto';
import { readConfig } from '../config.js';
import { DynamoStore } from '../data/dynamo.js';
import { IdentityService } from '../identity-service.js';
import { CursorCodec } from '../cursor.js';
import { IssueService } from '../issues.js';
import { FileService } from './service.js';
import { S3EvidenceStorage } from './s3.js';
import { EvidenceWorker } from './worker.js';
let worker: EvidenceWorker | undefined;
export async function handler(event: unknown) {
  if (!worker) {
    const c = readConfig();
    if (!c.FILES_ENABLED) throw new Error('Evidence processing is disabled.');
    const identity = new IdentityService(
      new DynamoStore(c),
      c,
      new CursorCodec(c.CURSOR_SECRET ?? randomBytes(32).toString('hex')),
    );
    worker = new EvidenceWorker(
      new FileService(
        new IssueService(identity),
        new S3EvidenceStorage(c.AWS_REGION, c.QUARANTINE_BUCKET!, c.EVIDENCE_BUCKET!),
      ),
    );
  }
  return worker.handle(event);
}
