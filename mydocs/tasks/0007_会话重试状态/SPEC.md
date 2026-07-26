# Feature Spec: 会话重试状态

## Task Identity

- Parent Spec: [0002](../0002_fork改进与主线覆盖总控/SPEC.md)
- Parent Item: `P-02`（唯一）
- Status: `Codex-only Implementation Complete / Pre-Commit Review PASS / Windows E2E Deferred`
- Current `HEAD`: `feb4e82d5f0e8ddacf85217664941a9e27ab7dc6`
- `origin/main`: `b64f4f35784876021268583b1736ad951495946c`
- `upstream/main`: `65633004b23d6eeeda9321e04f096ca647694b2b`
- Fork: `E:\Code\paseo-reclaude` at `6fb48efdf6eb8daef33d9a818b074d75fa61b39d`
- Fork reference: `5b5d68311`（“显示 provider 重连状态提示”）

## Goal

- 要解决的问题：Codex CLI 在运行时已能显示 `Reconnecting... N/M` 这类重试文案，但 Paseo 丢弃 app-server `error` 通知，因此会话 footer 没有同等反馈。
- 最终目标：在保留现有 retry timeline 和 host reconnect UI 的前提下，让 Codex 会话 footer 实时显示上游原始 retry 文案，包括上游已写入文案的次数；不猜测、解析或补造次数。
- 本轮目标：按已冻结的 Codex-only 合同实施产品代码与定向测试，不扩展到其他 Provider。

## Done Contract

- 本轮完成：已在远端核对 `upstream/main@65633004b`，并以 Codex CLI `0.145.0` 稳定 schema、上游实现与官方文档确认：`willRetry=true` 的 `error.message` 是 CLI 可见的唯一次数载体，`ErrorNotification` 没有结构化 attempt、max-attempt 或 delay 字段。
- 产品已完成：live `AgentSnapshotPayload`、Codex 原文转发和 footer 链路已落地；stale compaction、closure 时间戳和 bootstrap completion-order 三个提交前阻断项已按根因最小修复，并通过对应乱序回归与最终 Standards/Spec 复审。
- 残余验证：真实浏览器用例已覆盖 `2/5 -> 3/5 -> clear`、断线/stale 隐藏和长文本截断，但 Windows Playwright harness 在 global setup 阶段因 POSIX `which` 与 `spawn("npx")` 失败，需在 Linux/CI 执行；这不扩大为本任务内的 E2E 基础设施修复。
- 不算完成：解析 `N/M` 生成 attempt、伪造 `1/M`、展示 `additionalDetails`、复用 durable timeline/`lastError` 冒充实时状态，或让 child retry 泄漏至 root footer。

## Scope

### In

- 总表 `P-02` 的 Codex 子范围：app-server `error`、`warning`、turn notification 到 footer 的 live 状态链路。
- 一个向后兼容的 optional snapshot field、一个内部 `provider_retry` stream event 和明确的 set/update/clear 生命周期。
- Codex 原始 `error.message` 的逐字透传、footer 单行展示和旧 daemon 缺字段归一化。
- Codex root/native-turn 关联、child/pending-child 隔离、late event、防 stale snapshot 与不持久化边界。
- 现有 retry timeline、host reconnect UI 与新 live snapshot 的职责边界。

### Out

- `M-01` desktop smoke PID JSON 部分写入重试；它是测试工具文件可靠性问题。
- C-12 loading 动画与 reduced motion；用户已确认不再作为产品问题处理。
- Claude、OpenCode、OMP、Copilot/ACP、Pi 的本阶段接入或统一 Provider 状态对象。
- 通用网络请求重试框架、host 连接架构重写或 timeline 重构。
- 从错误文案解析 attempt/backoff，或要求所有 Provider 暴露相同细节。
- `server_info.features` capability、专用 RPC、持久化字段、`AgentListItemPayload` 投影或 retry action。
- 不更新持久 CodeMap 或长期项目文档；实现结果只回写当前任务记录与父表投影。

## Facts And Constraints

### 已确认

- 二号总表只有 `P-02` 直接描述会话执行期间的 Provider 重连/重试状态。
- 远端 `upstream/main` 已核对为 `65633004b`，`packages/server` 版本为 `0.2.1`；主线没有 `providerRuntimeState` 或 `provider_runtime_changed`。
- fork 代表提交 `5b5d68311` 只从 OpenCode `session.status` 生成 runtime state，虽跨 17 个文件，但不能代表其他 Provider，也不能整体 cherry-pick。
- 当前工作树包含其他任务改动，后续研究和实施必须避开无关文件。
- Agent/Timeline CodeMap 已复核为 `Update Required`；本任务未获得持久 CodeMap 更新 checkpoint，当前以源码为准。
- Codex 0.145.0 的稳定 app-server schema 包含 `method: "error"`，payload 必填 `error`、`willRetry`、`threadId`、`turnId`；`TurnError.message` 为 string，且没有 attempt、retry delay 或 backoff 字段。
- 当前 Codex adapter 没有 `error` schema 分支；该通知落入 `unknown_method`，只写 trace，不产生会话状态。
- Codex 上游把 transient `StreamError` 转为 `willRetry=true`；terminal error 用 `willRetry=false`。其 TUI 在任一 non-retry live notification 时清除 retry header。
- Codex runtime `warning` notification 只有可选 `threadId` 与 `message`；初始化/config warning 可能没有 threadId，不能被宽泛地当作 root retry 清除信号。
- Codex `stream_max_retries` 默认值为 5、可配置且上限为 100；`N/M` 的 `M` 不能硬编码。
- Codex 的 release/WebSocket 路径可能隐藏第一次 retry notification，因此首个可见字符串可为 `Reconnecting... 2/5`；产品不得假定从 `1/5` 开始。
- 手动或自动 compact 也可能复用相同 retry 文案；底层 `request_max_retries` 本身不保证发出可显示的 app-server notification。
- `additionalDetails` 是底层错误详情，不属于 footer 文案。
- ACP SDK 0.17.1 没有标准 retry session update；Pi 当前 RPC 合同也没有已知 retry 事件。
- 当前 App 的有效传播链是 `normalizeAgentSnapshot` -> `Agent` -> `ChatAgentStateShape` -> `selectChatAgentState`/`buildChatAgentFromState` -> `AgentScreenAgent` -> `AgentStreamView` -> `TurnFooter`；任一层漏传都会让协议字段存在但 footer 不变。
- `AgentStreamView` 使用自定义 `agentStreamViewPropsEqual`，必须比较 retry 文案；否则只改变 retry 文案时 memo 会阻止 footer 重渲染。
- `AgentPanel` 能得到 `viewState.source` 与 `viewState.sync.status`，但当前没有把 sync guard 传入 `AgentStreamView`；实现必须显式限制为 authoritative、sync idle、running，catch-up/reconnecting/sync-error/stale 不能显示旧值。
- 除 `fetch_agents`/`agent_update` 外，`fetch_agent`、timeline response 中的活动 agent 以及 MCP `get_agent_status` 也复用 `AgentSnapshotPayload`；它们可自然携带 live retry 字段，stored/list-item 投影仍不得携带。

### Adopted Codex Design

| 层             | 最小合同                                                                                       | 明确不做                                                            |
| -------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Wire snapshot  | `AgentSnapshotPayload.providerRetryMessage?: string`                                           | `null`、status object、attempt、maxAttempts、delay、capability flag |
| Internal event | `{ type: "provider_retry"; provider; message: string or null }`                                | native thread/turn ID、timeline row、waiter notification、专用 RPC  |
| Adapter        | `willRetry=true` 时原样使用 `error.message`；`willRetry=false` 时清除                          | trim、正则解析、重写或补造 `N/M`                                    |
| Manager        | live-only `string or null` 状态；仅值变化时更新 `updatedAt` 并 `emitState({ persist: false })` | 写入 `StoredAgentRecord`、durable timeline、`AgentListItemPayload`  |
| App            | 缺字段归一化为 `null`；`viewState.sync.status === "idle"` 且 running 时单行显示原文            | 在 reconnect/catch-up/stale view 中展示可能过期的文案               |

- 不加 capability：这是 optional snapshot 的被动展示增益，没有新 RPC、操作入口或旧协议回退路径；字段缺失已精确表示“本次 snapshot 没有活跃 retry 文案”。
- snapshot 只在值为 string 时包含字段；clear 后字段省略。旧 daemon 因而不受影响，App 在边界统一为 `null`。
- `provider_retry` 必须在 `AgentManager` 的通用 `touchUpdatedAt` 与 60ms stream coalescer 前处理。相同 message 不更新时间、不发 snapshot；set、update、clear 都要推进时间戳，避免 bootstrap/directory replica 因同一时间戳丢掉 live 更新。
- `provider_retry` 只来自 live session subscription；provider history replay 或 daemon rehydrate 不得重新点亮旧 retry 文案。仍在同一 daemon 中的新 client subscription 可以从当前内存 snapshot 收到正在进行的 retry；client cache 或 daemon restart 不得恢复旧文案。Codex TUI 对 initial replay 也不恢复 retry header。
- adapter 先解析 native `threadId`，未确认 root owner 前不把通知当作 root；再把原生 `error.turnId` 与 `currentTurnId` 比对，最后才由 `emitEvent` 绑定 Paseo foreground turn。`turn/completed` 要保留可选 native `turn.id`，只消费匹配 completed，并清除 `currentTurnId`；terminal 后迟到 error 不得重新显示。
- matching root `willRetry=false`、后续带有当前 root thread/turn 关联的任意正常 live notification、new turn、任一 terminal、close 与 reload 都清除。transport-fallback `warning` 没有必填 native turn ID，只有 warning 的 root thread 与当前 native turn association 已确认时才能清除；无 threadId 的初始化/config warning 不得清除。`5/5 -> warning -> 1/5` 是必须保留的 WebSocket fallback 路径。
- 清除应集中在 root notification route 已确认、native identity 已校验之后：root `turn/started`、matched `turn/completed`、delta/item、plan/diff/token usage、command、compaction/rollback 与匹配 warning 属于正常 live activity；child/pending-child、unmapped、invalid payload 和 unknown method 必须完全不触碰 root retry。不能等 `notifySubscribers()` 用 Paseo foreground turn 覆盖 provider turn ID 后再判断。
- child 与 pending-child 的 error/warning 只能留在 child route，不能改变 root footer；但 Codex review 的 stream error 会以父 native thread/turn 上报，root route 已确认时应正常显示，不能按“子任务来源”做宽泛过滤。out-of-band compact 没有 Paseo foreground turn 时，若 native turn 匹配仍可更新 live snapshot。
- 活动 Agent 的所有 `AgentSnapshotPayload` 详情（包括 `fetch_agents`、`agent_update`、`fetch_agent`、timeline response 和 MCP `get_agent_status`）可以携带该字段；App replica cache 的显式 serializer 与 deserializer、`StoredAgentRecord` 与 `AgentListItemPayload` 必须排除该字段。即使 cache 预置了该 key，rehydrate 也必须丢弃；daemon/process restart 后不恢复 retry 文案。
- App 传播实现必须把 absence 统一归一化为 `null`，并在 `AgentScreenViewState` 的 `source !== "authoritative"` 或 `sync.status !== "idle"` 时向 footer 投影 `null`（或传递等价的 `showLiveProviderRetry=false`）；不能只依赖 agent 的 `status`。
- 稳定 Codex schema 要求 `turn/completed.turn.id`；若为兼容旧 Codex 保留 permissive parser，缺失 native ID 的 completed 不能作为 retry clear/stale 判定的证据，至少要覆盖“无 ID 完成通知不清除当前 retry”。

### Targeted Test Checklist

| 层/目标文件                                                                                                                                          | 必须证明的行为                                                                                                                                                                                                                                                                                                                          |
| ---------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `codex-app-server-agent.test.ts`                                                                                                                     | `Reconnecting... 2/5 -> 3/5` 原样输出；不假定首条为 `1/5`；相同值不重复；`willRetry=false`、root delta、terminal、warning 都清除；`5/5 -> warning -> 1/5` 可重新进入；`additionalDetails` 不透传。                                                                                                                                      |
| `codex-app-server-agent.test.ts` 与 fake app-server helper                                                                                           | fake `error` 含四个 required native fields，`completeTurn()` 默认含 native turn ID；stale native turn error 与 terminal 后迟到 error 被忽略；matched completed 清 native turn；child/pending-child 不影响 root；无 Paseo foreground turn 的 matching compact retry 可发出 event。                                                       |
| `agent-manager.test.ts`、`agent-updates-service.test.ts`                                                                                             | set/update/clear 推进 `updatedAt` 并发 live snapshot；相同值不更新也不发 snapshot；live event 不进 waiter/timeline/持久记录，history replay 不复活状态；同 daemon 新订阅可收到当前内存 retry，持久化 bootstrap 不覆盖较新的 buffered live update；new turn、completed/failed/canceled、cancel、close、reload、replace、archive 都清除。 |
| `agent-projections.test.ts`、`agent-feature-schemas.test.ts`、必要的 `session` list request test                                                     | live snapshot 接受缺失或 string，拒绝 `null`/number/object；活动 `fetch_agents`、`fetch_agent`、timeline response 和 MCP `get_agent_status` 可携带 live 值，stored/`AgentListItemPayload` projection 无字段。                                                                                                                           |
| `agent-snapshots.test.ts`、`agent-directory-reconciliation.test.ts`、`use-agent-screen-state-machine.test.ts`、`runtime/replica-cache/index.test.ts` | 旧 daemon 缺字段归一化为 `null`；较旧 clear/set snapshot 被拒绝；预置 cache 中的 retry key 不被 rehydrate；string 逐字保留并贯穿 `normalizeAgentSnapshot -> Agent -> ChatAgentStateShape -> AgentScreenAgent`。                                                                                                                         |
| `agent-stream/view.tsx`、`agent-stream/turn-footer.tsx` 与浏览器 E2E                                                                                 | `agentStreamViewPropsEqual` 比较 retry 文案；mock `2/5 -> 3/5 -> clear`；只有 `source === "authoritative"`、sync idle 且 running 时显示；catch-up/reconnecting/sync-error/stale 不显示旧值；长文本保持单行截断、不撑破 footer。UI 验证使用真实浏览器/E2E，不新增 JSDOM/RN mount 测试。                                                  |

额外 adapter 回归：root delta/item/plan/diff/token/command/compaction/rollback 必须清除；child、pending-child、unmapped、invalid payload、unknown method 都不清除；以父 native thread/turn 上报的 review retry 仍应显示；fake `completeTurn()` 默认发送 native `turn.id`，而 permissive 的无 ID completed 不得清除当前 retry。

### Pre-Commit Remediation Plan

- Approval: `Approved`（2026-07-26，用户明确要求按三个 P1 做最小修复、补乱序测试并重新审查）。
- Test seams: Codex adapter 的公开 session subscription、AgentManager 的公开 state subscription、AgentUpdatesService 的公开 subscription output；不测试私有方法。

| 单元 | 最小产品改动                                                                                          | Red/Green 验收                                                                                     |
| ---- | ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| R1   | `handleRootProviderRetryState()` 对携带 native `turnId` 的 compaction 只在匹配当前 native turn 时清除 | 旧 turn compaction 不清当前 retry；当前 turn compaction 仍清除                                     |
| R2   | `prepareAgentForClosure()` 在生成 closed/null snapshot 前推进 `updatedAt`                             | close snapshot 的时间戳严格晚于最后 retry snapshot，旧 running/retry snapshot 不能在乱序交付后胜出 |
| R3   | bootstrap pending Map 只允许同一 agent 的较新版本覆盖较旧版本                                         | `2/5 -> 3/5 -> clear` 即使异步倒序完成，flush 仍保留 clear                                         |

### Product Execution Approved

- 当前 Codex-only scope、wire field、reset/stale 语义和定向测试已裁定。
- 用户已于 2026-07-26 明确回复 `Plan Approved`；按本合同实施产品代码与定向测试。

## Selection Decision

| 总表项 | 决定 | 理由                                                                    |
| ------ | ---- | ----------------------------------------------------------------------- |
| `P-02` | 纳入 | 唯一直接覆盖 Provider 重连/重试实时 footer 状态的条目                   |
| `M-01` | 排除 | 只处理 desktop smoke 读取半写入 PID JSON，与会话 runtime 状态无共享合同 |
| `C-12` | 排除 | loading 静止来自系统 reduced motion，用户明确不再处理                   |

## Research Plan

1. 已完成：复核 Agent/Timeline CodeMap、项目文档、最新远端主线和 fork `5b5d68311`。
2. 已完成：核验六个内建 Provider 的原生 retry 事件与当前 adapter 消费情况。
3. 已完成：追踪 Codex TUI 与 app-server retry 运行时，确认次数保留在 `error.message`，并识别 warning、child、stale native turn、bootstrap 与 cache 边界。
4. 已完成：固化 Codex-only optional field、owner、reset/stale 语义和定向测试。
5. 已完成：补查 App 传播链、memo/sync 门禁、关闭/重载/归档清理、warning `null`、缺失 native turn ID 和 `AgentSnapshotPayload` 复用边界。
6. 已完成：按提交前 Review 的三个 P1 执行 red/green 修复并重新审查；Windows 本地无法启动的浏览器用例保留给 Linux/CI。

## Approval

- Documentation Approval: `Approved`（用户明确要求清空并改写 0007、同步二号总表）
- Research Approval: `Approved`（用户明确要求继续调查 Provider 支持矩阵并重点核验 Codex）
- Product Execution Approval: `Approved`（2026-07-26，用户明确回复 `Plan Approved`）

## Validation

- Research：远端 `ls-remote` 与本地 ref 一致；本机 Codex 0.145.0 的稳定 JSON Schema/TypeScript bindings 生成成功；对主线、SDK 类型和 fork 进行定向检索。
- 文档：0007 与父表 P-02 通过定向格式检查和 `git diff --check`。
- 产品：protocol `8/8`、projection `17/17`、snapshot `4/4`、replica cache `5/5`、screen state `26/26`、directory `7/7`、live `agent_update` `29/29`、Manager `145/145` 与 Codex retry `4/4` 定向测试通过；`npm run build:client`、`npm run typecheck` 和 `npm run lint` 通过。
- 提交前复审：R1-R3 均使用批准的公开 subscription seam 验证；Standards 与 Spec 两轴均为 `PASS`，未发现新的 Codex-only 阻断项。
- 浏览器：用例和 WebSocket snapshot 注入 helper 已落地；Windows harness 在浏览器启动前失败，未声称 UI E2E 已运行通过。

## Change Log

- 2026-07-25：清空原 C-12 Electron 动画调查内容，将 0007 改挂总表 `P-02`。
- 2026-07-25：确认 `M-01` 不属于会话重试状态范围；记录当前三方基线和 fork 代表提交范围。
- 2026-07-25：完成 Provider retry 支持矩阵；确认 Codex 无结构化 attempt，产品 Execute 仍未授权。
- 2026-07-25：更正为 Codex-only 设计：CLI 可见的次数存在于原始 `error.message`，以 `providerRetryMessage?: string` 逐字透传，不解析为公共 attempt。
- 2026-07-25：补齐 warning 无 threadId、同 daemon 新订阅、活动 `fetch_agents`、list-item/cache 投影与可配置 retry budget 边界，并修正现有协议测试入口。
- 2026-07-25：补查 App 字段传播与 `AgentStreamView` memo/sync 门禁、close/reload/archive 清理、warning `null`、缺失 native turn ID 及其他 live snapshot 详情入口，并将 UI 测试约束为真实浏览器/E2E。
- 2026-07-26：用户批准 Codex-only Execute checkpoint，产品实现进入进行中状态。
- 2026-07-26：完成 Codex-only live retry 链路、定向测试与三轴 Review；Windows 浏览器 E2E 延后到 Linux/CI，未 stage、commit 或 push。
- 2026-07-26：提交前复审撤回 PASS；确认 stale compaction、closure 时间戳和 bootstrap completion-order 三个 P1，用户批准最小修复与乱序回归。
- 2026-07-26：完成 R1-R3 根因修复与公开 seam 乱序回归；复用既有定向清单后，Codex-only 最终 Standards/Spec 复审恢复为 PASS。

## Resume

- 当前状态：`Codex-only Implementation Complete / Pre-Commit Review PASS / Windows E2E Deferred`。
- 当前边界：只覆盖 Codex 原始 retry 文案；不接入其他 Provider，不更新持久 CodeMap。
- 下一步：在 Linux/CI 运行已落地的浏览器用例；提交或推送仍需用户另行授权。

## Project Sync Candidates

- Agent/Timeline CodeMap 确有漂移，但持久更新需要独立 checkpoint；本轮结论保留在 0007，不修改长期文档。
