import { tag } from './setup.ts';
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { fourForeignTags, FOUR_FOREIGN_TAGS } from '@aihot/industry/four-foreign';
import { sql, closeDb } from '@aihot/backend/db';
import { stopBoss } from '@aihot/backend/jobs/queue';
import { upsertMaterial } from '@aihot/backend/content/materials';
import { publishArticle } from '@aihot/backend/publication/publish';
import { loadTopicPage } from '@aihot/backend/publication/topics';

after(async () => { await stopBoss(); await closeDb(); });

test('four-foreign membership requires explicit activities in China, not just foreign subject names', () => {
  const cases = [
    ['英国驻华大使馆举办公开交流活动', FOUR_FOREIGN_TAGS[0]],
    ['The British embassy in Beijing announces a public event.', FOUR_FOREIGN_TAGS[0]],
    ['在华外资企业公布新的投资与用工计划', FOUR_FOREIGN_TAGS[1]],
    ['Foreign companies in China publish a business survey.', FOUR_FOREIGN_TAGS[1]],
    ['法国访华代表团到访上海开展交流', FOUR_FOREIGN_TAGS[2]],
    ['A German delegation visits China for public meetings.', FOUR_FOREIGN_TAGS[2]],
    ['外国媒体记者来华开展采访调研与走访', FOUR_FOREIGN_TAGS[3]],
    ['Foreign journalists visit China for a reporting tour.', FOUR_FOREIGN_TAGS[3]],
  ];
  for (const [text, expected] of cases) assert.ok(fourForeignTags(text!).includes(expected!), text);
  for (const text of ['中国驻美国大使馆发布领事提醒', 'Chinese embassy in London hosts an event', '英国企业在法国投资', '中国代表团出访德国', '外媒在境外报道中国经济数据']) assert.deepEqual(fourForeignTags(text), [], text);
});

test('a non-selected but eligible publication reaches its technical and four-foreign topic pages', async () => {
  const id = tag(), source = `four-${id}`;
  await sql`INSERT INTO sources(id,name,kind,tier,participation_mode) VALUES(${source},'四外测试','rss','T2','editorial')`;
  const material = await upsertMaterial({sourceId:source,url:`https://example.test/${id}`,title:'外国媒体记者来华采访人工智能产业',bodyText:'外国媒体记者来华开展采访调研，了解当地人工智能产业。',bodyStatus:'ok',language:'zh',via:'fetch'});
  await sql`INSERT INTO analyses(article_id,input_revision,origin,relevance,category,title_zh,summary_zh,tags,score,selected)
    VALUES(${material.articleId},1,'rule','pass','critical-technology','外国媒体记者来华采访人工智能产业','公开采访活动',${['科技','人工智能']},40,false)`;
  await publishArticle(material.articleId);
  const slug = `four-${id}`;
  await sql`INSERT INTO topics(slug,name,grp,tags,definition,position) VALUES(${slug},'四外测试','genre',${[FOUR_FOREIGN_TAGS[3]]},'测试',9999)`;
  const page = await loadTopicPage(slug,1);
  assert.equal(page!.topic.total,1);
  assert.equal(page!.topic.scope,'all');
  assert.equal(page!.items[0]!.id,material.articleId);
  await sql`UPDATE topics SET grp='field',tags=${['人工智能']} WHERE slug=${slug}`;
  assert.equal((await loadTopicPage(slug,1))!.topic.total,1);
  await sql`UPDATE publications SET visibility='withdrawn' WHERE article_id=${material.articleId}`;
  assert.equal((await loadTopicPage(slug,1))!.topic.total,0);
});
