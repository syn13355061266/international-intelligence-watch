# Railway 完整站点部署

此方案运行原有网页、管理员后台、内部 API、全天采集 worker 和 PostgreSQL。使用平台分配的 HTTPS 域名，不开放本机公网隧道。它不是 GitHub Pages 静态快照。

## 当前授权范围

用户选择先用免费试用，不接受付费。部署前必须确认连接的 Railway 账号仍有可用试用额度且不会扣取额外费用；不要升级套餐、绑定支付方式或购买额外资源。官方试用通常为 30 天或 5 美元额度先到为止，实际以账号显示为准。试用结束不等于能永久免费维持完整站点。

## 服务结构

- PostgreSQL：单独的数据库服务及持久化卷，应用使用其内部连接地址。
- 应用：仓库根目录 Dockerfile，`CLOUD_ALL_IN_ONE=true`。`scripts/cloud-host.ts` 先运行迁移，启动回环 API，再启动公开网页与 worker。
- 只给应用生成公开域名；API 不单独公开，数据库迁移时临时所需的外部连接另行管理。
- `/data` 挂载持久化卷，用于上传文件、图片缓存和本地备份；数据库卷单独保留。
- 单应用实例即可。健康检查 `/api/health`，平台启动端口由 `PORT` 决定；内部 API 自动使用另一端口。
- 设置至少 210 秒的部署关闭等待，让正在进行的模型请求保存回执后退出。API、网页或 worker 意外退出时，父进程也退出，交给平台统一重启。

## 变量与迁移

变量模板为 `deploy/railway.env.example`。不要把本机 `.env` 整份复制到云端，尤其不要带上 `MODEL_PROXY_URL=http://127.0.0.1:7890`、本机 `DATABASE_URL` 或开发登录配置。

迁移已有数据时，保持 `CLOUD_SEED=false`、`COLLECT_ENABLED=false`、`MODEL_CALLS_ENABLED=false`，暂不让新实例处理任务。保留本机原有的模型凭据加密密钥（`MODEL_CREDENTIALS_SECRET`；未单设时为 `SESSION_SECRET`），否则数据库中的订阅令牌将无法解密。管理员密码通过云端秘密变量设置，不写入源码。

步骤：

1. 核验免费试用额度与服务限制，创建 PostgreSQL 及应用。
2. 将经过检查的代码部署至应用，绑定数据卷，配置秘密变量和公网域名。
3. 导出本机数据库为 PostgreSQL 自定义格式备份，并用 `pg_restore --list` 检查目录。
4. 正式切换前暂停本机 worker，生成最终一致性备份，恢复到新的云端数据库；迁移过程中保持云端采集与模型开关关闭。
5. 检查文章、译文、主题、评分、历史日报与管理员登录，核对模型授权能否解密，并检查数据文件需求。
6. 验证云端能实际连接模型服务商后，启用云端采集和模型处理；本机保留数据备份，避免两个实例同时使用同一订阅处理重复任务。
7. 从外部网络运行 smoke 检查，核对全天采集和北京时间 08:00 日报排程，最后交付公网地址。

## 费用与持续可用

免费试用有额度和时间限制，不能保证长期在线。余额不足时，应按用户零付费约束暂停服务并保留备份。是否自动停用、能否持久保存卷与数据库，以部署时账号实际规则为准；没有验证前不能声称已经设置了费用硬上限或到期提醒。

参考：
- <https://docs.railway.com/pricing/free-trial>
- <https://docs.railway.com/builds/build-and-start-commands>
- <https://docs.railway.com/deployments/deployment-teardown>
