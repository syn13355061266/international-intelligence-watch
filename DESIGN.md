---
version: alpha
name: "国际情报观察"
description: "供读者查看国际情报、供管理员运营采集与模型任务的中文网站。"
colors:
  primary: "#202a30"
  background: "#faf9f6"
  surface: "#ffffff"
  accent: "#176b75"
  danger: "#b3402a"
  success: "#2f7d5c"
typography:
  sans:
    fontFamily: "system-ui, Microsoft YaHei, sans-serif"
  mono:
    fontFamily: "ui-monospace, monospace"
rounded:
  control: "8px"
  card: "12px"
  sheet: "16px"
spacing:
  admin-gap: "1.25rem"
components:
  button:
    owner: "apps/web/app/features/admin/ui.tsx"
  card:
    owner: "apps/web/app/features/admin/ui.tsx"
  dialog:
    owner: "apps/web/app/features/admin/ui.tsx"
---

# 国际情报观察 Design System

## Overview

### Creative North Star

沿用现有站点的纸面新闻阅读风格：暖白背景、深色正文、细边框和单一青绿色链接。管理员页面采用紧凑运营台的表达，以状态、动作和恢复路径帮助用户完成任务。

### Product context and register

读者关心国家安全、地缘政治及行业动态；管理员配置来源和模型，追踪采集、处理与发布。界面语言为简体中文，时间采用 Asia/Shanghai。模型 ID 和服务商名称保留上游拼写。公开页面偏新闻阅读，后台偏任务操作；本次修复不更换品牌或主题。

### Token ownership/runtime mapping

`apps/web/app/app.css` 是运行时语义色、圆角、字体和响应断点的唯一所有者；本文件记录现有值，不生成独立 CSS。共享后台组件位于 `apps/web/app/features/admin/ui.tsx`，命令与反馈位于 `action.ts` 和 `toast.tsx`。

## Colors

正文 ink、次要文案 ink-3、边框 line、链接 accent、破坏动作 hot、成功 ok 通过现有语义 class 使用。暗色模式由 app.css 同名变量切换，状态同时使用文字表达。

## Typography

中文使用系统字体及既有中文回退；模型 ID 允许换行。模型选择只显示一个名称，不重复输出名称和 ID。状态与错误必须解释当前步骤和下一步动作。

## Layout

后台导航、AdminPage 与 Card 复用现有组件。模型表单桌面两列，手机单列；配置行的操作按钮允许换行。长链接不撑开页面。

## Elevation & Depth

卡片沿用现有细边框；确认弹窗使用共享 ReasonDialog。未新增渐变、装饰图案或独立浮层层级。

## Components

Button、Input、Select、Field、Card、Badge 与 ReasonDialog 以 ui.tsx 为规范实现。Native Select 的系统弹出面板可接受；表单使用可访问名称及页面内错误提示；密钥默认隐藏。

## Motion

沿用共享组件既有过渡和 reduced-motion 样式。任务异步刷新不导致自动导航或焦点跳转。

## Accessibility

使用按钮、链接和表单语义；授权和任务状态可读，关键错误用 role=alert；删除必须确认且失败保留恢复入口。
