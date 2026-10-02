import "./setup.ts";
import assert from "node:assert/strict";
import http from "node:http";
import { test } from "node:test";
import { config } from "@aihot/backend/config";
import { fetchRss } from "@aihot/backend/sources/rss";

test("official meeting RSS preserves future event timestamps without inventing publication dates", async () => {
  const server = http.createServer((_req, res) => {
    res.setHeader("content-type", "text/xml");
    res.end('<rss version="2.0" xmlns:a10="http://www.w3.org/2005/Atom"><channel><title>Official meetings</title><item><guid>meeting-1</guid><link>https://example.org/meeting</link><title>Upcoming international summit</title><description>Scheduled for October 24</description><a10:updated>2026-10-24T12:00:00+02:00</a10:updated></item></channel></rss>');
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const before = config.allowPrivateNetworkFetch;
  config.allowPrivateNetworkFetch = true;
  try {
    const { candidates } = await fetchRss({ config: { feedUrl: `http://127.0.0.1:${(server.address() as {port:number}).port}` }, participation_mode: "editorial" } as never);
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0]!.publishedAt, null);
    assert.equal((candidates[0]!.raw as Record<string, unknown>).feedUpdated, "2026-10-24T12:00:00+02:00");
    assert.match(candidates[0]!.excerpt!, /October 24/);
  } finally {
    config.allowPrivateNetworkFetch = before;
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
