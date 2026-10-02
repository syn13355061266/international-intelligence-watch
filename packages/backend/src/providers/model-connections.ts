import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import type { Credential, CredentialStore, AuthPrompt, AuthEvent, AuthOperationOptions, Models } from "@earendil-works/pi-ai";
import { sql, type Db } from "../db.ts";
import { config, credential } from "../config.ts";
import { audit } from "../audit.ts";
import { assertPublicUrl } from "../lib/url.ts";
import { guardedFetch } from "../lib/http-fetch.ts";
import { modelErrorMessage } from "./model-errors.ts";
import { enqueue, ensureQueue, QUEUES } from "../jobs/queue.ts";

const noAmbient = { env: async () => undefined, fileExists: async () => false };
const catalog = builtinModels({ authContext: noAmbient });
const schema = z.object({ name: z.string().trim().min(1).max(80), provider: z.string().min(1).max(80), authMode: z.enum(["api_key", "oauth"]), modelId: z.string().trim().min(1).max(200), baseUrl: z.string().max(500).optional(), apiKey: z.string().trim().max(4096).optional() });
export interface Connection { id: string; name: string; provider: string; auth_mode: "api_key" | "oauth"; model_id: string; base_url: string | null; credential: string | null; active: boolean; login_status?: string; login_error?: string | null; verified_at?: Date | null }
const bad = (message: string) => Object.assign(new Error(message), { statusCode: 400 });
function encryptionKey() {
  const secret = credential("auth", "MODEL_CREDENTIALS_SECRET") ?? credential("auth", "SESSION_SECRET");
  if (!secret || secret.length < 24) throw bad("请先设置至少 24 字符的 MODEL_CREDENTIALS_SECRET 或 SESSION_SECRET");
  return createHash("sha256").update(`intelligence-model-credentials-v1:${secret}`).digest();
}
export function encryptCredential(value: Credential, id: string): string {
  const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  cipher.setAAD(Buffer.from(id));
  const body = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), body].map((x) => x.toString("base64")).join(".");
}
export function decryptCredential(value: string, id: string): Credential {
  const parts = value.split(".").map((x) => Buffer.from(x, "base64"));
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), parts[0]!);
  decipher.setAAD(Buffer.from(id)); decipher.setAuthTag(parts[1]!);
  return JSON.parse(Buffer.concat([decipher.update(parts[2]!), decipher.final()]).toString("utf8")) as Credential;
}
function publicConnection(c: Connection) { return { id: c.id, name: c.name, provider: c.provider, authMode: c.auth_mode, modelId: c.model_id, baseUrl: c.base_url, configured: !!c.credential, active: c.active, loginStatus: c.credential ? "complete" : c.login_status ?? "idle", loginError: c.credential ? null : c.login_error, verifiedAt: c.verified_at?.toISOString() ?? null }; }
export function uniqueModelOptions(models: ReadonlyArray<{ id: string; name: string }>) {
  const seen = new Set<string>();
  return models.filter((m) => { const id = m.id.toLowerCase(); if (seen.has(id)) return false; seen.add(id); return true; }).map((m) => ({ id: m.id, name: m.name }));
}
export async function connectionsOverview() {
  const rows = await sql<Connection[]>`SELECT * FROM model_connections ORDER BY created_at`;
  const [heartbeat] = await sql<{ value: { at?: string } }[]>`SELECT value FROM settings WHERE key='heartbeat.worker'`;
  const [counts] = await sql`SELECT (SELECT count(*)::int FROM articles) AS articles,(SELECT count(*)::int FROM publications WHERE visibility='public') AS published`;
  const tasks = await sql`SELECT id,connection_id,kind,status,error,detail FROM model_connection_tasks ORDER BY created_at DESC LIMIT 20`;
  return { connections: rows.map(publicConnection), tasks, counts, workerOnline: Date.now() - Date.parse(heartbeat?.value.at ?? "") < 120_000, modelCallsEnabled: config.modelCallsEnabled, providers: catalog.getProviders().filter((p) => p.auth.apiKey || p.auth.oauth).map((p) => ({ id: p.id, name: p.id === "openai-codex" ? "ChatGPT / Codex 订阅" : p.id === "openai" ? "OpenAI / ChatGPT 共享" : p.name, apiKey: !!p.auth.apiKey, oauth: !!p.auth.oauth, subscription: !!p.auth.oauth?.isSubscription, models: uniqueModelOptions(p.getModels()) })) };
}
export async function saveConnection(input: unknown, actor: string) {
  const v = schema.parse(input);
  const provider = catalog.getProvider(v.provider);
  if (v.provider !== "custom" && (!provider || !catalog.getModel(v.provider, v.modelId))) throw bad("请选择该服务商目录中的模型");
  if (v.authMode === "oauth" && !provider?.auth.oauth) throw bad("该服务商不支持订阅账号登录");
  if (v.authMode === "api_key" && v.provider !== "custom" && !provider?.auth.apiKey) throw bad("该服务商不支持 API Key");
  if (v.authMode === "api_key" && !v.apiKey) throw bad("请输入 API Key");
  let baseUrl: string | null = null;
  if (v.provider === "custom") {
    if (!v.baseUrl) throw bad("请输入 OpenAI 兼容接口的基础地址");
    const u = new URL(v.baseUrl);
    if (u.protocol !== "https:" || u.username || u.password || u.search || u.hash) throw bad("接口必须使用 HTTPS，且不能在地址中包含凭据、查询参数或片段");
    await assertPublicUrl(u.toString()); baseUrl = u.toString().replace(/\/$/, "");
  } else if (v.baseUrl) throw bad("内置服务商使用固定官方地址；自定义地址请选择 OpenAI 兼容接口");
  encryptionKey();
  const id = randomUUID();
  const secret = v.authMode === "api_key" ? encryptCredential({ type: "api_key", key: v.apiKey! }, id) : null;
  await sql.begin(async (tx) => {
    await tx`INSERT INTO model_connections (id,name,provider,auth_mode,model_id,base_url,credential) VALUES (${id},${v.name},${v.provider},${v.authMode},${v.modelId},${baseUrl},${secret})`;
    await audit(actor, "models.connection.create", `model-connection:${id}`, "新增模型接入", null, { name: v.name, provider: v.provider, modelId: v.modelId, authMode: v.authMode }, { db: tx });
  });
  return { id };
}
export async function getConnection(id: string, db: Db = sql): Promise<Connection> {
  z.uuid().parse(id);
  const [row] = await db<Connection[]>`SELECT * FROM model_connections WHERE id=${id}`;
  if (!row) throw bad("模型配置不存在"); return row;
}
export async function activateConnection(id: string, actor: string) {
  await sql.begin(async (tx) => {
    await tx`LOCK TABLE model_connections IN EXCLUSIVE MODE`;
    const row = await getConnection(id, tx); if (!row.credential) throw bad("请先完成登录或配置 API Key");
    await tx`UPDATE model_connections SET active=false WHERE active`;
    await tx`UPDATE model_connections SET active=true,updated_at=now() WHERE id=${id}`;
    await audit(actor, "models.connection.activate", `model-connection:${id}`, "用于默认模型的新任务", null, publicConnection(row), { db: tx });
  }); return { ok: true };
}
export async function queueConnectionTask(id: string, kind: "verify" | "bootstrap", actor: string) {
  if (!config.modelCallsEnabled) throw bad("模型调用关闭，请先启用运行配置并启动 worker");
  const c = await getConnection(id); if (!c.credential) throw bad("请先完成账号授权或保存 API Key");
  if (kind === "bootstrap" && (!c.verified_at || !c.active)) throw bad("请先验证该模型成功并设为默认");
  const [existing] = await sql<{ id: string }[]>`SELECT id FROM model_connection_tasks WHERE connection_id=${id} AND kind=${kind} AND status IN ('queued','running')`;
  if (existing) return { id: existing.id };
  await ensureQueue(QUEUES.connectionTask);
  return await sql.begin(async (tx) => {
    await tx`SELECT id FROM model_connections WHERE id=${id} FOR UPDATE`;
    const [pending] = await tx<{ id: string }[]>`SELECT id FROM model_connection_tasks WHERE connection_id=${id} AND kind=${kind} AND status IN ('queued','running')`;
    if (pending) return { id: pending.id };
    const taskId = randomUUID();
    await tx`INSERT INTO model_connection_tasks (id,connection_id,kind) VALUES (${taskId},${id},${kind})`;
    await enqueue(QUEUES.connectionTask, { taskId }, { singletonKey: taskId }, tx);
    await audit(actor, `models.connection.${kind}`, `model-connection:${id}`, kind === "verify" ? "后台小额推理验证" : "采集并生成首批网页内容", null, { taskId }, { db: tx });
    return { id: taskId };
  });
}
export async function deleteConnection(id: string, actor: string) {
  for (const s of sessions.values()) if (s.connectionId === id) s.controller.abort();
  await sql.begin(async (tx) => {
    const row = await getConnection(id, tx);
    await tx`DELETE FROM model_connections WHERE id=${id}`;
    await audit(actor, "models.connection.delete", `model-connection:${id}`, "移除本地接入凭据", publicConnection(row), null, { db: tx });
  }); return { ok: true };
}
export async function activeConnection(): Promise<Connection | null> {
  const [row] = await sql<Connection[]>`SELECT * FROM model_connections WHERE active`; return row ?? null;
}

// Row locks serialize rotating OAuth refresh tokens across API and worker processes.
function storeFor(id: string, provider: string): CredentialStore {
  return {
    async read(p) { if (p !== provider) return undefined; const row = await getConnection(id); return row.credential ? decryptCredential(row.credential, id) : undefined; },
    async list() { const row = await getConnection(id); return row.credential ? [{ providerId: provider, type: row.auth_mode }] : []; },
    async modify(p, fn, options?: AuthOperationOptions) {
      if (p !== provider) throw bad("服务商不匹配");
      return await sql.begin(async (tx) => {
        options?.signal?.throwIfAborted();
        const [row] = await tx<Connection[]>`SELECT * FROM model_connections WHERE id=${id} FOR UPDATE`;
        if (!row) throw bad("模型配置已移除");
        const current = row.credential ? decryptCredential(row.credential, id) : undefined;
        const next = await fn(current); options?.signal?.throwIfAborted();
        if (next) await tx`UPDATE model_connections SET credential=${encryptCredential(next, id)},updated_at=now() WHERE id=${id}`;
        return next ?? current;
      }) as Credential | undefined;
    },
    async delete(p) { if (p === provider) await sql`UPDATE model_connections SET credential=null,active=false,updated_at=now() WHERE id=${id}`; },
  };
}
export function connectionRuntime(c: Connection) { return builtinModels({ credentials: storeFor(c.id, c.provider), authContext: noAmbient }); }
type WithoutSignal<T> = T extends unknown ? Omit<T, "signal"> & { id: string } : never;
type PublicPrompt = WithoutSignal<AuthPrompt>;
interface LoginSession { id: string; connectionId: string; actor: string; controller: AbortController; expires: number; status: "pending" | "complete" | "failed" | "cancelled"; error?: string; events: AuthEvent[]; prompt?: PublicPrompt; answer?: (v: string) => void; timer?: ReturnType<typeof setTimeout> }
const sessions = new Map<string, LoginSession>();
function snapshot(s: LoginSession) { return { id: s.id, connectionId: s.connectionId, status: s.status, error: s.error, events: s.events, prompt: s.prompt }; }
function ownedSession(id: string, actor: string) { const s = sessions.get(id); if (!s || s.actor !== actor || Date.now() > s.expires) throw bad("登录会话不存在或已过期，请重新登录"); return s; }
export function loginStatus(id: string, actor: string) { return snapshot(ownedSession(id, actor)); }
export function answerLogin(id: string, input: unknown, actor: string) {
  const v = z.object({ promptId: z.string(), value: z.string().max(8192) }).parse(input), s = ownedSession(id, actor);
  if (!s.prompt || s.prompt.id !== v.promptId || !s.answer) throw bad("此步骤已结束，请刷新登录状态");
  if (s.prompt.type === "select" && !s.prompt.options.some((x) => x.id === v.value)) throw bad("请选择提供的选项");
  s.answer(v.value); return snapshot(s);
}
export function cancelLogin(id: string, actor: string) { const s = ownedSession(id, actor); s.status = "cancelled"; s.controller.abort(); return snapshot(s); }
export async function startLogin(id: string, actor: string, makeModels: (c: Connection) => Models = connectionRuntime, generateData = false) {
  const c = await getConnection(id); encryptionKey();
  if (c.auth_mode !== "oauth") throw bad("请选择订阅登录配置");
  for (const s of sessions.values()) {
    if (s.status === "pending" && s.connectionId === id) {
      if (s.actor === actor) return snapshot(s);
      throw bad("该配置正在登录，请完成或取消当前登录");
    }
  }
  if (c.credential) throw bad("此配置已登录；需要更换账号时请新建配置，确认后再启用");
  const s: LoginSession = { id: randomUUID(), connectionId: id, actor, controller: new AbortController(), expires: Date.now() + 10 * 60_000, status: "pending", events: [] };
  sessions.set(s.id, s);
  s.timer = setTimeout(() => { s.controller.abort(); sessions.delete(s.id); }, 10 * 60_000); s.timer.unref();
  const interaction = {
    signal: s.controller.signal,
    notify(event: AuthEvent) { s.events.push(event); if (s.events.length > 30) s.events.shift(); },
    prompt(p: AuthPrompt): Promise<string> {
      return new Promise((resolve, reject) => {
        const { signal, ...display } = p; const promptId = randomUUID();
        const finish = (value?: string) => {
          signal?.removeEventListener("abort", abort); s.controller.signal.removeEventListener("abort", abort);
          if (s.prompt?.id === promptId) { delete s.prompt; delete s.answer; }
          if (value === undefined) reject(new Error("Login cancelled")); else resolve(value);
        };
        const abort = () => finish();
        if (signal?.aborted || s.controller.signal.aborted) { abort(); return; }
        s.prompt = { ...display, id: promptId }; s.answer = (v) => finish(v);
        signal?.addEventListener("abort", abort, { once: true }); s.controller.signal.addEventListener("abort", abort, { once: true });
      });
    },
  };
  await sql`UPDATE model_connections SET login_status='pending',login_error=null WHERE id=${id}`;
  await audit(actor, "models.connection.login.start", `model-connection:${id}`, "订阅账号授权", null, { provider: c.provider });
  void makeModels(c).login(c.provider, "oauth", interaction, { getDeviceId: () => {
    const h = createHash("sha256").update(`${config.siteUrl}:${encryptionKey().toString("hex")}`).digest("hex");
    return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-8${h.slice(17,20)}-${h.slice(20,32)}`;
  } }).then(async () => {
    await sql`UPDATE model_connections SET login_status='complete',login_error=null WHERE id=${id}`;
    s.status = "complete"; delete s.prompt; delete s.answer;
    await activateConnection(id, actor);
    await audit(actor, "models.connection.login.complete", `model-connection:${id}`, "授权完成", null, { provider: c.provider });
    if (generateData && config.modelCallsEnabled) await queueConnectionTask(id, "verify", actor);
  }).catch(async (error) => {
    // A follow-up audit/activation failure must never turn a persisted grant into "authorization failed".
    const [saved] = await sql<{ configured: boolean }[]>`SELECT credential IS NOT NULL AS configured FROM model_connections WHERE id=${id}`.catch(() => []);
    if (saved?.configured) { s.status = "complete"; delete s.prompt; delete s.answer; return; }
    if (s.status !== "cancelled") s.status = "failed";
    s.error = modelErrorMessage(error); delete s.prompt; delete s.answer;
    s.events = [{ type: "info", message: s.error }];
    await sql`UPDATE model_connections SET login_status=${s.status},login_error=${s.error} WHERE id=${id}`.catch(() => {});
    await audit(actor, "models.connection.login.failed", `model-connection:${id}`, s.error, null, { provider: c.provider }).catch(() => {});
  });
  return snapshot(s);
}

// Called only inside chatJson's paidRequest callback, by worker jobs.
export async function completeConnection(c: Connection, system: string, user: string, maxTokens: number, temperature: number, timeoutMs: number, jsonMode = true) {
  if (!c.credential) throw new Error("模型凭据未配置");
  if (c.provider === "custom") {
    const key = decryptCredential(c.credential, c.id);
    if (key.type !== "api_key" || !key.key || !c.base_url) throw new Error("模型配置不完整");
    const res = await guardedFetch(`${c.base_url}/chat/completions`, { method: "POST", headers: { authorization: `Bearer ${key.key}`, "content-type": "application/json" }, body: JSON.stringify({ model: c.model_id, messages: [...(system ? [{ role: "system", content: system }] : []), { role: "user", content: user }], max_tokens: maxTokens, temperature, ...(jsonMode ? { response_format: { type: "json_object" } } : {}) }), timeoutMs, maxRedirects: 0, maxBytes: 2_000_000, route: "direct" });
    if (res.status < 200 || res.status >= 300) throw new Error(`模型接口 HTTP ${res.status}`);
    const json = JSON.parse(res.text()) as { choices: unknown[]; usage?: Record<string, unknown>; id?: string };
    return { response: json, usage: json.usage ?? null, requestId: json.id ?? null, cost: null };
  }
  const models = connectionRuntime(c), model = models.getModel(c.provider, c.model_id);
  if (!model) throw new Error("模型不在当前服务商目录中");
  // The Codex subscription endpoint rejects temperature, even though the SDK accepts it.
  const result = await models.completeSimple(model, { systemPrompt: system, messages: [{ role: "user", content: user, timestamp: Date.now() }] }, { maxTokens, ...(model.api === "openai-codex-responses" ? {} : { temperature }), transport: "sse", maxRetries: 0, timeoutMs, signal: AbortSignal.timeout(timeoutMs) });
  if (result.stopReason === "error" || result.stopReason === "aborted") {
    const message = result.errorMessage ?? "请求被取消";
    // Log only a bounded vocabulary, never provider bodies, authorization URLs or credentials.
    console.warn(JSON.stringify({ level: "warn", msg: "model request failed", provider: c.provider, model: c.model_id, signals: message.match(/unsupported|not supported|temperature|max_tokens|max_output_tokens|invalid_request_error|model_not_found|insufficient_quota|access_denied|permission|forbidden|401|403|400|429|500|timeout|fetch failed|JSON|response_format|reasoning|not available|does not exist/gi) ?? [] }));
    throw new Error(modelErrorMessage(new Error(message)));
  }
  const content = result.content.filter((x) => x.type === "text").map((x) => x.text).join("");
  const usage = { prompt_tokens: result.usage.input + result.usage.cacheRead + result.usage.cacheWrite, completion_tokens: result.usage.output, total_tokens: result.usage.totalTokens };
  // Catalog prices are estimates; do not label subscription usage as an actual monetary charge.
  return { response: { choices: [{ message: { content } }], usage }, usage, requestId: null, cost: null };
}
