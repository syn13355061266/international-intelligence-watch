// Apply the operator-approved moderate model budget and reprioritize the existing backlog.
import { sql, closeDb } from '@aihot/backend/db';
import { audit } from '@aihot/backend/audit';
import { getBoss, stopBoss } from '@aihot/backend/jobs/queue';
import { refreshContentPriorities } from '@aihot/backend/jobs/content';
import { adaptIntervals } from '@aihot/backend/sources/collect';

try {
  if (!process.argv.includes('--apply')) throw new Error('Pass --apply to set the approved 12/min, 300/hour, 3000/day model budget.');
  await sql.begin(async tx => {
    const [previous] = await tx`SELECT per_minute,per_hour,per_day FROM budgets WHERE service='llm' FOR UPDATE`;
    const next = { per_minute: 12, per_hour: 300, per_day: 3000 };
    await tx`UPDATE budgets SET per_minute=12,per_hour=300,per_day=3000,
      note='滚动采集适度并发；本站上限，不代表订阅额度',updated_at=now() WHERE service='llm'`;
    await audit('maintenance:rolling-collection','budget.update','budget:llm','全天滚动采集与适度并发',previous ?? null,next,{db:tx});
    await tx`UPDATE articles SET processing_retry_at=now() WHERE processing_state='new'
      AND processing_error LIKE 'Budget for llm exhausted%' AND processing_retry_at>now()`;
  });
  await getBoss();
  console.log({ prioritiesUpdated: await refreshContentPriorities(), intervals: await adaptIntervals() });
} finally { await stopBoss(); await closeDb(); }
