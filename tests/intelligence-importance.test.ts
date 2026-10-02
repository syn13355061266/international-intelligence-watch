import { test } from "node:test";
import assert from "node:assert/strict";
import { computeImportance, type ImportanceEvidence } from "@aihot/industry/intelligence";
import { parseTelegram } from "../packages/backend/src/sources/telegram.ts";
import { unsupportedConfig } from "../packages/backend/src/sources/config-keys.ts";
import { readFileSync } from "node:fs";
const at = new Date("2026-10-01T12:00:00Z");
const evidence = (key: string, tier = 1): ImportanceEvidence => ({publisherKey:key,sourceTier:tier,firstParty:false,publishedAt:at,labels:{severity:"critical",historical:false,diplomacyFlashpoint:false,entityAction:null}});
test("importance follows 55/20/15/10 and exposes its evidence", () => {
  const r = computeImportance([evidence("a")],at);
  assert.equal(r.score,88); assert.equal(r.base,88); assert.equal(r.independentPublishers,1);
  assert.equal(computeImportance([evidence("a"),evidence("a")],at).score,88);
  assert.equal(computeImportance([evidence("a"),evidence("b")],at).score,91);
});
test("undated, stale and future observations never gain fresh crisis importance", () => {
  for(const date of [null,new Date("2025-10-01"),new Date("2026-10-02")]) {
    const r=computeImportance([{...evidence("a"),publishedAt:date}],at);
    assert.equal(r.score,0); assert.equal(r.coverage,"unclassified");
  }
  const old=computeImportance([{...evidence("a"),labels:{severity:"critical",historical:true,diplomacyFlashpoint:true,entityAction:"oil:export-ban"}}],at);
  assert.equal(old.severity,"info"); assert.equal(old.diplomacyBonus,0);
});
test("unverified claims are capped; bonus requires independent matching entity/action", () => {
  assert.equal(computeImportance([evidence("telegram",4)],at).severity,"medium");
  const event=(key:string)=>({...evidence(key),labels:{severity:"medium" as const,historical:false,diplomacyFlashpoint:true,entityAction:"oil:export-ban"}});
  assert.equal(computeImportance([event("a"),event("a")],at).diplomacyBonus,0);
  const r=computeImportance([event("a"),event("b"),event("c")],at);
  assert.equal(r.severity,"high"); assert.equal(r.diplomacyBonus,18); assert.equal(r.entityBonus,12);
  const other={...event("b"),labels:{...event("b").labels,entityAction:"oil:new-deal"}};
  assert.equal(computeImportance([event("a"),other],at).entitySources,1);
});
test("Telegram parser accepts only dated messages from the configured public channel", () => {
  const html='<div class="tgme_widget_message" data-post="channel/42"><div class="tgme_widget_message_text">Oil export restriction</div><time datetime="2026-10-01T10:00:00Z"></time></div><div class="tgme_widget_message" data-post="other/43"><div class="tgme_widget_message_text">Other</div></div>';
  const rows=parseTelegram(html,"https://t.me/s/channel");
  assert.equal(rows.length,1); assert.equal(rows[0]!.url,"https://t.me/channel/42");
  assert.equal(rows[0]!.publishedAt!.toISOString(),"2026-10-01T10:00:00.000Z");
});
test("every seeded source has a unique id, supported configuration and no fulltext permission", () => {
  const data=JSON.parse(readFileSync(new URL("../industry/sources.json",import.meta.url),"utf8"));
  assert.equal(new Set(data.sources.map((s:any)=>s.id)).size,data.sources.length);
  for(const s of data.sources) { assert.deepEqual(unsupportedConfig(s.kind,s.config),[],s.id); assert.equal(s.site_fulltext,false,s.id); }
});
