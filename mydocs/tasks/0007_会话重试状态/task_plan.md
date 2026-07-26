# Task Plan: 会话重试状态

## Current State

- Status: `Codex-only Implementation Complete / Pre-Commit Review PASS / Windows E2E Deferred`
- Current phase: Review complete；等待提交授权或 Linux/CI E2E
- Spec: [SPEC.md](SPEC.md)
- Findings: [findings.md](findings.md)
- Latest progress: [progress.md](progress.md)
- Parent: [0002 / P-02](../0002_fork改进与主线覆盖总控/SPEC.md)
- Blocking gate: Product Execution Approval `Approved`（2026-07-26）

## Work Items

- [x] 从二号总表筛选唯一相关项 `P-02`，排除 `M-01` 和 C-12。
- [x] 清空旧 0007 内容，记录当前基线与 fork 代表提交。
- [x] 同步父表状态、计数、路线和子 Spec 注册表。
- [x] 复核 Agent/Timeline CodeMap、最新 `upstream/main` owner 和现有测试入口。
- [x] 建立 Provider 输入矩阵，并裁定本阶段只覆盖 Codex。
- [x] 定义 `providerRetryMessage?: string`、原文透传、owner、reset/stale、非持久化与 App sync 边界。
- [x] 固化 Codex adapter、manager、projection、schema、App 与 E2E 的定向测试清单。
- [x] 深入复核 warning 无 threadId、同 daemon 新订阅、`fetch_agents` live snapshot、list-item/cache 投影与可配置 retry budget 边界。
- [x] 补查 App 字段传播链、`AgentStreamView` memo/sync 门禁、close/reload/replace/archive 清理、warning `null`、缺失 native turn ID、详情入口复用与 UI 测试形态。
- [x] 用户要求实施时，给出 Codex-only Execute checkpoint 并取得精确 `Plan Approved`。
- [x] 实施 Codex adapter、manager/snapshot、App/footer 与定向测试。
- [x] R1：stale native-turn compaction 不得清除当前 retry，并补 adapter 乱序测试。
- [x] R2：closure 清除 retry 时推进 `updatedAt`，并补 live snapshot 乱序测试。
- [x] R3：bootstrap buffer 按版本而非异步完成顺序保留最新 update，并补倒序完成测试。
- [x] 复用现有定向验证、完成 Standards/Spec 复审，并按真实结论回写 0007 与父表。

## Dependencies

- 当前主线 retry timeline 与 host reconnect UI。
- 父表 `E07` 及 fork `5b5d68311` 仅作 Research 输入。
- Codex 0.145.0 只提供 `willRetry` 与 `error.message`；次数只可作为原文显示，禁止解析为 attempt。
- 协议字段必须 optional 且 live-only；本设计不增加 capability、RPC 或 compat shim。
- `provider_retry` 必须绕过通用 coalescer、waiter、timeline 和持久化路径。
- 活动 `fetch_agents`/`agent_update` 可承载 live 值；`StoredAgentRecord`、`AgentListItemPayload` 和 replica cache 必须排除。
- App 只有 authoritative + sync idle + running 时才显示；字段必须贯穿 snapshot、store、screen state、memo comparator 和 footer。
- `turn/completed.turn.id` 缺失时不能用完成通知清除当前 retry；关闭、重载、替换和归档必须显式清理 live 值。
