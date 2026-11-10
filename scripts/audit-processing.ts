// Read-only local processing report. Never prints credentials or provider response bodies.
import { sql, closeDb } from '@aihot/backend/db';

const safeNames = ['COLLECT_ENABLED', 'MODEL_CALLS_ENABLED', 'COLLECT_SCHEDULE', 'COLLECT_KINDS', 'FETCH_SCHEDULE_BATCH', 'FETCH_CONCURRENCY', 'FETCH_SPACING_MS', 'EXTRACT_CONCURRENCY', 'ANALYZE_CONCURRENCY', 'MODEL_MIN_SPACING_MS', 'MODEL_MAX_CONCURRENCY', 'TRANSLATE_SCOPE', 'TRANSLATE_BATCH', 'TRANSLATE_CONCURRENCY', 'DATABASE_POOL_MAX', 'WEB_PORT', 'API_PORT'];
try {
  const report = {
    at: new Date().toISOString(),
    environment: Object.fromEntries(safeNames.map(name => [name, process.env[name] ?? '(default)'])),
    articles: await sql`SELECT processing_state, body_status, count(*)::int AS n FROM articles GROUP BY 1,2 ORDER BY 1,2`,
    queue: await sql`SELECT name, state, count(*)::int AS n, min(created_on) AS oldest FROM pgboss.job WHERE state IN ('created','retry','active') GROUP BY 1,2 ORDER BY 1,2`,
    budgets: await sql`SELECT service, per_minute, per_hour, per_day FROM budgets ORDER BY service`,
    connections: await sql`SELECT provider, auth_mode, model_id, active, credential IS NOT NULL AS configured FROM model_connections`,
    heartbeats: await sql`SELECT key, value->>'at' AS at FROM settings WHERE key LIKE 'heartbeat.%'`,
    receipts: await sql`SELECT r.purpose, a.status, count(*)::int AS n, round(avg(a.latency_ms))::int AS avg_ms FROM receipt_attempts a JOIN receipts r ON r.id=a.receipt_id WHERE a.started_at > now()-interval '24 hours' GROUP BY 1,2 ORDER BY 1,2`,
    failures: await sql`SELECT left(processing_error,180) AS error, count(*)::int AS n FROM articles WHERE processing_state='failed' GROUP BY 1 ORDER BY 2 DESC LIMIT 12`,
    translations: await sql`SELECT p.body_mode, count(*)::int AS published, count(*) FILTER(WHERE p.eligible)::int AS eligible, count(*) FILTER(WHERE p.selected)::int AS selected, count(tr.article_id)::int AS translated, count(*) FILTER(WHERE tr.complete)::int AS complete FROM publications p LEFT JOIN translations tr ON tr.article_id=p.article_id AND tr.lang='zh' GROUP BY 1`,
    translationAttempts: await sql`SELECT outcome, reason, count(*)::int AS n FROM translation_attempts GROUP BY 1,2 ORDER BY 3 DESC LIMIT 20`,
    translationLanguages: await sql`SELECT article_id, complete, length(body_text)::int AS chars, length(regexp_replace(coalesce(body_text,''),'[^一-鿿]','','g'))::int AS han FROM translations WHERE origin <> 'source' ORDER BY created_at DESC LIMIT 20`,
    topics: await sql`SELECT t.slug, t.name, t.grp, t.tags, count(p.article_id) FILTER(WHERE p.eligible AND p.visibility='public')::int AS eligible, count(p.article_id) FILTER(WHERE p.selected AND p.visibility='public')::int AS selected FROM topics t LEFT JOIN publications p ON p.tags && t.tags GROUP BY t.slug ORDER BY t.position`,
  };
  console.log(JSON.stringify(report, null, 2));
} finally {
  await closeDb();
}
