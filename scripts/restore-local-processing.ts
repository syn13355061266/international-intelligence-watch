// Restore the upstream processing pace on a loopback installation. No model calls or collection.
// A full local database snapshot and dotenv backup are mandatory before applying the profile.
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { config, REPO_ROOT } from '@aihot/backend/config';
import { sql, closeDb } from '@aihot/backend/db';
import { audit } from '@aihot/backend/audit';
import { getBoss, stopBoss } from '@aihot/backend/jobs/queue';
import { refreshContentPriorities, queueProcessing } from '@aihot/backend/jobs/content';
import { recoverStaleWork } from '@aihot/backend/operations/recover';
import { publishArticle } from '@aihot/backend/publication/publish';
import { fourForeignTags } from '@aihot/industry/four-foreign';
import { cjkRatio } from '@aihot/backend/lib/text';

const profile: Record<string, string> = {
  COLLECT_ENABLED:'true', MODEL_CALLS_ENABLED:'true', COLLECT_SCHEDULE:'rolling',
  COLLECT_KINDS:'rss,web_list,json_list', COLLECT_SOURCE_IDS:'', COLLECT_SKIP_JINA:'true', JINA_BODY_FALLBACK:'false',
  FETCH_SCHEDULE_BATCH:'40', FETCH_CONCURRENCY:'8', FETCH_SPACING_MS:'0', EXTRACT_CONCURRENCY:'4', ANALYZE_CONCURRENCY:'6',
  MODEL_MAX_CONCURRENCY:'12', MODEL_MIN_SPACING_MS:'0', MODEL_REASONING_LEVEL:'low',
  TRANSLATE_SCOPE:'published', TRANSLATE_BATCH:'30', TRANSLATE_CONCURRENCY:'2', LOCAL_FULLTEXT_PREVIEW:'true',
  WEB_HOST:'127.0.0.1', API_HOST:'127.0.0.1',
  FEISHU_CONTENT_PUSH_ENABLED:'false', FEISHU_INTERNAL_ENABLED:'false', INDEXNOW_SUBMIT_ENABLED:'false',
};

try {
  const dbUrl = new URL(config.databaseUrl);
  if (!['localhost','127.0.0.1','[::1]'].includes(dbUrl.hostname) || process.env.RAILWAY_ENVIRONMENT_ID) throw new Error('This script only changes a local database.');
  if (!process.argv.includes('--apply')) {
    console.log(JSON.stringify({mode:'preview',profile,budget:{perMinute:100,perHour:2000,perDay:20000}},null,2));
  } else {
    const backupDir = path.join(REPO_ROOT,'.data','backups');
    mkdirSync(backupDir,{recursive:true});
    const stamp = new Date().toISOString().replace(/[:.]/g,'-');
    const dump = path.join(backupDir,`before-processing-restore-${stamp}.dump`);
    const bundled = ['../.intelwatch-work/postgres-runtime/bin/pg_dump.exe','../.intelwatch-work/public-host/pg-clients/pg_dump.exe'].map(p=>path.resolve(REPO_ROOT,p)).find(existsSync);
    const pgDump = process.env.PG_DUMP_PATH || bundled || 'pg_dump';
    console.log('Saving local database snapshot...');
    const backup = spawnSync(pgDump,['--format=custom','--file',dump],{
      env:{...process.env,PGHOST:dbUrl.hostname,PGPORT:dbUrl.port||'5432',PGUSER:decodeURIComponent(dbUrl.username),PGPASSWORD:decodeURIComponent(dbUrl.password),PGDATABASE:decodeURIComponent(dbUrl.pathname.slice(1))},
      windowsHide:true,encoding:'utf8',timeout:600_000,
    });
    if(backup.status!==0) throw new Error(`Database backup failed: ${backup.error?.message ?? backup.stderr}`);
    const envPath=path.join(REPO_ROOT,'.env');
    copyFileSync(envPath,path.join(backupDir,`before-processing-restore-${stamp}.env`));
    let dotenv=readFileSync(envPath,'utf8');
    for(const [key,value] of Object.entries(profile)) {
      const line=`${key}=${value}`;
      const re=new RegExp(`^${key}=.*$`,'m');
      dotenv=re.test(dotenv)?dotenv.replace(re,line):`${dotenv.trimEnd()}\n${line}\n`;
    }
    writeFileSync(envPath,dotenv);
    const seed=spawnSync(process.execPath,['--env-file=.env','scripts/seed.ts','--prune-topics'],{cwd:REPO_ROOT,env:{...process.env,COLLECT_ENABLED:'false',MODEL_CALLS_ENABLED:'false'},windowsHide:true,encoding:'utf8'});
    if(seed.status!==0) throw new Error(`Seed failed: ${seed.stderr}`);
    console.log(seed.stdout.trim());
    const budget=await sql.begin(async tx=>{
      const [before]=await tx`SELECT per_minute,per_hour,per_day FROM budgets WHERE service='llm' FOR UPDATE`;
      const known=!before || [[6,120,1000],[12,300,3000]].some(([m,h,d])=>before.per_minute===m&&before.per_hour===h&&before.per_day===d);
      if(!known) return {changed:false,reason:'existing custom budget preserved',limits:before};
      await tx`INSERT INTO budgets(service,per_minute,per_hour,per_day,note) VALUES('llm',100,2000,20000,'上游默认模型熔断；次数保护，不代表订阅额度或费用')
        ON CONFLICT(service) DO UPDATE SET per_minute=100,per_hour=2000,per_day=20000,note=EXCLUDED.note,updated_at=now()`;
      await audit('maintenance:upstream-restore','budget.update','budget:llm','恢复上游模型预算熔断',before??null,{per_minute:100,per_hour:2000,per_day:20000},{db:tx});
      return {changed:true};
    });
    await getBoss();
    const publications=await sql<{article_id:string}[]>`SELECT article_id FROM publications`;
    let changed=0;
    for(const row of publications) if((await publishArticle(row.article_id))?.changed) changed++;
    const blocked=await sql<{id:string;text:string}[]>`SELECT id,concat_ws(' ',title,body_text,excerpt) AS text FROM articles WHERE processing_state='blocked'`;
    let requeued=0;
    for(const row of blocked.filter(row=>fourForeignTags(row.text).length)) {
      await sql`UPDATE articles SET processing_state='new',processing_attempts=0,processing_error=NULL,processing_retry_at=NULL,processing_queued_at=NULL,processing_attempt_tag='four-foreign-scope-20261030' WHERE id=${row.id}`;
      await queueProcessing(row.id); requeued++;
    }
    const translations=await sql<{article_id:string;body_text:string}[]>`SELECT article_id,body_text FROM translations WHERE origin<>'source'`;
    let invalid=0;
    for(const row of translations) if(cjkRatio(row.body_text??'')<0.1) {
      await sql`UPDATE translations SET complete=false WHERE article_id=${row.article_id} AND origin<>'source'`;
      await sql`DELETE FROM translation_attempts WHERE article_id=${row.article_id}`; invalid++;
    }
    const reset=await sql`DELETE FROM translation_attempts WHERE outcome='skipped' AND reason IN ('no batch translated','no translatable text','already Chinese','no foreign-language body')`;
    await sql`UPDATE articles SET processing_retry_at=NULL WHERE processing_state='new' AND processing_error LIKE 'Budget for llm exhausted%'`;
    const recovered=await recoverStaleWork();
    const priorities=await refreshContentPriorities();
    const result={backup:dump,budget,publicationsRebuilt:publications.length,publicationsChanged:changed,fourForeignRequeued:requeued,invalidTranslations:invalid,languageSkipsReset:reset.count,recovered,priorities};
    await audit('maintenance:upstream-restore','processing.restore','local','本地恢复上游采集处理并启用个人试阅',null,{...result,backup:path.basename(dump)},{ });
    console.log(JSON.stringify(result,null,2));
  }
} finally { await stopBoss(); await closeDb(); }
