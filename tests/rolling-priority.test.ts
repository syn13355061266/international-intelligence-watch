import { tag } from './setup.ts';
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { closeDb, sql } from '@aihot/backend/db';
import { contentPriority, type PriorityInput } from '@aihot/backend/jobs/content-priority';
import { queueProcessing, refreshContentPriorities } from '@aihot/backend/jobs/content';
import { getBoss, stopBoss, QUEUES } from '@aihot/backend/jobs/queue';
import { upsertMaterial } from '@aihot/backend/content/materials';
import { RequestGate } from '@aihot/backend/providers/request-gate';

after(async () => { await stopBoss(); await closeDb(); });

test('news ordering uses freshness, authority and known importance, with history behind all live news', () => {
  const now = Date.parse('2026-10-11T08:00:00Z');
  const news: PriorityInput = { backfill: false, published_at: new Date(now), discovered_at: new Date(now), tier: 'T2', score: null };
  assert.ok(contentPriority(news, now) > contentPriority({ ...news, published_at: new Date(now - 86400000), tier: 'T1', score: 100 }, now));
  assert.ok(contentPriority({ ...news, tier: 'T1' }, now) > contentPriority(news, now));
  assert.ok(contentPriority({ ...news, score: 90 }, now) > contentPriority(news, now));
  assert.ok(contentPriority({ ...news, title: 'New oil export ban amid military blockade', published_at: new Date(now - 2 * 3600000) }, now) > contentPriority({ ...news, title: 'Our family hotel stay' }, now));
  assert.ok(contentPriority({ ...news, title: '石油出口管制与军事封锁' }, now) > contentPriority(news, now));
  assert.equal(contentPriority({ ...news, backfill: true, published_at: new Date(now - 30 * 86400000), score: 100 }, now), -2);
  assert.ok(contentPriority({ ...news, backfill: true }, now) > 0, 'fresh first-import news still counts as live');
  assert.equal(contentPriority({ ...news, published_at: new Date(now + 86400000) }, now), contentPriority(news, now));
});

test('an existing backlog is reprioritized without changing active work, retry dates or evaluation identity', async () => {
  const sourceId = `priority-${tag()}`;
  await sql`INSERT INTO sources(id,name,kind,tier) VALUES (${sourceId},'Priority test','rss','T1')`;
  const ids: string[] = [];
  for (const age of [24, 1, 0]) {
    const result = await upsertMaterial({ sourceId, url: `https://example.org/${sourceId}/${age}`, title: 'News', via: 'fetch', bodyText: 'Confirmed news', bodyStatus: 'ok', publishedAt: new Date(Date.now() - age * 3600000) });
    ids.push(result.articleId);
    await queueProcessing(result.articleId, { attemptTag: 'retain-receipt' });
  }
  await sql`UPDATE pgboss.job SET priority=0, start_after=now()+interval '1 hour'
    WHERE name=${QUEUES.analyze} AND data->>'articleId'=ANY(${ids})`;
  await sql`UPDATE pgboss.job SET state='active' WHERE name=${QUEUES.analyze} AND data->>'articleId'=${ids[2]!}`;
  const before = await sql`SELECT id,data,start_after FROM pgboss.job WHERE name=${QUEUES.analyze} AND data->>'articleId'=ANY(${ids}) ORDER BY id`;
  await refreshContentPriorities();
  const afterRows = await sql`SELECT id,data,start_after FROM pgboss.job WHERE name=${QUEUES.analyze} AND data->>'articleId'=ANY(${ids}) ORDER BY id`;
  assert.deepEqual([...afterRows], [...before]);
  const priorities = await sql<{ article: string; priority: number }[]>`SELECT data->>'articleId' AS article,priority FROM pgboss.job WHERE name=${QUEUES.analyze} AND data->>'articleId'=ANY(${ids})`;
  const byId = new Map(priorities.map(row => [row.article, row.priority]));
  assert.ok(byId.get(ids[1]!)! > byId.get(ids[0]!)!);
  assert.equal(byId.get(ids[2]!), 0);
  await sql`DELETE FROM pgboss.job WHERE name=${QUEUES.analyze} AND data->>'articleId'=ANY(${ids})`;
  await getBoss();
});

test('model gate overlaps two requests, bounds concurrency and releases rejected calls', async () => {
  const gate = new RequestGate(() => ({ concurrency: 2, spacingMs: 5 }));
  let active = 0, peak = 0;
  const results = await Promise.allSettled(Array.from({ length: 6 }, (_, i) => gate.run(async () => {
    peak = Math.max(peak, ++active);
    try {
      await new Promise(resolve => setTimeout(resolve, 25));
      if (i === 0) throw new Error('provider failure');
      return i;
    } finally { active -= 1; }
  })));
  assert.equal(peak, 2);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 5);
});

test('provider cooldown postpones all waiting model calls', async () => {
  const gate = new RequestGate(() => ({ concurrency: 2, spacingMs: 15 }));
  let until = 0;
  const first = gate.run(async () => {
    await new Promise(resolve => setTimeout(resolve, 5));
    until = Date.now() + 40;
    gate.cooldown(40);
  });
  const second = gate.run(async () => assert.ok(Date.now() >= until));
  await Promise.all([first, second]);
});
