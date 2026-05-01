# 📊 Phase 2: 战术面板 (Tactical Dashboard)

> **当前状态**: 🟦 待启动 (PENDING)
> **目标**: 构建聚合数据接口与高响应前端，为指挥官提供实时决策支持。

---

## 1. 聚合接口与实时推送 (Backend / API)

- [ ] **WebSocket 服务构建 (三段式握手)**:
    - [ ] 在 Hono 中实现 `/ws` 路由，**仅用作鉴权网关**：验证 JWT/Cookie → 校验通过后将 WebSocket upgrade 请求 **转发至 `ChainMonitor` Durable Object**。
    - [ ] **DO 接管生命周期**：`ChainMonitor` 调用 `state.acceptWebSocket(ws)` 持有连接，使用 **WebSocket Hibernation API** 管理空闲连接（降低 DO wall-clock 计费）。
    - [ ] 逻辑：客户端连接后，DO 将其订阅至帮派 Room，所有后续推送均由 DO 直接发出。
    - ⚠️ **WebSocket Hibernation 实现陷阱**:
        - [ ] **DO 类必须实现的 handler**：使用 Hibernation API 时，DO 类 **必须** 定义 `webSocketMessage(ws, msg)`, `webSocketClose(ws, code, reason, wasClean)`, `webSocketError(ws, error)` 三个方法。缺少任何一个都会导致事件静默丢失。
        - [ ] **禁止调用 `ws.accept()`**：使用 Hibernation 模式时，`state.acceptWebSocket(ws)` 已经隐含 accept。如果再手动调 `ws.accept()` 会报错。
        - [ ] **Hibernation 后 DO 内存清零**：DO 空闲时会被 Cloudflare 从内存驱逐。当 WS 消息到达时 DO 被重新实例化，但 **transient memory（this.xxx）全部丢失**。必须从 `state.storage` 重建关键状态。在 `constructor` 或首次 handler 调用中做 `await this.state.storage.get(...)` 恢复。
        - [ ] **广播用 `getWebSockets()`**：`this.ctx.getWebSockets()` 返回所有活跃连接。用 `ws.serializeAttachment()` / `ws.deserializeAttachment()` 给每个连接打 tag（如 user_id），支持定向推送。
        - [ ] **客户端必须实现自动重连**：WS 连接可能因网络切换、CF 维护等断开。前端需要指数退避重连（1s → 2s → 4s → max 30s），并在重连成功后主动请求一次全量快照以弥补断连期间丢失的增量推送。
- [ ] **数据聚合与 DO 通信**:
    - [ ] 握手流程：前端连接 `/ws` → Hono Worker 验证身份 → Worker 通过 `env.CHAIN_MONITOR.get(id).fetch()` 将请求转发至 DO → DO 持有 WebSocket 双向长连接。
    - [ ] **全息作战板 (Global Manual Selection)**：DO 内存中维护一个 `global_selected_members` 数组。任何指挥官勾选/取消人员时，通过 WS 发送指令更新该数组，DO 瞬间将新的编队名单广播给所有连接的指挥官，实现“一人圈人，全服亮起”的共享推演效果。
    - [ ] **精确战力算子 (Calculator)**：结合 `is_donator`（能量上限 100 vs 150）与 `energy_refill_used` 状态，推算出每位成员真实的“最大潜在出击数”；并处理 Cooldown 和 Status。
- [ ] **推送调度**:
    - [ ] 当 DO 内存中的高频战术数据（或共享的编队勾选名单）更新时，立即通过 WebSocket 向所有客户端执行全局广播。

## 2. 前端看板开发 (Frontend / React)

- [ ] **核心状态管理 (Zustand vs TanStack Query 严格分工)**:
    - [ ] **TanStack Query (负责低频与 HTTP Server State)**:
        - 专职处理标准 HTTP 请求：初始全量数据的首次加载 (Initial Snapshot)、用户鉴权状态、配置修改 (如提交/校验 API Key，控制开关 `SYSTEM_MASTER_SWITCH` 的 Mutation 操作)。
        - 处理 REST API 的 Loading, Error, Cache Invalidation 与 Retry。
    - [ ] **Zustand (负责高频实时流与 Client State)**:
        - **WebSocket 吞吐引擎**：专职接管 DO 推送过来的 10秒级 高频 JSON 更新包。通过精准覆盖内存树来驱动组件局部渲染，避免使用 React Query 去 Refetch 造成的性能浪费。
        - **UI 交互状态**：存储纯本地视角的交互，比如“隐藏不可用人员”的 Toggle 开关、“战力优先”的排序偏好、以及微型日志的滚动。
- [ ] **系统控制中枢 UI**:
    - [ ] 紧凑型布局：全局采用高信息密度的操作型布局。
    - [ ] 实现显眼的 **Master 控制总闸按钮**（仅 `role = admin` 管理员可见/可操作），直接操作 `SYSTEM_MASTER_SWITCH` 启停并触发 DO 点火/熄火。
    - [ ] 实现 **Chain Target 输入器**（所有成员可修改），修改后实时写入 DO `state.storage`，全服秒级生效。
- [ ] **看板组件实现**:
    - [ ] **连锁仪表盘**：显示巨大的倒计时圆环、当前长度/目标长度进度条。
    - [ ] **核心推演数据与编队测算**：
        - 醒目展示“目标连锁差距 (Target Gap)”与“预计完赛时间 (ETA)”。
        - **双维度火力评估（防止虚假冲锋令）**：
            - ⚡ **即战火力 (Available Now)**：仅统计 `Status = Okay` 的成员能量总和。这是此刻立即可以打出的火力。
            - 📊 **战略火力 (Total Potential)**：包含全员（含医院/飞行中）的能量总和。这是理论极限。
        - ⚠️ FULL SEND 必须基于 **即战火力**，而非战略火力。否则一半人躺医院无法出击，冲锋令将变成空头支票。
        - **决战冲锋信号 (Push All-Out Indicator)**：仅当 **即战火力 (Available Now)** 足以打穿剩余目标差距时，触发 **“🔥 弹药充足：全力推进 (FULL SEND)！”**。若仅 Total Potential 达标但 Available Now 不足，显示 “⏳ 战略储备充足，等待人员归队”。
        - **全局动态算力切换**：默认聚合全帮派的总潜在出击数；一旦系统侦测到 DO 下发的全局共享编队名单（`global_selected_members`）不为空，全服所有面板的推演数据（极限连击、ETA、冲锋信号）将**强制同步切换**为仅基于“特遣队人员”的测算。
    - [ ] **系统微型日志终端 (System Micro-Logs)**：在界面底部或侧边展示来自 DO 的最近 20 条日志（如“触发熔断”、“全局限流拦截”），方便指挥官监控底层健康度。
    - [ ] **成员列表矩阵**：
        - [ ] **战术勾选框 (Manual Selector)**：每张成员卡片包含一个选择框，点击即加入当前战术编队。
        - [ ] 实现状态图标：Okay (绿), Hospital (红), Traveling (蓝), Jail (橙)。
        - [ ] **活跃度指示灯**：展示从 Faction API 拿到的 `last_action`（例如显示常亮绿点代表 Online，或显示“5m ago”），让指挥官秒懂该成员是否在挂机。
        - [ ] 实现指标卡片：显示 Energy, Cooldowns, FHC 预估, **Refill 是否可用**。
        - [ ] **熔断与占位 UI (Fallback)**：对于未提供 API Key 或被系统判定重伤而“熔断停止抓取”的成员，保留其卡片并实时显示 Faction Status，但将 Energy/Cooldowns 等个人数据区置灰并显示 `N/A`。
- [ ] **智能交互过滤器**:
    - [ ] 实现“战力优先”排序逻辑（基于 Energy + Refill 潜力 + FHC 空间综合倒序排列）。
    - [ ] 实现“隐藏不可用人员”的一键切换开关（一键过滤 Hospital/Jail/Traveling 状态及长期 Offline 的成员）。

## 3. 用户体验增强 (UX Improvements)

- [ ] **响应式适配**: 针对手机端竖屏优化，将成员列表转为紧凑的卡片流模式。
- [ ] **动态警报效果**:
    - [ ] 当 `timeout < 120s` 时，标题栏显示红色闪烁。
    - [ ] 当 `timeout < 60s` 时，触发浏览器震动（若支持）及全屏红色遮罩。
- [ ] **数据过期标记 (Stale Data Policy)**:
    - [ ] 每个数据块携带 `lastUpdatedAt` 时间戳。
    - [ ] 前端渲染规则：数据超过 30s 未更新 → 显示黄色 "⏳ 数据延迟" 标记；超过 120s → 显示红色 "⚠️ 数据过期" 标记。
    - [ ] Torn API 全站维护时：Master Switch 自动切为 OFF，前端展示 "Torn API 维护中" 全局提示。

---

## 4. 验证与测试清单 (Verification & Testing)

### 🧪 面板与实时性审计 (UX & Real-time Audit)
- [ ] **WS 重连测试**: 手动断网并重连，验证 WebSocket 是否自动恢复。
- [ ] **大数据渲染测试**: 加载 100+ 成员列表，验证 Filter/Sort 操作流畅度。
- [ ] **数据更新时延**: 修改 DB 数据，验证前端 UI 是否在 1000ms 内更新。

### 📊 预期指标
| 验证项 | 预期结果 | 状态 |
| :--- | :--- | :--- |
| API Latency | `/api/dashboard` JSON 响应 < 100ms | [ ] |
| Visual Alert | 连锁时间 < 120s 时，红色高亮正常触发 | [ ] |
| Mobile Adaptability | 在手机浏览器上布局不崩坏，核心指标清晰 | [ ] |

---

## 5. 产出产物 (Artifacts)
- `src/routes/api/dashboard.ts`
- `src/components/MemberGrid.tsx`
- `src/hooks/useDashboardData.ts`
