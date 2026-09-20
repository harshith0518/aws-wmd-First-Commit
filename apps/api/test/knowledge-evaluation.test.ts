import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { knowledgeFixture } from './knowledge-fixture.js';
import { knowledgeKey } from '../src/knowledge.js';
import { keys } from '../src/data/keys.js';
import { knowledgeQuerySchema } from '@campusfix/contracts';
import type { Item } from '../src/data/store.js';
test('30 labelled synthetic retrieval cases: expected sources and no unauthorized, expired or reopened results', async () => {
  const data = JSON.parse(
    await readFile(new URL('../../../specs/knowledge-evaluation.json', import.meta.url), 'utf8'),
  ) as {
    sources: Array<{
      key: string;
      category: string;
      symptom: string;
      cause: string;
      fix: string;
      outcome: string;
    }>;
    cases: Array<{ category: string; query: string; expected: string | null }>;
  };
  const f = await knowledgeFixture(),
    baseCard = (await f.store.get(f.config.CORE_TABLE, knowledgeKey(f.campus, f.card!.id)))!,
    basePost = (await f.store.get(f.config.CORE_TABLE, keys.post(f.campus, f.post.id)))!,
    baseResolution = (await f.store.get(f.config.CORE_TABLE, {
      pk: basePost.pk,
      sk: `RESOLUTION#${baseCard.resolutionId}`,
    }))!,
    category = (await f.store.get(f.config.CORE_TABLE, {
      pk: `C#${f.campus}`,
      sk: `CATEGORY#${f.category}`,
    }))!;
  const categories = new Map<string, string>(),
    ids = new Map<string, string>();
  for (const name of ['network', 'plumbing', 'electrical']) {
    const id = randomUUID();
    categories.set(name, id);
    f.store.seed(f.config.CORE_TABLE, { ...category, id, name, sk: `CATEGORY#${id}` });
  }
  const seed = (
    name: string,
    cat: string,
    symptom: string,
    cause: string,
    fix: string,
    outcome: string,
    mode?: string,
  ) => {
    const id = randomUUID(),
      sourceId = randomUUID(),
      resolutionId = randomUUID(),
      campus = mode === 'foreign' ? f.otherCampus : f.campus,
      pk = keys.post(campus, sourceId),
      ck = knowledgeKey(campus, id),
      createdAt = new Date(Date.now() + ids.size).toISOString(),
      resolution = {
        ...baseResolution,
        pk: pk.pk,
        id: resolutionId,
        sk: `RESOLUTION#${resolutionId}`,
        postId: sourceId,
        campusId: campus,
        symptom,
        cause,
        action: fix,
        outcome,
      };
    const post: Item = {
      ...basePost,
      ...pk,
      id: sourceId,
      campusId: campus,
      title: symptom,
      categoryId: cat,
      authorId: mode === 'other' ? f.bob : f.user,
      audience: { kind: 'GROUPS', groupIds: [mode === 'other' ? f.otherHostel : f.hostel] },
      detail: {
        ...(basePost.detail as Record<string, unknown>),
        resolutionId,
        currentResolution: resolution,
        status: mode === 'reopened' ? 'REOPENED' : 'CONFIRMED_CLOSED',
      },
    };
    const card = {
      ...baseCard,
      ...ck,
      id,
      campusId: campus,
      sourcePostId: sourceId,
      resolutionId,
      categoryId: cat,
      symptom,
      cause,
      fix,
      outcome,
      createdAt,
      reviewedAt: createdAt,
      ...(mode === 'expired' ? { reviewDueAt: '2000-01-01T00:00:00Z' } : {}),
    };
    f.store.seed(f.config.CORE_TABLE, post);
    f.store.seed(f.config.CORE_TABLE, resolution);
    f.store.seed(f.config.CORE_TABLE, card);
    // Poisoned audience/campus projections must still be harmless after canonical validation.
    f.store.seed(f.config.DISCOVERY_TABLE, {
      pk: `C#${f.campus}#KNOW#${cat}#AUD#GROUP#${f.hostel}`,
      sk: `${createdAt}#${id}`,
      canonicalPk: ck.pk,
      canonicalSk: 'META',
      version: 1,
    });
    ids.set(name, id);
  };
  for (const x of data.sources)
    seed(x.key, categories.get(x.category)!, x.symptom, x.cause, x.fix, x.outcome);
  for (const [name, mode] of [
    ['expired oldmodem', 'expired'],
    ['reopened fibrepair', 'reopened'],
    ['otherhostel secretmesh', 'other'],
    ['foreigncampus privateproxy', 'foreign'],
  ])
    seed(
      name!,
      categories.get('network')!,
      name!,
      'Synthetic cause',
      'Synthetic historical fix',
      'Synthetic outcome',
      mode,
    );
  let correct = 0;
  for (const c of data.cases) {
    const page = await f.k.search(
      f.user,
      f.campus,
      knowledgeQuerySchema.parse({ categoryId: categories.get(c.category), query: c.query }),
    );
    if (c.expected) {
      assert.equal(page.items[0]?.id, ids.get(c.expected));
    } else assert.equal(page.items.length, 0);
    correct++;
  }
  assert.equal(data.cases.length, 30);
  assert.equal(correct, 30);
});
