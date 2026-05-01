# 🧠 Phase 3: 连锁推演 (Chain Deduction)

> **当前状态**: 🟦 待启动 (PENDING)
> **目标**: 实现智能预测算法，将原始数据转化为“战争时间”的预判。

---

## 1. 核心推演逻辑 (Calculation Engine)

- [ ] **HPM 滑动窗口实现**:
    - [ ] 在 Durable Object 的 transient memory 中维护一个数组（DO 驱逐后允许丢失，从下一轮采集自动重建），记录过去 5 分钟内每一分钟的新增击数。
    - [ ] 实现平均值计算函数，剔除异常值。
- [ ] **ETA 完赛时间预估**:
    - [ ] 算法：`剩余击数 / 当前 HPM = 剩余分钟数`。
    - [ ] **趋势预测**：对比“最近 1 分钟”与“最近 5 分钟”的 HPM，给出“加速中”或“减速中”的提示。
    - [ ] **余击推演 (Buffer & Overkill Check)**:
        - [ ] 对接 Phase 2 的 **“理论极限连击 (Max Potential Chain)”** 数据源（支持全局或手动编队的局部算力）。
        - [ ] 结合 HPM 测算：判断手中的剩余弹药是会“安全溢出（提前完赛）”还是“火力不足（面临断连死局）”，并给出直观的火力差值。

## 2. 连锁风险监控 (Risk Management)

- [ ] **脱管防御与断连警报 (Risk Alert Engine)**:
    - [ ] 逻辑：结合 `timeout` 和当前 HPM。若 `timeout < 90s` 且当前 HPM 极度低迷（说明无人在接力），判定为"极高断连风险"。
    - [ ] **AlertDispatcher 接口抽象**：Phase 3 仅负责 "判断是否需要报警" 并调用 `AlertDispatcher.send(alert)` 接口。本阶段使用 `console.log` 占位实现，Phase 4 注入真正的 Discord Webhook 实现，解耦两阶段依赖。
    - [ ] **外部警报触发**：一旦触发上述危机阈值，通过 `AlertDispatcher` 推送高优报警（支持 `@here` 或 `@指定角色`），确保即使指挥官没有盯着屏幕也能瞬间被唤醒。
    - [ ] **捷报触发**：当系统判定"理论极限连击"达标（触发 FULL SEND 信号）或连锁最终目标完成时，通过 `AlertDispatcher` 发送自动化捷报至频道。
- [ ] **延迟补偿算法 (Dynamic & Adjustable Compensation)**:
    - [ ] **动态底层测算 (RTT Ping)**：委托 Phase 1 的 10 秒级 Faction Poller 在每次发起请求时，精准测算网络往返时间 (RTT) 与 API 返回的 `server_time` 偏差，将其存入 DO 内存。
    - [ ] **指挥官手动微调面板 (Manual Offset Slider)**：由于各地区网络与 Torn 内部队列波动，延迟绝对不可硬编码！在前端 Dashboard 注入一个可滑动的微调器，数值（如 `+500ms` 或 `-1200ms`）实时写入 DO，全局生效。
    - [ ] **最终倒计时合成**：大盘最终渲染的倒计时 = `Torn 原始 Timeout` - `(动态 RTT / 2)` + `指挥官手动 Offset`。这种剥离设计保证了底层网络测算与上层指挥官肉眼校准互不干扰，彻底根除“死秒 (Dead second)”断连悲剧。
    - ⚠️ **倒计时算错 = 断连，这里是整个系统最精密的数学区**:
        - [ ] **单位陷阱**：Torn API `chain.timeout` 返回的是**秒 (integer)**，`server_time` 是 **Unix 秒级时间戳**。RTT 测量用 `Date.now()` 得到的是**毫秒**。混淆单位 = 倒计时偏差数百倍。
        - [ ] **RTT 精确测量方法**：
            ```
            const t1 = Date.now();          // ms
            const res = await fetch(tornAPI);
            const t2 = Date.now();          // ms
            const rtt_ms = t2 - t1;         // 往返总延迟 (ms)
            const one_way_ms = rtt_ms / 2;  // 单程估算 (ms)
            ```
        - [ ] **timeout 语义理解**：API 返回 `timeout = 285` 意味着 "在 `server_time` 那一刻，连锁还剩 285 秒"。但该响应经过 `one_way_ms` 才到达 DO，所以 DO 收到时实际剩余 = `timeout - (one_way_ms / 1000)` 秒。
        - [ ] **合成公式（统一为秒）**：
            ```
            adjustedTimeout_s = api_timeout_s - (rtt_ms / 2 / 1000) + (commander_offset_ms / 1000)
            ```
        - [ ] **前端倒计时禁止用 setInterval**：`setInterval(fn, 1000)` 在浏览器标签不可见时会被降频（Chrome 降至每分钟 1 次）。必须使用 **目标时间戳 + requestAnimationFrame**：计算 `deadline = Date.now() + adjustedTimeout_s * 1000`，每帧渲染 `Math.max(0, deadline - Date.now())`。
        - [ ] **负值保护**：如果 `adjustedTimeout_s <= 0`，说明连锁可能已经断了。立即触发最高级别紧急警报，不要显示负数倒计时。

## 3. DO 状态机管理 (State Persistence)

- [ ] **自动快照存储**: 关键状态（`chain_status`, `selected_members`, `offset`）使用 `state.storage.put()` 实时持久化（DO 驱逐后自动恢复）。统计性数据（HPM 历史、击数曲线）每 5 分钟批量转存至 D1，用于连锁复盘（这些数据允许丢失最近 5 分钟）。
- [ ] **连锁复盘数据生成**: 在连锁结束后，生成包含“平均击率曲线”和“贡献分布图”的 JSON 总结。

---

## 4. 验证与测试清单 (Verification & Testing)

### 🧪 算法与数学审计 (Logic & Math Audit)
- [ ] **ETA 模拟测试**: 模拟不同 HPM (10 vs 2)，验证 ETA 预测的动态漂移是否合理。
- [ ] **时钟同步测试**: 验证看板倒计时与 Torn 官网倒计时误差在 ±500ms 内。
- [ ] **DO 状态持久化**: 重启服务后，DO 是否能恢复之前的击数滑动窗口数据。

### 📊 预期指标
| 验证项 | 预期结果 | 状态 |
| :--- | :--- | :--- |
| Prediction Drift | 稳定击率下，预测时间误差 < 30s | [ ] |
| DO Latency | Durable Object 状态读写延迟 < 10ms | [ ] |
| Buffer Safety | 自动算出距离连锁断裂的“安全击数”并显示 | [ ] |

---

## 5. 产出产物 (Artifacts)
- `src/do/ChainMonitor.ts` (Core logic)
- `src/utils/math.ts` (Calculations)
- `src/services/alert_dispatcher.ts` (AlertDispatcher 接口 + console.log 占位实现)
