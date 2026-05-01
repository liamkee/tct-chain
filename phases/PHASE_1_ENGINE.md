# 🛰️ Phase 1: 采撷引擎 (Retrieval Engine)

> **当前状态**: 🟦 待启动 (PENDING)
> **目标**: 构建双轨道高频采集系统，确保帮派状态与成员指标的实时同步。

---

## 1. 轨道 A：帮派指挥官轨道 (Faction Poller)

- [ ] **无人值守高频探针 (Durable Object Alarms)**:
    - [ ] 核心驱动：在 `Durable Object (ChainMonitor)` 中利用 `state.storage.setAlarm()` 实现自运转的轮询循环。**防漂移策略**：`alarm()` handler 开头必须先 `setAlarm(Date.now() + 10000)` 注册下一轮，再执行当前采集逻辑，确保 API 延迟不会拉长轮询间隔。
    - [ ] 兜底保障：即使**没有任何用户打开面板**，DO 也会保持每 10 秒苏醒一次调用指挥官 Key，确保 Discord 危机警报的绝对可靠。
    - ⚠️ **全系统 #1 致命风险：Alarm 循环静默死亡**:
        - **致死原因**：如果 `alarm()` handler 内部抛出未捕获异常（如 API 返回格式异变、JSON parse 失败、网络超时未处理），且 `setAlarm()` 尚未执行（或异常发生在 setAlarm 之后的代码中但 CF 内部回滚了 alarm），**整个轮询循环将永久停止**。没有 Cron 兜底，没有自动恢复，系统变成死人。
        - [ ] **强制防护模式 — alarm() 骨架**：
            ```
            async alarm() {
              // 1. 无条件先注册下一轮（即使后续逻辑全部炸了，循环也不会断）
              await this.state.storage.setAlarm(Date.now() + 10000);
              try {
                // 2. 检查 Master Switch
                // 3. 执行 Faction API 采集
                // 4. 更新状态 + 广播 WebSocket
              } catch (err) {
                // 5. 绝对不能 re-throw！吞掉错误，记录到 micro-logs
                this.microLogs.push({ ts: Date.now(), msg: `alarm error: ${err.message}` });
              }
            }
            ```
        - [ ] **try/catch 覆盖整个 alarm() 函数体**。catch 内部**绝对禁止 re-throw**，只做日志记录。让循环带伤运行总比循环死亡好。
        - [ ] **前端心跳检测**：Dashboard 监控 `lastUpdatedAt` 时间戳。若超过 30s 无更新，显示 "⚠️ 引擎可能已停止" 警告。管理员可通过 Master Switch OFF → ON 重新点火恢复。
        - [ ] **fetch() 超时保护**：Torn API 调用必须设置 `AbortController` + 5 秒超时。Workers 的 `fetch` 默认无超时，Torn 如果卡住会阻塞整个 alarm handler。
- [ ] **高频采集与预警逻辑 (Faction API 优先)**:
    - [ ] **请求频率**：**每 10 秒 1 次**。
    - [ ] 发送请求：`faction -> basic`（**一次请求同时包含**连锁状态与全员基础名单）。
    - [ ] 提取连锁字段：`chain.timeout`, `chain.current`, `chain.max`。
    - [ ] 提取全局成员状态：解析 `members` 数组中所有成员的 `status` (当前在不在医院/监狱) 及 `last_action` (显示玩家几分钟前活跃过)。**完全使用 Faction API 的 10秒级 轨道**，同时完成“盯连锁”和“盯人生死”的双重任务。
     - [ ] **DO 级更新 (Zero D1 Writes)**：获取到的这些 10秒级 高频状态 **只更新在 DO 中**，**绝对禁止**写入 D1 数据库，以彻底保护 D1 的免费写入配额。DO 内部全部使用 `state.storage.put()` 持久化（包括成员 Energy、cooldowns、status、last_action），防止 DO 驱逐导致指挥官面板出现长达 60s 的数据空白盲区。DO storage 写入计费极低（100万次/月免费），不应在此处省钱。
    - [ ] 跨边界触发：当数据触及警戒线，立即通过内部通道触发 Discord 预警机制。
- [ ] **智能启停控制**:
    - [ ] **DO 点火 (Ignition)**：DO 不会自行启动。当管理员将 Master Switch 切为 ON 时，API handler 调用 `ChainMonitor.fetch('/start')` 触发首次 `setAlarm()`，DO 从此自运转。
    - [ ] **DO 必须无面板存活**：即使没有任何用户打开面板，DO Alarm 循环也必须持续运行（为 Phase 3/4 的 Discord 紧急通知提供数据源）。
    - [ ] 逻辑判断：若 `chain.timeout` 为 0 **且** Master Switch 为 OFF，停止注册新 Alarm 进入休眠。若仅 chain.timeout 为 0 但 Switch 仍为 ON，降至低频轮询（如每 60s）等待连锁重新开始。
    - [ ] 若连锁正在进行，将最新状态更新至 DO 内存并触发向现有 WebSocket 的广播。

## 2. 轨道 B：成员数据采集 (Member Queue)

- [ ] **生产者逻辑 (Producer - 何时触发与停止)**:
    - [ ] 触发频率：Producer 每 **1 分钟** 运行一次，遍历 D1 / DO 中的名单。
    - [ ] **按需熔断 (停止 Request 的条件)**：
        - 检查刚刚从 Faction API (轨道 A) 拿到的全局成员 `status`。
        - **停止抓取**：如果某成员状态为 `Hospital` 或 `Jail` 且剩余时间 `until` > 1小时，或者处于长途 `Traveling` 中，**直接跳过，不将其推入 Queue**。
        - **触发抓取**：仅当成员状态为 `Okay` 或即将出院/落地时，才推入 Queue 消耗个人 API 抓取战术数据。
    - [ ] **空数据占位 (Fallback)**：未注册 API Key 或被熔断过滤的成员，仅通过 Faction API 维持列表展示，保护限流池。
- [ ] **消费者与全局限流墙 (Consumer/Worker)**:
    - [ ] **绝对速率锁 (Token Bucket)**：在 `ChainMonitor` DO 的 `state.storage` 中维护 per-key 令牌桶计数器（DO 单例 + 强一致性 = 唯一可靠的全局计数方案）。Queue Consumer 发起 Torn API 请求前，必须先向 DO 申请令牌。注意：Torn 限流实际为 **per-key 100次/分钟**，非 IP 级别，限流策略以 key 为维度跟踪配额。
    - [ ] **阻断与重排队**：当触及限流时，拦截请求并将该成员的更新任务重新压入 Queue（设定合理的延迟重试延时）。
    - [ ] 队列扇出 (Fan-out) 防护：严格配置 Queue 的 `max_concurrency` 以平滑每秒并发峰值。
    - ⚠️ **Queue Consumer 跨 Worker 协调风险**:
        - **核心难点**：Queue Consumer 运行在**独立的 Worker 调用**中，不在 DO 内部。它必须通过 `fetch()` 网络调用与 DO 通信申请令牌，这引入了网络延迟和失败可能。
        - [ ] **DO 不可达时的策略**：如果 `fetch('/api/internal/token-bucket')` 超时或返回 500，Consumer **必须拒绝发送 Torn API 请求**（宁可跳过本轮也不可绕过限流），将消息 retry 回 Queue。
        - [ ] **毒消息防护 (Poison Message)**：如果某成员 API Key 已失效，每次请求都会返回 Torn API 错误。必须设置 `max_retries`（建议 3 次），超过后将该成员标记为 "Key 失效" 并**停止为其排入 Queue**，避免无限重试烧光 Queue 配额。
        - [ ] **Dead Letter Queue (DLQ)**：在 `wrangler.toml` 中为 Queue 配置 `dead_letter_queue`，永久失败的消息自动转入 DLQ 而非丢失，便于事后排查。
        - [ ] **批量消息解包**：由于 Producer 将 10~20 人合并为一条消息，Consumer 收到后必须遍历数组逐一处理。**单人失败不应阻塞同批其他人**——用 `Promise.allSettled()` 而非 `Promise.all()`。
        - [ ] **批量 Token 申请（减少碎请求）**：Consumer 启动时一次性发送 `fetch('/api/internal/token-bucket?count=20')`，DO 一次性扣除额度并返回。拿到配额后再在 Worker 本地并发请求 Torn API，避免 20 人批次产生 20 次 DO fetch 碎请求。
    - [ ] **动态生成 API 请求 (Dynamic Selections & 本地倒数)**:
        - 采用“按需拼接”策略，避免抓取冗余数据：
        - **is_donator 缓存停止**：若已获取 `is_donator`，将其缓存在 DO 并设定 TCT 零点过期。在明天之前，请求参数中**永久移除** `profile`。
        - **cooldown 本地倒数停止**：cooldown 一旦生效**无法被任何道具清除**，因此可安全地本地倒数。若获取到的 cooldown 值 > 24 小时 (86400秒)，记录时间戳交由系统自行倒数。在系统倒数到 < 24 小时之前，请求参数中**永久移除** `cooldowns`。
        - **常驻参数**：仅保留 `bars` (Energy 随时可能恢复或消耗) 和 `refills`。
        - **终极精简**：经过本地过滤，发送给 Torn 的合并请求将动态缩减为最简的 `?selections=bars,refills`。
- [ ] **数据更新与缓冲 (DO 驱动)**:
    - [ ] 将最新抓取的高频战术数据直接推入 `Durable Object (ChainMonitor)` 内存中。
    - [ ] 保护数据库：仅当发生关键状态跨度变更时（或异步定期）才执行 D1 落盘写入。

## 3. 流量调度与健壮性 (Traffic Control)

- [ ] **多 Key 轮询算法**:
    - [ ] 设计 `KeyPool` 策略：当一个 Key 达到速率限制 (Rate Limit) 的 80% 时，自动切换至池中下一个 Key。
- [ ] **重试机制**:
    - [ ] 针对 Torn API 的 502/504 错误实现指数退避重试 (Exponential Backoff)。
- [ ] **数据看板同步**:
    - [ ] 采集完成后，更新 DO transient memory 中的"最后同步时间戳"（通过 WebSocket 推送至前端 Stale Data Policy 检测）。
- [ ] **系统可观测性 (Logging & Observability)**:
    - [ ] **开发与底层监控**：**无需手搓庞大的日志系统**。普通的执行日志直接用 `console.log`，通过 Cloudflare 后台或终端 `wrangler tail` 实时查看。
    - [ ] **事件打点 (Analytics Engine)**：利用 Cloudflare 原生且免费的 **Workers Analytics Engine** 记录“熔断触发”、“限流拦截”、“API 错误”等事件。代码中只需一行 `env.ANALYTICS.writeDataPoint(...)`，无需建表即可在 CF 后台看图表。
    - [ ] **指挥官微型日志 (DO 内存)**：在 DO 内存中维护一个只保存“最近 20 条关键拦截/预警事件”的轻量数组。这 20 条高亮日志直接通过 WebSocket 推给前端 Dashboard 底部显示，让指挥官知道“系统正在后台阻挡什么”。

---

## 4. 验证与测试清单 (Verification & Testing)

### 🧪 引擎压力测试 (Engine Stress Test)
- [ ] **早停逻辑自愈测试**: 
    - [ ] 手动设连锁为“断开”，验证 Cron 是否在 60s 内停止采集。
- [ ] **并发压力测试**: 
    - [ ] 模拟 100 个成员数据压入 Queue，验证 Consumer 是否在 10s 内无报错完成。
- [ ] **异常健壮性测试**: 
    - [ ] 故意输入无效 API Key，验证系统是否能优雅跳过而非崩溃。

### 📊 预期指标
| 验证项 | 预期结果 | 状态 |
| :--- | :--- | :--- |
| Faction Poller | 准确识别连锁状态并自动启停 | [ ] |
| Queue Consumer | 并发处理无冲突，API Key 轮询正常 | [ ] |
| Data Consistency | D1 成员状态与 Torn 实时同步 (误差 < 60s) | [ ] |

---

## 5. 产出产物 (Artifacts)
- `src/jobs/faction_poller.ts`
- `src/jobs/member_consumer.ts`
- `src/services/api_manager.ts` (Rate limit management)
