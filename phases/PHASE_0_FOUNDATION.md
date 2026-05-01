# 🚀 Phase 0: 奠基 (Foundations)

> **当前状态**: 🟦 待启动 (PENDING)
> **目标**: 建立稳固的全栈基础设施，实现安全的鉴权与全局控制逻辑。

---

## 1. 基础设施脚手架 (Infrastructure Scaffolding)

- [x] **项目初始化**:
    - [x] 创建工程目录并初始化 `git`。
    - [x] 遵循单代码库、单 Worker 原则：前端使用 `Vite` + `React`，后端使用 `Hono`。
    - [x] 安装核心依赖：`hono`, `@hono/vite-dev-server` (本地开发热更新), `drizzle-orm`, `@tanstack/react-router`, `@tanstack/react-query`, `zustand`。部署通过 `wrangler deploy` 走 Workers Static Assets，非 Pages Functions。
    - [x] 搭建目录结构：`/src/api` (Hono 路由), `/src/db` (数据库), `/src/components` (UI), `/src/services` (业务逻辑)。
- [ ] **Cloudflare 资源编排 (Wrangler CLI 纯命令行接管)**:
    - [x] **配置自定义域名**: 在 `wrangler.toml` 中配置 `routes = [{ pattern = "torn.nobaggage2rome.com", custom_domain = true }]`。
    - [x] **创建 D1 数据库**: 执行 `npx wrangler d1 create tct-db`，将输出的 `database_id` 填入 `wrangler.toml`。
    - [x] **创建 KV 命名空间**: 执行 `npx wrangler kv:namespace create TCT_CACHE`，提取 ID。
    - [x] **创建 Queue**: 执行 `npx wrangler queues create tct-member-queue`。
    - [x] **注入加密机密**: 拒绝网页端，直接在终端执行 `npx wrangler secret put ENCRYPTION_SECRET` 等命令注入敏感配置。
    - [x] 注册 Durable Object：定义名为 `ChainMonitor` 的类，用于承载强一致性的高频实时状态（Energy, Status, cooldowns, chain_status, energy_refill_used, **System_Micro_Logs**）。
- [x] **Drizzle ORM 配置**:
    - [x] 编写 `schema.ts`：定义 `Members`（包含 `Torn ID`, `Name`, `API Key`, `Discord`, `is_donator`, `role` 等）及其他辅助表结构。
    - [x] 配置 `drizzle.config.ts` 并运行首个 `generate` 与 `migrate` 命令。

## 2. 鉴权与安全体系 (Auth & Security)

- [ ] **Discord OAuth2 流程实现**:
    - [ ] 在 Discord Developer Portal 创建应用并获取 Client ID/Secret。
    - [ ] 实现 `/api/auth/login` 重定向逻辑。
    - [ ] 实现 `/api/auth/callback`：接收 Code -> 换取 Token -> 获取用户信息。
    - [ ] **成员白名单校验**：在登录时调用一次 Torn API，确认该 Discord 用户所属帮派 ID 是否匹配。
    - ⚠️ **OAuth2 安全陷阱 (必须注意)**:
        - [ ] **CSRF 防护 (state 参数)**：`/api/auth/login` 生成随机 `state` 字符串存入 Cookie/KV → 重定向 Discord 时附带 `state` → callback 收到后 **必须比对**，不匹配直接拒绝。不做此步 = 攻击者可伪造登录。
        - [ ] **Code 换 Token 必须服务端执行**：`client_secret` 绝不能出现在前端代码或 URL 中。Hono 后端直接 `fetch('https://discord.com/api/oauth2/token', ...)` 完成交换。
        - [ ] **Token 存储策略**：Discord Access Token 仅用于一次性获取用户信息后即刻丢弃，**不要持久化**。系统后续使用自签的 JWT 或加密 Cookie 维持会话。
        - [ ] **边界情况处理**：
            - 用户 Discord 账户存在但未绑定 Torn → 返回引导页提示绑定 API Key。
            - 用户被踢出帮派 → 下次打开面板时校验失败，强制登出并清除 Cookie。
            - Discord API 临时不可用 → 返回友好错误页面，而非 500 崩溃。
- [ ] **API Key 验效与加密存储逻辑**:
    - [ ] 方案设计：使用 Web Crypto API 的 AES-GCM 模式。
    - [ ] 绑定验效：前端提交 Key -> 后端调用一次 Torn API 验证其真实性与权限。
    - [ ] 落盘流程：验效通过后 -> 后端生成随机 IV -> 加密存入 D1 的 `Members` 表。
    - [ ] 密钥管理：在 Cloudflare Secret 中配置 `ENCRYPTION_SECRET`。
    - ⚠️ **AES-GCM 致命陷阱 (搞错一步 = 数据泄露或永久丢失)**:
        - [ ] **IV 必须每次随机生成 12 字节**：`crypto.getRandomValues(new Uint8Array(12))`。**绝对禁止** IV 重用（相同 Key + 相同 IV = 密文可被破解）。
        - [ ] **IV 不是秘密，必须与密文一起存储**：D1 存储格式建议 `base64(IV):base64(ciphertext+authTag)`，冒号分隔，读取时先 split 再分别解码。
        - [ ] **ENCRYPTION_SECRET 导入方式**：不能直接将字符串当 key 用。必须先 `crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['encrypt', 'decrypt'])`。如果 Secret 是人类可读字符串，先用 `TextEncoder().encode()` 转为 Uint8Array，且长度必须恰好为 16（AES-128）或 32（AES-256）字节。
        - [ ] **密钥丢失 = 全部 API Key 永久不可恢复**：Cloudflare Secret 一旦删除无法找回。建议部署者在安全的离线位置（如密码管理器）保留一份 ENCRYPTION_SECRET 备份。
        - [ ] **AuthTag 验证失败 ≠ 密码错误**：AES-GCM 解密时如果 `ENCRYPTION_SECRET` 不匹配或数据被篡改，`crypto.subtle.decrypt()` 会直接 throw `OperationError`。必须 try/catch 并返回明确的 "密钥不匹配" 错误，而非让系统崩溃。
- [ ] **会话管理**: 使用 JWT 或加密 Cookie 保持登录状态，设置合理的过期时间。
    - ⚠️ **JWT 签名密钥**必须使用 Cloudflare Secret 中的独立密钥（不可复用 ENCRYPTION_SECRET），且设置合理的 `exp`（建议 24h）。

## 3. 全局控制中枢 (Control Plane)

- [ ] **Master Switch (总闸)**:
    - [ ] 在 KV 中定义键名 `SYSTEM_MASTER_SWITCH`。KV **仅此一项**用途。
    - [ ] 实现后台管理 API：`POST /api/admin/toggle`，需 `role = admin` 权限校验。
    - [ ] **DO 点火机制**：当 Master Switch 被切为 `ON` 时，API handler 同步调用 `env.CHAIN_MONITOR.get(id).fetch('/start')` 唤醒 DO 并触发首次 `setAlarm()`。切为 `OFF` 时，DO Alarm handler 检测到 OFF 状态后停止注册下一轮 Alarm，自动休眠。
    - [ ] 实现全局中间件：所有采集逻辑执行前必须先读取此 KV 状态，若为 `OFF` 则立即中止。
- [ ] **权限配置 (Admin Role)**:
    - [ ] Members 表 `role` 字段默认为 `member`，仅 Master Switch 操作需 `admin` 权限。
    - [ ] **配置时机**：在帮派成员数据（通过 Phase 1 Faction API 或手动录入）写入 D1 后，由部署者手动在数据库中将指定成员的 `role` 设为 `admin`。
    - [ ] 其他操作（全息作战板圈人、Chain Target 修改）所有已登录帮派成员均可执行。
- [ ] **前端基础布局**:
    - [ ] 搭建 React 顶层容器，集成颜色主题 (Dark Mode) 和基础 CSS。
    - [ ] 实现一个常驻的“系统运行状态”指示灯组件。

---

## 4. 验证与测试清单 (Verification & Testing)

### 🧪 基础设施审计 (Infrastructure Audit)
- [ ] **数据库冒烟测试**: 执行一次 D1 写入与读取，确保 Drizzle Schema 与数据库完全同步。
- [ ] **加解密一致性测试**: 
    - [ ] 输入 API Key，加密存入 D1。
    - [ ] 取出并解密，验证原始 Key 匹配度需达 100%。
- [ ] **鉴权闭环测试**: 
    - [ ] 点击 Discord 登录，验证系统能正确获取 `discord_id`。
    - [ ] 验证非白名单/非帮派成员的拦截逻辑。

### 📊 预期指标
| 验证项 | 预期结果 | 状态 |
| :--- | :--- | :--- |
| `wrangler dev` | 全栈工程本地冷启动成功 | [ ] |
| Security Roundtrip | AES-GCM 密文在数据库中不可读，解密后恢复原值 | [ ] |
| Global Switch | KV `SYSTEM_MASTER_SWITCH` 设为 `OFF` 时，所有 API 返回 503 | [ ] |

---

## 5. 产出产物 (Artifacts)
- `wrangler.toml`
- `src/db/schema.ts`
- `src/services/security.ts` (含 AES-GCM 加解密逻辑)
- `src/scripts/rotate_encryption_key.ts` (密钥轮转迁移脚本)
