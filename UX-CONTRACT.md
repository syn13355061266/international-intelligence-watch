# 国际情报观察后台交互规范

## Canonical behavior map

| Capability | Canonical owner | Source of truth | Allowed variants | Verification |
| --- | --- | --- | --- | --- |
| Select/Listbox | ui.tsx Select | 已有 Native Select | 系统弹出几何与键盘行为 | 模型选择与键盘检查 |
| Date | 既有原生日期输入 | 浏览器日期选择 | 不修改现有监控时间输入 | 监控界面原有测试 |
| Form | ui.tsx Field/Input/Button | 后台 API schema | 密钥显示隐藏、页面错误 | 新增配置与失败恢复 |
| Toast | features/admin/toast.tsx | useAdminAction | success/error | 命令返回状态与提示 |
| CRUD | routes/admin/model-connections.tsx | model-connections.ts 和管理员 API | API Key 与 OAuth | 新增、授权、验证、删除 |
| Scrollbar | app.css | 站点滚动样式 | 主栏目横向条 | 手机视图与长内容 |

## Model connection lifecycle

授权步骤为等待用户 → 接收授权码 → 令牌交换 → 服务端保存 → 设置默认。服务商回调页的成功不等于令牌已保存。本页以服务端连接和任务状态为准。授权失败展示分类后的原因和恢复入口，禁止显示 token、授权码或原始服务商错误体。

在管理员启用运行配置的环境，网页授权成功后只排队后台推理验证；验证成功再排队首次采集。页面加载、轮询和管理员 API 本身不执行模型推理。所有模型请求经过回执与预算。模型验证与生成数据按钮明确表达会执行后台任务。

首次采集从 BBC、Guardian、欧盟理事会三个已配置来源各导入最多三条；遵循原始发布时间与回补标记，不伪造新鲜度，不保证每条符合精选门槛。后续自动运营由既有来源调度与日报任务负责。

## Mutation and failure recovery

客户端命令必须带 CSRF，并保留同一重试命令的 Idempotency-Key。没有请求体的 DELETE 不设置 application/json；删除使用共享确认对话框，成功后重读列表，失败保留弹窗。后台验证任务按连接和任务类别去重。

前端命令和 OAuth 状态均只对管理员开放，返回 no-store。授权会话十分钟有效；页面刷新可对同一配置恢复未结束会话，服务端重启后重新授权。任务与错误保存在数据库中，凭据存在时不能显示为授权失败。

## Sensitive fields and navigation

模型选择仅展示名称；准确模型 ID 保留在已保存配置中。API Key 默认隐藏，可以用键盘操作显示隐藏。运行状态分别报告 worker、模型调用开关、采集数量与公开发布数量。删除本地配置不代表撤销服务商账号授权。

## Locale and accessibility

用户文案使用简体中文，服务商登录提示可以保留上游语言。用户可以粘贴回调链接，不能禁止密码管理器或粘贴。窄屏按钮换行，保留完整操作。失败状态不是空白内容或无限加载，用户可重试授权、验证或采集。
