# 紫阳小张 Agent Server

紫阳小张 Agent 的 Node.js 后端服务，为 Web 前端及其他客户端提供稳定的 Agent API 与业务能力。

## 项目定位

本仓库负责服务端能力，计划包括：

- Agent 请求接收与任务编排
- 会话、状态和业务数据管理
- MySQL 数据访问
- 鉴权、日志与统一错误处理
- 面向 Web 前端的 API 服务

## 技术方向

- Node.js 22+
- npm
- PM2
- MySQL 8.0

具体 Web 框架、ORM 和目录结构将在项目初始化后补充。

## 本地开发

```bash
git clone git@github.com:Kookaburra-maomao/ziyang-server.git
cd ziyang-server
npm install
npm run dev
```

## 生产运行

```bash
npm run build
pm2 start ecosystem.config.js
```

> 当前仓库处于初始化阶段，实际命令以项目后续生成的 `package.json` 和 PM2 配置为准。

## 关联项目

Web 前端：[ziyang-web](https://github.com/Kookaburra-maomao/ziyang-web)
