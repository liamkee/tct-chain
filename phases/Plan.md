# Torn 连锁与战争指挥系统 (TCT-Chain) 实施蓝图

## 0. 架构决策

- **前端栈**: React, Vite, TanStack Router, TanStack Query, Zustand
- **后端栈**: Hono (运行于同一个 Cloudflare Worker)
- **基础设施**: Cloudflare D1 (持久关系数据), KV (低频开关), Durable Objects (高频实时状态树与 WebSocket 吞吐), Queues (Torn API 并发控制)
- **鉴权体系**: Discord OAuth2 登录 + Torn API Key 加密绑定
- **部署形态**: 单一代码库，单一 **Cloudflare Workers** 部署（非 Pages Functions），前端静态资源通过 Workers Static Assets 分发，100% 依赖 `wrangler.toml` (IaC) 管理云端资源。

---

## 1. 核心数据模型 (Data Schema)

### 持久关系型数据 (D1)
- **`Members` 表**: 存储稳定的身份映射。
  - `Torn ID` (主键)
  - `Name`
  - `API Key` (加密存储)
  - `Discord ID` (鉴权与 Webhook 艾特依据)
  - `is_donator` (能量上限依据，每日零点通过 API 刷新一次)
  - `role` (`admin` | `member`，手动配置，仅 Master Switch 操控需 admin 权限)

### 边缘键值存储 (KV)
- `SYSTEM_MASTER_SWITCH`: 抓取系统的全局总闸 (ON/OFF)。**KV 仅此一项**，不再承载其他数据。

### 强一致性状态树 (Durable Objects — 双层存储)
- **持久层 (`state.storage.put()` — 存活于 DO 驱逐与重启)**:
  - `chain_status` (当前连击数、剩余读秒)。
  - `chain_target` (本次连锁目标击数，如 1000 或 2500，用于触发 FULL SEND 冲锋信号。所有成员可修改，强一致秒级生效)。
  - `chain_timeout_offset` (指挥官实时滑动微调的延迟补偿值，强一致性瞬间生效)。
  - `global_selected_members` (当前在"全息作战板"中被指挥官圈选的成员 ID 数组。所有成员可操作)。
  - 实时人员快照: `Energy`, `Status`, `last_action`, `booster_cooldown`, `drug_cooldown`, `energy_refill_used`（DO 驱逐后必须立即恢复，不允许出现 60s 数据盲区）。
- **易变层 (Transient Memory — DO 驱逐时允许丢失)**:
  - `system_micro_logs` (20 条滚动循环的系统熔断/拦截日志)。
  - `hpm_sliding_window` (5 分钟滑动窗口，丢失后从下一轮采集自动重建)。

---

## 2. 核心采集引擎 (双轨道零损耗系统 - Phase 1)

### 轨道 A: 宏观主轴雷达 (Faction Track)
- **触发频率**: 每 10 秒触发一次 (由 Cron 或 DO 内部定时器驱动)。
- **接口与参数**: `https://api.torn.com/faction/?selections=basic&key=[系统随机抽取的一个公用指挥官Key]`
- **数据剥离 (Data Extraction)**:
  - 剥离 `chain` 节点 -> 提取出 `current`, `timeout` 更新至 DO (`chain_status`)。
  - 剥离 `members` 节点 -> 提取出全员的 `status.state` (是否住院/飞行) 和 `last_action`。
- **熔断判定 (Circuit Breaker)**:
  - 检查每一个 member。若发现某人 `status.state` 处于 `Hospital` 或 `Traveling`，立刻给该成员打上“熔断标签”。该成员在接下来的 60 秒内，**绝对不会**被放入轨道 B 的抓取队列。

### 轨道 B: 个人精算雷达 (User Track)
- **触发频率**: 每 60 秒触发一次 (仅针对未被轨道 A 熔断的成员，批量下发至 Queue 执行)。
- **接口与参数**: `https://api.torn.com/user/?selections=[动态拼接]&key=[成员各自绑定的私钥]`
- **动态组装 `selections` 策略 (零损耗核心)**:
  - **常驻索取**: `energy,refills` (因为能量和吃药状态随时会变，这 2 个必须每次抓)。
  - **按需索取一 (`profile`)**: 如果 DO 尚未记录该成员的 `is_donator` 状态，则拼接 `profile`。一旦抓到，立刻缓存在 DO (`state.storage`) 并设定 **每日 TCT 零点过期**。在当日有效期内，请求参数中**剔除** `profile`，次日零点自动重新抓取刷新。
  - **按需索取二 (`cooldowns`)**: 如果上次抓取时，发现该成员的 `drug_cooldown` 或 `booster_cooldown` 高达数小时，则将该 CD 转交给我们系统的**本地时钟去自己倒数**，并在后续轮询中**剔除** `cooldowns` 参数。直到系统自己倒数归零了，才再次拼接 `cooldowns` 去 API 查验。
- **数据剥离 (Data Extraction)**:
  - 更新 `Energy`, `energy_refill_used`, 以及 (若请求了的) `cooldowns`。

### 队列节流 (Queue Fan-out)
- 严控 API 并发量，所有轨道 B 的个人请求必须被推入 Cloudflare Queues，控制并发速率，确保系统永远不会被 Torn 官方因为“并发过多”而封禁 IP (HTTP 429 错误)。
- **微型日志终端 (Micro-Logs)**: 在 DO 中建立 20 条循环 Buffer，专门记录上述的“熔断拦截”和“动态截断”动作，供指挥官在面板底部实时审查系统的“省流战果”。

---

## 3. 战术大盘与状态管理 (Phase 2)

- **严密的状态分工边界**:
  - **TanStack Query**: 负责低频状态突变 (初始快照、配置提交、Discord 鉴权握手)。
  - **Zustand**: 纯本地 UI 视角控制 (排序偏好、一键隐藏不可用人员的开关)。
  - **Durable Object (DO)**: 掌控高频流推送与**全局战术状态**。
- **全息作战板 (Global Manual Selection)**:
  - 抛弃单机独立勾选。指挥官的选人动作实时写入 DO 内存并毫秒级广播全服。一人点兵，全服所有人的大盘推演瞬间同步跳变。
- **动态算力极限引擎**:
  - 综合 `Energy`、`is_donator` 与 `Refills`，测算 **理论极限连击 (Max Potential Chain)**。
  - 若算力足以贯穿既定目标，触发极高能见度的 **“🔥 弹药充足：全力推进 (FULL SEND)！”** 总攻冲锋令。

---

## 4. 连锁推演与风控防线 (Phase 3)

- **死秒终结者 (Dual-Engine Delay Compensation)**:
  - **底层动态测算**: 每次请求自动测量 RTT 往返时延并与 API `server_time` 对比。
  - **指挥官微调器**: 大盘提供可调整的 Offset Slider (如 `-500ms`)。
  - **绝对纯净倒计时** = `原始 Timeout` - `(RTT/2)` + `指挥官手动微调`。双引擎合并根除网络死秒卡顿。
- **脱管防御机制 (Webhook Alerts)**:
  - 当 `timeout < 90s` 且火力断档 (HPM 跌入冰点) 时，系统直接绕过前端，触发 Webhook 强力报警 (`@here` 或指挥官)。

---

## 5. 跨平台交互 (Discord 联动 - Phase 4)

- **基础设施筹备**: 搭建 Discord App，提取频道 Webhook 与需报警的 Role IDs。
- **无头推送 (Webhook Alerts)**: 
  - 通过 Webhook 执行断连高危警报与整数里程碑战报推送。
- **深度交互 (Bot Slash Commands)**: 
  - 将 Discord `Interactions Endpoint` 挂载至后端路由。实现 `/chain status` 等终端查分指令。

---

## 6. 战时模式架构 (War Mode - Phase 5 后期拓展)

- **深层敌方情报网 (Enemy Radar)**:
  - 监控排位战接口 (`rankedwars`)，解析目标分数差距。
  - **高危复活监控**: 不只看医院读秒，深层抓取 `medical_cooldown`。只紧盯“极易被奶妈拉起”的重点打击对象。
  - **逃逸自杀雷达**: 精准侦测抽血自杀等防守行为。
- **公平交战派单系统 (Fair Fight Dispatch & Kill Tickets)**:
  - 接入间谍数据库获取敌方三围，植入 **Fair Fight 算子** 确保击杀分数收益最大化。
  - **双向狙击网格**: 左侧我方特遣队，右侧“航班式”敌方出院时间轴 (Sniper Timeline)。指挥官划线连桥，一键下发“猎杀工单”。
  - **闭环核销**: Discord Bot 私信提醒打手开火。目标倒地后，系统通过 API 溯源伤害来源，自动核销工单并记录人头战果。

---

## 7. 构建与点火顺序 (Boot Sequence)

1. **Phase 0**: 纯 IaC 搭建，Hono + Vite + Drizzle + D1/KV/DO 脚手架绑定。
2. **Phase 1**: 部署 Track A / Track B 双轨调度器与零损耗拦截网。
3. **Phase 2**: 贯通 `/ws` 长连接，渲染战术看板与全息作战连线机制。
4. **Phase 3**: 植入 HPM 算子模型与双擎倒计时补偿算法。
5. **Phase 4**: 挂载 Discord Slash Commands 交互与 Webhook 广播网。
6. **Phase 5**: 战时状态启动，迁入敌方雷达与派单工单库。

---

## 8. 成本预估 (Cloudflare Free Tier Budget)

> **运营假设**: 帮派 40 人，活跃约 20 人；连锁窗口约 48 小时/次，非连锁期间系统完全关闭（Master Switch OFF，零请求零消耗）。

| 资源 | 免费额度 | 48h 连锁期用量 | 状态 |
| :--- | :--- | :--- | :--- |
| Workers 请求 | 100k/天 | ~3k/天 (Track A 8.6k + Track B ~120 + Dashboard) | ✅ 极安全 |
| D1 读取 | 5M/天 | 极低（大部分数据走 DO） | ✅ 极安全 |
| D1 写入 | 100k/天 | 极低（仅 Phase 3 每 5min 快照 + 鉴权写入） | ✅ 极安全 |
| DO 请求 | 1M/月 | ~130k/次连锁 (Alarm 17k + Track B 更新 58k + WS + Token Bucket) | ✅ 安全 |
| DO 持续时间 | 400k GB-s/月 | ~5h 有效计算时间 (Hibernation 管理空闲 WS) | ✅ 安全 |
| Queues 消息 | 1M/月 | ~5.8k/次连锁 (20 人÷10 人/批=2 msg/min × 2880 min) | ✅ 极安全 |
| KV 读取 | 100k/天 | ~8.6k/天 (仅 Master Switch 开关检查) | ✅ 极安全 |

> **结论**: 以当前规模（40 人/48h 窗口），所有资源均 **远低于** 免费额度上限。即使每月跑 4 次连锁（192h），总量仍在安全线以内。Queues 通过 10~20 人合并批量推送，单次连锁仅消耗约 6k 消息。