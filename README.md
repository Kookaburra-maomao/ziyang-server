# 紫阳社区 AI Agent Server

紫阳社区 AI Agent 的 Node.js 后端，同时承载 API 和 React 构建后的静态页面。

## 能力

- 账号密码注册、登录，以及手机验证码免注册登录
- 手机首次登录后强制补全用户名和密码
- JWT 鉴权、bcrypt 密码哈希、MySQL 用户与聊天记录
- 豆包文本对话和豆包 ASR 语音识别
- React SPA 静态资源、前端路由回退和 PM2 配置

## 启动

```bash
cp .env.example .env
npm install
npm run db:init
npm start
```

生产运行：

```bash
pm2 start ecosystem.config.js
pm2 save
```

## 主要接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/health` | 健康与能力状态 |
| `POST` | `/api/auth/register` | 账号注册 |
| `POST` | `/api/auth/login` | 账号登录 |
| `POST` | `/api/sms/send` | 发送验证码 |
| `POST` | `/api/auth/sms/login` | 手机验证码登录 |
| `POST` | `/api/auth/complete-profile` | 补全账号资料 |
| `GET` | `/api/chat/history` | 聊天记录 |
| `POST` | `/api/chat` | 豆包文本对话 |
| `POST` | `/api/asr/doubao` | 豆包语音识别 |
