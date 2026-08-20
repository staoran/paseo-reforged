# Codex Goal 任务完整支持 Spec

本 Spec 覆盖 Codex Goal 的协议、daemon、Codex provider、App 和恢复验证；自动化实施、提交后审查修复和本轮复验已完成，当前等待真实环境手工验收。

## 0. 状态与索引

| 字段              | 值                                                                       |
| ----------------- | ------------------------------------------------------------------------ |
| task_id           | `0085`                                                                   |
| spec layer        | `Feature Spec`                                                           |
| task status       | `待手工验收`                                                             |
| mode              | `single_project`                                                         |
| phase             | `Review`                                                                 |
| approval status   | `Plan Approved`                                                          |
| approval source   | `User / Plan Approved / 2026-08-18`                                      |
| spec path         | `mydocs/specs/0085_Codex_Goal任务完整支持.md`                            |
| parent spec       | `N/A`                                                                    |
| supersedes        | `N/A`                                                                    |
| current task unit | `审查修复、目标自动验证和静态复核完成；等待真实 Codex kill/restart 验收` |
| created / updated | `2026-08-18 / 2026-08-20 01:42 +08:00`                                   |

## 1. 目标、范围与完成契约

- 背景/问题：Paseo 目前只把 `/goal` 当作 provider 的 out-of-band 文本命令转发。Goal 没有一等标识、持久状态和用量投影，App 也没有暂停、恢复、编辑或终止控件。Agent 进程被杀、Paseo 关闭或 daemon 重启后，Codex 可能在 `thread/resume` 期间自动继续 Goal；由于 AgentManager 尚未订阅 provider 事件且随后无条件写入 `idle`，Paseo 会丢掉 `turn_started`/`thread/status/changed`，界面既不显示 Goal，也不会进入 Working。
- 最终目标：把 Goal 作为 provider-owned、provider-neutral 的可选一等投影贯穿 protocol、daemon、Codex provider、client 和 App；在 composer 上方显示目标、状态、用量和当前步骤，提供暂停、恢复、暂停态编辑 Goal objective、终止；在异常恢复和重连时以 provider 权威状态追平，且不以本地投影替代 Codex 的 Goal scheduler 或 Agent lifecycle。
- 当前任务单元：协议、daemon、Codex provider、App、恢复链路和自动验证已经完成；唯一保留的手工验收项是真实 Codex 进程 kill/restart。
- 范围内：
  - provider-neutral Goal 类型、状态、同步状态、当前步骤投影、错误码和 capability gate。
  - `agent.goal.get/update/terminate` 点分 RPC、client 相关方法、旧新 wire 双向兼容和 zod-aot 验证。
  - daemon 的 Goal 聚合、事件顺序、权威 hydrate、恢复时序、生命周期校正、快照广播和每 Agent mutation 串行化。
  - Codex App Server 0.147.0 适配：`thread/goal/get|set|clear`、`thread/goal/updated|cleared`、`thread/status/changed`、`turn/plan/updated`，以及 resume 前事件缓存。
  - App 的 composer Goal track、当前步骤展示、用量/状态、pause/resume/edit/terminate/retry、pending/失败/过期状态、跨平台表单和全部 i18n。
  - 单元、协议、daemon/provider 集成、最小 fake daemon browser E2E、异常重启/重连和真实 Codex 手工验收。
  - `docs/providers.md`、必要的 `docs/architecture.md` 和恢复/兼容说明。
- 范围外：
  - 合并、cherry-pick、rebase、commit、push 或创建远端 PR；远端 PR 仅作为集成风险输入。
  - Codex Goal scheduler、token 预算算法或 status 枚举的重新定义；Paseo 不复制一份本地 Goal store。
  - 非 Codex provider 的 Goal 实现；它们只能通过可选接口逐步接入。
  - 通过自然语言解析猜测 Goal，或把 `/goal` acknowledgement 当作权威状态。
  - 直接写入 Codex 当前 plan step。Codex 0.147.0 的官方 App Server schema 没有 step-write RPC；本 Spec 只实现当前步骤的权威只读投影，暂停态编辑针对 Goal objective。若审批要求真正改写 step，必须在 Plan 阶段增加新的 provider-native 契约，不能用本地覆盖冒充完成。
  - queued steering、Plan mode 提示和其他与 Goal 无关的 composer 重构。
- Done Contract：
  - 支持的 provider 在 `server_info.features.agentGoalControl === true` 时，Agent snapshot 能区分 `goal === undefined`（旧 daemon/不支持/尚未 hydrate）和 `goal === null`（已权威确认无 Goal）；Goal 对象包含 objective、status、token/time 用量和 generation 时间。
  - Goal 状态和 Agent lifecycle 分离。`thread/status/changed` 或等价恢复事件能使活动恢复进入 `running`，不会被注册流程最后的默认 `idle` 覆盖；状态通知不伪造 `turn_completed`。
  - composer 上方稳定显示目标、状态、用量和 current step；active 可 Pause，paused 可 Resume/Edit，所有可终止状态可 Terminate，动作受 capability、同步状态和 provider 状态约束，并有可访问名称与失败重试。
  - objective 只能是 trim 后非空、最长 4000 字符；编辑只在 paused 状态提交，使用原生 `thread/goal/set`，保持 paused，并明确告知新 objective 会产生新 generation 且重置用量。
  - current step 由 `turn/plan/updated`/canonical todo 投影解析，不能伪造为 Goal 原生字段；Goal 清除或 objective generation 变化时，旧步骤立即失效且迟到的旧 turn plan 不会重新出现。
  - Terminate 先权威 clear Goal，再通过 AgentManager 的既有 interrupt 路径终止当前 turn；clear 与 interrupt 的部分成功、未运行和失败都在响应与 UI 中如实表达。单独的 `clear` 不承诺结束当前 turn。
  - resume/reconnect 顺序为捕获事件、订阅、hydrate Goal/Thread status、按序 drain、一次性发布最终快照；provider 异常或瞬时 `get` 失败不会把旧权威 Goal 静默清掉，也不会错误发布 idle。
  - 新 App/旧 daemon、旧 App/新 daemon、Goal 不可用的 provider、Codex 旧版本均保持可用；旧端忽略新增可选字段，新端不依赖旧端未知字段。
  - 目标协议、恢复、控制、UI、E2E 和文档验收均有可复现证据；用户未明确批准前不得进入 `Plan Approved`/`Execute`，实现完成前不得标记已收口。
- 失败或回炉方式：
  - provider 能力、schema 或恢复合同失败时只关闭 `agentGoalControl` advertisement，保留现有 `/goal` 文本路径和普通 Agent lifecycle。
  - `getGoal` 非权威失败保留最近一次内存权威投影并标记 `goalSync=stale`；没有旧投影时保持 `goal=undefined`，不猜测 `null`。
  - objective 更新冲突、clear 失败或 interrupt 部分失败均返回结构化错误，不做本地乐观覆盖；修复后通过同一 Spec 的 RED seam 回归。

### 1.1 最小任务单元判断

- 为什么当前任务单元足够小：协议字段、provider 事件和 daemon 恢复顺序共同决定 App 能否显示真实状态；拆成“先做 UI/再补恢复”会制造不可验证的中间契约。所有写入仍在一个项目、一个 Spec 内，可按执行清单逐步提交和回退。
- 验证证据：wire compatibility/AOT 测试、Codex fake app-server 测试、AgentManager resume/partial-stop 测试、App presentation/model 测试、旧 daemon browser 测试和真实重启手工脚本。
- 模型可自主决定的范围：不改变本节的字段语义、状态机、RPC 名称、generation 规则、终止顺序、capability gate 或兼容期限时，可调整私有模块名、样式值、测试夹具组织和日志字段；任何新的 wire 字段、native RPC、状态转换或本地持久化都必须回到 Plan。
- 拆分决定：`Accepted`；协议、daemon、provider、App 属于同一端到端合同，执行时按阶段清单分步验证，不另建平行 Spec。

## 2. 上下文与调研

### 2.1 上下文来源

- 需求来源：用户提出的三项缺口（Goal 标识/状态、暂停恢复、异常恢复）、Codex Desktop composer 上方的 Goal progress row 及 pause/resume/edit/clear 控件要求；用户随后明确忽略远端停止门禁，仍创建完整范围 `0085` Heavy Spec。
- 官方 OpenAI 文档（2026-08-18 实际抓取）：
  - [Long-running work](https://learn.chatgpt.com/docs/long-running-work)：确认 Desktop Goal progress row 的 pause、resume、edit、clear 行为。
  - [App Server](https://learn.chatgpt.com/docs/app-server)：确认 `thread/goal/get|set|clear`、`thread/goal/updated|cleared`、`thread/status/changed`、`turn/plan/updated`、`turn/interrupt` 和 `turn/steer` 的边界。
- Codex 事实源：Codex App Server 0.147.0 生成的 TypeScript schema；`ThreadGoal` 状态为 `active | paused | blocked | usageLimited | budgetLimited | complete`，字段含 `threadId/objective/tokenBudget/tokensUsed/timeUsedSeconds/createdAt/updatedAt`；`ThreadStatus` 为 `notLoaded | idle | systemError | active(activeFlags)`。
- 项目事实源：`PROJECT.md`、`docs/architecture.md`、`docs/rpc-namespacing.md`、`docs/protocol-validation.md`、`docs/forms.md`、`docs/floating-panels.md`、`packages/protocol`、`packages/client`、`packages/server/src/server/agent`、`packages/app/src/panels/agent-panel.tsx`、`packages/app/src/composer/task-list/index.tsx` 和对应测试。
- Codemap：`N/A`；调用链已由现有源码和本 Spec 的文件/时序表精确定位，不创建平行索引。
- Codemap Mode：`N/A`
- Context Bundle：`N/A`
- Context Bundle Level：`N/A`
- 关联任务记录：`mydocs/specs/0084_跨端中继二进制加密与状态追平压缩.md`（仅编号相邻，无代码依赖）；上游相关 issue/PR 见 2.2。

### 2.2 调研结论

#### 已确认事实

- 当前 Codex provider 仅在 `tryHandleOutOfBand` 中解析 `/goal`，调用 `thread/goal/set|clear` 后发一条 acknowledgement；没有 `get` hydrate，也没有把 Goal/Thread status 通知转成 `AgentStreamEvent`。
- 当前 `AgentSession` 没有 Goal 控制接口；`AgentSnapshotPayload` 没有 Goal 字段；App `Agent`/ReplicaCache/SessionStore 也没有一等 Goal 模型。已有 `agentTasks` 来自 todo timeline，适合做步骤来源但不能单独代表 Goal。
- `AgentManager.registerSession()` 的现状顺序是 provider `resumeSession()`、`refreshSessionState()`、无条件 `managed.lifecycle = "idle"`、persist/emit、最后 `subscribeToSession()`；resume 期间发生的 autonomous start/completion 会丢失。
- `AgentStreamEvent` 已有 `turn_started/turn_completed/usage_updated` 和 `todo`；Codex `turn/plan/updated` 目前在非 Plan mode 映射为 todo。它没有 Goal generation，迟到的旧 plan 可能重新污染当前 UI。
- `server_info.features` 是项目约定的单点 capability gate；新 WebSocket RPC 必须使用点分 `.request/.response` 命名；wire schema 是结构验证源，不应使用 transform/catch/preprocess。
- `AgentTaskList` 已位于 composer 上方。Goal track 应复用其跨平台布局和 i18n 约定，避免新增第二套浮层/表单系统。
- 远端相关 PR（截至 2026-08-18，查询 `getpaseo/paseo`）：
  - [#3179](https://github.com/getpaseo/paseo/pull/3179) 创建于 `2026-08-10 22:13:50Z`，最后更新 `2026-08-12 12:23:19Z`，当前 `OPEN / CONFLICTING / DIRTY`，没有正式 review decision。它覆盖基础 Goal snapshot、Codex notification、composer Pause/Resume/Clear 和 queued steering；未覆盖本 Spec 的 objective edit contract、current-step generation、Terminate 的 clear+interrupt 部分成功、`thread/status/changed` 生命周期校正和完整恢复顺序。该 PR 还包含本 Spec 明确排除的 queued steering，不能直接当作本任务实现。
  - [#2333](https://github.com/getpaseo/paseo/pull/2333) 创建于 `2026-07-22 18:44:59Z`，最后更新 `2026-08-13 14:57:36Z`，当前 `OPEN / MERGEABLE / BLOCKED`，没有正式 review decision。它覆盖 resume 前事件缓存、provider wrapper 转发和 active turn 恢复，和本 Spec 的恢复 seam 有重叠，但不能假设会合并，也不包含 Goal 协议/UI。
  - [#3083](https://github.com/getpaseo/paseo/pull/3083) 创建于 `2026-08-09 11:44:54Z`，只处理 Plan mode 设置 Goal 的提示，属于本 Spec 范围外的既有变更。
- 没有可核实的合并 ETA：#3179 至少要先解决冲突并重新 review；#2333 虽可合并但状态仍被维护流程阻塞。用户已明确覆盖“远端在做则停止”门禁，本 Spec 不等待其合并。

#### 未知与开放问题

- Codex 后续版本是否提供直接编辑 plan step 的 native RPC；当前 0.147.0 未提供。批准本 Spec 即表示接受“current step 只读投影、Goal objective 可编辑”的交付边界，或在批准意见中补充新的 native 契约。
- 执行时实际发布版本号和 capability 的移除日期；实现必须用落地版本替换占位，并保留至少一个正式兼容窗口。
- `blocked/usageLimited/budgetLimited` 在不同 Codex 版本上的可恢复条件；UI 可发起 Resume，但 provider 错误必须原样结构化返回，不得假装已 active。
- 是否在真实 Codex 进程上执行 kill/restart 手工验收；自动化先用 fake app-server 和 isolated daemon，真实 daemon `6767` 仍受项目保护规则约束。

#### 风险与约束

- Goal objective 是用户输入，可能含代码、路径或敏感信息；日志只记录长度、状态、generation 和错误码，不记录原文。
- `thread/status/changed` 是 lifecycle 校正信号，不等价于 turn completion；混用会破坏等待者、timeline 和 Stop 语义。
- clear 与 interrupt 不是 Codex 的原子 RPC；必须展示部分成功，且 clear 失败时不能贸然 interrupt 后让 active Goal 立即重启。
- 旧 todo 与新 Goal 的 generation 关联不完整；必须在 manager/provider 侧清除和过滤，不能由 App 猜测。
- 远端 PR 的重叠文件较多，执行时需要按当前 checkout 的实际差异重做冲突审计，不得整块覆盖用户已有改动。

### 2.3 方案与决策

- 备选方案：
  - A：继续把 `/goal` acknowledgement 当状态，App 本地解析文本。拒绝：不可恢复、不可兼容、无法处理自然语言触发的 Goal。
  - B：App 直接发送 Codex `thread/goal/*`，daemon 只做透明转发。拒绝：协议泄漏 provider 细节，无法统一权限、恢复、终止和其他 provider。
  - C：在 Paseo 建第二份 Goal store，靠本地状态驱动 UI。拒绝：和 Codex 权威状态漂移，重启时会产生假状态。
  - D：provider-neutral Goal control seam + daemon 权威投影 + Codex adapter + capability-gated App。采用。
- 已选方案：D；`AgentSession.goalControl` 是控制 seam，`AgentStreamEvent` 传递 Goal/Thread status，daemon 统一 hydrate、generation、lifecycle 和 terminate 组合，App 只消费现有 Agent snapshot/状态广播。
- 选择理由：接口小而深，复杂的 native RPC、事件排序、错误翻译和兼容逻辑留在 provider/daemon；App 不知道 Codex RPC，未来 provider 可选择实现同一可选 seam。
- current step 决策：展示由 provider plan/todo 投影的 current step；暂停时的编辑入口只编辑 Goal objective，并在表单中说明用量重置。不能把本地改写的 step 标作 Codex 权威状态；真正 step 编辑留作明确的后续 native-contract 变更。
- 终止决策：`clear` 和 `interrupt` 保持两个可观测阶段；UI 的“终止”是 daemon 组合操作，单独 slash `/goal clear` 仍只清除 Goal。

### 2.4 下一步动作

- 下一步动作 1：已完成；用户于 `2026-08-18` 明确回复 `Plan Approved`，接受 current-step 只读边界、Terminate 部分成功、Goal edit 新 generation/用量重置和 capability gate。
- 下一步动作 2：在真实 Codex Goal 运行中杀死 Agent 进程或关闭并重启隔离 Paseo，确认恢复后 Goal track、current step 和 Working 状态会自动追平；未获许可不得重启受保护的 `6767` daemon。

## 3. 计划与执行前检查点

### 3.1 文件变化

| 项目/子项                 | 文件或子 Spec                                                                                                                                            | 计划变化                                                                                                                    | 原因                                 |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| Protocol                  | `packages/protocol/src/agent-types.ts`                                                                                                                   | 增加 Goal 状态、快照、步骤、同步状态和错误类型                                                                              | 共享 provider-neutral 类型源         |
| Protocol                  | `packages/protocol/src/messages.ts`                                                                                                                      | 增加可选 Agent snapshot Goal 字段、`agentGoalControl` capability、`agent.goal.get/update/terminate` request/response schema | 建立双向兼容 wire 合同               |
| Protocol                  | `packages/protocol/src/messages.test.ts`、`packages/protocol/src/messages.wire-compat.test.ts`、`packages/protocol/tests/validation/ws-outbound.test.ts` | 覆盖新旧 payload、非法分支、AOT 生成和未知字段                                                                              | 防止协议收窄/生成器回归              |
| Client                    | `packages/client/src/daemon-client.ts`、`packages/client/src/index.ts` 及对应测试                                                                        | 暴露 Goal 查询、更新、终止和 correlated response helpers                                                                    | App 不直接拼 wire                    |
| Daemon contract           | `packages/server/src/server/agent/agent-sdk-types.ts`                                                                                                    | 增加可选 `goalControl`、`getExecutionStatus()`、Goal/Thread status stream event、`flushPreSubscriptionEvents()` 语义        | provider-neutral seam 和恢复事件入口 |
| Daemon registry           | `packages/server/src/server/agent/provider-registry.ts`、`provider-registry-wrap.test.ts`                                                                | wrapper 转发 Goal control、execution status 和 pre-subscription flush                                                       | 自定义/wrapped provider 不丢能力     |
| Daemon manager            | `packages/server/src/server/agent/agent-manager.ts`、`agent-manager.test.ts`                                                                             | 管理 Goal projection、generation、hydrate、lifecycle 校正、mutation lane、terminate 部分结果；重排注册顺序                  | 修复异常恢复核心缺陷                 |
| Daemon projection/loading | `packages/server/src/server/agent/agent-projections.ts`、`agent-projections.test.ts`、`agent-loading.ts`、`agent-loading.test.ts`                        | 在 Agent snapshot 中投影 Goal/step/sync；从 history/todo 过滤旧 generation                                                  | 保持快照和恢复一致                   |
| Daemon transport          | `packages/server/src/server/session.ts`、`packages/server/src/server/websocket-server.ts` 及定向测试                                                     | 路由三组 RPC、capability、权限和错误                                                                                        | 对外暴露控制而非 provider RPC        |
| Codex adapter             | `packages/server/src/server/agent/providers/codex-app-server-agent.ts`、`codex-app-server-agent.test.ts`                                                 | 解析官方 Goal/Thread schema，提供 control，转译通知/plan，缓存 resume 前事件                                                | 接入 Codex 权威状态                  |
| App model                 | 新增 `packages/app/src/goals/model.ts`、`presentation.ts`、`track.tsx` 及测试                                                                            | 管理 tri-state Goal、动作矩阵、draft/pending/stale/error 和跨平台展示                                                       | 将交互复杂度集中在深模块             |
| App integration           | `packages/app/src/panels/agent-panel.tsx`、`packages/app/src/composer/task-list/index.tsx`                                                               | 在 composer 上方组装 Goal track，避免 Goal 与通用 todo 重复渲染                                                             | 复用现有入口和布局                   |
| App state/cache           | `packages/app/src/stores/session-store.ts`、`utils/agent-snapshots.ts`、`runtime/replica-cache/index.ts` 及测试                                          | 接收 optional Goal 字段、按 Agent selector 更新、重连清理 pending                                                           | 支持冷启动/重连且不写第二权威源      |
| App i18n                  | `packages/app/src/i18n/resources/{ar,en,es,fr,ja,ko,pt-BR,ru,zh-CN}.ts`                                                                                  | 增加状态、动作、警告、失败和可访问名称                                                                                      | 所有支持语言同等可用                 |
| App E2E                   | 新增 `packages/app/e2e/browser/codex-goal-control.spec.ts`、最小 Goal fake daemon fixture/helper                                                         | 覆盖显示、暂停、编辑、恢复、终止、重连和旧 daemon gate                                                                      | 证明用户可观察行为                   |
| Docs                      | `docs/providers.md`、`docs/architecture.md`                                                                                                              | 记录 provider seam、权威源、恢复时序、兼容和终止语义                                                                        | 稳定知识进入既有事实源               |
| Registry                  | `mydocs/todolist.md`                                                                                                                                     | 基线 `0085`、下一编号 `0086`、登记本 Spec                                                                                   | 任务索引一致                         |

不计划修改 `agent-storage` 建立第二份 Goal store；如实现发现现有 snapshot 持久化必须扩展，只能保存最近权威投影作为恢复显示缓存，绝不能驱动 scheduler，并需回到 Plan 记录。

### 3.2 签名与契约

#### Protocol types

```ts
export const AGENT_GOAL_STATUSES = [
  "active",
  "paused",
  "blocked",
  "usageLimited",
  "budgetLimited",
  "complete",
] as const;

export type AgentGoalStatus = (typeof AGENT_GOAL_STATUSES)[number];

export interface AgentGoalSnapshot {
  objective: string;
  status: AgentGoalStatus;
  tokenBudget: number | null;
  tokensUsed: number;
  timeUsedSeconds: number;
  createdAt: string;
  updatedAt: string;
}

export interface AgentGoalStepSnapshot {
  generation: string; // equals goal.createdAt
  ordinal: number;
  text: string;
  status: "pending" | "in_progress" | "completed";
  activeForm?: string;
}

export type AgentGoalSyncStatus = "hydrating" | "synced" | "stale";
```

- `objective` 在 provider seam 归一化为 trim 后非空、最多 4000 个 Unicode 字符；wire schema 不做 transform，handler/provider 负责语义校验。
- `createdAt` 是 Goal generation；objective 替换必须返回新 generation，pause/resume 不得改变 generation。provider 的数值时间在 adapter 归一化为 ISO 字符串。
- Agent snapshot 新增 `goal?: AgentGoalSnapshot | null`、`goalStep?: AgentGoalStepSnapshot | null`、`goalSync?: AgentGoalSyncStatus`，均为 optional。`undefined` 不可误解为“无 Goal”，`null` 才是权威无 Goal。
- `goalStep` 必须和 `goal.createdAt` 相等，否则 daemon 丢弃；`goal === null` 时只允许省略或为 `null`。

#### Provider seam

```ts
export interface AgentGoalControl {
  get(): Promise<AgentGoalSnapshot | null>;
  set(input: {
    objective?: string;
    status?: "active" | "paused";
  }): Promise<AgentGoalSnapshot>;
  clear(): Promise<void>;
}

export type AgentThreadStatus =
  | { status: "notLoaded" }
  | { status: "idle" }
  | { status: "systemError"; message?: string }
  | {
      status: "active";
      activeFlags: Array<"waitingOnApproval" | "waitingOnUserInput">;
    };

// AgentSession additions
readonly goalControl?: AgentGoalControl;
// Optional pull seam used during resume/reconnect hydration.
getExecutionStatus?(): Promise<AgentThreadStatus>;
flushPreSubscriptionEvents?(): void;
```

`AgentStreamEvent` 增加：

```ts
| { type: "goal_changed"; provider: AgentProvider; goal: AgentGoalSnapshot | null }
| { type: "thread_status_changed"; provider: AgentProvider; status: AgentThreadStatus }
```

这些事件只描述 provider 权威事实；daemon 仍负责更新 lifecycle、generation 和 public snapshot。`flushPreSubscriptionEvents()` 必须 FIFO、幂等，并在首次 subscriber 已安装后同步投递；provider wrapper 必须转发。

#### Public RPC

新 RPC 均使用点分 request/response 对，参数在 request 顶层，response 结果在 `payload`，两端携带同一个 `requestId`：

```ts
agent.goal.get.request;
// { type, requestId, agentId }

agent.goal.get.response;
// { type, payload: { requestId, agentId, ok, goal, goalStep, goalSync, error } }

agent.goal.update.request;
// { type, requestId, agentId, expectedGeneration?, mutation:
//   { kind: "pause" } |
//   { kind: "resume" } |
//   { kind: "replace_objective", objective: string } }

agent.goal.update.response;
// { type, payload: { requestId, agentId, ok, goal, goalStep, goalSync, error } }

agent.goal.terminate.request;
// { type, requestId, agentId, expectedGeneration? }

agent.goal.terminate.response;
// { type, payload: {
//   requestId, agentId, ok, goal, goalStep, goalSync?,
//   clear: "cleared" | "already_absent" | "failed",
//   interrupt: "interrupted" | "not_running" | "failed" | "skipped",
//   outcome: "stopped" | "goal_cleared_turn_running" | "failed",
//   error
// } }
```

`AgentGoalError` 的 `code` 为 `unsupported | not_found | invalid_objective | invalid_transition | conflict | sync_required | provider_unavailable | provider_error | clear_failed | interrupt_failed`，另有 `retryable` 和非敏感 `message`。新消息不向旧 daemon 发送，客户端先检查 `agentGoalControl`；daemon 仍必须校验 agent 权限、generation 和当前状态。

#### Capability and compatibility

- `server_info.features.agentGoalControl?: boolean` 是唯一公共 gate；实现时以实际发布版本填写 `COMPAT(agentGoalControl)` 的 added version，并登记不早于 `2027-08-18` 的移除日期。
- `AgentSnapshotPayload` 的 Goal 字段、feature 字段和 response 的扩展字段全部保持可选；不删除、收窄或把现有字段改为必填。
- server 广播仍复用现有 Agent status/update snapshot，不新增一条会和 snapshot 竞争的 Goal notification；provider 的 `goal_changed` 先归并进 daemon snapshot。
- client 收到旧 snapshot 时保留 `goal === undefined`；收到新 daemon 的 `goal: null` 时才清除现有权威投影。ReplicaCache 同样保留三态。

### 3.3 子 Spec 索引

`N/A`：单项目、单 Heavy Spec；Protocol、daemon、Codex provider、client、App 和 E2E 都在本 Spec 内，由 3.4 的原子顺序隔离。

### 3.4 执行清单

- [x] 1. 在当前 checkout 重新记录 upstream/PR 基线和 dirty worktree，不合并远端代码；确认 `0085` 仍未占用，并保持本 Spec 直到用户明确批准。
- [x] 2. Protocol RED：为 Goal types、三态 snapshot、错误码、三组 RPC、capability 和旧新 wire 双向解析写失败测试；运行协议 AOT 生成链路。
- [x] 3. Provider seam RED：为 `goalControl`、Goal/Thread status event、invalid notification、thread filter 和 `flushPreSubscriptionEvents` 写 fake Codex app-server 测试。
- [x] 4. Codex GREEN：集中实现 0.147.0 schema parser 和 native RPC adapter；让 `/goal` 复用同一 control，保留 clear 不等于 interrupt 的语义。
- [x] 5. Manager recovery RED→GREEN：先订阅并 flush，再调用 `goalControl.get()` 与 `getExecutionStatus()` hydrate，按序 drain；覆盖 autonomous start、completion、Goal update、status active/idle、get 失败保留和 stale retry；删除 register 中无条件 idle。
- [x] 6. Manager projection/control：实现 generation/current-step 过滤、per-Agent mutation lane、pause/resume/edit、clear→interrupt terminate 组合和部分成功响应；确保旧 turn plan 不复活。
- [x] 7. Public RPC/client：接入 websocket/session handler、capability gate、correlation、权限和错误翻译；补旧 App/旧 daemon兼容测试。
- [x] 8. App model/UI：先完成纯 presentation/action matrix，再接 SessionStore/ReplicaCache；在 composer 上方实现 Goal track、current step、usage、draft/pending/stale/error、i18n 和跨平台 editor。
- [x] 9. Browser E2E：用隔离真实 daemon 和 opt-in mock provider 验证 Goal 显示、pause、resume、paused objective edit、usage reset 提示、terminate partial result、reload 后 stale/retry 和不支持 provider 隐藏；不启动受保护的 `6767` daemon。
- [x] 10. 文档和最终验证：更新 providers/architecture，运行受影响 Vitest、browser slice、`npm run typecheck`、`npm run lint`、目标格式检查，审阅 schema/wire diff 和进程/端口回收。
- [x] 11. 提交后审查修复：脱敏 raw/parsed/provider/manager Goal 日志和异常日志；在 terminate response 透传权威 `goalSync`，旧 daemon 缺字段时由 App 保守降为 `stale`；将 Goal 交互收敛为 reducer、objective editor 收敛为纯 TypeScript form model；以 opt-in mock provider 替换 Browser WebSocket 合成 fixture。

### 3.5 执行前检查点

- 当前目标与任务单元：自动化实现和文档已完成，唯一等待项是真实 Codex 进程 kill/restart 验收。
- 当前 phase：`Review`
- approval status / source：`Plan Approved / User / 2026-08-18`
- 下一步：在不触碰受保护 `6767` 的隔离环境完成真实 Codex kill/restart 手工验收；若需操作现有 daemon，先取得用户明确许可。
- 风险与回退：真实 Codex smoke 因所需测试凭据不可用而条件跳过；若手工恢复失败，先关闭 `agentGoalControl` advertisement 并保留 slash-only，不回滚用户改动。
- 验证方式：协议/manager/provider/App 定向测试 + 最小 browser E2E + 静态检查已完成；真实 Codex 重启保留为手工验收。
- TDD 判定、测试 seam 与验收行为：`TDD；先写 protocol parser、provider fake、manager resume/terminate、App presentation 四组 RED seam，再做 GREEN；验收以用户可观察的 Goal row、状态和恢复为准。`
- seam 确认：`User / Plan Approved / 2026-08-18；Protocol、Codex provider、AgentManager/daemon、App presentation/state。`

## 4. 跨项目扩展

`N/A - single_project；所有本地写入、验证和文档均在 Paseo checkout 内。`

## 5. 执行记录

| 步骤/子项  | 实际变化或子 Spec 锚点 | 状态   | 偏差与处理                                                                                                                                                                                   |
| ---------- | ---------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Plan       | 本文档 0-3.5           | 已批准 | `User / Plan Approved / 2026-08-18`                                                                                                                                                          |
| Baseline   | 3.4 第 1 项            | 已完成 | PR #3179/#2333 仍 OPEN；mergeability 本次查询为 UNKNOWN；保留 dirty worktree，不拉取或合并                                                                                                   |
| Protocol   | 3.4 第 2 项            | 已完成 | 本轮 protocol 定向 26/26；terminate `goalSync` 保持 additive optional，新旧响应兼容均 GREEN                                                                                                  |
| Provider   | 3.4 第 3-4 项          | 已完成 | Codex Goal slice 6/6、App Server transport 9/9、opt-in mock provider 19/19；native Goal/status、resume FIFO 与 wrapper forwarding 均 GREEN；完整 provider 文件保留范围外 fake-server timeout |
| Manager    | 3.4 第 5-6 项          | 已完成 | `agent-manager.test.ts` 全文件 209/209；Session Goal slice 10/10；恢复、current-step、mutation lane、日志脱敏与 terminate freshness 均 GREEN                                                 |
| Public RPC | 3.4 第 7 项            | 已完成 | Session Goal slice 10/10（此前 server Goal 合集 49/49）；capability handshake、terminate freshness、correlation 与结构化错误均 GREEN                                                         |
| App        | 3.4 第 8 项            | 已完成 | 本轮 Goal model/presentation/objective form 18/18；交互 reducer、旧 daemon freshness 和 client build GREEN；Goal track 已接入 composer                                                       |
| Browser    | 3.4 第 9、11 项        | 已完成 | 最终 2/2；已删除 Goal `routeWebSocket` 合成 fixture，真实浏览器经隔离 daemon、mock provider、manager 与 RPC 覆盖 stale/retry、pause/edit/resume 和 terminate partial                         |
| Review Fix | 3.4 第 11 项           | 已完成 | Goal 日志 sentinel、terminate freshness、App reducer/form model、opt-in mock Goal adapter、公共 named input types 和注册恢复 helper 均按 RED→GREEN 修复                                      |
| Docs/Final | 3.4 第 10-11 项        | 已完成 | `docs/architecture.md` 已同步 terminate freshness 兼容规则；目标 lint、server/client/protocol typecheck、build、格式与 whitespace 检查重新执行                                               |

## 6. 验证

| 项目/验收项      | 命令或步骤                                                                                                            | 结果 | 证据                                                                                                                                                                                                                        | 未验证原因                                                                                                                            |
| ---------------- | --------------------------------------------------------------------------------------------------------------------- | ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Spec 模板与结构  | `npm run format:check:files -- <0085 目标文件>`                                                                       | PASS | 2026-08-20；26 个 0085 目标代码/Spec/docs 文件通过 formatter；`git diff --check` PASS；并行改动的总表未纳入本轮目标格式检查                                                                                                 | N/A                                                                                                                                   |
| Protocol wire    | `messages.wire-compat.test.ts` + AOT validation                                                                       | PASS | wire compatibility 13/13、AOT validation 13/13（合计 26/26）；terminate `goalSync` 为 additive optional，覆盖新响应保真和旧响应缺字段                                                                                       | N/A                                                                                                                                   |
| Resume/lifecycle | `agent-manager.test.ts --bail=1`                                                                                      | PASS | 全文件 209/209；恢复、generation、mutation lane、terminate 部分成功均通过；范围外 fake App Server compaction 用例仍有历史 `turn/start` 重复消费 timeout                                                                     | 已登记候选待办，未混入 0085                                                                                                           |
| Codex provider   | `codex-app-server-agent.test.ts -t "[Gg]oal" --bail=1`                                                                | PASS | Goal slice 6/6；App Server transport 9/9；完整 provider 文件的一个 compaction/retry 用例受范围外 fake wait bug 影响，未将该修复混入 0085                                                                                    | 范围外 fake-server 问题                                                                                                               |
| Mock provider    | `mock-load-test-agent.test.ts --bail=1`                                                                               | PASS | 19/19；覆盖 opt-in Goal get/set/clear、确定性 update/interrupt failure 和真实 daemon E2E adapter                                                                                                                            | N/A                                                                                                                                   |
| Public RPC       | `session.test.ts -t "Goal" --bail=1`                                                                                  | PASS | Goal slice 10/10；覆盖 terminate freshness、异常脱敏、恢复加载、correlation 与错误响应                                                                                                                                      | N/A                                                                                                                                   |
| App model/state  | Goal model/presentation 与 objective form model 定向 Vitest                                                           | PASS | 本轮 18/18；交互 reducer、旧 daemon terminate 保守 stale、draft/validation 纯模型均 GREEN                                                                                                                                   | N/A                                                                                                                                   |
| App Browser E2E  | `npx playwright test --project=browser e2e/browser/goal-control.spec.ts`                                              | PASS | `.last-run.json` 为 `passed`，2/2；不再拦截 Goal WebSocket，真实隔离 daemon 链路覆盖失败、reload stale/retry、编辑和 terminate partial；两次用例前 Metro 冷 warmup 超时后，同入口 bundle 探针成功并在缓存建立后完成最终执行 | N/A                                                                                                                                   |
| 真实 Codex smoke | `codex-goal-mid-turn.real.e2e.test.ts --maxWorkers=1 --bail=1`                                                        | SKIP | `codex-cli 0.147.0` 已确认；1 个测试文件加载成功，3 项因该套件所需外部测试凭据不可用而条件跳过                                                                                                                              | 凭据条件不满足，且未执行真实 kill/restart                                                                                             |
| 静态门禁         | `npm run typecheck:server`、client/protocol typecheck、`npm run lint`、`npm run build:client`、`npm run build:server` | PASS | server/client/protocol typecheck、根 lint（0 warnings/errors）、client build、server build 均通过                                                                                                                           | 根 `npm run typecheck` 仍被并行任务改动的 `packages/app/src/tool-calls/detail-level/projection.test.ts` 3 个既有类型错误阻断；非 0085 |

- 集成验证：自动化已覆盖旧 App/新 daemon 的可选 wire、新 App/旧 daemon 的 terminate freshness 缺字段、Goal 不支持、浏览器 reload reconnect、无 active turn terminate、clear→interrupt 部分成功和恢复 hydrate/FIFO 顺序；Browser Goal 行为经真实隔离 daemon 而非合成 transport。
- 剩余风险：真实 Codex 进程 kill/restart 尚未验收；不同 Codex 版本对 `blocked/usageLimited/budgetLimited` resume 的 native 行为仍由结构化 provider 错误兜底；#3179/#2333 后续合并可能造成重叠冲突。current step 写入不是未完成项，而是因 0.147.0 无 native RPC 而明确保持只读。
- Done Contract 是否由证据满足：`自动化部分已满足；唯一未验收项是真实 Codex 进程 kill/restart。`

## 7. 评审（Review）

| 评审轴             | 结论      | 证据或阻塞问题                                                                |
| ------------------ | --------- | ----------------------------------------------------------------------------- |
| 目标与 Spec 完成度 | `PARTIAL` | 全范围实现和自动化完成；只剩真实 Codex 进程 kill/restart 手工验收             |
| Spec 与执行一致性  | `PASS`    | RPC、generation、恢复顺序、只读 step、编辑和 terminate 语义均按批准 Plan 落地 |
| 实现质量与风险     | `PASS`    | 分层公共 seam、provider adapter、权威投影和真实浏览器测试均有 GREEN 证据      |

- Overall Verdict：`PASS`
- Blocking Issues：`None；真实 provider 验收未完成，因此任务状态保持待手工验收而非已收口`
- Cross-project consistency：`N/A`

### 7.1 回归风险

| project_id | Regression risk | 依据                                                                                                                                   |
| ---------- | --------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `paseo`    | `High`          | 公共 protocol、AgentManager resume/lifecycle、Codex provider 和 composer 状态交叉影响；所有 wire 字段必须 additive，恢复必须一次性发布 |

### 7.2 Touched Projects

普通单项目任务填写 `N/A`；本任务的全部实现都在 `paseo` 单项目内。

| project_id | Files Changed | Reason                                      |
| ---------- | ------------- | ------------------------------------------- |
| `N/A`      | `N/A`         | 单项目任务按模板不登记 touched-project 子表 |

- Orphan changes：`None attributable to 0085；工作区存在 0084、0086、0092、0100 等并行任务改动，均未纳入或回退。0085 的 26 个目标代码/Spec/docs 文件格式检查已通过；任务总表因共享并行改动单独保留。`

## 8. 偏差、变更与反向同步

- Plan-Execution Diff：`无产品契约偏差。App 组件行为以纯 model/presentation/form Vitest 和真实 Playwright 覆盖，没有保留依赖 JSDOM/vi.mock 的实现耦合组件测试；Browser fixture 从合成 WebSocket 升级为隔离真实 daemon + opt-in mock provider；真实 Codex smoke 已尝试但因所需外部测试凭据不可用而跳过，kill/restart 保留为手工验收；lint、server/client/protocol typecheck 和 build 均通过，根 typecheck 仅受范围外 App 类型错误阻断。`
- Change Log：
  - `2026-08-18`：按用户要求忽略远端停止门禁，创建完整范围 `0085` Heavy Spec。
  - `2026-08-18`：将 #3179/#2333/#3083 记录为重叠/风险输入，不把任何远端 PR 设为前置依赖。
  - `2026-08-18`：锁定 Goal objective 可编辑、current step 只读投影、generation 清理和 clear→interrupt 部分成功语义。
  - `2026-08-18`：用户明确回复 `Plan Approved`，按 Protocol→provider→manager→RPC→App→Browser 的 RED→GREEN 清单实施。
  - `2026-08-19`：完成 App、Browser、长期文档和最终自动化检查；真实 Codex smoke 因凭据条件跳过，任务进入待手工验收。
  - `2026-08-19`：用户授权为 0085 创建独立本地 commit，明确不 push；提交后以该 commit 为固定基线执行 Standards/Spec 静态审查。
  - `2026-08-19`：修复提交后审查发现的 Goal objective 日志泄露、terminate freshness 丢失、App 多状态/表单模型违规、箭头函数规则和 mocked Browser transport；重新通过定向测试与真实隔离 daemon Browser E2E。
  - `2026-08-20`：修复复核发现的 mock Goal 匿名 mutation input 和恢复注册方法复杂度/类型收窄问题；重新通过 manager 209/209、mock 19/19、Goal provider 6/6、transport 9/9、Browser 2/2、lint、目标格式、server/client/protocol typecheck 与双 workspace build。
- 用户决策：
  - 已明确继续创建 Spec，不因远端 PR 停止。
  - `Plan Approved` 已于 `2026-08-18` 给出。
  - 用户批准的边界是 current step 只读、paused objective 可编辑；实现没有伪造 Codex 不存在的 step-write RPC。
- Spec 反向同步结果：已同步实际协议、恢复时序、App 行为、测试证据、静态检查例外和手工验收风险；长期合同已写入 `docs/architecture.md` 与 `docs/providers.md`。

## 9. 恢复、长期知识与提交关联

- 状态说明：`待手工验收 / Review / Plan Approved`；完整实现、提交后审查修复、目标验证与静态复核已完成；本轮修复尚未创建新 commit，也未 push 或执行其他远端写入。
- 当前卡点：真实 Codex 测试套件所需外部凭据不可用，3 项条件跳过；实际 kill/restart 恢复尚无真实 provider 证据。
- 下一步唯一动作：在隔离 daemon 上启动真实 Codex Goal，分别杀死 Agent 进程和重启 Paseo，确认 Goal track、current step 与 Agent `running` 自动恢复；未经明确许可不操作受保护的 `6767`。
- Resume / Handoff 锚点：实现无需继续；若手工验收失败，从 `subscribe → flush/drain → execution/Goal hydrate → drain → persist/broadcast` 顺序和 `codex-app-server-agent.ts` 的 pre-subscription FIFO 开始诊断，保留所有并行 dirty diff。
- Project Sync Candidates：`无；稳定合同已经同步到既有长期文档。`
- 长期文档同步：`docs/architecture.md` 已记录 Goal wire、generation、terminate 和恢复顺序；`docs/providers.md` 已记录 provider port、Codex native 映射与 current-step 边界。

### 提交记录

一个 Spec 可对应多个提交；本任务已获一次独立本地提交授权，未获 push 授权。

| 提交信息（Commit Message）                    | 提交脚注（Commit Footer） | 关联项目 / 改动或阶段   | 文档同步状态 | 备注                         |
| --------------------------------------------- | ------------------------- | ----------------------- | ------------ | ---------------------------- |
| `feat: support Codex Goal lifecycle controls` | `N/A`                     | `paseo / 0085 完整实现` | `已同步`     | 用户授权本地 commit；不 push |
| `fix: address Codex Goal review findings`     | `N/A`                     | `paseo / 0085 审查修复` | `已同步`     | 用户授权本地 commit；不 push |
