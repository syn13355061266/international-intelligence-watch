import { stub } from "./setup.ts";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { after, test, mock } from "node:test";
import { zstdDecompressSync } from "node:zlib";
import { z } from "zod";
import { sql, closeDb } from "@aihot/backend/db";
import { config } from "@aihot/backend/config";
import { encryptCredential, decryptCredential, saveConnection, connectionsOverview, activateConnection, deleteConnection, activeConnection, loginStatus, startLogin, answerLogin, cancelLogin, connectionRuntime, uniqueModelOptions, queueConnectionTask } from "@aihot/backend/providers/model-connections";
import { runConnectionTask } from "@aihot/backend/jobs/model-connections";
import { chatJson } from "@aihot/backend/providers/llm";
import { buildApp } from "../apps/api/src/app.ts";
import { stopBoss } from "@aihot/backend/jobs/queue";

after(async () => { await sql`DELETE FROM model_connections`; await stopBoss(); await closeDb(); });
test("encrypted credentials are bound to their profile and authenticated", () => {
  const value = { type: "api_key" as const, key: "sensitive-test-token" };
  const a = encryptCredential(value, "profile-a"), b = encryptCredential(value, "profile-a");
  assert.notEqual(a, b); assert.ok(!a.includes(value.key));
  assert.deepEqual(decryptCredential(a, "profile-a"), value);
  assert.throws(() => decryptCredential(a, "profile-b"));
  assert.throws(() => decryptCredential(a.slice(0, -5) + "xxxxx", "profile-a"));
});
test("API Key is absent from list and audit, activation is exclusive, and removing a profile clears default", async () => {
  const key = "private-api-key-do-not-disclose";
  const a = await saveConnection({ name: "测试 DeepSeek", provider: "deepseek", authMode: "api_key", modelId: "deepseek-flash", apiKey: key }, "connections-test");
  const b = await saveConnection({ name: "测试订阅", provider: "openai", authMode: "oauth", modelId: "gpt-5.4" }, "connections-test");
  try {
    const list = await connectionsOverview(); assert.ok(!JSON.stringify(list).includes(key));
    assert.ok(list.providers.some((p) => p.id === "openai" && p.oauth && p.subscription));
    const [stored] = await sql`SELECT credential FROM model_connections WHERE id=${a.id}`;
    assert.ok(stored!.credential && !stored!.credential.includes(key));
    const audits = await sql`SELECT before,after FROM audit_log WHERE actor='connections-test'`;
    assert.ok(!JSON.stringify(audits).includes(key));
    await assert.rejects(activateConnection(b.id, "connections-test"), /登录/);
    await activateConnection(a.id, "connections-test"); assert.equal((await activeConnection())?.id, a.id);
    await deleteConnection(a.id, "connections-test"); assert.equal(await activeConnection(), null);
  } finally { await sql`DELETE FROM model_connections WHERE id IN (${a.id},${b.id})`; }
});
test("unsupported models and unsafe endpoints are rejected before storing credentials", async () => {
  await assert.rejects(saveConnection({ name: "坏模型", provider: "deepseek", authMode: "api_key", modelId: "made-up", apiKey: "x" }, "test"), /目录/);
  for (const baseUrl of ["http://example.com/v1", "https://user:password@example.com/v1", "https://example.com/v1?key=secret", "https://127.0.0.1/v1", "https://169.254.169.254/v1"]) {
    await assert.rejects(saveConnection({ name: "坏地址", provider: "custom", authMode: "api_key", modelId: "model", apiKey: "x", baseUrl }, "test"));
  }
  assert.throws(() => loginStatus("unknown-login", "other-admin"), /过期/);
});
test("subscription login bridges notifications and prompts, enforces ownership, and persists encrypted tokens", async () => {
  const c = await saveConnection({ name: "模拟订阅", provider: "openai", authMode: "oauth", modelId: "gpt-5.4" }, "owner");
  try {
    const session = await startLogin(c.id, "owner", (row) => {
      const models = connectionRuntime(row), provider = models.getProvider("openai")!;
      models.setProvider({ ...provider, auth: { ...provider.auth, oauth: { ...provider.auth.oauth!, async login(interaction, options) {
        assert.match(options!.getDeviceId!(), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/);
        interaction.notify({ type: "auth_url", url: "https://example.com/authorize" });
        const code = await interaction.prompt({ type: "manual_code", message: "模拟回调链接" });
        assert.equal(code, "stub-callback");
        return { type: "oauth", access: "private-access", refresh: "private-refresh", expires: Date.now() + 60_000 };
      } } } }); return models;
    });
    for (let i = 0; i < 50 && !loginStatus(session.id, "owner").prompt; i++) await new Promise((resolve) => setTimeout(resolve, 10));
    const status = loginStatus(session.id, "owner"); assert.ok(status.prompt); assert.equal(status.events[0]!.type, "auth_url");
    assert.throws(() => loginStatus(session.id, "other-admin"), /不存在/);
    assert.throws(() => cancelLogin(session.id, "other-admin"), /不存在/);
    assert.throws(() => answerLogin(session.id, { promptId: "stale", value: "stub-callback" }, "owner"), /结束/);
    answerLogin(session.id, { promptId: status.prompt!.id, value: "stub-callback" }, "owner");
    for (let i = 0; i < 50 && loginStatus(session.id, "owner").status === "pending"; i++) await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(loginStatus(session.id, "owner").status, "complete");
    const [stored] = await sql`SELECT credential FROM model_connections WHERE id=${c.id}`;
    assert.ok(!stored!.credential.includes("private-access"));
    assert.equal(decryptCredential(stored!.credential, c.id).type, "oauth");
    assert.ok(!JSON.stringify(await connectionsOverview()).includes("private-refresh"));
  } finally { await deleteConnection(c.id, "owner"); }
});
test("model configuration API requires an admin session and CSRF on mutations", async () => {
  const old = config.devAdmin; config.devAdmin = null;
  const app = await buildApp();
  try {
    assert.equal((await app.inject({ method: "GET", url: "/api/admin/model-connections" })).statusCode, 401);
    config.devAdmin = { displayName: "Connection Test" };
    assert.equal((await app.inject({ method: "GET", url: "/api/admin/model-connections" })).statusCode, 200);
    assert.equal((await app.inject({ method: "POST", url: "/api/admin/model-connections", payload: {} })).statusCode, 403);
    assert.equal((await app.inject({ method: "POST", url: "/api/admin/model-connections", headers: { "x-csrf-token": "dev" }, payload: {} })).statusCode, 400);
    const c = await saveConnection({ name: "删除回归", provider: "deepseek", authMode: "api_key", modelId: "deepseek-flash", apiKey: "stub-key" }, "test");
    const removed = await app.inject({ method: "DELETE", url: `/api/admin/model-connections/${c.id}`, headers: { "x-csrf-token": "dev" } });
    assert.equal(removed.statusCode, 200, "bodyless DELETE must omit content-type JSON");
    const [stored] = await sql`SELECT id FROM model_connections WHERE id=${c.id}`;
    assert.equal(stored, undefined);
  } finally { config.devAdmin = old; await app.close(); }
});
test("model options collapse casing aliases without merging distinct model versions", () => {
  assert.deepEqual(uniqueModelOptions([{ id: "gpt-model", name: "GPT model" }, { id: "GPT-MODEL", name: "GPT model" }, { id: "gpt-model-2", name: "GPT model 2" }]).map((m) => m.id), ["gpt-model", "gpt-model-2"]);
});
test("a successful browser callback followed by a token exchange failure remains an actionable failed grant", async () => {
  const c = await saveConnection({ name: "模拟令牌错误", provider: "openai", authMode: "oauth", modelId: "gpt-5.4" }, "owner");
  try {
    const session = await startLogin(c.id, "owner", (row) => {
      const models = connectionRuntime(row), provider = models.getProvider("openai")!;
      models.setProvider({ ...provider, auth: { ...provider.auth, oauth: { ...provider.auth.oauth!, async login(interaction) {
        interaction.notify({ type: "progress", message: "Exchanging authorization code for tokens..." });
        throw new Error("fetch failed: private-callback-code");
      } } } }); return models;
    });
    for (let i = 0; i < 50 && loginStatus(session.id, "owner").status === "pending"; i++) await new Promise((resolve) => setTimeout(resolve, 10));
    const state = loginStatus(session.id, "owner"); assert.equal(state.status, "failed");
    assert.match(state.error!, /后端连接/); assert.ok(!JSON.stringify(state).includes("private-callback-code"));
    const overview = await connectionsOverview(), saved = overview.connections.find((x) => x.id === c.id)!;
    assert.equal(saved.configured, false); assert.match(saved.loginError!, /后端连接/);
  } finally { await deleteConnection(c.id, "owner"); }
});
test("worker verification is queued once, uses a paid receipt, and records actual successful inference", async () => {
  const id = randomUUID(), server = await stub(() => ({ choices: [{ message: { content: '{"ok":true}' } }], usage: { prompt_tokens: 4, completion_tokens: 2 } }));
  const oldCalls = config.modelCallsEnabled, oldPrivate = config.allowPrivateNetworkFetch;
  try {
    await sql`INSERT INTO model_connections (id,name,provider,auth_mode,model_id,base_url,credential) VALUES (${id},'verification stub','custom','api_key','stub-model',${server.url},${encryptCredential({ type: "api_key", key: "local-stub-only" }, id)})`;
    config.modelCallsEnabled = true; config.allowPrivateNetworkFetch = true;
    const tasks = await Promise.all([queueConnectionTask(id,"verify","test"),queueConnectionTask(id,"verify","test")]);
    assert.equal(tasks[0]!.id, tasks[1]!.id); assert.equal(server.hits(),0,"admin queuing never performs inference");
    await runConnectionTask(tasks[0]!.id); await runConnectionTask(tasks[0]!.id);
    assert.equal(server.hits(),1);
    const [row] = await sql`SELECT status,detail FROM model_connection_tasks WHERE id=${tasks[0]!.id}`;
    assert.equal(row!.status,"complete"); assert.ok(row!.detail.receiptId);
    const [connection] = await sql`SELECT verified_at FROM model_connections WHERE id=${id}`; assert.ok(connection!.verified_at);
  } finally { config.modelCallsEnabled=oldCalls; config.allowPrivateNetworkFetch=oldPrivate; await deleteConnection(id,"test"); await server.close(); }
});
test("saving and enabling a connection never invokes inference; disabled calls remain blocked", async () => {
  const c = await saveConnection({ name: "安全阀测试", provider: "deepseek", authMode: "api_key", modelId: "deepseek-flash", apiKey: "never-call-this-key" }, "test");
  const old = config.modelCallsEnabled;
  try {
    const [before] = await sql`SELECT count(*)::int AS n FROM receipt_attempts`;
    await activateConnection(c.id, "test"); config.modelCallsEnabled = false;
    await assert.rejects(chatJson({ model: "default", purpose: "connection-test", subject: "test", promptVersion: "test", system: "JSON", user: "test", schema: z.object({ ok: z.boolean() }) }), /disabled/);
    const [after] = await sql`SELECT count(*)::int AS n FROM receipt_attempts`;
    assert.equal(after!.n, before!.n);
  } finally { config.modelCallsEnabled = old; await deleteConnection(c.id, "test"); }
});
test("Codex subscription inference omits unsupported temperature and accepts the SSE answer", async () => {
  const c = await saveConnection({ name: "Codex protocol stub", provider: "openai-codex", authMode: "oauth", modelId: "gpt-6-sol" }, "test");
  const oldCalls = config.modelCallsEnabled;
  const access = `stub.${Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "stub-account" } })).toString("base64url")}.stub`;
  let hits = 0;
  const fetchStub = mock.method(globalThis, "fetch", async (_url: unknown, options: RequestInit) => {
    hits++;
    const headers = new Headers(options.headers);
    const bytes = typeof options.body === "string" ? Buffer.from(options.body) : Buffer.from(options.body as Uint8Array);
    const body = JSON.parse((headers.get("content-encoding") === "zstd" ? zstdDecompressSync(bytes) : bytes).toString());
    assert.equal(body.model, "gpt-6-sol"); assert.equal(Object.hasOwn(body, "temperature"), false);
    const events = [
      { type: "response.output_item.added", output_index: 0, item: { type: "message", id: "stub-msg", role: "assistant", content: [] } },
      { type: "response.output_text.delta", output_index: 0, delta: '{"ok":true}' },
      { type: "response.completed", response: { status: "completed", output: [], usage: { input_tokens: 4, output_tokens: 2 } } },
    ];
    return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""), { headers: { "content-type": "text/event-stream" } });
  });
  try {
    await sql`UPDATE model_connections SET credential=${encryptCredential({ type: "oauth", access, refresh: "stub-refresh", expires: Date.now()+600_000 }, c.id)} WHERE id=${c.id}`;
    config.modelCallsEnabled = true;
    const result = await chatJson({ connectionId: c.id, model: "default", purpose: "codex-protocol-test", subject: `connection:${c.id}`, promptVersion: "test", system: "Return JSON", user: "Test", schema: z.object({ ok: z.boolean() }), temperature: 0.2 });
    assert.deepEqual(result.data, { ok: true }); assert.equal(hits, 1);
  } finally { fetchStub.mock.restore(); config.modelCallsEnabled = oldCalls; await deleteConnection(c.id, "test"); }
});
test("the worker default connection reaches a local stub through receipts and reuses a completed response", async () => {
  const id = randomUUID(), key = "stub-only-private-key", subject = `connection:${id}`;
  const server = await stub((_hit, req) => {
    const body = JSON.parse(req.body); assert.equal(body.model, "stub-connection");
    return { choices: [{ message: { content: '{"ok":true}' } }], usage: { prompt_tokens: 3, completion_tokens: 2 } };
  });
  const oldCalls = config.modelCallsEnabled, oldPrivate = config.allowPrivateNetworkFetch;
  try {
    // Only tests insert a local endpoint directly. The admin configuration API rejects it.
    await sql`INSERT INTO model_connections (id,name,provider,auth_mode,model_id,base_url,credential,active) VALUES (${id},'stub','custom','api_key','stub-connection',${server.url},${encryptCredential({ type: "api_key", key }, id)},true)`;
    config.modelCallsEnabled = true; config.allowPrivateNetworkFetch = true;
    const opts = { model: "default", purpose: "connection-test", subject, promptVersion: "test", system: "Return JSON", user: "Are you ready?", schema: z.object({ ok: z.boolean() }) };
    const first = await chatJson(opts), second = await chatJson(opts);
    assert.deepEqual(first.data, { ok: true }); assert.equal(first.receiptId, second.receiptId);
    assert.equal(second.reused, true); assert.equal(server.hits(), 1);
    const [receipt] = await sql`SELECT service,request FROM receipts WHERE id=${first.receiptId}`;
    assert.equal(receipt!.service, "llm"); assert.ok(!JSON.stringify(receipt).includes(key));
    const [attempt] = await sql`SELECT usage FROM receipt_attempts WHERE receipt_id=${first.receiptId}`;
    assert.equal(attempt!.usage.prompt_tokens, 3);
  } finally { config.modelCallsEnabled = oldCalls; config.allowPrivateNetworkFetch = oldPrivate; await sql`DELETE FROM model_connections WHERE id=${id}`; await server.close(); }
});
