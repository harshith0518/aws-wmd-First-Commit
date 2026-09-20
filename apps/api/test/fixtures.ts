import { randomUUID } from 'node:crypto';
import {
  type Store,
  type Item,
  type Key,
  type Query,
  type Write,
  WriteConflict,
} from '../src/data/store.js';
import { readConfig } from '../src/config.js';
import { IdentityService, hash } from '../src/identity-service.js';
import { CursorCodec } from '../src/cursor.js';
import { keys } from '../src/data/keys.js';
export class MemoryStore implements Store {
  items = new Map<string, Item>();
  key(table: string, key: Key) {
    return JSON.stringify([table, key.pk, key.sk]);
  }
  seed(table: string, item: Item) {
    this.items.set(this.key(table, item), structuredClone(item));
  }
  async get(table: string, key: Key) {
    const item = this.items.get(this.key(table, key));
    return item ? structuredClone(item) : undefined;
  }
  async query(q: Query) {
    const pk = q.index ? `${q.index}pk` : 'pk';
    const sk = q.index ? `${q.index}sk` : 'sk';
    const matches = [...this.items.entries()]
      .filter(
        ([key, i]) =>
          JSON.parse(key)[0] === q.table &&
          i[pk] === q.pk &&
          (!q.prefix || String(i[sk]).startsWith(q.prefix)),
      )
      .map(([, i]) => structuredClone(i))
      .sort((a, b) => String(a[sk]).localeCompare(String(b[sk])));
    if (q.descending) matches.reverse();
    const start = q.after
      ? matches.findIndex((i) => i.pk === q.after!.pk && i.sk === q.after!.sk) + 1
      : 0;
    const items = matches.slice(start, start + q.limit);
    const last = items.at(-1);
    return {
      items: q.index ? items.map((i) => ({ pk: i.pk, sk: i.sk })) : items,
      ...(last && start + q.limit < matches.length ? { next: { pk: last.pk, sk: last.sk } } : {}),
    };
  }
  async transact(writes: Write[]) {
    const keys = writes.map((w) => this.key(w.table, w.key));
    if (new Set(keys).size !== keys.length) throw new Error('Duplicate item in transaction.');
    for (const w of writes) {
      const old = this.items.get(this.key(w.table, w.key));
      if (
        (w.guard.kind === 'member' &&
          (old?.version !== w.guard.version ||
            old.status !== 'ACTIVE' ||
            (typeof old.expiresAt === 'string' &&
              old.expiresAt <= w.guard.now.replace(/\.\d{3}Z$/, 'Z')))) ||
        (w.guard.kind === 'absent' && old) ||
        (w.guard.kind === 'version' && old?.version !== w.guard.version) ||
        (w.guard.kind === 'expired' && old && Number(old.expiresAt) > w.guard.now)
      )
        throw new WriteConflict();
    }
    for (const w of writes) if (w.item) this.seed(w.table, w.item);
  }
}
export function fixture() {
  const store = new MemoryStore();
  const config = readConfig({ APP_ENV: 'test', DYNAMODB_ENDPOINT: 'http://127.0.0.1:8000' });
  const service = new IdentityService(
    store,
    config,
    new CursorCodec('test-only-secret-at-least-thirty-two-characters'),
  );
  const user = randomUUID(),
    campus = randomUUID(),
    otherCampus = randomUUID(),
    hostel = randomUUID(),
    otherHostel = randomUUID(),
    unit = randomUUID();
  const now = new Date().toISOString();
  const profile = {
    ...keys.profile(user),
    id: user,
    displayName: 'Alice',
    verifiedEmail: 'alice@example.test',
    emailVerified: true,
    mfaEnrolled: false,
    version: 1,
    createdAt: now,
    updatedAt: now,
  };
  const member = {
    ...keys.member(campus, user),
    id: randomUUID(),
    campusId: campus,
    userId: user,
    version: 1,
    authVersion: 1,
    createdAt: now,
    updatedAt: now,
    status: 'ACTIVE' as const,
    groupIds: [hostel],
    roles: [],
    verifiedEmailHash: hash('alice@example.test'),
    gsi1pk: keys.membershipIndex(user),
    gsi1sk: `CAMPUS#${campus}`,
  };
  store.seed(config.CORE_TABLE, profile);
  store.seed(config.CORE_TABLE, member);
  store.seed(config.CORE_TABLE, {
    ...keys.campus(campus),
    id: campus,
    version: 1,
    name: 'Test campus',
    slug: 'test',
    status: 'ACTIVE',
  });
  return {
    store,
    config,
    service,
    user,
    campus,
    otherCampus,
    hostel,
    otherHostel,
    unit,
    member,
    profile,
    now,
  };
}
