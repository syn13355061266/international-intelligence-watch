import { stub, tag } from './setup.ts';
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { localPreviewEnabled } from '@aihot/contracts/local-preview';
import { config } from '@aihot/backend/config';
import { sql, closeDb } from '@aihot/backend/db';
import { stopBoss } from '@aihot/backend/jobs/queue';
import { upsertMaterial } from '@aihot/backend/content/materials';
import { publishArticle } from '@aihot/backend/publication/publish';
import { loadItemDetail } from '@aihot/backend/publication/detail';
import { translateArticle, chineseTranslationUsable } from '@aihot/backend/editorial/translate';
import { buildApp } from '../apps/api/src/app.ts';
import { isChineseText } from '@aihot/backend/lib/text';

let echo = false;
const provider = await stub((_hit, req) => {
  const segments = JSON.parse(JSON.parse(req.body).messages[1].content).segments as string[];
  return {choices:[{message:{content:JSON.stringify({t:segments.map(s=>echo?s:'这是保留原文事实、来源与日期的完整中文译文。')})}}]};
});
process.env.DEEPSEEK_BASE_URL=provider.url+'/v1'; process.env.DEEPSEEK_API_KEY='test-key';
const source = `local-reading-${tag()}`;
await sql`INSERT INTO sources(id,name,kind,tier,participation_mode,site_fulltext) VALUES(${source},'未授予公网转载许可','rss','T2','editorial',false)`;
const app = await buildApp();
after(async()=>{config.localFulltextPreview=false;await app.close();await provider.close();await stopBoss();await closeDb();});

test('local reading requires explicit opt-in, loopback URL and bindings, and is disabled on Railway',()=>{
  const env={LOCAL_FULLTEXT_PREVIEW:'true',SITE_URL:'http://localhost:3010'};
  assert.equal(localPreviewEnabled(env),true);
  for(const extra of [{SITE_URL:'https://example.com'},{WEB_HOST:'0.0.0.0'},{API_HOST:'::'},{RAILWAY_ENVIRONMENT_ID:'production'},{RAILWAY_PUBLIC_DOMAIN:'example.up.railway.app'}]) assert.equal(localPreviewEnabled({...env,...extra}),false);
});

test('English echoes are rejected while names and real Chinese translations are accepted',()=>{
  assert.equal(chineseTranslationUsable('The foreign delegation visited China yesterday.','The foreign delegation visited China yesterday.'),false);
  assert.equal(chineseTranslationUsable('The foreign delegation visited China yesterday.','外国代表团昨天访问了中国。'),true);
  assert.equal(chineseTranslationUsable('OpenAI GPT-6','OpenAI GPT-6'),true);
  assert.equal(isChineseText('CVE-2024-42009：RoundCube Webmail contains a cross-site scripting vulnerability. 中文标签'),false);
  assert.equal(isChineseText('这是一份中文公开活动报告。 OpenAI'),true);
  assert.equal(isChineseText('外国の代表団が中国を訪問しました。'),false);
});

test('private full-text translation does not change public body permissions or expose bodies to a public host',async()=>{
  const {articleId}=await upsertMaterial({sourceId:source,url:`https://example.test/${source}/body`,title:'Foreign delegation visited China',bodyText:'The foreign delegation visited China yesterday and held public meetings.',bodyHtml:'<p>The foreign delegation visited China yesterday and held public meetings.</p>',bodyStatus:'ok',language:'en',via:'fetch'});
  await sql`INSERT INTO analyses(article_id,input_revision,origin,relevance,category,title_zh,summary_zh,score,selected) VALUES(${articleId},1,'rule','pass','diplomacy-politics','代表团访华','公开会谈动态',40,false)`;
  await publishArticle(articleId);
  config.localFulltextPreview=true;
  assert.equal((await translateArticle(articleId)).status,'translated');
  assert.equal((await sql`SELECT body_mode FROM publications WHERE article_id=${articleId}`)[0]!.body_mode,'summary');
  const publicView=await loadItemDetail(articleId);
  assert.equal(publicView.kind,'found');
  if(publicView.kind==='found') assert.equal(publicView.detail.body,null);
  const local=await app.inject({url:`/api/site/items/${articleId}`,headers:{host:'localhost:3010'}});
  assert.equal(local.json().localPreview,true);
  assert.match(local.json().body.zh,/完整中文译文/);
  assert.match(String(local.headers['cache-control']),/private, no-store/);
  const remote=await app.inject({url:`/api/site/items/${articleId}`,headers:{host:'example.com'}});
  assert.equal(remote.json().localPreview,undefined);
  assert.equal(remote.json().body,null);
});

test('a failed English answer can be replaced, and Arabic and Japanese bodies are not skipped',async()=>{
  config.localFulltextPreview=true;
  for(const [suffix,text,language] of [['en','The public report describes a foreign delegation visiting China.','en'],['ar','هذا تقرير عام عن زيارة وفد أجنبي واجتماعاته في الصين.','ar'],['ja','外国の代表団が中国を訪問して公開会合に出席しました。','other']] as const){
    const materialText = `${text} ${source}`;
    const {articleId}=await upsertMaterial({sourceId:source,url:`https://example.test/${source}/${suffix}`,title:'Public visit',bodyText:materialText,bodyHtml:`<p>${materialText}</p>`,bodyStatus:'ok',language,via:'fetch'});
    if(suffix==='en'){
      echo=true;
      assert.equal((await translateArticle(articleId)).status,'failed');
      assert.equal((await sql`SELECT 1 FROM translations WHERE article_id=${articleId}`).length,0);
      echo=false;
    }
    assert.equal((await translateArticle(articleId)).status,'translated');
    const [tr]=await sql`SELECT complete,body_text FROM translations WHERE article_id=${articleId}`;
    assert.equal(tr!.complete,true);
    assert.match(tr!.body_text,/完整中文译文/);
  }
});
