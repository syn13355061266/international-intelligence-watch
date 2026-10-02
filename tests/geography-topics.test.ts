import { tag } from "./setup.ts";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { readFileSync } from "node:fs";
import { COUNTRIES, geographyTags } from "@aihot/industry/geography";
import { normalizeAnalysis } from "@aihot/backend/editorial/analyze";
import { upsertMaterial } from "@aihot/backend/content/materials";
import { closeDb, sql } from "@aihot/backend/db";
import { stopBoss } from "@aihot/backend/jobs/queue";
import { publishArticle } from "@aihot/backend/publication/publish";
import { loadTopicPage } from "@aihot/backend/publication/topics";

const T = tag();
const source = `geography-${T}`;
const slug = `${T}-country`;
const ids: string[] = [];
after(async () => {
  if (ids.length) {
    await sql`DELETE FROM pgboss.job WHERE data->>'articleId' = ANY(${ids}::text[])`;
    await sql`DELETE FROM selected_ledger WHERE article_id = ANY(${ids}::text[])`;
    await sql`DELETE FROM articles WHERE id = ANY(${ids}::text[])`;
  }
  await sql`DELETE FROM sources WHERE id = ${source}`;
  await sql`DELETE FROM topics WHERE slug = ${slug}`;
  await stopBoss();
  await closeDb();
});

test("country subjects aggregate across regions without inventing EU member countries", () => {
  assert.deepEqual(geographyTags(["us", "GB", "ZZ", "US"]), ["country:US", "region:019", "region:021", "region:FVE", "country:GB", "region:150", "region:154"]);
  assert.ok(geographyTags(["FR"]).includes("region:EU"));
  assert.ok(!geographyTags(["GB"]).includes("region:EU"));
  assert.deepEqual(geographyTags([], ["EU"]), ["region:EU"]);
  assert.deepEqual(new Set(geographyTags([], ["145"])), new Set(["region:145", "region:142"]));
  assert.equal(geographyTags([], ["999"]).length, 0);
});

test("country, direction and meeting labels survive the copy's shorter tags", () => {
  const output = normalizeAnalysis({
    prefilter: { label: "PASS", reason: "", model: "test", receiptId: 1, reused: false }, scores: null,
    writing: { kind: "understand", model: "test", titleZh: "美法参会", summaryZh: "原文公告", reasonZh: null, tags: ["供应链"], receiptIds: [], reused: false },
    structure: { model: "test", category: "supply-chain", tags: ["供应链", "地缘政治", "国际会议", "半导体"], subjects: [], countries: ["US", "FR"], regions: [], fact: null, receiptId: 2, reused: false },
  });
  for (const value of ["地缘政治", "国际会议", "半导体", "country:US", "country:FR", "region:EU", "region:019"]) assert.ok(output.tags.includes(value), value);
  assert.ok(!output.tags.includes("country:GB"));
  const topics = JSON.parse(readFileSync(new URL("../industry/topics.json", import.meta.url), "utf8")).topics;
  assert.equal(new Set(topics.map((t: any) => t.slug)).size, topics.length);
  assert.equal(topics.filter((t: any) => t.group === "company").length, 9);
  assert.equal(topics.filter((t: any) => t.group === "field").length, 10);
  assert.equal(topics.filter((t: any) => t.group === "genre").length, 13);
  assert.ok(topics.some((t: any) => t.tags.includes("country:TW")));
  assert.ok(geographyTags(["TW"]).includes("country:TW"));
  assert.ok(geographyTags(["IR"]).includes("region:MDE"));
});

test("country pages include ordinary latest updates but obey release, eligibility and withdrawal", async () => {
  await sql`INSERT INTO sources(id,name,kind,tier,participation_mode,next_fetch_at) VALUES(${source},'国别测试','rss','T1','editorial','2100-01-01')`;
  await sql`INSERT INTO topics(slug,name,grp,tags,definition,related,position) VALUES(${slug},'美国','company',${['country:US']},'美国最新动态',${[]},9999)`;
  const start = new Date();
  for (const kind of ["ordinary", "pending", "withdrawn", "ineligible", "other-country"]) {
    const { articleId } = await upsertMaterial({ sourceId: source, url: `https://example.test/${T}/${kind}`, title: kind, bodyText: "公告正文", bodyStatus: "ok", via: "fetch", publishedAt: start });
    ids.push(articleId);
    await sql`INSERT INTO analyses(article_id,input_revision,origin,relevance,category,title_zh,summary_zh,score,selected,tags)
      VALUES(${articleId},1,'rule','pass','supply-chain','公告标题','公告摘要',40,${kind === 'pending'},${[kind === 'other-country' ? 'country:GB' : 'country:US']})`;
    await publishArticle(articleId);
    if (kind === "withdrawn") await sql`UPDATE publications SET visibility='withdrawn' WHERE article_id=${articleId}`;
    if (kind === "ineligible") await sql`UPDATE publications SET eligible=false WHERE article_id=${articleId}`;
  }
  const before = await loadTopicPage(slug, 1, start);
  assert.equal(before!.topic.scope, "all");
  assert.equal(before!.topic.total, 1);
  assert.deepEqual(before!.items.map(i => i.id), [ids[0]]);
  const after = await loadTopicPage(slug, 1, new Date(start.getTime() + 181000));
  assert.equal(after!.topic.total, 2);
  assert.deepEqual(new Set(after!.items.map(i => i.id)), new Set([ids[0], ids[1]]));
});
