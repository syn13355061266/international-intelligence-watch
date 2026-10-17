# 本机运行与发布状态（2026-10-17）

当前使用这台 Windows 电脑保存数据库并运行采集、模型处理和网站。网站地址为 `http://localhost:3010/`，后台为 `http://localhost:3010/admin`。API 与数据库只监听回环地址，不直接开放给其他电脑。

## 自动启动与守护

`deploy/windows-host.ps1` 在用户登录后启动 PostgreSQL、API、网页和 worker，每 20 秒检查所属进程，进程退出后重新启动。已有进程通过 PID 和完整命令行核对后接管，不会重复启动。进程记录与日志位于 `E:\aihot\.intelwatch-work\public-host`。

启动项为 `%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\InternationalIntelligenceWatch.vbs`，以隐藏窗口运行。PowerShell 的 RemoteSigned 执行策略只用于该进程，不修改系统执行策略。

守护进程运行期间请求 Windows 保持系统唤醒，显示器仍可休眠。关机、退出登录、断网或合上电脑盖仍可能中断运行。当前不是“无人登录即可启动”的 Windows 系统服务。

## 更新与访问范围

worker 全天滚动采集，日报在北京时间 08:00 触发。新文章处理完成后进入本地网站；模型连接仍可能因网络失败而延迟。

公网隧道发布操作被自动审批拒绝（`blocked by policy`），因此截至本次记录还没有可验证的公网动态地址。不能将本地健康检查成功视为已经发布。GitHub Pages 定时同步读者站或云平台完整部署，需要选定方案并完成必要的服务授权后继续。

## 移除登录启动项

只删除上述 `InternationalIntelligenceWatch.vbs` 即可取消后续登录自动启动；这不会删除网站、数据库或历史情报。已经运行的进程需要单独停止。
