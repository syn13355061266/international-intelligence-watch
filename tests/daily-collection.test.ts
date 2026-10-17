import { tag } from './setup.ts';
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { sql, closeDb } from '@aihot/backend/db';
import { collectionDayStart, scheduleDueSources } from '@aihot/backend/sources/collect';
import { getBoss, stopBoss, QUEUES } from '@aihot/backend/jobs/queue';

after(async()=>{await stopBoss();await closeDb();});
test('Shanghai daily collection changes window at 05:00, including midnight and year boundaries',()=>{
  assert.equal(collectionDayStart(new Date('2026-10-10T20:59:59Z')).toISOString(),'2026-10-09T21:00:00.000Z');
  assert.equal(collectionDayStart(new Date('2026-10-10T21:00:00Z')).toISOString(),'2026-10-10T21:00:00.000Z');
  assert.equal(collectionDayStart(new Date('2026-01-01T00:00:00Z')).toISOString(),'2025-12-31T21:00:00.000Z');
});
test('daily batches drain all sources, skip successful ones, respect failure backoff and pending jobs',async()=>{
  const ids=Array.from({length:4},(_,i)=>`daily-${tag()}-${i}`);
  const saved=process.env.COLLECT_SOURCE_IDS, kinds=process.env.COLLECT_KINDS;
  process.env.COLLECT_SOURCE_IDS=ids.join(',');process.env.COLLECT_KINDS='rss';
  const boss=await getBoss();
  const parked=await sql<{id:string;start_after:Date}[]>`SELECT id,start_after FROM pgboss.job WHERE name=${QUEUES.fetchSource} AND state IN ('created','retry')`;
  if(parked.length) await sql`UPDATE pgboss.job SET start_after='2100-01-01' WHERE id=ANY(${parked.map(j=>j.id)}::uuid[])`;
  try {
    for(const id of ids) await sql`INSERT INTO sources(id,name,kind,enabled) VALUES (${id},'Daily test','rss',true)`;
    await sql`UPDATE sources SET last_ok_at=now() WHERE id=${ids[0]!}`;
    await sql`UPDATE sources SET last_fetch_at=now(),next_fetch_at=now()+interval '1 hour',last_error='HTTP 429' WHERE id=${ids[1]!}`;
    assert.equal((await scheduleDueSources(1,{daily:true})).enqueued,1);
    assert.equal((await scheduleDueSources(1,{daily:true})).enqueued,1);
    assert.equal((await scheduleDueSources(1,{daily:true})).enqueued,0);
    const jobs=await sql<{id:string;data:{sourceId:string}}[]>`SELECT id,data FROM pgboss.job WHERE name=${QUEUES.fetchSource} AND data->>'sourceId'=ANY(${ids})`;
    assert.deepEqual(new Set(jobs.map(j=>j.data.sourceId)),new Set(ids.slice(2)));
    for(const j of jobs) await boss.cancel(QUEUES.fetchSource,j.id);
    // Rolling mode revisits a successful source once due, while still honoring failure backoff.
    assert.equal((await scheduleDueSources(1)).enqueued,1);
    const rolling=await sql<{data:{sourceId:string}}[]>`SELECT data FROM pgboss.job WHERE name=${QUEUES.fetchSource} AND state='created' AND data->>'sourceId'=ANY(${ids})`;
    assert.equal(rolling[0]?.data.sourceId,ids[0]);
    await sql`UPDATE sources SET next_fetch_at=now()-interval '1 minute' WHERE id=ANY(${ids.slice(2)})`;
    assert.equal((await scheduleDueSources(1)).enqueued,1);
    assert.equal((await scheduleDueSources(1)).enqueued,0,'rolling queue is bounded at twice the batch size');
    await sql`DELETE FROM pgboss.job WHERE name=${QUEUES.fetchSource} AND data->>'sourceId'=ANY(${ids})`;
  } finally {
    for(const j of parked) await sql`UPDATE pgboss.job SET start_after=${j.start_after} WHERE id=${j.id}`;
    if(saved===undefined) delete process.env.COLLECT_SOURCE_IDS;else process.env.COLLECT_SOURCE_IDS=saved;
    if(kinds===undefined) delete process.env.COLLECT_KINDS;else process.env.COLLECT_KINDS=kinds;
  }
});
