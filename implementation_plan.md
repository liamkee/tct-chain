# Torn 连锁指挥系统 实施计划

## 0. 架构决策

本项目应构建为单一的全栈 Cloudflare 应用，而非独立的前端和后端部署。

**推荐技术栈：**
- **前端**: React, Vite, TanStack Router, TanStack Query, Zustand
- **后端**: Hono (运行于同一 Cloudflare Worker)
- **运行时**: Cloudflare Workers
- **存储**: D1 (持久化关系数据), KV (低风险配置/缓存), Durable Objects (强一致性实时链状态), Queues (Torn API 速率控制)
- **鉴权**: Discord OAuth2 + 加密存储的 Torn API Key 绑定
- **ORM/迁移**: Drizzle ORM 与 D1 迁移

**部署形态：**
- 单一代码库
- 单一 Worker
- 单一部署单元

---

## 1. 核心原则

- 前端严禁直接调用 Torn API
- 前端应通过单一聚合接口（Dashboard）获取战术数据
- 所有 Torn API 调用必须经过中心化速率限制层
- D1 为成员、状态、审计和历史的唯一事实来源
- KV 仅用于简单开关和非关键缓存
- Durable Objects 用于强一致性的实时协调
- API Key 必须加密存储，并在绑定时立即验效

---

## 2. 数据模型 (D1)

### 核心表结构
- **資料庫建置 (D1)**：
    - 建立 `Members`
        - `Torn ID`
        - `Name`
        - `API Key`
        - `Discord`
        - `is_donator`

### KV 存储
- `SYSTEM_MASTER_SWITCH`: 全局采撷总闸。

### Durable Object
- `Energy`
- `Status`
- `booster_cooldow`
- `drug_cooldown`
- `chain_status`

---

## 3. 鉴权与安全

- **Discord OAuth2**: 用于系统登入，建立加密 Session。
- **API Key 安全**: 
  - 前端不可见 Key。
  - D1 中加密存储（使用 Worker Secret 作为私钥）。
  - 绑定时校验所属权。

---

## 4. 采集引擎逻辑
`Members`
- `Torn ID` (一次)
- `Name` (一次)
- `API Key` (一次)
- `Discord` (一次)
- `Energy` (1分钟)
- `Status` (1分钟)
- `is_donator` (30分钟;如果有值就停止)
- `booster_cooldow` (1分钟;如果超过24小时的值就停止)
- `drug_cooldown` (1分钟;如果超过24小时的值就停止)
- `chain_status` 每10秒User Trigger

### 队列 (Queue)
- 负责扇出 (Fan-out) 请求，确保不触发 Torn API 速率限制（IP 限制）

---

## 5. 战术面板与 UI

### 聚合接口 (`/api/dashboard`)
WebSocket：
- 前端僅透過 /api/dashboard 進行身分驗證與握手，隨後建立持久型 WebSocket 連線
- 目标连锁差距与预计完赛时间
- 成员实时战术数据（可用击数、FHC 预估）

### UI 要求
- 紧凑的操作型布局
- 有一个master 按钮控制整个系统的运行和停止
- 显示全部成员列表
- 成员列表支持一键过滤Status人员
- 连锁危机（剩余时间 < 1分）视觉显著提醒

---

## 6. 实施阶段

### Phase 0: 奠基
- 初始化全栈工程。
- 配置 D1, KV, Queue, DO。
- 实现 Discord 登录及 API Key 加密绑定。
- 设置全局总闸。

### Phase 1: 采撷引擎
- 实现 Cron 早停逻辑。
- 开发帮派数据轨道（指挥官 Key）。
- 开发成员数据队列轨道（成员 Key）。

### Phase 2: 战术面板
- 开发聚合 API。
- 计算战术指标（可用击数、FHC）。
- 构建 React 操作面板，实现实时刷新。

### Phase 3: 连锁推演
- 实现目标设定与余击计算。
- 实现基于近 5 分钟击率的耗时预测。
- DO 实时监控连锁风险，处理 API 延迟补偿。

### Phase 4: Discord 联动
- 配置 Webhook。
- 实现危急警报（< 2分）与里程碑战报。
- DO 层去重防刷。

### Phase 5: 战时模式
- 强化采集频率。
- 提升系统可观测性。

---

## 7. 推荐构建顺序

1. **架构脚手架**: Hono + React 全栈配置。
2. **数据库**: D1 建模与 Drizzle 迁移。
3. **鉴权**: Discord 登录与 Key 校验。
4. **采集**: 指挥官轨道与成员队列逻辑。
5. **API**: 构建 `/api/dashboard`。
6. **前端**: 战术 UI 落地。
7. **高级**: 连锁预测与 Discord 报警。