// Revisit only decisions made with the obsolete prefilter. No model requests in this script:
// the existing worker safety sweep drains the staggered work under the normal budgets.
import { sql, closeDb } from '@aihot/backend/db';
import { PROMPT_VERSIONS } from '@aihot/backend/editorial/analyze';
import { audit } from '@aihot/backend/audit';
try {
  const rows = await sql<{id:string}[]>`
    SELECT a.id FROM articles a JOIN sources s ON s.id=a.source_id
    JOIN LATERAL (SELECT prompt_version FROM analyses n WHERE n.article_id=a.id ORDER BY n.id DESC LIMIT 1) n ON true
    WHERE a.processing_state='blocked' AND s.enabled AND s.participation_mode='editorial'
      AND coalesce(n.prompt_version,'') NOT LIKE ${`%${PROMPT_VERSIONS.prefilter}%`}
    ORDER BY a.discovered_at DESC LIMIT 500`;
  if (!process.argv.includes('--apply')) console.log({mode:'preview',candidates:rows.length});
  else {
    await sql.begin(async tx=>{
      for (const [i,row] of rows.entries()) await tx`UPDATE articles SET processing_state='new',processing_attempts=0,
        processing_error=NULL,processing_queued_at=NULL,processing_retry_at=now()+make_interval(mins=>${i*2}),
        processing_attempt_tag='national-security-scope-2026-10-11' WHERE id=${row.id} AND processing_state='blocked'`;
      await audit('maintenance:2026-10-11','content.requeue-scope','articles','十领域预筛替换旧四专题预筛',null,{count:rows.length,spacingMinutes:2},{db:tx});
    });
    console.log({requeued:rows.length,spacingMinutes:2});
  }
} finally { await closeDb(); }
