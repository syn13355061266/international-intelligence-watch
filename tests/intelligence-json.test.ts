import { test, after } from "node:test";
import assert from "node:assert/strict";
import { stub } from "./setup.ts";
import { config } from "@aihot/backend/config";
import { fetchJsonList } from "@aihot/backend/sources/json-list";
import type { SourceRow } from "@aihot/backend/sources/types";
const oldPrivate=config.allowPrivateNetworkFetch;
config.allowPrivateNetworkFetch=true;
after(()=>{config.allowPrivateNetworkFetch=oldPrivate;});
test("authenticated JSON observations preserve periods and units without storing API secrets",async()=>{
  process.env.INTEL_TEST_API_KEY="local-json-test-key";
  let requested="";
  const server=await stub((_hit,req)=>{requested=req.url;return {response:{data:[{period:"2026-10-01",value:"81.5",units:"USD/barrel"}]}};});
  try {
    const source: SourceRow={id:"local-json-observation",name:"Local JSON observation",kind:"json_list",tier:"T1",participation_mode:"editorial",first_party:true,interval_minutes:180,enabled:true,cursor:null,fail_count:0,config:{url:server.url+"/data?frequency=daily",credentialQuery:{api_key:"INTEL_TEST_API_KEY"},itemsPath:"response.data",titleTemplate:"Oil {raw:period}: {raw:value} {raw:units}",summaryTemplate:"Period {raw:period}; value {raw:value}; units {raw:units}",summaryIsBody:true,urlTemplate:"https://example.org/oil?period={period}",publishedAtPath:"period"}};
    const rows=await fetchJsonList(source);
    assert.match(requested,/api_key=local-json-test-key/);
    assert.equal(rows[0]!.title,"Oil 2026-10-01: 81.5 USD/barrel");
    assert.equal(rows[0]!.publishedAt!.toISOString(),"2026-10-01T00:00:00.000Z");
    assert.match(rows[0]!.bodyText!,/units USD\/barrel/);
    assert.ok(!JSON.stringify(rows).includes("local-json-test-key"));
    delete process.env.INTEL_TEST_API_KEY;
    await assert.rejects(fetchJsonList(source),/missing credential/);
  } finally {delete process.env.INTEL_TEST_API_KEY;await server.close();}
});
