# 关闭最后标签并回收 Provider Runtime Spec

## 0. 状态与索引

| 字段              | 值                                                                                  |
| ----------------- | ----------------------------------------------------------------------------------- |
| task_id           | `0035`                                                                              |
| spec layer        | `Feature Spec`                                                                      |
| task status       | `已收口`                                                                            |
| mode              | `single_project`                                                                    |
| phase             | `Review`                                                                            |
| approval status   | `Plan Approved`                                                                     |
| approval source   | `User`                                                                              |
| spec path         | `mydocs/specs/0035_关闭最后标签并回收Provider_Runtime.md`                           |
| parent spec       | `N/A`                                                                               |
| supersedes        | `mydocs/micro_specs/0035_关闭最后标签后卸载会话视图.md`                             |
| current task unit | `managed agent tab close-only、runtime 状态 fallback 与默认 agent 恢复的端到端闭环` |
| created / updated | `2026-08-03 16:13 / 2026-08-04 01:21`                                               |

## 1. 目标、范围与完成契约

- 背景/问题：当前关闭 workspace 的最后标签后会补一个空 draft；root agent tab 关闭还会先卸载 UI 再异步 archive，而 managed subagent tab 仅关闭布局。用户无法通过关闭 agent tab 释放对应 idle provider runtime，全部 tab 关闭后也没有稳定渠道恢复 workspace 的初始默认 agent。
- 最终目标：对所有 provider 和所有 Paseo-managed agent 提供一致的 close-only 用户流程。关闭任一 managed agent tab 时回收该 agent 的 live provider runtime并保留未归档会话；全部 agent tabs 关闭时卸载 workspace 视图且不补 replacement draft；sidebar 在无更高优先级业务图标时展示 runtime residency；再次点击 workspace 固定恢复会话初始默认 agent，而不是最后关闭或最近活动的 agent。
- 当前任务单元：完成一个跨 workspace 默认 agent 身份、protocol、client、daemon、workspace layout/navigation 和 sidebar projection/presentation 的生命周期闭环；UI 与 RPC 必须共享 `AgentLifecycleStatus === "closed"` 权威事实，重开目标必须来自稳定的默认 agent 身份。
- 范围内：
  - workspace 默认 agent 身份的持久化、旧记录兼容推导和客户端暴露；
  - provider-agnostic runtime close RPC 与 `server_info.features.*` capability；
  - `AgentManager.closeAgent()` 的 Session 暴露、结果和错误路径；
  - root agent 与 managed subagent tab 的统一 close-only policy、确认、成功后 UI 卸载与 replacement draft 抑制；
  - sidebar runtime residency 聚合、fallback icon、tooltip/accessibility；
  - hidden 默认 agent 的确定性同 ID 重开与现有 `ensureAgentLoaded()` resume；
  - 新旧 peer 兼容、定向 unit/component/Playwright、typecheck/lint 和必要文档同步。
- 范围外：
  - idle timeout/内存阈值驱动的自动回收；
  - provider 专属关闭分支或 daemon 主进程关闭；
  - archive/delete、workspace archive、`close_items_request` 既有语义重写；
  - provider-owned `provider_subagent` timeline tab 的独立 runtime close；该 tab 没有独立 `AgentSession`，继续保持 layout-only；
  - draft/passive tab 的 runtime close；它们没有关联 provider runtime；
  - 全局导航、sidebar 信息架构或任务 0034 的相对时间功能重构；
  - commit、branch、PR、发布。
- Done Contract：
  1. 关闭任一 root/managed-subagent agent tab 后，目标 agent `archivedAt` 仍为空、持久 lifecycle 为 `closed`，其 provider `close()` 被调用一次；provider-owned child tab 仍为 layout-only。
  2. close response 的 authoritative outcome 为 `closed: true` 时 UI 卸载目标 tab；`closed: false` 或无权威响应时保留可操作视图并显示错误。provider cleanup warning 不得与 daemon 是否已持久关闭相矛盾。
  3. 全部 agent tabs 关闭后 workspace 视图卸载且不生成 replacement draft；关闭一个 agent 不影响其他 agent tab/runtime。
  4. sidebar 从未归档 managed agents 聚合 runtime residency；任一非 `closed` 即 resident，全部 `closed` 才 closed。loading/creating、running、needs-input、attention/完成等既有业务状态图标优先，只有无其他图标时才显示 runtime fallback。
  5. runtime 状态使用图标、tooltip 与 accessibility label/test ID，颜色不作为唯一信息编码。
  6. workspace 保存稳定的默认 agent 身份；默认值是创建 workspace 时与会话标题关联的初始 root agent，不从最后关闭、最近活动、Map 顺序或标题字符串匹配推断。
  7. 点击 sidebar workspace 后打开默认 agent 的同一 Paseo agent ID；若其 runtime 已关闭，则恢复原 persistence handle/timeline，不创建 replacement agent。
  8. 行为适用于所有 provider；旧 daemon 缺 capability 时只显示升级提示，不 archive、不伪关闭、不 fallback。
  9. protocol 双向兼容、受影响单文件测试、目标 Playwright、根级 typecheck 与 lint 均通过；任务 0034 的已收口改动不被覆盖。
- 失败或回炉方式：任一 wire/runtime/layout/sidebar 纵向切片失败时，只回退当前切片并返回 Research/Plan；不改变现有 archive RPC，不清理或重置用户工作区。真实 provider 验证失败时保留 mock/contract 证据并单独标注未验证资源回收风险。

### 1.1 最小任务单元判断

- 为什么当前任务单元足够小：用户可见结果是一个不可拆散的生命周期 transaction；单独增加 RPC、单独关闭 tab 或单独显示 icon 都会留下不可恢复或错误表达的中间状态。范围虽跨 workspace，但共享一个 agent lifecycle contract，并可按纵向 slice 逐步验证。
- 验证证据：协议 correlation、server closed/未归档断言、App 成功/失败 transaction、sidebar priority/accessibility、Playwright close→reopen 同 ID 五类证据能够独立定位回炉点。
- 模型可自主决定的范围：在项目既有 pattern 内选择 schema/helper/file placement、lucide runtime icon、纯函数命名、测试 fixture 和错误文案；不得改变用户已确认的 close-only、所有 provider、默认 agent 同 ID 恢复和 icon fallback 顺序。
- 拆分决定：`Accepted`；暂不拆父子 Spec。若 Research 发现必须重构通用 AgentManager failure model，先回写本 Spec 并重新评估范围，而非静默扩张。

## 2. 上下文与调研

### 2.1 上下文来源

- 需求来源：当前对话。用户先要求关闭最后标签后不创建空 agent，随后明确 close-only、所有 provider、保留未归档会话与 sidebar residency；最新决策进一步锁定“关闭任一 managed agent tab 即回收对应 runtime，全部关闭后从 sidebar 恢复 workspace 初始默认 agent”，并要求 runtime icon 只在没有 loading/完成/其他状态图标时显示。
- 项目事实源：`PROJECT.md`、`docs/agent-lifecycle.md`、`docs/architecture.md`、`docs/protocol-validation.md`、`docs/rpc-namespacing.md`、`docs/testing.md`、`docs/expo-router.md` 及命中源码/测试。
- Codemap：`mydocs/codemap/2026-08-03_16-13_Provider_Runtime关闭恢复功能.md`
- Codemap Mode：`feature`
- Context Bundle：`mydocs/context/2026-08-03_16-13_关闭最后标签并回收Provider_Runtime_context_bundle.md`
- Context Bundle Level：`Standard`
- 关联任务记录：
  - superseded Light：`mydocs/micro_specs/0035_关闭最后标签后卸载会话视图.md`；
  - 已收口 sidebar 任务：`mydocs/micro_specs/0034_侧边栏会话最后操作时间.md`；
  - 现状 E2E：`packages/app/e2e/workspace-navigation-regression.spec.ts`。

### 2.2 调研结论

- 已确认事实：
  1. `AgentLifecycleStatus` 已包含 `closed`；项目文档将它定义为“持久、可恢复、无 live provider runtime”。
  2. 所有 provider 实现统一 `AgentSession.close()`；Codex `close()` 最终 dispose app-server client/process tree，不需要 provider 特判。
  3. `AgentManager.closeAgent()` 已提供并发去重、event drain、订阅释放、provider close、`closed` snapshot 持久化与广播。
  4. `ensureAgentLoaded()` 会等待 in-flight close，从 persistence handle 以相同 Paseo agent ID 恢复并 hydrate timeline；timeline fetch 已调用该路径。
  5. 当前 `close_items_request` 和 root `handleCloseAgentTab` 都是 archive 语义；managed subagent close 当前是 layout-only。二者都需要改为 close-only。
  6. 当前 App 在 archive 完成前先删除 tab/写 hidden；失败后没有保留当前 UI 的 transaction 保证。
  7. unarchived `closed` agent 仍在 workspace active/auto-open 集合，但 hidden set 会阻止 reconcile 重开；普通 sidebar workspace click 不携带 agent target。
  8. `openTabFocused({ kind: "agent", agentId })` 会解除 hidden；随后 agent pane/timeline 请求可触发同 ID resume。
  9. sidebar 的 `WorkspaceStatusIndicator` 当前顺序为 loading、running loader、needs-input、attention、done 空槽、其余 workspace-kind/status；status group 的完成 icon 属于已有业务状态呈现。
  10. lifecycle 到 `done` bucket 会合并 idle 与 closed，因此 runtime residency 必须保留原始 lifecycle 维度。
  11. 任务 0034 已在 `workspace-agent-activity.ts`、`sidebar-workspaces-view-model.ts`、`sidebar-workspace-row-content.tsx` 和相关测试/i18n 中加入 `lastActivityAt` 并收口；0035 必须在其当前未提交 diff 上增量合并。
  12. 现状 E2E 已通过并证明旧行为：关闭最后 draft 后又出现 1 个 draft，耗时 58.6 秒；隔离 daemon 已回收。
  13. Provider-owned child tab 使用 `provider_subagent` target，没有独立 `AgentSession`，不进入 `handleCloseAgentTab`，因此仍只能关闭布局。
  14. workspace 当前没有 `defaultAgentId` / `primaryAgentId`；workspace title 可异步自动命名和手动改名，不能通过标题字符串反查默认 agent。
  15. 首个 workspace 和首个 root agent 初始标题来自同一首消息；agent 创建成功时 server 同时掌握 `workspaceId` 与新 `agentId`，是登记默认 agent 身份的稳定边界。
  16. 旧 agent 记录已有 `workspaceId`、`createdAt` 和 `labels`，可对缺少默认字段的旧 workspace 按 `(createdAt, id)` 做确定性兼容推导。
- 未知与开放问题：`无方案级开放问题；A + D 已选定。当前只剩 TDD seam 用户确认与 Execute 授权门禁，不属于技术方案未知。`
- 风险与约束：
  - 误复用 archive RPC 会改变公共 wire contract并丢失会话入口；
  - 只关闭 UI 会泄漏 runtime；只 close runtime 不处理 hidden/navigation 会失去重开入口；
  - 仅用 `done` 或颜色表示 residency 会产生逻辑与可访问性错误；
  - running close 是资源终止动作，必须保留显式确认与明确失败反馈；
  - 把 reopen target 绑定到最后关闭、最近活动、Map 顺序或可变 title，会违反默认 agent 语义；
  - capability 必须单点 gate，旧 daemon 不实现 fallback；
  - 禁止覆盖 0034/其他用户未提交改动，禁止全量测试和干扰主 `6767` daemon。
- `grilling` 结论（如使用）：`未使用；用户已明确 tab 分类、默认 agent 和 icon 语义。剩余问题是实现策略取舍，可在 Innovate checkpoint 选择。`
- TDD 判定：`TDD`；公共 RPC、workspace 默认身份、资源生命周期与 UI transaction 存在稳定 public seams 和明显回归风险。候选首个纵向切片为“首个 root agent 创建后 workspace 暴露稳定 defaultAgentId；close-only RPC 随后关闭该 agent 且 archivedAt 为空”；精确 seam 在 Plan 后由用户确认。

### 2.3 方案与决策（Innovate，已锁定）

- 已锁定、无需再选择的语义：
  - root agent 与 managed subagent 都按 agent tab close-only；provider-owned `provider_subagent` 保持 layout-only；
  - residency 为 workspace 聚合事实，reopen target 独立固定为默认 agent；
  - 任一未归档 managed agent 非 `closed` 即 resident，全部为 `closed` 才 closed；
  - 默认 agent 是创建 workspace 时与会话标题关联的初始 root agent，不采用最后关闭、最近活动、Map 顺序或 title 字符串匹配；
  - runtime icon 是最终 fallback，不能覆盖 loading/creating/running/needs-input/attention/完成等业务 icon。
- 已选方案 A：workspace 持久化 optional `defaultAgentId`。首个合格 root agent 创建或导入成功后只在字段为空时登记；旧记录或无效引用按最早未归档、非 internal、非 delegated agent 的 `(createdAt, id)` 确定性推导并回填。有效既有引用保持不变，无候选写 `null`，回填不改 workspace `updatedAt`。
- 已选方案 D：新 RPC 返回以 `closed` 字段判别的 authoritative result。wire/type 保持 discriminated union；因 zod-aot 会把 boolean literal discriminator 错编译为字符串 case，authoring schema 使用已由生成 validator 回归证明的顺序 `z.union`。manager 抛错后 handler 必须回读持久记录；若未归档记录已是 `closed`，响应 `closed: true` 并附 cleanup `warning`，UI 仍卸载 tab；只有 `closed: false` 或无法确认时才保留 tab并显示 `error`。已持久 `closed` 且没有 live runtime 的 agent 幂等成功。
- 已排除方案：每次纯推导默认 agent、把最后关闭/最近活动 agent 存入 layout，以及 provider close raw rejection 后依赖异步 snapshot 修正 UI；前两者会漂移默认身份，后者会让 UI 与权威持久状态冲突。
- 共用基础方案：新增 agent-scoped close-only RPC，复用 `AgentManager.closeAgent()` / `ensureAgentLoaded()`，不扩展 `close_items_request`、不依赖 daemon idle cleanup、不引入 provider 特判。
- 当前选择状态：`Selected / LOCKED；用户于 2026-08-03 17:25 选择 A + D：持久 optional defaultAgentId + authoritative close result。`

### 2.4 下一步动作

- 下一步动作 1：6 个 TDD seams 已由用户明确确认，且已收到精确 `Plan Approved`。
- 下一步动作 2：进入 Execute，先通过 public Session API 完成清单 13 的首个纵向 RED，再按 14→25 推进。

## 3. 计划与执行前检查点

> 执行前合同记录：A + D 已固化为以下执行合同；6 个 TDD seams 已由用户确认，且已收到精确 `Plan Approved`。当前任务已完成 Execute 并在 Review 收口。

### 3.1 文件变化

| 项目/子项                       | 文件或子 Spec                                                                                                                                                                                                | 计划变化                                                                                                                                                                                       | 原因                                                                                                  |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| protocol                        | `packages/protocol/src/messages.ts`、`packages/protocol/src/messages.test.ts`                                                                                                                                | 新增 optional `WorkspaceDescriptorPayload.defaultAgentId`、`agent.runtime.close.request/response` schema/type 与 optional capability `agentRuntimeClose`                                       | 建立新增式、可 gate 的 wire contract，不污染 archive RPC                                              |
| workspace identity              | `packages/server/src/server/workspace-registry.ts`、`workspace-registry.test.ts`、新建 `workspace-default-agent.ts` / `.test.ts`                                                                             | 持久化 nullable `defaultAgentId`；集中定义候选判断、`(createdAt, id)` 选择和“仅字段为空时登记”逻辑                                                                                             | 创建、导入和 migration 共用同一默认身份规则                                                           |
| workspace migration             | 新建 `packages/server/src/server/migrations/backfill-workspace-default-agent.migration.ts` / `.test.ts`、`workspace-registry-bootstrap.ts` / `.test.ts`                                                      | 在 `workspaceId` backfill 后修复缺失/无效引用；同时覆盖 registry 已存在的 early-return 和首次 bootstrap 分支                                                                                   | 旧数据在 descriptor 暴露前满足同一身份不变量                                                          |
| daemon contract                 | `packages/server/src/server/session.ts`、`session.workspaces.test.ts`、`packages/server/src/server/websocket-server.ts`                                                                                      | 创建/导入成功时登记首个合格 agent；descriptor 暴露默认 ID；dispatch/handler 调用通用 `AgentManager.closeAgent()` 并回读持久状态；server info 宣告 capability                                   | provider-agnostic 回收 runtime，保留同 ID 未归档记录                                                  |
| shared client                   | `packages/client/src/daemon-client.ts`、`daemon-client.test.ts`                                                                                                                                              | 新增 correlated `closeAgentRuntime()` 并原样返回 success/failure union                                                                                                                         | App 只消费权威结果，不自行猜 lifecycle                                                                |
| close transaction               | 新建 `packages/app/src/screens/workspace/agent-runtime-close-transaction.ts` / `.test.ts`、修改 `workspace-screen.tsx`                                                                                       | 单点 capability/client gate；仅 `closed: true` 后执行 tab cleanup，失败保留；running agent 仍先确认；warning 为非阻塞反馈                                                                      | UI 卸载与 daemon 持久状态形成 transaction                                                             |
| bulk close / empty seed         | `workspace-bulk-close.ts` / `.test.ts`、`workspace-empty-draft-seed.ts` / `.test.ts`                                                                                                                         | agent 逐个复用同一 transaction；terminal 仍走 `closeItems({ terminalIds })`；其他 tab layout-only；有默认 agent 时禁止 replacement draft                                                       | 单个 agent 失败不影响其他关闭项，全部关闭后保留重开入口                                               |
| obsolete policy / copy          | 删除 `packages/app/src/subagents/close-tab-policy.ts` / `.test.ts` 并移除 `subagents/index.ts` export；更新八个 `packages/app/src/i18n/resources/*.ts` 与 `resources.test.ts`                                | 移除 root archive / subagent layout-only 的旧分叉；把单个和批量确认文案改为 stop runtime、keep session，并增加 gate/error/runtime tooltip 文案                                                 | managed root/subagent 已统一 close-only，UI 不能继续宣称 archive                                      |
| residency store                 | `packages/app/src/utils/workspace-agent-activity.ts` / `.test.ts`、`stores/session-store.ts` / `.test.ts`、`hooks/sidebar-workspaces-view-model.ts` / `.test.ts`                                             | 在不改变现有 root-only activity 的前提下新增独立 residency index，并把 `defaultAgentId` / residency 投影到 sidebar entry                                                                       | 保留 0034 语义，同时从原始 lifecycle 区分 idle 与 closed                                              |
| sidebar presentation/navigation | `components/sidebar/sidebar-workspace-row-content.tsx`、`sidebar-workspace-list.tsx`、`sidebar/sidebar-status-list.tsx`、`sidebar-workspace-list.test.tsx`、`packages/app/test-stubs/lucide-react-native.ts` | `done` 空槽按 residency 显示 `Power` / `PowerOff`、tooltip、accessibility label、稳定 test ID；两个点击入口携带有效默认 agent target；测试替身导出同名 Lucide 图标                             | runtime icon 仅作最终 fallback，并可从任一 sidebar 入口恢复同一 agent；测试配置继续使用既有 stub 边界 |
| E2E / docs                      | `packages/app/e2e/workspace-navigation-regression.spec.ts`、`packages/app/metro.config.cjs`、`docs/agent-lifecycle.md`、`docs/architecture.md`                                                               | 把旧 replacement-draft 断言改为 close→closed icon→sidebar reopen 同 ID；排除 Playwright 临时 artifact 目录以避免 Windows Metro watcher 竞态；验证后同步稳定生命周期、默认身份和 capability/RPC | 以可观察证据收口用户流程和长期知识，同时保留既有 CI artifact 路径                                     |

### 3.2 签名与契约

| 项目/子项              | 接口、类型或签名                                                                                                                                                                 | 计划变化                                                                                                                                                                                        | 兼容性                                                                                                                                                                     |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| persisted workspace    | `PersistedWorkspaceRecord.defaultAgentId: string \| null`；factory input optional                                                                                                | schema 对旧 JSON 缺失值归一化为 `null`；factory 默认 `null`                                                                                                                                     | 只增字段；不改 workspace `updatedAt` 语义；`COMPAT(workspaceDefaultAgent)` added `v0.2.5`，目标移除日期 `2027-02-03`                                                       |
| default selector       | `selectWorkspaceDefaultAgentId(workspaceId, agents): string \| null`                                                                                                             | 仅接受同 workspace、未归档、非 internal、`paseo.parent-agent-id` 为空的 agent；按 `createdAt` 再按 `id` 升序                                                                                    | 纯函数确定性；不依赖 title、activity 或 Map 顺序                                                                                                                           |
| default registration   | `setWorkspaceDefaultAgentIfAbsent({ workspaceRegistry, workspaceId, agent }): Promise<string \| null>`                                                                           | 创建/导入成功后仅为合格 agent 填空，不覆盖已有默认值                                                                                                                                            | 并发创建仍以首个成功写入为准；旧值由 startup migration 校验                                                                                                                |
| migration              | `backfillWorkspaceDefaultAgentIds({ agentStorage, workspaceRegistry, logger }): Promise<number>`                                                                                 | 有效引用保留；缺失/无效引用回填最早候选；无候选写 `null`；在 `backfillWorkspaceIdForLegacyAgents()` 后运行                                                                                      | `COMPAT(workspaceDefaultAgentBackfill)` added `v0.2.5`，目标移除日期 `2027-02-03`                                                                                          |
| workspace descriptor   | wire `defaultAgentId: z.string().nullable().optional()`；App `WorkspaceDescriptor.defaultAgentId: string \| null`                                                                | server 原样输出 persisted 值；`normalizeWorkspaceDescriptor()` 把 absent 归一化为 `null`                                                                                                        | 旧 client 忽略，旧 daemon 被新 App 归一化为 null                                                                                                                           |
| close request          | `{ type: "agent.runtime.close.request", agentId: string, requestId: string }`                                                                                                    | 新点分 correlated request                                                                                                                                                                       | 只新增消息，不改 `close_items_request` / archive                                                                                                                           |
| close success          | `{ type: "agent.runtime.close.response", payload: { requestId, agentId, closed: true, warning: string \| null } }`                                                               | `closed: true` 只表示未归档 durable record 已确认 `lifecycle === "closed"`                                                                                                                      | wire/type 以 `closed` 判别；authoring schema 为顺序 `z.union`，warning 不反转成功                                                                                          |
| close failure          | `{ type: "agent.runtime.close.response", payload: { requestId, agentId, closed: false, error: string } }`                                                                        | 记录缺失/已归档、load/close 失败且无法确认 durable closed 时返回                                                                                                                                | UI 保留 tab；不伪造成功                                                                                                                                                    |
| capability             | `server_info.features.agentRuntimeClose?: boolean`                                                                                                                               | 新 daemon 发送 `true`；App 只在 `useHostFeature(serverId, "agentRuntimeClose")` 检查一次                                                                                                        | `COMPAT(agentRuntimeClose)` introduced `v0.2.5`，目标移除日期 `2027-02-03`；旧 daemon 无 fallback                                                                          |
| daemon close algorithm | `handleAgentRuntimeCloseRequest(msg): Promise<void>`                                                                                                                             | durable closed 且无 live runtime 时幂等成功；durable 非 closed 且无 live agent 时先 `ensureUnarchivedAgentLoaded()`；调用 `closeAgent()` 后无论 resolve/reject 都回读 storage，再构造权威 union | provider close 抛错但 durable closed 时 `closed: true + warning`；无法确认时 false                                                                                         |
| client                 | `DaemonClient.closeAgentRuntime(agentId: string, requestId?: string): Promise<AgentRuntimeClosePayload>`                                                                         | 使用 `sendNamespacedCorrelatedSessionRequest()`，不把 `closed: false` 转成 rejection                                                                                                            | transport/schema error 仍 reject，由 App 统一保留 tab                                                                                                                      |
| App transaction        | `closeAgentRuntimeAndCommit({ client, supported, agentId, commitClose }): Promise<AgentRuntimeCloseOutcome>`                                                                     | client/capability 缺失、transport reject、`closed: false` 均不调用 `commitClose()`；`closed: true` 恰好调用一次                                                                                 | 单个和 bulk 共用；warning 在 commit 后反馈                                                                                                                                 |
| draft seed             | `shouldSeedEmptyWorkspaceDraft({ ..., defaultAgentId })`                                                                                                                         | `defaultAgentId !== null` 时返回 false；真正没有 agent/default 的空 workspace 保持原行为                                                                                                        | 旧 daemon 字段 absent→null，维持旧行为                                                                                                                                     |
| residency              | `type WorkspaceRuntimeResidency = "resident" \| "closed"`；`buildWorkspaceRuntimeResidencyIndex(agents, previous?)`                                                              | 聚合同 workspace 所有未归档 managed agents：任一 lifecycle 非 closed→resident；全 closed→closed；无 agent→无条目                                                                                | 与 root-only `workspaceAgentActivity` 独立，不把 `done` 当 lifecycle                                                                                                       |
| sidebar entry          | `defaultAgentId: string \| null`、`runtimeResidency: WorkspaceRuntimeResidency \| null`                                                                                          | 默认 ID 只在仍存在于 active agent map 且未归档时形成显式 target；无效/缺失值走普通 workspace navigation                                                                                         | 避免 unrelated archive/delete 留下死 target；closed 未归档 agent 仍可 target                                                                                               |
| indicator              | `WorkspaceStatusIndicator(..., runtimeResidency)`                                                                                                                                | loading/creating、running、needs-input、attention/完成及其他既有图标分支先返回；仅原 `done` 空槽渲染 `Power` 绿色或 `PowerOff` muted                                                            | tooltip/accessibility 使用 `sidebar.workspace.status.runtimeResident/runtimeClosed`；test ID 固定为 `workspace-status-indicator-runtime-resident/closed`，颜色不是唯一信号 |
| close copy             | `workspace.tabs.confirmations.stopRunningAgentTitle/Message/stopAgent`、`workspace.tabs.toasts.agentRuntimeCloseFailed/agentRuntimeCleanupWarning/updateHostToCloseAgentRuntime` | 单个和 bulk 文案明确“停止 runtime、关闭 tab、保留会话”；warning 在 commit 后展示且不回滚                                                                                                        | 八个 locale key shape 保持一致，`resources.test.ts` 校验无 archive 旧文案                                                                                                  |

### 3.3 子 Spec 索引

`N/A；当前任务不拆分。`

### 3.4 执行清单

- [x] 1. 完成 Research 开放问题确认并回写 tab 分类、默认 agent 与 residency 用户决策。
- [x] 2. 用户在 Innovate checkpoint 选择 `A + D`。
- [x] 3. 固定 protocol optional 字段、RPC union、capability 与双向兼容测试合同。
- [x] 4. 固定 workspace 默认 agent 的候选规则、持久 schema、migration 顺序和创建/导入登记点。
- [x] 5. 固定 daemon close 幂等、load、close、持久回读与 warning/failure 收敛算法。
- [x] 6. 固定 client correlated method、App commit-on-authoritative-success transaction 和旧 daemon gate。
- [x] 7. 固定单个/批量关闭、terminal 分流、replacement draft 抑制、旧 close policy 删除及 i18n 范围。
- [x] 8. 固定独立 residency 投影、store/view-model 接线、runtime fallback icon 与两个 sidebar default target 入口。
- [x] 9. 固定目标 E2E、定向测试、静态检查、文档同步和进程回收边界。
- [x] 10. 完成 `review_spec(scope=plan_only)` 并回写第 7 节；Readiness Verdict 为 GO。
- [x] 11. 取得用户对第 3.5 节 TDD seams 的明确确认。
- [x] 12. 取得用户精确 `Plan Approved`；随后按 13→25 的依赖顺序 Execute。
- [x] 13. RED→GREEN：在 public Session seam 建立并通过“首 root default + close-only durable closed/unarchived”首个纵向用例。
- [x] 14. GREEN：实现 protocol schema/type/capability，再实现 workspace selector/schema/migration/bootstrap 与 create/import 登记。
- [x] 15. GREEN：实现 daemon close handler 的幂等、load、close 后持久回读和 success-warning/failure union。
- [x] 16. RED→GREEN：补 protocol 新旧 peer解析、migration 有效/无效引用、close warning/failure 与 client correlation 边界。
- [x] 17. RED→GREEN：实现并验证 App transaction；只有 `closed: true` commit，其他结果全部保留 tab。
- [x] 18. RED→GREEN：改造 single/bulk close、terminal 分流、确认/错误文案并删除失效 close-tab policy。
- [x] 19. RED→GREEN：给 draft seed 增加 `defaultAgentId` 抑制，同时保留真正空 workspace 的 draft 行为。
- [x] 20. RED→GREEN：实现多-agent residency 聚合、store restore/setAgents 同步和 view-model 投影。
- [x] 21. RED→GREEN：实现 runtime fallback icon 的优先级/accessibility，并让两个 sidebar 入口显式打开有效默认 agent。
- [x] 22. 更新目标 Playwright，证明关闭全部 agent tabs 后无 replacement draft、显示 closed、点击后以同一默认 ID 恢复 runtime，并让 residency 从 closed 返回 resident。
- [x] 23. 运行受影响单文件测试、`npm run typecheck`、`npm run lint`；仅在隔离环境做真实 provider 验证并回收本任务进程。
- [x] 24. 根据验证事实更新 `docs/agent-lifecycle.md` / `docs/architecture.md`，反向同步 Spec 和任务总表。
- [x] 25. 执行 `review_execute(changed_only)` 三轴评审；失败回 Research/Plan，PASS 后再判断人工验收/提交状态。

### 3.5 执行前检查点

- 执行前目标与任务单元：关闭任一 managed agent tab 时 provider-agnostic 回收对应 runtime、保留会话；全部关闭不补 draft；sidebar fallback 展示 residency，点击固定恢复 workspace 默认 agent。
- 执行前 phase：`Execute / ACTIVE`。
- approval status / source：`Plan Approved / User`；授权时间为 `2026-08-03 19:56`。
- 执行起点：通过 public Session API 写入首个纵向 RED，证明默认 agent 登记与 close-only durable lifecycle 合同尚未实现。
- 风险与回退：不扩展 `close_items_request`；任一持久状态无法确认都保留 tab；migration 只改 `defaultAgentId`；sidebar 默认 ID 无效时不产生 agent target；若实施需要重构 `AgentManager` failure model、覆盖 0034 或改变 archive/delete 语义，立即回 Plan 重新授权。
- 验证方式：分别运行 `messages.test.ts`、`workspace-default-agent.test.ts`、migration/bootstrap/registry 测试、`session.workspaces.test.ts`、`daemon-client.test.ts`、App transaction/bulk/draft/activity/store/view-model/sidebar 单文件测试；再运行目标 Playwright、`npm run typecheck`、`npm run lint`。禁止全量本地测试，禁止启动/重启主 `6767` daemon；本任务隔离 daemon/子进程必须回收。
- TDD 判定、测试 seam 与验收行为：`TDD`。
  1. **首个纵向 seam（public Session API）**：经现有 `create_agent_request` 创建新 workspace 的首个 root agent，经 `fetch_workspaces_request` 观察同一 `defaultAgentId`，再发送 `agent.runtime.close.request`；验收 response 为 `closed: true / warning: null`、provider `close()` 一次、durable lifecycle 为 `closed`、`archivedAt` 仍为 null。
  2. **authoritative failure seam**：provider close 抛错但 durable record 已 closed 时验收 success + warning；持久 closed 无法确认时验收 `closed: false + error`，重试已 closed/no-live agent 幂等成功。
  3. **protocol/client seam**：旧 workspace descriptor/无 capability 仍可解析并归一化 null；新 request/response correlation 在 wire/type 层保留以 `closed` 判别的 union，client 不吞掉 false；authoring schema 可在生成器回归证据下使用等价顺序 union。
  4. **App transaction seam**：capability/client 缺失、transport rejection 和 false 都不 commit；true 只 commit 一次，warning 不回滚；single 与 bulk 复用该行为。
  5. **projection/presentation seam**：root/subagent 混合、多 agent 一 resident、全 closed、无 agent四类 residency；loading/running/needs-input/attention/完成图标优先，fallback icon 有 tooltip/accessibility/test ID。
  6. **navigation/E2E seam**：全部 managed agent tabs 关闭后无 replacement draft；sidebar closed workspace 携带初始 `defaultAgentId` target，点击后解除 hidden 并以同一 Paseo ID 恢复，而不是最后关闭的 agent。
- seam 确认：`User；用户于 2026-08-03 19:56 明确确认上述 6 个 seams。`

## 4. 跨项目扩展

`N/A；single_project，全部修改限定在 E:\Code\paseo。`

## 5. 执行记录

| 步骤/子项                                             | 实际变化或子 Spec 锚点                                                                                                            | 状态                 | 偏差与处理                                                                                                                                                                                                                                                                                     |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Light → Heavy                                         | 创建 CodeMap、Context Bundle 与本 Spec；旧 micro-spec 互链                                                                        | Research 完成        | 无实现代码改动                                                                                                                                                                                                                                                                                 |
| Research → Innovate                                   | 回写 managed/provider-owned tab 分类、默认 agent 身份与 close failure 方案                                                        | 完成                 | 用户选择 `A + D`；无实现代码改动                                                                                                                                                                                                                                                               |
| Innovate → Plan                                       | 固定精确文件、签名、迁移/transaction 顺序、TDD seams 与验证边界                                                                   | 完成，待批准         | `review_spec(plan_only)` 为 GO；等待 seam 确认与 `Plan Approved`                                                                                                                                                                                                                               |
| Plan → Execute                                        | 用户确认第 3.5 节全部 6 个 seams，并给出精确 `Plan Approved`                                                                      | 完成                 | 批准来源 `User`；清单 13–25 已按 Batch Override 完成，最终 Review PASS                                                                                                                                                                                                                         |
| 清单 13：public Session 首个纵向 slice                | 新增 create→fetch default→runtime close 测试；最小实现 protocol、default 登记、descriptor 与 close success                        | GREEN                | RED 缺少 `defaultAgentId`；GREEN 验证 close 一次、durable closed、未归档；raw storage 缺失 archivedAt 按既有兼容语义归一为 null                                                                                                                                                                |
| 清单 14：protocol 与 default identity                 | 完成 optional descriptor/capability、selector、registry schema、migration/bootstrap、create/import 默认登记                       | GREEN                | 有效默认引用保持；无效引用按 `(createdAt, id)` 回填；bootstrap 两分支均按 `workspaceId → defaultAgentId` 顺序执行                                                                                                                                                                              |
| 清单 15：authoritative close handler                  | 完成 close-only success、cleanup warning、durable failure、幂等和 stored-only lazy load                                           | GREEN                | provider cleanup 抛错但 durable closed 时成功携 warning；持久化不可用且 closed 无法确认时返回 false，不 archive 会话                                                                                                                                                                           |
| 清单 15 Review 补强：并发 close                       | live entry 已移除但 provider cleanup/persist 尚未结束时，后续 close 先 join 既有 close 并回读 durable record                      | RED→GREEN            | RED 创建 2 个 provider sessions；复用既有 `waitForAgentClose()` 加入屏障后只创建 1 个 session、provider `close()` 只调用 1 次，两个 RPC 均返回 authoritative success                                                                                                                           |
| 清单 16：protocol/client compatibility                | 增加 zod-aot success/failure envelope 回归并恢复 client false correlation                                                         | RED→GREEN            | RED 证明 boolean discriminator 被错编译为字符串 case；改用等价顺序 `z.union` 后生成 validator 与 client 均 GREEN                                                                                                                                                                               |
| 清单 17：App close transaction                        | 新增单点 close transaction，并由 single/bulk close 复用；client 缺失改用结构化 outcome，由 UI 本地化错误                          | RED→GREEN            | capability/client 缺失、transport rejection、`closed: false` 均不 commit；`closed: true` 恰好 commit 一次，warning 不回滚                                                                                                                                                                      |
| 清单 18：single/bulk close 与文案                     | single/bulk agent tab 改走 authoritative transaction，terminal 单独 batch，八个 locale 移除 agent-tab archive 文案并删除旧 policy | GREEN                | 单个 agent failure 不阻塞其他项；provider-owned passive tab 仍 layout-only；workspace/archive 明示操作未改                                                                                                                                                                                     |
| 清单 19：descriptor normalization 与 empty draft seed | App descriptor 新增 non-optional nullable `defaultAgentId`；旧 payload 归一为 null；seed helper 在非 null 时拒绝补 draft          | RED→GREEN            | 真正空 workspace 保持既有 seed 行为；workspace screen 将 descriptor 默认 ID 显式传入 helper                                                                                                                                                                                                    |
| 清单 20：residency store/projection                   | 新增独立 workspace residency index，接入 restore/setAgents，并投影到 sidebar entry                                                | GREEN                | activity 10/10、session store 16/16、view-model 29/29；保持 0034 root-only activity 语义                                                                                                                                                                                                       |
| 清单 21：sidebar icon/navigation                      | `Power` / `PowerOff` 仅作业务 icon 后的 fallback；project/status 两种入口携带仍有效的 `defaultAgentId` target                     | GREEN                | sidebar 组合测试 8/8；tooltip、accessibility label、稳定 test ID 与两类入口均有断言                                                                                                                                                                                                            |
| 清单 22：close→reopen E2E                             | 两个 managed mock agent 先关默认、后关另一 agent；断言无 draft、closed icon、点击恢复默认 agent 同 ID 与 runtime residency        | GREEN（Review 加强） | stronger E2E 在任何 seed-client 查询前观察 closed→resident，daemon 同时记录 `Agent resumed from persistence`；实际触发器是 visible-tab `viewedTimelineSync` catch-up 发起 timeline fetch，再由 daemon `ensureAgentLoaded()` 恢复 runtime，`agent-panel.tsx` 的 cached-history 早退不阻断该路径 |
| 清单 23：静态与定向验证                               | 根 typecheck、根 lint、受影响单文件、目标 Playwright 与 diff hygiene                                                              | PASS                 | 并发 close 分组 3 passed / 104 skipped；最终 typecheck 通过；lint 0 warnings/0 errors（2987 files）；tracked/index diff check 与 Heavy Spec 尾随空白检查通过；未运行全量本地套件；主 `6767` 未触碰                                                                                             |
| 清单 24：长期文档与记录                               | 更新 agent lifecycle、architecture、本 Spec 与任务总表                                                                            | 完成                 | 删除旧 root-archive/subagent-layout-only 文档事实，记录 close-only/default identity/residency/capability 合同                                                                                                                                                                                  |
| 清单 25：`review_execute(changed_only)`               | 依据 Requirements、Plan、Validation 与 0035 changed files 完成三轴核对                                                            | PASS                 | 并发 close blocker 已按 TDD 修复；三轴均 PASS，Blocking Issues 为 None                                                                                                                                                                                                                         |

## 6. 验证

| 项目/验收项                                          | 命令或步骤                                                                                                                                                                                                               | 结果               | 证据                                                                                                                                                                                                            | 未验证原因                                                                        |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| 现状 replacement draft                               | `npm run test:e2e --workspace=@getpaseo/app -- workspace-navigation-regression.spec.ts --grep "keeps one replacement draft after returning from settings and closing the last tab"`                                      | PASS（旧行为基线） | `1 passed`，关闭后 draft 数仍为 1，58.6 秒，隔离 daemon 已停止                                                                                                                                                  | 不证明目标行为                                                                    |
| Heavy 文档迁移                                       | 核对 task id、互链、总表唯一活跃索引、Markdown 本地链接、尾随空白与 `git diff --check`                                                                                                                                   | PASS               | Heavy 为唯一活跃索引；Light 为 `Superseded`；全部本地链接可解析；无尾随空白；diff check 通过                                                                                                                    | N/A                                                                               |
| Research 资产与真相源                                | 核对 CodeMap、Context Bundle、Light/Heavy 互链与总表索引                                                                                                                                                                 | PASS               | CodeMap/Context 保留 Plan 前候选状态作为历史输入；Light 为 `Superseded`；A+D 与当前状态只以本 Heavy Spec 为活跃真相源；总表仅索引 Heavy                                                                         | N/A                                                                               |
| Plan 合同与预审                                      | `review_spec(scope=plan_only)`                                                                                                                                                                                           | PASS               | 第 7 节 Spec Review Matrix；Readiness Verdict GO                                                                                                                                                                | 不替代 seam 确认或执行授权                                                        |
| Plan 文档完整性                                      | stale phrase `rg`、目标路径 `Get-Item`、尾随空白 `rg`、tracked `git diff --check`                                                                                                                                        | PASS               | 无待选择/Innovate stale 状态；任务状态/phase/approval 与总表一致；引用路径存在；无尾随空白或 diff error                                                                                                         | 新建 Heavy Spec 未进入 tracked diff，另以尾随空白扫描覆盖                         |
| public Session 首个纵向 slice                        | `npx vitest run packages/server/src/server/session.workspaces.test.ts --bail=1 -t "create_agent_request registers the workspace default before close-only runtime shutdown"`                                             | RED→GREEN          | RED：fetch descriptor 缺 `defaultAgentId`；GREEN：1 passed / 103 skipped，6.04 秒                                                                                                                               | 仅证明 success path；migration、warning/failure、client/App/UI 尚未验证           |
| default identity selector/migration/bootstrap/import | 对应 `workspace-default-agent.test.ts`、migration、`workspace-registry-bootstrap.test.ts` 与 import 定向用例                                                                                                             | PASS               | selector 1 passed；migration 1 passed；bootstrap 9 passed；import 1 passed                                                                                                                                      | App normalization/default target 尚未验证                                         |
| close warning、幂等与 stored-only load               | `session.workspaces.test.ts` 对应定向用例                                                                                                                                                                                | PASS               | 1 passed；cleanup warning 不反转 durable success，重复 close 不再调用 provider，stored-only agent 可加载后关闭                                                                                                  | 真实 provider 进程树尚未隔离验证                                                  |
| concurrent close barrier                             | `npx vitest run packages/server/src/server/session.workspaces.test.ts --bail=1 -t "concurrent agent.runtime.close requests do not resume a runtime while it is closing"`；最终以 `-t "agent\\.runtime\\.close"` 分组复跑 | RED→GREEN / PASS   | RED 创建 2 个 provider sessions；GREEN 聚焦用例 1 passed / 106 skipped；最终 close 分组 3 passed / 104 skipped，两个并发响应均 success 且 provider 只 close 一次                                                | N/A                                                                               |
| durable close failure                                | `npx vitest run packages/server/src/server/session.workspaces.test.ts --bail=1 -t "agent.runtime.close returns false when durable closure cannot be confirmed"`                                                          | RED→GREEN          | RED：底层 `ENOTDIR` 未表达权威判定；GREEN：1 passed / 105 skipped，响应 `closed: false` 并带 durable-state 错误                                                                                                 | App 保留 tab 尚未验证                                                             |
| protocol runtime-close AOT                           | `npx vitest run packages/protocol/tests/validation/ws-outbound.test.ts --bail=1 -t "accepts an authoritative runtime-close response envelope"`                                                                           | RED→GREEN          | RED：boolean discriminator 被生成为字符串 case；GREEN：success/failure 两项 passed / 8 skipped                                                                                                                  | N/A                                                                               |
| protocol 消息与 client correlation                   | `messages.test.ts` 定向文件；`npm run build:client`；`npx vitest run packages/client/src/daemon-client.test.ts --bail=1 -t "sends agent.runtime.close.request and preserves an authoritative false outcome"`             | PASS               | protocol 23 passed；client build 通过；client 1 passed / 106 skipped                                                                                                                                            | App capability gate 尚未验证                                                      |
| App authoritative close transaction                  | `npx vitest run packages/app/src/screens/workspace/agent-runtime-close-transaction.test.ts --bail=1`                                                                                                                     | RED→GREEN          | client-unavailable 结构化 outcome RED 后 GREEN；6 passed，所有非 success path 保留 tab，success 恰好 commit 一次                                                                                                | UI 组合路径待 typecheck/E2E                                                       |
| agent-tab close locale contract                      | `npx vitest run packages/app/src/i18n/resources.test.ts --bail=1`                                                                                                                                                        | RED→GREEN          | RED 为 4 个 locale key shape 缺失；补齐 8 个 locale、移除旧 agent-tab archive keys 并消除 helper 英文 fallback 后 32 passed                                                                                     | 其他 locale 翻译质量只由现有资源测试覆盖                                          |
| default descriptor 与 replacement draft 抑制         | `workspace-empty-draft-seed.test.ts`、`session-store.test.ts` 单文件 `--bail=1`                                                                                                                                          | RED→GREEN          | 各自 RED 为默认 ID 未参与 seed 与缺失字段仍为 undefined；GREEN 为 4 passed、14 passed                                                                                                                           | close→sidebar reopen 组合行为待 E2E                                               |
| residency 聚合、store 与 view-model                  | app workdir 下分别运行 `workspace-agent-activity.test.ts`、`session-store.test.ts`、`sidebar-workspaces-view-model.test.ts`，均带 `--bail=1`                                                                             | PASS               | 10/10、16/16、29/29 passed                                                                                                                                                                                      | N/A                                                                               |
| sidebar presentation/navigation                      | app workdir 下 `npx vitest run src/components/sidebar-workspace-list.test.tsx --bail=1`                                                                                                                                  | PASS               | 8/8 passed；runtime fallback priority/accessibility 与 project/status 默认 agent target 均覆盖                                                                                                                  | 首次误从仓库根运行未加载 app config，在测试收集前因 RN 语法失败；正确入口重跑通过 |
| close→default reopen Playwright                      | `npx playwright test e2e/workspace-navigation-regression.spec.ts --project="Desktop Chrome" --grep="closes all runtimes without a replacement draft and reopens the persisted default agent"`                            | PASS               | stronger E2E 在 seed-client 查询前断言同一 workspace row 从 `runtime-closed` 变为 `runtime-resident`，并只恢复初始默认 agent tab；最终 1 passed，2.3 分钟，daemon 日志记录默认 agent `resumed from persistence` | 使用 deterministic mock provider；未依赖本机 provider 凭据                        |
| Windows Metro artifact watcher                       | 目标 Playwright 默认输出复跑；直接求值 `resolver.blockList` 对 `.playwright-artifacts-0`                                                                                                                                 | PASS               | blockList 命中目标路径；修复后 Metro 未再报 `ENOENT watch`，保留 CI 既有 artifact 路径                                                                                                                          | N/A                                                                               |
| 隔离资源回收                                         | 检查最终 stronger E2E 的 daemon `64614`、Metro `64615`、relay `64726/64727`、daemon PID `40772` 与隔离 `PASEO_HOME`                                                                                                      | PASS               | 隔离端口均无 listener、PID 不存在、`PASEO_HOME` 不存在；主 `6767` 仍由原 PID `7488` 持有                                                                                                                        | N/A                                                                               |
| 根静态检查                                           | `npm run typecheck`；`npm run lint`                                                                                                                                                                                      | PASS               | 并发屏障生产代码落地后最终重跑：typecheck 通过；lint 0 warnings / 0 errors（2987 files）                                                                                                                        | N/A                                                                               |
| 文档与 diff hygiene                                  | 更新 `docs/agent-lifecycle.md` / `docs/architecture.md`；`git diff --check`；`git diff --cached --check`；Heavy Spec 尾随空白扫描                                                                                        | PASS               | 长期文档已同步已验证合同；两类 diff check 无输出；未跟踪 Heavy Spec 无尾随空白                                                                                                                                  | N/A                                                                               |
| 目标代码行为                                         | App/sidebar/Playwright/static checks                                                                                                                                                                                     | PASS               | close-only、无 replacement draft、默认 agent 同 ID tab 与 runtime resume、closed→resident、并发 close 不恢复第二 runtime 均有自动证据                                                                           | N/A                                                                               |

- 集成验证：目标 Playwright 已在真实浏览器、真实 WebSocket 和隔离 daemon 上通过；使用 deterministic mock provider，因此不证明某一外部 provider CLI 的 OS process tree 行为。
- 剩余风险：未运行需要本机 provider 可用性/凭据的真实 provider smoke；provider cleanup warning 下的 OS process tree 完全回收仍以通用 `AgentSession.close()` 合同和 provider 定向测试为证。Native 实机 tooltip/accessibility 未人工验收。默认 agent 被独立 archive/delete 后本任务只保证不生成死 target，不新增 rebinding 语义。
- Done Contract 是否由证据满足：`自动验证已满足 1–9；第 7 项由 stronger E2E 的 closed→resident 断言与 daemon persistence-resume 日志直接证明；最终定向测试、静态检查、diff hygiene 与三轴 Review 均 PASS。`

## 7. 评审（Review）

### 7.0 Spec Review Notes（`scope=plan_only`，2026-08-03 19:35）

#### Spec Review Matrix

| 评审项                      | 结论   | 证据或阻塞问题                                                                                                         |
| --------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------- |
| 目标、范围与验收可验证性    | `PASS` | 第 1 节分别约束 managed / provider-owned tab、close-only、同 ID 恢复、residency/icon priority、兼容和验证证据          |
| 决策闭合度                  | `PASS` | A + D 已 `Selected / LOCKED`；没有方案级开放问题，排除项和理由已记录                                                   |
| 文件变化精确度              | `PASS` | 第 3.1 节定位 protocol、registry/migration、session/client、App transaction、sidebar、E2E/docs 及对应测试文件          |
| 签名与数据契约              | `PASS` | 第 3.2 节固定 optional 字段、RPC discriminated union、capability、migration、client/transaction/residency/sidebar 类型 |
| 执行原子性与依赖顺序        | `PASS` | checklist 13→25 按 public RED→protocol/storage/server→client/App→sidebar/E2E→validation/docs/review 推进               |
| 兼容、迁移与失败语义        | `PASS` | startup 两分支均在 workspaceId backfill 后迁移；旧 daemon 单点 gate；close resolve/reject 后一律以 durable reread 决策 |
| 测试 seams 与资源边界       | `PASS` | 第 3.5 节列出 6 个 public seams、验收行为、单文件测试限制、主 `6767` 保护和隔离进程回收；用户确认仍是 Execute 前门禁   |
| scope / dirty worktree 保护 | `PASS` | 不改 archive/delete contract，不拆 Spec，不覆盖 0033/0034/0036/0037 与其他用户 dirty files，不授权 commit/PR           |

- Readiness Verdict：`GO；Spec 已具备供用户确认 seams 和审批的可执行精度。GO 是建议性计划结论，不代表 seam 已确认或已获 Plan Approved。`
- Risks & Suggestions：
  1. `AgentManager.closeAgent()` 会先移除 live agent，再分别收集 provider close/persist error；handler 不得直接映射 promise resolve/reject，必须按计划回读 storage。
  2. default migration 必须同时覆盖 bootstrap early-return 与首次 materialization 分支，并保持 `workspaceId backfill → defaultAgentId backfill` 顺序。
  3. sidebar 只对 active unarchived agent map 中仍有效的默认 ID生成 target；这既支持 closed 未归档恢复，也隔离本任务范围外的 archive/delete stale reference。
  4. 任务 0034 已修改相同 sidebar 文件；Execute 前后都应检查局部 diff，禁止整文件替换或无关格式化。
- Phase Reminders：
  - Execute 前：用户明确确认 6 个 TDD seams，并精确回复 `Plan Approved`。
  - Execute 中：每个 RED/GREEN 只运行受影响测试文件；RPC、migration 或 UI contract 偏离时先反向同步本 Spec。
  - Validation：真实 provider 仅使用隔离 daemon/PASEO_HOME，验证结束回收全部子进程；不碰主 `6767`。
  - Review：执行三轴 `review_execute(changed_only)`，补 Plan-Execution Diff、最终证据、长期文档和任务总表状态。

### 7.1 Execute Review（`scope=changed_only`，2026-08-04 01:21）

| 评审轴             | 结论   | 证据或阻塞问题                                                                                                                                                                                                        |
| ------------------ | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 目标与 Spec 完成度 | `PASS` | Done Contract 1–9 已由 protocol/migration/Session/client/App/sidebar 单文件测试、stronger E2E、静态检查和长期文档证据覆盖；未要求的真实 provider smoke 与 Native 人工验收保留为非阻塞风险                             |
| Spec 与执行一致性  | `PASS` | close-only、durable authoritative result、optional default identity、旧 peer gate、无 replacement draft、fallback icon priority 与默认 agent 同 ID恢复均匹配 Plan；已知文件/authoring/测试基础设施偏差均记录于第 8 节 |
| 实现质量与风险     | `PASS` | changed-only 审查发现并以 TDD 修复并发 close 误恢复 runtime 的竞态；复用既有 in-flight close 屏障，未新增 provider 特判；最终 close 分组、typecheck、lint 与 diff hygiene 全部通过                                    |

- Overall Verdict：`PASS；0035 的目标、Plan 一致性和代码质量三轴均满足收口条件。`
- Blocking Issues：`None；agent-panel cached-history 早退已由 stronger E2E 证伪为 blocker，并发 close 竞态已修复且有定向回归。`
- Cross-project consistency：`N/A`

### 7.2 回归风险

| project_id | Regression risk | 依据                                                                           |
| ---------- | --------------- | ------------------------------------------------------------------------------ |
| `paseo`    | `High`          | 公共 wire contract、provider lifecycle、UI transaction 与 sidebar 状态均受影响 |

### 7.3 Touched Projects

`N/A；single_project。`

- Orphan changes：`None；本轮 0035 Plan 只更新本 Spec 与任务总表。其他 dirty files 属于用户或任务 0033/0034/0036/0037，均不覆盖、不清理、不归入 0035。`

## 8. 偏差、变更与反向同步

- Plan-Execution Diff：`协议 wire shape、类型与 closed 判别语义未变；AgentRuntimeClosePayloadSchema 的 authoring 表达由计划中的 z.discriminatedUnion 改为等价顺序 z.union，因为生成 validator 会把 boolean discriminator 错编译为字符串 case。App client-unavailable 使用结构化 outcome 代替硬编码英文。sidebar Power/PowerOff 测试需要既有 Lucide test stub 增加同名导出，因此补列 packages/app/test-stubs/lucide-react-native.ts。目标 Playwright 首次进入产品步骤前暴露 Windows Metro 对 packages/app/test-results/.playwright-artifacts-* 的 watcher ENOENT 竞态；补列 packages/app/metro.config.cjs，仅把既有 Playwright artifact 目录加入 resolver.blockList，不改变测试输出路径或业务合同。Review 期间进一步加强清单 22 的 E2E，新增 runtime-closed→runtime-resident 断言；先前对 cached-history 早退的 blocker 判断被运行证据证伪，实际 resume 由既有 visible timeline catch-up 触发。changed-only Review 随后发现并发 close 在 live entry 已移除、durable closed 尚未写入时会误走 stored-only lazy load；`session.ts`复用既有`AgentManager.waitForAgentClose()`先 join 再回读，新增 Session TDD 回归。计划列出的`workspace-registry.test.ts` 无需修改：schema default 由新 selector/migration/bootstrap 测试与既有构造器夹具覆盖；为 non-optional App descriptor 增加的多个一行类型夹具属于编译适配，不改变测试行为。`
- Change Log：
  - `2026-08-03 15:20`：Light 建档并记录 replacement draft 旧行为。
  - `2026-08-03 15:42`：用户将语义扩大为所有 provider 的 close-only、保留会话、同 ID 恢复与 sidebar residency；Light 暂停。
  - `2026-08-03 16:13`：用户显式调用 `sdd-riper-one`，并锁定 runtime icon 为所有既有业务状态 icon 之后的 fallback；创建 Heavy Research 产物并 supersede Light。
  - `2026-08-03 16:57`：用户锁定 agent tab 分类和重开规则：managed root/subagent 关闭即回收对应 runtime，provider-owned child layout-only；全部 tabs 关闭后 sidebar 恢复 workspace 初始默认 agent，禁止使用最后关闭者。Research 收口并进入 Innovate。
  - `2026-08-03 17:25`：用户选择 `A + D`，锁定 persisted optional `defaultAgentId` 与 authoritative close result / cleanup warning。
  - `2026-08-03 19:35`：完成精确 Heavy Plan、6 个 TDD seams 与 `review_spec(plan_only)`；Readiness Verdict GO，停在 seam 确认和 Execute 授权门禁。
  - `2026-08-03 19:56`：用户明确确认第 3.5 节全部 6 个 TDD seams，并给出精确 `Plan Approved`；进入 Execute。
  - `2026-08-03 20:06`：清单 13 public Session 首个纵向测试按预期 RED（descriptor 缺默认 ID）后 GREEN；成功路径已证明，清单 14/15 仍待 migration 与 failure/warning 覆盖。
  - `2026-08-03 20:27`：清单 14–16 GREEN；default identity、authoritative close 与 client correlation 已闭环。新增 AOT 回归证明并修复 boolean discriminator 生成缺陷；durable closed 无法确认时返回稳定领域错误和 `closed: false`。
  - `2026-08-03 20:57`：清单 17 GREEN，清单 18 的 single/bulk transaction、八 locale 文案与旧 close-tab policy 清理完成；client 缺失改为结构化 outcome，避免业务层硬编码英文 fallback。transaction 6 项与资源 32 项单文件测试通过。
  - `2026-08-03 21:00`：清单 19 GREEN；App descriptor 将 absent `defaultAgentId` 归一化为 null，empty draft seed 在默认 agent 非 null 时返回 false，目标单文件测试分别 14 项与 4 项通过。
  - `2026-08-03 22:18`：清单 20–21 GREEN；residency 聚合/store/view-model 与 sidebar fallback/icon priority/default target 完成，目标单文件最终 10、16、29、8 项通过；根 lint 暴露的测试夹具问题已最小修复。
  - `2026-08-03 22:31`：清单 22–24 完成；目标 Playwright 在默认 artifact 路径通过，Windows Metro watcher 竞态以既有 blockList 机制修复；隔离进程与临时状态已回收，根 typecheck/lint 和长期文档同步完成，进入 Review。
  - `2026-08-03 23:11`：`review_execute(changed_only)` 发现 blocker：目标 E2E 只证明同 ID tab 恢复，`agent-panel.tsx` 对 cached authoritative history 的早退会跳过 closed runtime resume。Review provisional FAIL；既有 Plan 无需变更，清单 22/23 重新打开并返回 Execute。
  - `2026-08-04 00:10`：stronger E2E 在任何 seed-client 查询前直接观察 closed→resident，并由 daemon 记录 `Agent resumed from persistence`；provisional blocker 被证伪。恢复路径来自 visible `viewedTimelineSync` catch-up，不需要修改 `agent-panel.tsx`；清单 22 再次 GREEN，返回 Review。
  - `2026-08-04 01:21`：changed-only Review 发现并发 close 可能在首个 close 持久化完成前误恢复 runtime；Session TDD RED 创建 2 个 provider sessions，加入既有 in-flight close 屏障后 GREEN 为 1 个 session/1 次 close。最终 close 分组 3 passed / 104 skipped，根 typecheck、lint、tracked/index diff check 与 Heavy Spec whitespace 检查均通过；三轴 Review PASS，清单 23/25 收口。
- 用户决策：
  - 不用 Codex 特判，所有 provider 共用规则；
  - 关闭任一 Paseo-managed agent tab 都 close-only 回收其 runtime，不 archive 会话；
  - provider-owned `provider_subagent` 没有独立 `AgentSession`，继续 layout-only；
  - 全部 agent tabs 关闭后不补 draft，点击 sidebar 恢复 workspace 初始默认 agent；
  - 默认 agent 与会话初始标题关联，不能用最后关闭、最近活动、Map 顺序或 title 字符串匹配代替；
  - 选择 A：持久化 optional `defaultAgentId`，旧/无效引用按确定性候选规则回填；
  - 选择 D：close RPC 返回权威 discriminated result，durable closed 可携 cleanup warning；
  - loading/完成/其他业务 icon 优先，runtime icon 只在没有其他 icon 时显示。
- Spec 反向同步结果：Light micro-spec 只保留 superseded 历史；本 Heavy Spec 是唯一任务真相源，执行偏差、验证证据与最终 Review 已回写，任务总表同步为已收口。

## 9. 恢复、长期知识与提交关联

- 状态说明：`已收口 / Review / LOCKED / Plan Approved`；批准来源为 `User`，Heavy Spec 保留为 0035 唯一任务真相源。
- 当前卡点：`无；provisional runtime-resume concern 已由 stronger E2E 解除，并发 close 竞态已由 TDD 回归修复。`
- 下一步唯一动作：`无强制动作；用户未请求 commit/PR。可选剩余验收仅为真实 provider smoke 与 Native 实机 tooltip/accessibility。`
- Resume / Handoff 锚点：任务已闭环；后续若出现回归，先读第 1、3.2、5、6、7.1、8 节，并继续保护任务 0033/0034/0036/0037/0038 与其他用户 dirty files。
- Project Sync Candidates：`docs/agent-lifecycle.md`（managed agent tab close-only、runtime residency/default-agent reopen）；`docs/architecture.md`（workspace default identity、新 capability/RPC，仅在实现验证后同步）。
- 长期文档同步：`已根据 Validation 证据更新 docs/agent-lifecycle.md 与 docs/architecture.md；Review 若发现合同偏差再反向修正。`

### 提交记录

| 提交信息（Commit Message） | 提交脚注（Commit Footer） | 关联项目 / 改动或阶段 | 文档同步状态 | 备注                 |
| -------------------------- | ------------------------- | --------------------- | ------------ | -------------------- |
| `<待提交>`                 | `N/A`                     | `paseo / 0035`        | `未请求提交` | 用户未授权 commit/PR |
