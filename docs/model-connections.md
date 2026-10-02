# 网页模型配置

入口：网站「更多 → 模型配置（管理员）」，或 `/admin/model-connections`。先使用 `.env` 中的 `ADMIN_PASSWORD` 登录。

## API Key

选择服务商和目录中的模型，输入 API Key，保存后点击「设为默认」。DeepSeek、OpenAI、Anthropic 等服务商使用 Pi 内置官方接口。目录以固定版本 `@earendil-works/pi-ai@1.0.0` 为准，不代表账号有权使用每个模型。

其他服务商选择「自定义 OpenAI 兼容接口」，填写 HTTPS 基础地址（通常到 `/v1`）、准确模型 ID 与 Key。该入口拒绝私网地址、含凭据的 URL 和重定向，只支持文本 Chat Completions。内置模型同样按文本任务接入，视觉任务请继续使用已有视觉模型配置。

## 订阅账号

选择「订阅账号登录 / OAuth」。列表仅包含 Pi 声明支持 OAuth 的服务商，并区分订阅接入与普通账号授权。OpenAI 的 ChatGPT 登录、GitHub Copilot 等按各服务商流程授权，不是填写网站账号密码。

点击保存后，打开授权链接，按提示处理设备验证码、选项或回调链接。在远程服务器部署时，若浏览器返回 localhost 页面失败，将完整回调链接填回网页提示框；部分服务商可能有额外部署限制。登录会话有效期十分钟，后台重启后重新登录。刷新页面后可以对相同配置再点「登录账号」恢复未结束的会话。

完成授权后，后台会自动排队执行一次**真实、付费回执记录的模型验证**；验证通过后再排队采集三路国际新闻 RSS，并进入原有抽取、评分、摘要、归组和发布队列。页面中的“凭据已保存”“模型验证”“首批情报”是三个独立状态，只有验证和文章发布完成才表示网页已有真实内容。实际模型权限、额度和限流仍由服务商决定。移除配置删除本地凭据；如需撤销服务商授权，另到服务商账号管理页面操作。

参考：[Pi AI 文档](https://github.com/earendil-works/pi/blob/main/packages/ai/README.md)、[OpenAI 开源与自托管登录流程](https://developers.openai.com/siwc/token-sharing-open-source/sign-in)。ChatGPT 订阅可用范围请以 [官方计划使用说明](https://developers.openai.com/siwc/token-sharing-open-source) 为准，不能将会员视作通用 API Key。

## 配置生效与每日运行

网页连接替换后端 `default` 模型。`模型与评测` 中各能力的独立选择、以及对应 `*_MODEL` 环境变量，仍优先于 default；要让全部文本能力使用网页默认连接，请将对应能力选择 `default`，或清除独立选择及对应环境变量。

保存、打开页面和账号授权不触发推理。采集、分析、归组与日报任务仍在 worker 中执行。网页接入的所有推理使用已有 `llm` 回执与次数预算，关闭 SDK 自动重试，避免重试绕过回执。订阅 token 计入用量；目录估算价格不能当成订阅的实际扣费。

本地预览可保持 `COLLECT_ENABLED=false`；手动点击“更新首批情报”仍会走受控的三路首批采集。生产每天运行须启用 `COLLECT_ENABLED=true`、`MODEL_CALLS_ENABLED=true`，设置合适的 `llm` 日预算并让 API、worker、Web 和 PostgreSQL 常驻运行。定时任务会继续采集、分析、归组、生成日报；浏览器不必一直打开，本机预览也不会自动成为公网网站。参见 [部署说明](deploy.md) 与 [情报站配置说明](intelligence-expansion.md)。

## 本次真实接入记录

2026-10-02，`ChatGPT / Codex 订阅` 已完成令牌交换、真实 SSE 模型验证和首批采集。后台回执记录了验证及内容处理的模型调用；预览库已采集 9 条报道，5 条已完成分析并公开发布，余下资料仍按正文可用性和模型预算继续处理。Codex Responses 不接受 `temperature`，worker 会对该服务商省略该参数。若正文需要 Jina 兜底而未配置 `JINA_API_KEY`，该条会保持可重试状态，不会伪造内容。

## 凭据与备份

凭据 AES-256-GCM 加密后保存在新增 `model_connections` 表，管理员查询只返回配置元数据。刷新令牌的读写用数据库行锁跨进程序列化。前端没有凭据文件，审计记录不保存 Key 或 token。

生产部署应设置独立随机 `MODEL_CREDENTIALS_SECRET`（至少 24 字符），备份数据库及该密钥。未配置时使用 `SESSION_SECRET`。API 与 worker 必须使用相同且稳定的加密密钥；更换密钥会导致旧凭据无法解密，需要迁移或重新授权。不要提交 `.env`，上线使用 HTTPS。
