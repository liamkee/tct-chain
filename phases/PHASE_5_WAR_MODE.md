# ⚡ Phase 5: 战时模式 (Ranked War / Territory War)

> **当前状态**: 🟦 待启动 (PENDING) (属于后期独立拓展，不干扰 Phase 0~4)
> **目标**: 针对排位战(RW)和领地战的终极微操平台。核心目标从"刷连锁"升级为"复活压制、极限抢分、情报剥离与战力精准对位"。

---

## 1. 深度敌方情报网 (Deep Enemy Intel)

- [ ] **排位战 API 轮询 (Ranked War Endpoint)**:
    - [ ] 挂载 `/faction/basic?selections=rankedwars` 接口，实时追踪双方的 `Score` (战分差距)、`Target Score` (目标分数) 以及当前交战的起止时间。
    - [ ] 实时计算并展示 **"战分追平/拉开时间 (ETA to Win/Lose)"**。
- [ ] **复活压制与出院监控 (Hospital & Revive Pattern Tracking)**:
    - [ ] 抓取敌方身处 Hospital 的出院倒计时 (`until`)。
    - [ ] **高危复活判定（统计学模型）**：⚠️ `medical_cooldown` 属于私密数据，**API 无法获取敌方的医疗冷却**。改用经验预判：
        - **Revive 响应时间**：记录敌方每次倒地后被拉起的历史耗时。平均 30s 内被 Revive = "有专属奶妈 (High Revive Risk)"。
        - **进出医院频率**：短时间内频繁出院 = 有活跃 Reviver。长期躺平 = Dead Weight。
        - **提前出院检测**：若出院时间远早于 `until`（被 Revive 提前拉出），记录此特征。
- [ ] **防逃逸与自杀监控 (Self-Hosp Detection)**:
    - [ ] 严格记录敌方进医院的 `Reason`。如果侦测到敌方关键人物频繁通过抽血 (Blood bag)、吃错药或主动撞墙自杀，立即在雷达打上"逃逸警告"标签，提醒指挥官敌人正在规避送分。

## 2. 动态战力对位与工单系统 (Fair Fight Dispatch)

- [ ] **属性估算与情报整合 (Stat Spy)**:
    - [ ] 预留 API 接口用于对接外部间谍数据库 (如 TornStats / YATA)，引入敌方的估计三围 (Estimated Battle Stats)。
    - [ ] **Fair Fight (公平交战) 算子**：在分配目标时，系统根据双方属性差，预估出这次击杀能拿到的 Respect 和 War Score。严防高属性大佬浪费体力去清扫低属性敌人（导致战分收益极低）。
- [ ] **猎杀派单系统 (Kill Ticket System)**:
    - [ ] 指挥官选中敌方 A，生成一个"猎杀工单 (Kill Ticket)"，分配给我方打手 B 和 C。
    - [ ] 工单必须包含：目标出院读秒、是否需要使用降属性武器 (如 Tear Gas / Flash Grenade)、以及谁负责首发，谁负责补刀。
    - [ ] **自动核销闭环**：当 API 侦测到敌方 A 再次被打进医院，且触发原因为我方 B 或 C，系统自动核销该工单并记录"击杀战果"。

## 3. 战时数据库矩阵 (War Mode DB Schema)

*(独立存在，前期按需建表)*

- [ ] **`RW_Intel` (情报表)**:
    - [ ] 存储敌对帮派的持久化属性：`Torn_ID`, `Estimated_Stats`, `Last_Known_Loadout` (惯用武器/防具)。
- [ ] **`War_Tickets` (猎杀工单表)**:
    - [ ] `Ticket_ID`, `Enemy_Torn_ID`, `Assigned_To_Our_IDs` (JSON Array), `Strategy` (Blind/Mug/Hosp), `Status` (Pending, Executing, Resolved, Failed)。
- [ ] **`War_Audit` (战损战果日志)**:
    - [ ] 详细记录敌方成员进出医院的操作者，战后复盘整场战争中"被第三方抢走的人头"和"我方净胜分流失"。

## 4. 战时指挥部 UI (War Room Dashboard)

- [ ] **战分对决看板**:
    - [ ] 顶部悬挂巨大的红蓝对抗进度条，直观展示 War Score 占比，并闪烁提示当前是处于 Lead (领先) 还是 Trail (落后)。
- [ ] **航班式复活时间线 (Sniper Timeline)**:
    - [ ] 将敌方所有处于医院的成员，按出院时间点绘制成一条 **横向时间轴**。
    - [ ] 节点颜色根据敌方 **Revive 历史风险等级** 渲染：深红色 = 高频被 Revive 的危险目标，灰色 = 历史上无人拉的安全目标。让指挥官像看航班起降表一样预判未来 3 分钟的猎物。
- [ ] **双向狙击网格 (Sniper Matrix)**:
    - [ ] 左右分屏。左侧为我方"蓄势待发"成员（按可用 Energy 与 Fair Fight 值排序），右侧为敌方"即将出院"成员（按出院倒计时排序）。
    - [ ] 指挥官可用鼠标在左右两边 **"画线连桥"**，一键下发工单。

## 5. 战时 Webhook 播报体系

- [ ] **单兵工单直推 (DM Alerts)**:
    - [ ] 派单后，通过 Discord Bot 直接私信我方打手："🎯 你的任务目标 [Enemy Name] 将于 15 秒后出院，建议使用 Tear Gas，请准备！"
- [ ] **战局反转警报**:
    - [ ] 当 War Score 发生阵营领跑互换，或敌方突然获得大额分数时，触发全局高优红色警报。
