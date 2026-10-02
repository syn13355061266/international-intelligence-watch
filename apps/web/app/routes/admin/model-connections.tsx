import { useEffect, useState } from "react";
import { Link, useRevalidator } from "react-router";
import type { ModelConnections, ModelLogin } from "@aihot/contracts/model-connections";
import type { Route } from "./+types/model-connections";
import { adminGet } from "../../lib/admin.server";
import { useAdminAction } from "../../features/admin/action";
import { AdminPage, Badge, Button, Card, Field, Input, Select, ReasonDialog } from "../../features/admin/ui";

export async function loader({ request }: Route.LoaderArgs) { return adminGet<ModelConnections>(request, "/api/admin/model-connections"); }
export const meta = () => [{ title: "模型配置 · 国际情报观察后台" }];
const safeLink = (value?: string) => { try { const u = new URL(value ?? ""); return u.protocol === "https:" ? u.toString() : undefined; } catch { return undefined; } };

export default function Connections({ loaderData: data }: Route.ComponentProps) {
  const { run, busy } = useAdminAction(); const revalidator = useRevalidator();
  const [mode, setMode] = useState<"api_key" | "oauth">("api_key"), [provider, setProvider] = useState("deepseek"), [name, setName] = useState(""), [modelId, setModelId] = useState(""), [baseUrl, setBaseUrl] = useState(""), [key, setKey] = useState("");
  const [login, setLogin] = useState<ModelLogin | null>(null), [answer, setAnswer] = useState("");
  const [removeId, setRemoveId] = useState<string | null>(null), [showKey, setShowKey] = useState(false), [formError, setFormError] = useState("");
  const polling = !!login && login.status === "pending" || data.tasks.some((t) => t.status === "queued" || t.status === "running") || data.counts.articles > data.counts.published;
  useEffect(() => { if (!polling) return; const timer = setInterval(() => revalidator.revalidate(), 4000); return () => clearInterval(timer); }, [polling, revalidator]);
  const providers = data.providers.filter((p) => mode === "oauth" ? p.oauth : p.apiKey);
  const selected = providers.find((p) => p.id === provider), models = selected?.models ?? [];
  useEffect(() => { if (provider !== "custom" && !providers.some((p) => p.id === provider) || mode === "oauth" && provider === "custom") { setProvider(providers[0]?.id ?? ""); setModelId(""); } }, [mode, provider, providers]);
  useEffect(() => {
    if (!login || login.status !== "pending") return;
    const controller = new AbortController();
    const timer = setInterval(async () => {
      try { const res = await fetch(`/api/admin/model-login/${login.id}`, { credentials: "same-origin", signal: controller.signal, cache: "no-store" });
        if (!res.ok) { setLogin((old) => old ? { ...old, status: "failed", prompt: undefined, events: [{ type: "info", message: "登录会话已过期或后台已重启，请重新登录。" }] } : null); return; }
        const next = await res.json() as ModelLogin; setLogin(next); if (next.status === "complete") revalidator.revalidate();
      } catch { /* A temporary interruption is retried; cleanup aborts outstanding polls. */ }
    }, 1500);
    return () => { clearInterval(timer); controller.abort(); };
  }, [login?.id, login?.status, revalidator]);
  useEffect(() => { setAnswer(""); }, [login?.prompt?.id]);
  async function save() {
    setFormError("");
    if (!(modelId || models[0]?.id) || mode === "api_key" && !key.trim() || provider === "custom" && !baseUrl.trim()) { setFormError("请填写模型、API Key 和所需接口地址。"); return; }
    const saved = await run<{ id: string }>("POST", "/api/admin/model-connections", { name: name.trim() || selected?.name || "自定义模型", provider, authMode: mode, modelId: modelId || models[0]?.id || "", ...(provider === "custom" ? { baseUrl } : {}), ...(mode === "api_key" ? { apiKey: key } : {}) }, { success: "配置已保存" });
    if (!saved) return; setKey(""); setName("");
    if (mode === "oauth") { const s = await run<ModelLogin>("POST", `/api/admin/model-connections/${saved.id}/login`, {}, { revalidate: false }); if (s) setLogin(s); }
  }
  return <AdminPage title="模型配置" subtitle="接入模型 → 后台推理验证 → 采集并生成网页内容。密钥仅保存在服务端，任务受本站预算限制。">
    <div className="grid gap-5">
      <Card title="运行状态"><p>后台任务：{data.workerOnline ? "在线" : "未启动或心跳过期"} · 模型调用：{data.modelCallsEnabled ? "已允许（受预算限制）" : "已关闭"}</p><p className="mt-2">已采集 {data.counts.articles} 条 · 已发布 {data.counts.published} 条。<Link className="text-accent" to="/all">查看最新情报</Link></p><p className="mt-2 text-sm text-ink-3">订阅授权成功后自动设为默认，并在后台验证一次推理；成功后采集首批真实来源。已有单独模型选择仍优先，可到 <Link className="text-accent" to="/admin/models">模型与评测</Link> 调整。</p></Card>
      <Card title="新增接入"><form noValidate className="grid gap-4 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <Field label="接入方式"><Select aria-label="接入方式" value={mode} onChange={(e) => { setMode(e.target.value as typeof mode); setKey(""); setModelId(""); }}><option value="api_key">API Key</option><option value="oauth">订阅账号登录 / OAuth</option></Select></Field>
        <Field label="服务商"><Select aria-label="服务商" value={provider} onChange={(e) => { setProvider(e.target.value); setModelId(""); setKey(""); }}>{providers.map((p) => <option key={p.id} value={p.id}>{p.name}{mode === "oauth" && !p.subscription ? "（账号授权，非订阅）" : ""}</option>)}{mode === "api_key" && <option value="custom">自定义 OpenAI 兼容接口</option>}</Select></Field>
        <Field label="配置名称"><Input aria-label="配置名称" value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：日报模型" maxLength={80} /></Field>
        <Field label="模型">{provider === "custom" ? <Input required aria-label="模型 ID" value={modelId} onChange={(e) => setModelId(e.target.value)} placeholder="服务商提供的模型 ID" /> : <Select aria-label="模型" value={modelId || models[0]?.id || ""} onChange={(e) => setModelId(e.target.value)}>{models.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</Select>}</Field>
        {provider === "custom" && <Field label="API 基础地址" hint="HTTPS 地址，例如 https://api.example.com/v1"><Input required aria-label="API 基础地址" type="url" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} /></Field>}
        {mode === "api_key" && <Field label="API Key"><div className="flex gap-2"><Input required aria-label="API Key" type={showKey ? "text" : "password"} autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} maxLength={4096} /><Button aria-label={showKey ? "隐藏 API Key" : "显示 API Key"} aria-pressed={showKey} onClick={() => setShowKey(!showKey)}>{showKey ? "隐藏" : "显示"}</Button></div></Field>}
        {formError && <p role="alert" className="text-hot sm:col-span-2">{formError}</p>}
        <div className="sm:col-span-2"><Button type="submit" disabled={busy || provider !== "custom" && !models.length}>{mode === "oauth" ? "保存并开始账号登录" : "保存配置"}</Button></div>
        {mode === "oauth" && <p className="text-sm text-ink-3 sm:col-span-2">在服务商页面完成授权。若返回 localhost 页面无法打开，可将完整回调链接复制到下方登录步骤。订阅支持与额度由服务商决定，登录成功不保证所有模型均可用。</p>}
      </form></Card>
      {login && <Card title="账号授权"><p role="status">{({ pending: "等待授权与令牌交换", complete: "授权凭据已保存，默认模型已接入；后台正在验证与生成数据", failed: "授权未完成", cancelled: "授权已取消" })[login.status]}</p>{login.error && <p className="mt-2 text-hot" role="alert">{login.error}</p>}<p className="mt-2 text-sm text-ink-3">服务商回调页的成功提示仅代表收到授权码，请以本页的令牌保存与推理验证状态为准。</p>
        <div className="mt-3 space-y-2">{login.events.map((e, i) => <div key={i} className="break-words text-sm">{e.message}{e.instructions && <p>{e.instructions}</p>}{safeLink(e.url ?? e.verificationUri) && <a className="text-accent underline" href={safeLink(e.url ?? e.verificationUri)} target="_blank" rel="noopener noreferrer">打开服务商授权页面</a>}{e.userCode && <p>设备验证码：<strong>{e.userCode}</strong></p>}</div>)}</div>
        {login.prompt && login.status === "pending" && <form noValidate className="mt-4 space-y-3" onSubmit={async (e) => { e.preventDefault(); if (!answer.trim()) return; const next = await run<ModelLogin>("POST", `/api/admin/model-login/${login.id}/answer`, { promptId: login.prompt!.id, value: answer }, { revalidate: false }); if (next) { setLogin(next); setAnswer(""); } }}>
          <Field label={login.prompt.message}>{login.prompt.type === "select" ? <Select required value={answer} onChange={(e) => setAnswer(e.target.value)}><option value="">请选择</option>{login.prompt.options?.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</Select> : <Input required type={login.prompt.type === "secret" ? "password" : "text"} autoComplete="off" placeholder={login.prompt.placeholder} value={answer} onChange={(e) => setAnswer(e.target.value)} maxLength={8192} />}</Field><Button type="submit" disabled={busy}>继续授权</Button>
        </form>}
        {login.status === "pending" && <div className="mt-3"><Button disabled={busy} onClick={async () => { const next = await run<ModelLogin>("DELETE", `/api/admin/model-login/${login.id}`, undefined, { revalidate: false }); if (next) setLogin(next); }}>取消登录</Button></div>}
      </Card>}
      <Card title="已保存的模型">
        {!data.connections.length && <p className="text-ink-3">尚未配置模型。</p>}
        <div className="space-y-4">{data.connections.map((c) => {
          const task = data.tasks.find((t) => t.connection_id === c.id);
          return <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-3" key={c.id}>
            <div className="min-w-0"><p>{c.name} {c.active && <Badge tone="accent">默认模型</Badge>}</p>
              <p className="break-words text-sm text-ink-3">{c.provider} · {c.modelId} · {c.verifiedAt ? "推理验证通过" : c.configured ? "凭据已保存，等待推理验证" : "尚未授权"}</p>
              {c.loginError && !c.configured && <p className="mt-1 text-sm text-hot">{c.loginError}</p>}
              {task && <p className="mt-1 text-sm" role="status">{task.kind === "verify" ? "模型推理验证" : "首批情报采集"}：{({ queued: "等待后台执行", running: "执行中", complete: "完成", failed: "失败" })[task.status]}{task.error && ` · ${task.error}`}</p>}
            </div>
            <div className="flex flex-wrap gap-2">
              {c.authMode === "oauth" && !c.configured && <Button disabled={busy} onClick={async () => { const s = await run<ModelLogin>("POST", `/api/admin/model-connections/${c.id}/login`, {}, { revalidate: false }); if (s) setLogin(s); }}>重新授权</Button>}
              <Button disabled={busy || !c.configured || c.active} onClick={() => void run("POST", `/api/admin/model-connections/${c.id}/activate`, {}, { success: "默认模型已更新" })}>设为默认</Button>
              <Button disabled={busy || !c.configured || !data.modelCallsEnabled || !data.workerOnline || task?.status === "queued" || task?.status === "running"} onClick={() => void run("POST", `/api/admin/model-connections/${c.id}/verify`, {}, { success: "已排队验证；默认模型成功后会生成首批数据" })}>验证并生成数据</Button>
              {c.verifiedAt && c.active && <Button disabled={busy || !data.workerOnline} onClick={() => void run("POST", `/api/admin/model-connections/${c.id}/bootstrap`, {}, { success: "情报采集已排队" })}>更新首批情报</Button>}
              <Button tone="ghost" disabled={busy} onClick={() => setRemoveId(c.id)}>删除配置</Button>
            </div>
          </div>;
        })}</div>
      </Card>
      <ReasonDialog open={removeId !== null} title="删除模型配置" description="将删除此配置及服务端凭据；若它是默认模型，后续任务将使用其他已配置的默认方式。服务商账号授权需另到服务商页面撤销。" confirmLabel="删除配置" danger requireReason={false} busy={busy} onClose={() => setRemoveId(null)} onSubmit={async () => !!await run("DELETE", `/api/admin/model-connections/${removeId}`, undefined, { success: "模型配置已删除" })} />
    </div>
  </AdminPage>;
}
