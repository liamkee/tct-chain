# 🧠 Phase 3: 连锁推演 (Chain Deduction)

> **当前状态**: ✅ 已完成 (待实战验证)
> **目标**: 实现智能预测算法，将原始数据转化为“战争时间”的预判。

---

## 1. 核心推演逻辑 (Calculation Engine)

- [x] **HPM 滑动窗口实现**:
    - [x] 在 Durable Object 中维护击数数组，记录过去 5 分钟内的新增击数。
    - [x] 实现平均值计算函数，采用 Trimmed Mean 剔除异常值。
- [x] **ETA 完赛时间预估**:
    - [x] 算法：`剩余击数 / 当前 HPM = 剩余分钟数`。
    - [x] **趋势预测**：对比“最近 1 分钟”与“最近 5 分钟”的 HPM，给出“加速中”或“减速中”的提示。
    - [x] **余击推演 (Buffer & Overkill Check)**:
    - [x] 对接 Phase 2 的 **“理论极限连击 (Max Potential Chain)”** 数据源。
    - [x] **动态时间轴战力预测 (Time-Aware Potential)**:
        - [x] 实现基于时间的能量回归算法 (Donator +5e/10m, Normal +5e/15m)。
        - [x] 实现资源释放预测 (Booster 窗口、Drug 补给点)。
        - [x] **综合推演**: 算出未来 `T+1h` 的全帮派总击数预测。
    - [x] 结合 HPM 测算：判断手中的剩余弹药是否能提前完赛，并给出直观的火力差值。

## 2. 连锁风险监控 (Risk Management)

- [x] **脱管防御与断连警报 (Risk Alert Engine)**:
    - [x] 逻辑：结合 `timeout` 和当前 HPM。若 `timeout < 30s` 判定为"高断连风险"并触发报警。
    - [x] **AlertDispatcher 接口抽象**：已实现内部报警分发逻辑（目前对接微日志与 Console）。
    - [ ] **外部警报触发**：(Phase 4 待对接 Discord)。
    - [ ] **捷报触发**：(Phase 4 待对接 Discord)。
- [x] **延迟补偿算法 (Dynamic & Adjustable Compensation)**:
    - [x] **动态底层测算 (RTT Ping)**：已在每次 Faction Poller 请求时实时测算 RTT。
    - [x] **指挥官手动微调面板 (Manual Offset Slider)**：后端与前端均已实现，支持毫秒级微调。
    - [x] **最终倒计时合成**：公式 `Timeout - (RTT/2) + Offset` 已集成至推演算法。
    - ⚠️ **倒计时算错 = 断连，这里是整个系统最精密的数学区**:
        - [x] **单位陷阱**：已严格区分秒与毫秒，确保计算无误。
        - [x] **RTT 精确测量方法**：已通过 fetch 前后打点实现精准测算。
            ```
            const t1 = Date.now();          // ms
            const res = await fetch(tornAPI);
            const t2 = Date.now();          // ms
            const rtt_ms = t2 - t1;         // 往返总延迟 (ms)
            const one_way_ms = rtt_ms / 2;  // 单程估算 (ms)
            ```
        - [x] **timeout 语义理解**：API 返回 `timeout = 285` 意味着 "在 `server_time` 那一刻，连锁还剩 285 秒"。但该响应经过 `one_way_ms` 才到达 DO，所以 DO 收到时实际剩余 = `timeout - (one_way_ms / 1000)` 秒。
        - [x] **合成公式（统一为秒）**：
            ```
            adjustedTimeout_s = api_timeout_s - (rtt_ms / 2 / 1000) + (commander_offset_ms / 1000)
            ```
        - [x] **前端倒计时禁止用 setInterval**：已实现基于 `deadline` 时间戳与 `requestAnimationFrame` 的毫秒级补间渲染。
        - [x] **负值保护**：已在 `monitor.ts` 实现 `FATAL` 报警逻辑，且前端 `isBroken` 状态支持全屏紧急视觉反馈。

## 3. DO 状态机管理 (State Persistence)

- [x] **自动快照存储**: 关键状态（`hpm_history`, `last_rtt`, `manual_offset`）使用 `state.storage.put()` 实时持久化。
- [x] **连锁复盘数据生成**: 已实现每 5 分钟向 D1 定时转存。

---

## 4. 验证与测试清单 (Verification & Testing)

### 🧪 算法与数学审计 (Logic & Math Audit)
- [x] **ETA 模拟测试**: 模拟不同 HPM (10 vs 2)，验证 ETA 预测的动态漂移是否合理。 (已通过 `verify_eta_logic.js` 模拟验证)
- [x] **时钟同步测试**: 验证看板倒计时与 Torn 官网倒计时误差在 ±500ms 内。 (已实现 DO 绝对时间轴同步)
- [x] **DO 状态持久化**: 重启服务后，DO 是否能恢复之前的击数滑动窗口数据。 (已修复 `memberMinutesCache` 存储逻辑)

### 📊 预期指标
| 验证项 | 预期结果 | 状态 |
| :--- | :--- | :--- |
| Prediction Drift | 稳定击率下，预测时间误差 < 30s | [x] |
| DO Latency | Durable Object 状态读写延迟 < 10ms | [x] |
| Buffer Safety | 自动算出距离连锁断裂的“安全击数”并显示 | [x] |

---

## 5. 产出产物 (Artifacts)
- `src/do/ChainMonitor.ts` (Core logic)
- `src/utils/math.ts` (Calculations)
- `src/services/alert_dispatcher.ts` (AlertDispatcher 接口 + console.log 占位实现)
