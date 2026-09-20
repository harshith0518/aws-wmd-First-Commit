// Construction-injected synthetic storage. Never import this from a production entry.
import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';
import type { EvidenceStorage, ObjectRef, ObjectReceipt } from '../src/files/storage.js';
export class TestEvidenceStorage implements EvidenceStorage {
  readonly kind = 'test' as const;
  objects = new Map<string, { receipt: ObjectReceipt; bytes: Uint8Array }>();
  tickets = new Map<string, { key: string; mime: string; bytes: number; sha256: string }>();
  downloads = new Map<string, ObjectRef>();
  put(key: string, bytes: Uint8Array, mime: string) {
    const receipt = {
      key,
      version: randomUUID(),
      bytes: bytes.length,
      mime,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      modifiedAt: new Date().toISOString(),
    };
    this.objects.set(`${key}@${receipt.version}`, { receipt, bytes });
    return receipt;
  }
  async reserve(key: string, mime: string, bytes: number, sha256: string) {
    const token = randomUUID();
    this.tickets.set(token, { key, mime, bytes, sha256 });
    return { url: `http://127.0.0.1:3002/synthetic-upload/${token}`, fields: { key, token } };
  }
  async head(key: string, version?: string) {
    const value = [...this.objects.values()]
      .filter((v) => v.receipt.key === key && (!version || v.receipt.version === version))
      .at(-1);
    if (!value) throw Object.assign(new Error('Object missing'), { name: 'NotFound' });
    return value.receipt;
  }
  async read(ref: ObjectRef) {
    const item = this.objects.get(`${ref.key}@${ref.version}`);
    if (!item) throw Object.assign(new Error('Object missing'), { name: 'NotFound' });
    return item.bytes;
  }
  async write(key: string, bytes: Uint8Array, mime: string) {
    return this.put(key, bytes, mime);
  }
  async download(ref: ObjectRef) {
    await this.read(ref);
    const token = randomUUID();
    this.downloads.set(token, ref);
    return `http://127.0.0.1:3002/synthetic-download/${token}`;
  }
  async remove(quarantine: ObjectRef | undefined, clean: ObjectRef[]) {
    for (const ref of [...(quarantine ? [quarantine] : []), ...clean])
      this.objects.delete(`${ref.key}@${ref.version}`);
  }
}
