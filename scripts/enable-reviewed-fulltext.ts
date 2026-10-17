// Explicit operation, separate from seeding: only the reviewed sources receive a site licence.
// Every change is audited and re-publication runs through the normal worker queue.
import fs from 'node:fs';
import { sql, closeDb } from '@aihot/backend/db';
import { updateSource } from '@aihot/backend/admin/sources';
import { stopBoss } from '@aihot/backend/jobs/queue';
const permissions = JSON.parse(fs.readFileSync(new URL('../industry/fulltext-permissions.json', import.meta.url), 'utf8')) as {sources:Array<{ids:string[];policy:string;attribution:string}>};
try {
  for (const entry of permissions.sources) for (const id of entry.ids) {
    const [s] = await sql<{updated_at:Date;site_fulltext:boolean}[]>`SELECT updated_at,site_fulltext FROM sources WHERE id=${id}`;
    if (!s) { console.log(`${id}: not seeded`); continue; }
    if (s.site_fulltext) continue;
    await updateSource(id,{patch:{site_fulltext:true},version:s.updated_at.toISOString(),reason:`Reviewed 2026-10-11: ${entry.policy} — ${entry.attribution}`},'maintenance:reviewed-fulltext');
    console.log(`${id}: enabled; re-publication queued`);
  }
} finally { await stopBoss(); await closeDb(); }
