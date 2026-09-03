# 紫阳小张 Server

紫阳社区 AI Agent 的 Node.js 后端，同时承载 API 和 React 构建后的静态页面。

## 能力

- 账号密码注册、登录，以及手机验证码免注册登录
- 手机首次登录后强制补全用户名和密码
- JWT 鉴权、bcrypt 密码哈希、MySQL 用户与聊天记录
- 豆包文本对话和豆包 ASR 语音识别
- 新用户敏感信息同意、老人/子女/社区社工三类身份建档
- 身份证仅保存不可逆 HMAC 和尾号，聊天记录自动脱敏
- 老人兴趣归一化、同好脱敏匹配、周边设施、政策通知、健康打卡与健康求助
- 老人每天首次健康打卡奖励1枚鸡蛋，支持余额查询，并保留奖励流水
- 老人本人或社区工作人员确认家属关联，子女查看当天/本周摘要
- 社工工作台查询健康求助、健康打卡、家属关联并更新政策通知
- 当天的用户和助手消息由服务端统一保存，并作为豆包对话上下文
- React SPA 静态资源、前端路由回退和 PM2 配置

## 启动

```bash
cp .env.example .env
npm install
npm run db:init
npm start
```

首次上线前生成20个一次性社工密钥（数据库仅保存哈希，明文只写入指定的安全文件）：

```bash
node scripts/generate-staff-keys.js --output=/secure/path/staff-keys.txt
```

候选端口集成测试：

```bash
INTEGRATION_BASE_URL=http://127.0.0.1:3001 npm run test:integration
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
| `GET` | `/api/community/bootstrap` | 当天历史、身份流程和角色功能 |
| `POST` | `/api/community/consent` | 敏感信息处理同意 |
| `POST` | `/api/community/identity` | 选择身份 |
| `POST` | `/api/community/onboarding` | 完成身份建档 |
| `POST` | `/api/community/relations/:id/respond` | 老人确认/拒绝家属关联 |
| `GET` | `/api/chat/history` | 聊天记录 |
| `POST` | `/api/chat` | 豆包文本对话 |
| `POST` | `/api/asr/doubao` | 豆包语音识别 |

## 健康求助短信

`TEMPLATE_CODE`/`SIGN_NAME` 仅用于登录验证码。健康求助短信必须另行配置审核通过的
`ALERT_SMS_TEMPLATE_CODE`，可选独立的 `ALERT_SMS_SIGN_NAME`。模板变量为
`address`、`name`、`symptom`；未配置时求助仍会入库并可由社工工作台查询，但不会发送短信。
