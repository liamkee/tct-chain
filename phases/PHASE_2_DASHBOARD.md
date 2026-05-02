# 📊 Phase 2: 战术面板 (Tactical Dashboard)

> **当前状态**: 🟩 进行中 (IN_PROGRESS)
> **目标**: 构建聚合数据接口与高响应前端，为指挥官提供实时决策支持。

---

## 1. 聚合接口与实时推送 (Backend / API)

- [x] **WebSocket 服务构建 (三段式握手)**:
    - [x] 在 Hono 中实现 `/ws` 路由，**仅用作鉴权网关**：验证 JWT/Cookie → 转发至 `ChainMonitor` DO。
    - [x] **DO 接管生命周期**：使用 **WebSocket Hibernation API** 管理连接，降低计费。
    - [x] **实时同步与快照**：实现了 `/snapshot` 获取初次状态，WS 增量推送后续更新。
- [x] **数据聚合与全息作战板**:
    - [x] **DO 内存状态持久化**：即使 DO 唤醒也能从 storage 恢复姓名、状态等关键数据。
    - [x] **全局编队勾选**：`global_selected_members` 逻辑已在 Store 和 UI 预留，支持全服同步推演。
- [x] **推送调度优化**:
    - [x] 成功过滤健康检查等垃圾消息，确保 WebSocket 总线纯净。

## 2. 前端看板开发 (Frontend / React)

- [x] **核心状态管理 (Zustand)**:
    - [x] **WebSocket 吞吐引擎**：`useDashboardStore` 已能秒级处理增量成员更新数据包。
    - [x] **状态合并逻辑**：自动合并 snapshot 数据与后续的 WS soft-update。
- [x] **看板组件实现**:
    - [x] **战术矩阵 UI (Member Matrix)**:
        - [x] **姓名优先显示**：标题栏展示粗体成员名，下方标注 ID，提升识别速度。
        - [x] **实时指标可视化**：能量条、Drug CD、Refill 状态 (READY/USED) 动态刷新。
        - [x] **状态反馈**：Okay (绿), Hospital (红), Jail (橙) 等色块提示。
    - [x] **系统日志终端**：界面底部实时滚动来自 DO 的操作日志。
- [x] **系统控制中枢 UI**:
    - [x] 显眼的 **Master 控制总闸按钮**：支持一键强制开启/关闭全系统轮询（后端 `/clear` 和 `/start` 接口已就绪）。
    - [x] **Chain Target 输入器**：允许管理员动态设置本次行动的目标连锁数。
- [x] **智能交互过滤器**:
    - [x] 实现“战力优先”排序逻辑（基于 Energy + Refill 潜力综合倒序）。
    - [x] 实现“隐藏不可用人员”开关（过滤 Hospital/Traveling 成员）。

## 3. 用户体验增强 (UX Improvements)

- [x] **响应式细节优化**: 针对手机端进一步压缩卡片间距，提升单屏信息密度。
- [x] **数据刷新指示**: 实时展示 `lastUpdatedAt`，确保指挥官知道数据是“鲜活”的。
- [x] **动态警报效果**: 连锁时间不足时触发全屏红色遮罩或标题闪烁。

---

## 4. 验证与测试清单 (Verification & Testing)

- [x] **基础连通性**: WebSocket 连接正常且无内存泄漏。
- [x] **数据一致性**: 确保 Faction API 抓取的名字与 D1 数据库映射一致。
- [ ] **极端情况测试**: 测试在帮派成员频繁切换状态（如疯狂出击）时的 UI 稳定性。

---

## 5. 产出产物 (Artifacts)
- [x] `src/api/dashboard.ts` (API 路由)
- [x] `src/hooks/useDashboardStore.ts` (核心状态机)
- [x] `src/components/MemberGrid.tsx` (实时矩阵组件)
- [x] `src/services/monitor.ts` (DO 聚合逻辑)
