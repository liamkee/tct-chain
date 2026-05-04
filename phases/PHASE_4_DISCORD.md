# 🔔 Phase 4: Discord 联动 (Discord Integration)

> **当前状态**: ✅ 已完成 (COMPLETED)
> **目标**: 将战况推送到前线，实现自动化的警报与里程碑播报。

---

## 0. 基础设施配置流程 (Discord Setup)

- [x] **创建 Discord Application**:
    - [x] 在 [Discord Developer Portal](https://discord.com/developers/applications) 创建应用（可复用 Phase 0 鉴权用的同一个 App）。
    - [x] 开启 Bot 功能，获取 `BOT_TOKEN`，并存入 Cloudflare Secret。
- [x] **获取 Faction Webhook URL**:
    - [x] 拥有 Faction Discord 管理员权限的人，在指定频道（如 `#chain-alerts`）的设置 -> 整合 (Integrations) -> 创建 Webhook。
    - [x] 复制 Webhook URL 并配置到 `wrangler.toml` 的环境变量中。
- [x] **配置 Slash Command 监听点**:
    - [x] 在 Developer Portal 的 `Interactions Endpoint URL` 中填入我们后端的路由地址（例如：`https://torn.nobaggage2rome.com/api/discord/interactions`）。
    - [x] 将 Bot 邀请加入 Faction 的 Discord 服务器。
- [x] **获取关键 ID (开启 Discord 开发者模式)**:
    - [x] 获取需要被 `@` 的角色 ID（例如 `@Chain_Commander` 的 Role ID），记录在配置中，保证 Webhook 发送时能正确高亮对应人群。

## 1. Webhook 多频道推送架构

- [x] **频道映射逻辑**:
    - [x] 配置 `ALERTS_WEBHOOK_URL` (高优警报)。
    - [x] 配置 `BATTLE_LOG_WEBHOOK_URL` (常规战报)。
- [x] **Embed 模板设计**:
    - [x] 使用 Discord `Embed` 规范：左侧颜色条根据风险等级变化（绿/黄/红）。
    - [x] 动态进度条：使用字符画模拟 `[████░░░░░░] 40%`。

## 2. 警报与战报逻辑

- [x] **紧急提醒逻辑**:
    - [x] 触发条件：对接 Phase 3，当 `timeout < 90s` 且火力断档时触发。
    - [x] 内容：使用 `<@&ROLE_ID>` 语法强力 `@指挥官` 或 `@当前有药的成员`，并附带一条前往战术面板的直达链接。
- [x] **冲锋与里程碑播报**:
    - [x] 对接 Phase 2 的“决战冲锋信号”：当算力引擎提示“全员爆发火力可达标”时，推送冲锋令。
    - [x] 监控 `faction_stats`，当连锁长度达到 1k, 2.5k, 10k 等整数关口时，自动触发里程碑战报，列出当前的 Top 3 击手。

## 3. 防骚扰与指令交互

- [x] **推送去重逻辑 (Deduplication)**:
    - [x] 在 DO transient memory 中记录最后一次警报的 `AlertID` 和时间（无需持久化，DO 重启后重置即可）。
    - [x] 规则：1 分钟内即便多次触发临界值，也仅发送一条提醒。
- [x] **Slash Command 实现 (基于 Hono Discord API)**:
    - [x] `/chain status`: 允许用户在 Discord 中直接查询当前 ETA 和 HPM。

---

## 4. 验证与测试清单 (Verification & Testing)

### 🧪 警报可靠性审计 (Alert & Webhook Audit)
- [x] **阈值临界测试**: 模拟时间降至 119s，验证 Discord 警报是否立即触发。
- [x] **推送去重测试**: 验证在同一报警窗口内，不会发生重复推送。
- [x] **Mention 解析测试**: 验证 Webhook 能否正确 @Role_ID。

### 📊 预期指标
| 验证项 | 预期结果 | 状态 |
| :--- | :--- | :--- |
| Webhook Speed | 逻辑触发后 2000ms 内 Discord 收到消息 | [x] |
| Rich Embed | 消息包含进度条与贡献 Hitter 排行 | [x] |
| Admin Command | `/status` 命令能在 500ms 内返回当前战况 | [x] |

---

## 5. 产出产物 (Artifacts)
- `src/services/discord_webhook.ts`
- `src/utils/embed_templates.ts`
