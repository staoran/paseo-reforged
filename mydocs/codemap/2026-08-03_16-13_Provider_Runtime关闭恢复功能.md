# Provider Runtime 关闭与恢复 CodeMap (feature)

> 面向“关闭 managed agent tab 后回收对应 runtime、保留会话、再次点击恢复 workspace 默认 agent”的端到端源码索引。

## 1. Orientation

- Goal：定位 root/managed-subagent tab 关闭、对应 provider runtime 回收、`closed` 状态持久化、workspace 默认 agent 身份、侧边栏展示和默认 agent 同 ID 恢复的完整链路。
- Scope：workspace default identity、Agent lifecycle、provider `close()`、WebSocket RPC/capability、workspace tab/layout、sidebar 状态投影、timeline 触发恢复和聚焦验证入口。
- Non-Scope：archive/delete 语义重写、按空闲时长自动回收、provider 专属策略、daemon 主进程退出、provider-owned child 的独立生命周期。
- Primary question：“怎样让关闭每个 managed agent tab 都只释放对应 runtime，并在全部关闭后从 sidebar 稳定恢复 workspace 初始默认 agent？”
- Confidence：
  - confirmed：`closed` 生命周期、通用 `AgentSession.close()`、`AgentManager.closeAgent()`、同 ID `ensureAgentLoaded()`、当前 archive-on-close、hidden tab 与 sidebar 状态优先级均已由源码复核。
  - confirmed：用户已锁定 residency 按未归档 managed agents 聚合，而侧边栏重开目标独立固定为 workspace 初始默认 agent；禁止使用最后关闭、最近活动、Map 顺序或 title 匹配。
  - inferred：显式持久 optional `defaultAgentId` 与 authoritative close result 最符合现有 server ownership；具体策略仍需 Heavy Innovate 选择。
  - unknown：provider `close()` 抛错时进程是否已实际退出取决于 provider；当前 `AgentManager` 仍会持久化并广播 `closed` 后再抛错。

## 2. Context Tree

```text
Node: Provider Runtime Close / Resume
  -> Node: Current Close Entry
  -> Node: Runtime Lifecycle Contract
  -> Node: Target Close-Only Flow
  -> Node: Default Agent Identity And Reopen
  -> Node: Sidebar Residency Projection
  -> Node: Compatibility
  -> Node: Risk And Unknowns
  -> Node: Validation
```

### Node: Current Close Entry

- Type：`entry`
- Status：`confirmed`
- Purpose：区分 tab layout、agent archive 和 runtime close 三种不同动作。
- Read First：
  - [`workspace-screen.tsx`](../../packages/app/src/screens/workspace/workspace-screen.tsx) :: `handleCloseAgentTab`、`closeWorkspaceTabWithCleanup`。
  - [`close-tab-policy.ts`](../../packages/app/src/subagents/close-tab-policy.ts) :: `resolveCloseAgentTabPolicy`。
  - [`workspace-empty-draft-seed.ts`](../../packages/app/src/screens/workspace/workspace-empty-draft-seed.ts) :: `shouldSeedEmptyWorkspaceDraft`。
  - [`session.ts`](../../packages/server/src/server/session.ts) :: `handleCloseItemsRequest`、`archiveAgentForClose`。
- Current behavior：
  1. root agent tab 使用 `archive-on-close`；running 时先显示 archive 确认。
  2. UI 先执行 `closeWorkspaceTabWithCleanup()`，将 agent unpin、写入 hidden set 并删除 tab，再异步 archive。
  3. managed subagent tab 使用 `layout-only`，不改变其独立 agent lifecycle；目标行为需要改为 close-only。
  4. provider-owned child 使用 `provider_subagent` target 且没有独立 `AgentSession`，不进入 `handleCloseAgentTab`，应继续 layout-only。
  5. `close_items_request` 对 agent 的语义也是 archive，不是 runtime close。
  6. workspace 完全为空且数据已 hydrate 时，`shouldSeedEmptyWorkspaceDraft()` 会补一个 draft。
- Effects：root agent 从活动列表消失；最后内容消失时可触发 replacement draft；关闭失败发生在 UI 卸载之后。
- Next Drill-Down：新的 close-only 入口不能复用 `close_items_request`，也不能在 daemon 成功前卸载最后视图。

### Node: Runtime Lifecycle Contract

- Type：`capability`
- Status：`confirmed`
- Purpose：证明 close-only 可以保持 provider-agnostic，并复用既有持久化/恢复边界。
- Read First：
  - [`agent-lifecycle.ts`](../../packages/protocol/src/agent-lifecycle.ts) :: `AgentLifecycleStatus`。
  - [`agent-sdk-types.ts`](../../packages/server/src/server/agent/agent-sdk-types.ts) :: `AgentSession.close()`。
  - [`agent-manager.ts`](../../packages/server/src/server/agent/agent-manager.ts) :: `closeAgent`、`closeAgentRuntime`、`prepareAgentForClosure`。
  - [`agent-loading.ts`](../../packages/server/src/server/agent/agent-loading.ts) :: `ensureAgentLoaded`、`ensureUnarchivedAgentLoaded`。
  - [`agent-projections.ts`](../../packages/server/src/server/agent/agent-projections.ts) :: `toStoredAgentRecord`、`toAgentPayload`。
- Invariants：
  - `closed` 是持久、可恢复且没有 live provider runtime 的 lifecycle；它不等于 archived。
  - `AgentSession.close()` 是所有 provider 的统一资源释放契约；Codex 实现调用 app-server client `dispose()`。
  - `AgentManager.closeAgent()` 对并发关闭去重，等待 session events，取消 running provider subagents，释放订阅，持久化一次最终 `closed` snapshot 并广播。
  - `ensureAgentLoaded()` 先等待 in-flight close，随后从 persistence handle 恢复相同 Paseo agent ID，并补齐 provider history。
  - `ensureUnarchivedAgentLoaded()` 会拒绝 archived agent；close-only 保留 `archivedAt` 为空，因此可交互恢复。
- Failure branch：provider `close()` 或 snapshot persist 失败时，当前 manager 仍 emit `closed`，之后向调用者抛错；RPC/UI 必须显式处理这一已存在的边界。
- Provider examples：
  - [`codex-app-server-agent.ts`](../../packages/server/src/server/agent/providers/codex-app-server-agent.ts) :: `close()` 清理权限、订阅和 client/process tree。
  - 其他 provider adapters 均通过同一 `AgentSession.close()` 契约接入，不需要按 provider 分支。
- Validation：[`agent-manager.test.ts`](../../packages/server/src/server/agent/agent-manager.test.ts) 已覆盖 closed 持久化、并发关闭、close/load race、同 ID 恢复和 provider close failure。

### Node: Target Close-Only Flow

- Type：`flow`
- Status：`inferred`
- Purpose：给 Heavy Innovate/Plan 提供最短完整路径，不提前锁定未评审签名。
- Candidate route：
  1. App 按 tab target 分类：root/managed-subagent 都进入对应 agent close-only；provider-owned child 和无 runtime 的 draft/passive tab 只关闭布局。
  2. running managed agent 继续要求显式确认，但文案表达“停止并卸载 runtime”，不表达 archive。
  3. App 在单一 `server_info.features.*` capability gate 后调用新的点分 RPC；旧 daemon 只显示升级提示。
  4. Session handler 校验 agent 未归档并调用 `AgentManager.closeAgent(agentId)`，不设置 `archivedAt`、不 cascade archive。
  5. handler 将最终持久状态收敛为 `agentId + closed + error?`；已持久 `closed` 时保持幂等，cleanup failure 可作为 warning 返回。
  6. `closed: true` 后 App 才关闭目标 tab；若这是最后一个 agent tab，则抑制 replacement draft并离开 workspace。
  7. `closed: false` 或无法取得权威响应时保留当前可操作视图并显示错误；不静默吞掉失败。
  8. daemon 广播的 agent snapshot 以 `status: "closed"` 成为客户端 runtime residency 的权威事实。
- Candidate RPC：`agent.runtime.close.request` / `agent.runtime.close.response`；最终名称、payload 与 capability key 在 Plan 前固定。
- Rejected route：复用 `close_items_request`，因为它会 archive 并改变既有 wire contract。
- Evidence：[`rpc-namespacing.md`](../../docs/rpc-namespacing.md)、[`protocol-validation.md`](../../docs/protocol-validation.md)、Session correlated RPC patterns。

### Node: Default Agent Identity And Reopen

- Type：`flow`
- Status：`confirmed`
- Purpose：解释为什么“保留 closed agent”本身还不足以让侧边栏点击恢复。
- Read First：
  - [`workspace-registry.ts`](../../packages/server/src/server/workspace-registry.ts) :: workspace record/descriptor 持久字段与更新入口。
  - [`session.ts`](../../packages/server/src/server/session.ts) :: agent 创建成功后同时持有 `workspaceId` 与 `snapshot.id` 的边界。
  - [`create-agent-title.ts`](../../packages/server/src/server/agent/create-agent-title.ts) / [`workspace-auto-name.ts`](../../packages/server/src/server/workspace-auto-name.ts) :: 初始同源标题与后续独立重命名。
  - [`agent-storage.ts`](../../packages/server/src/server/agent/agent-storage.ts) :: 旧 agent 的 `workspaceId`、`createdAt`、`labels`。
  - [`workspace-layout-store.ts`](../../packages/app/src/stores/workspace-layout-store.ts) :: `hideAgent`、`unhideAgent`、`openTabFocused`、`reconcileTabs`。
  - [`workspace-layout-actions.ts`](../../packages/app/src/stores/workspace-layout-actions.ts) :: `applyPinnedAndHidden`、`reconcileWorkspaceTabs`。
  - [`agent-visibility.ts`](../../packages/app/src/workspace-tabs/agent-visibility.ts) :: `deriveWorkspaceAgentVisibility`。
  - [`navigation.ts`](../../packages/app/src/stores/navigation-active-workspace-store/navigation.ts) :: `navigateToWorkspace`。
  - [`session.ts`](../../packages/server/src/server/session.ts) :: `handleFetchAgentTimelineRequest`。
- Current facts：
  - workspace 当前没有 `defaultAgentId` / `primaryAgentId` 等持久身份字段。
  - 首个 workspace 与首个 root agent 初始标题来自同一首消息；workspace 后续可自动或手动改名，因此 title 字符串不能充当 ID 关系。
  - agent 创建成功后 server 同时掌握 `workspaceId` 和新 `agentId`，可原子/幂等登记首个默认 agent。
  - 旧 agent record 可按最早未归档 root agent的 `(createdAt, id)` 做确定性兼容推导。
  - unarchived `closed` agent 仍进入 `activeAgentIds` / `autoOpenAgentIds`。
  - 关闭 tab 会把 agent 加入 workspace hidden set；reconcile 不会重新 auto-open hidden agent。
  - 普通 sidebar click 只导航到 workspace；没有 target 时仅为 attention agent 主动开 tab。
  - `openTabFocused({ kind: "agent", agentId })` 会解除 hidden 状态。
  - agent pane 的 authoritative timeline fetch 会调用 `ensureAgentLoaded()`，从而恢复同 ID runtime。
- Required bridge：workspace descriptor 必须暴露稳定的 default agent ID；sidebar row 以该 agent target 导航并解除 hidden。只导航 workspace，或从 activity/关闭顺序猜 target，都无法满足默认 agent 恢复。
- Innovate choice：推荐持久 optional `defaultAgentId`，旧记录推导并回填；备选是每次纯推导。用户语义已经锁定，待选的是存储策略而非 reopen 目标。

### Node: Sidebar Residency Projection

- Type：`presentation`
- Status：`confirmed`
- Purpose：在不覆盖业务状态图标的前提下展示 runtime 是否驻留。
- Read First：
  - [`workspace-agent-activity.ts`](../../packages/app/src/utils/workspace-agent-activity.ts) :: `buildWorkspaceAgentActivityIndex`。
  - [`sidebar-workspaces-view-model.ts`](../../packages/app/src/hooks/sidebar-workspaces-view-model.ts) :: `createSidebarWorkspaceEntry`。
  - [`sidebar-workspace-row-content.tsx`](../../packages/app/src/components/sidebar/sidebar-workspace-row-content.tsx) :: `WorkspaceStatusIndicator`。
  - [`sidebar-agent-state.ts`](../../packages/app/src/utils/sidebar-agent-state.ts) / [`agent-state-bucket.ts`](../../packages/protocol/src/agent-state-bucket.ts) :: lifecycle 到业务 bucket 的映射。
  - [`sidebar-status-list.tsx`](../../packages/app/src/components/sidebar/sidebar-status-list.tsx) :: status group completion icon。
- Current priority：
  1. row loading spinner；
  2. running synced loader；
  3. needs-input alert；
  4. attention indicator；
  5. `done` 目前只保留空槽；
  6. failed 等其他 bucket 使用 workspace-kind icon + status dot。
- User-required priority：loading / creating、running、needs-input、attention/完成等已有业务状态图标优先；只有当前分支没有其他图标时，才按 runtime residency 显示 fallback icon。
- Residency authority：使用未归档 managed agents 的原始 `Agent.status === "closed"`；任一非 closed 即 resident，全部 closed 才 closed。不能从 `done` bucket、颜色、tab 是否存在或 `cwd` 猜测。
- Accessibility：runtime icon 必须同时有 tooltip、accessibility label/test ID；颜色只能辅助，不能作为唯一编码。
- Concurrent boundary：任务 0034 已在同一 view model 和 row content 接入 `lastActivityAt` 并收口；0035 必须基于其当前未提交结构增量合并。

### Node: Compatibility

- Type：`contract`
- Status：`confirmed`
- Purpose：保证新 App 与旧 daemon、旧 App 与新 daemon 双向可用。
- Read First：
  - [`messages.ts`](../../packages/protocol/src/messages.ts) :: `ServerInfoStatusPayloadSchema`、session message unions。
  - [`websocket-server.ts`](../../packages/server/src/server/websocket-server.ts) :: `buildServerInfoStatusPayload`。
  - [`daemon-client.ts`](../../packages/client/src/daemon-client.ts) :: `sendNamespacedCorrelatedSessionRequest`。
- Rules：
  - 新 request/response 使用点分命名，request 参数顶层，response 结果放 `payload`，双方携带 `requestId`。
  - 新 feature 字段必须 optional；新 daemon 可向旧 App 发送额外字段，旧 daemon 缺字段时新 App 只显示升级提示。
  - capability 只在一个上游入口 gate，下游消费干净 shape；不实现 archive fallback 或本地伪关闭。
  - 不删除、不收窄现有 `close_items_*`、archive 或 lifecycle schema。

### Node: Risk And Unknowns

- Type：`risk`
- Status：`confirmed`
- Risks：
  - UI 先卸载再等待 RPC 会让失败后没有恢复渠道。
  - 把 `done` 当成 runtime closed 会误判正常 idle、finished-attention 或其他非运行状态。
  - 仅改 sidebar 颜色无法满足可访问性，也容易与 status color 混淆。
  - 只保留 closed record、不显式解除 hidden 会导致再次点击 workspace 仍没有 tab。
  - 多-agent workspace 若使用“任意 closed”会把仍有驻留 runtime 的 workspace误标为已回收。
  - 使用最后关闭、最近活动、Map 顺序或 title 匹配作为 reopen target 会违反默认 agent 语义，且跨重启漂移。
  - provider close failure 当前仍会广播 closed；RPC 失败与 authoritative snapshot 的竞态必须有测试。
  - 未区分 managed subagent 和 provider-owned child 会导致前者 runtime 泄漏或后者调用不存在的独立 close。
  - 直接改 sidebar 文件可能覆盖 0034 已收口但尚未提交的相对时间实现。
- Open decisions：`defaultAgentId` 持久字段 vs 每次纯推导；authoritative close result vs raw RPC rejection。推荐前者组合。

### Node: Validation

- Type：`validation`
- Status：`confirmed`
- Purpose：用最窄测试证明 wire、runtime、layout 和用户可见状态形成闭环。
- Candidate entries：
  - Protocol：[`messages.test.ts`](../../packages/protocol/src/messages.test.ts) 或新增同主题单文件，验证新 RPC 与 capability 的新旧 peer 解析。
  - Client：[`daemon-client.test.ts`](../../packages/client/src/daemon-client.test.ts) 验证 request/response correlation 与 rejection。
  - Server：workspace registry/agent creation tests 验证 default agent 登记与旧记录推导；[`session.test.ts`](../../packages/server/src/server/session.test.ts) 验证 close-only 不 archive、authoritative result；[`agent-manager.test.ts`](../../packages/server/src/server/agent/agent-manager.test.ts) 复用现有 close/resume coverage。
  - App data：[`workspace-agent-activity.test.ts`](../../packages/app/src/utils/workspace-agent-activity.test.ts)、[`sidebar-workspaces-view-model.test.ts`](../../packages/app/src/hooks/sidebar-workspaces-view-model.test.ts) 验证 managed-agent residency 与 default target 独立。
  - App UI：sidebar row focused test 验证图标优先级、tooltip/accessibility；workspace close/navigation test 验证 root/managed-subagent 成功后卸载、失败保留、provider-owned child layout-only。
  - E2E：[`workspace-navigation-regression.spec.ts`](../../packages/app/e2e/workspace-navigation-regression.spec.ts) 覆盖“逐个关闭 agent tabs -> 无 replacement draft -> closed 指示 -> 点击恢复 default agent ID”。
  - Static：代码改动后根级 `npm run typecheck`、`npm run lint`；只运行受影响单文件 Vitest 和目标 Playwright spec。
- Existing baseline：现状 E2E 已证明关闭最后 draft 后仍补 1 个 draft，`1 passed (58.6s)`；该证据描述旧行为，不是目标 GREEN。

## 3. Compact Indexes

### Entry Point Index

| Entry                   | Path                                                                      | Handler / Function                            | Status    | Notes                                                |
| ----------------------- | ------------------------------------------------------------------------- | --------------------------------------------- | --------- | ---------------------------------------------------- |
| Managed agent tab close | `packages/app/src/screens/workspace/workspace-screen.tsx`                 | `handleCloseAgentTab`                         | confirmed | root 当前 archive；managed subagent 当前 layout-only |
| Provider child close    | `packages/app/src/subagents/close-tab-policy.ts` 等                       | `provider_subagent` target path               | confirmed | 无独立 `AgentSession`，保持 layout-only              |
| Tab cleanup             | 同上                                                                      | `closeWorkspaceTabWithCleanup`                | confirmed | 写 hidden + 删 tab                                   |
| Empty draft seed        | `packages/app/src/screens/workspace/workspace-empty-draft-seed.ts`        | `shouldSeedEmptyWorkspaceDraft`               | confirmed | 当前会补 replacement draft                           |
| Runtime close           | `packages/server/src/server/agent/agent-manager.ts`                       | `closeAgent`                                  | confirmed | provider-agnostic、持久 closed                       |
| Runtime resume          | `packages/server/src/server/agent/agent-loading.ts`                       | `ensureAgentLoaded`                           | confirmed | 同 Paseo ID 恢复                                     |
| Default identity        | `packages/server/src/server/workspace-registry.ts` / `session.ts`         | workspace descriptor / agent creation success | confirmed | 当前无字段；server 同时掌握 workspace/agent ID       |
| Sidebar click           | `packages/app/src/stores/navigation-active-workspace-store/navigation.ts` | `navigateToWorkspace`                         | confirmed | target 可解除 hidden                                 |
| Sidebar visual          | `packages/app/src/components/sidebar/sidebar-workspace-row-content.tsx`   | `WorkspaceStatusIndicator`                    | confirmed | runtime icon 应为最终 fallback                       |

### Key Contract Index

| Contract                      | Owner                     | Current state                    | Target implication                 |
| ----------------------------- | ------------------------- | -------------------------------- | ---------------------------------- |
| `AgentLifecycleStatus.closed` | protocol                  | 已存在、optional peer-compatible | 直接作为 residency authority       |
| `AgentSession.close()`        | server provider interface | 所有 provider 通用               | 禁止 Codex 特判                    |
| `AgentManager.closeAgent()`   | server                    | 不 archive、持久 closed          | 新 RPC 的核心调用                  |
| workspace descriptor          | server/protocol           | 当前无 default agent 字段        | 推荐新增 optional `defaultAgentId` |
| `close_items_request`         | protocol/session          | archive agents                   | 不可复用                           |
| `server_info.features.*`      | protocol/websocket server | optional capability map          | 单点升级 gate                      |
| workspace hidden set          | App layout store          | close 后阻止 auto-open           | sidebar 重开必须传 agent target    |

## 4. Next Drill-Down

- Innovate：选择默认 agent 持久字段 A vs 纯推导 B，以及 authoritative close result D vs raw rejection E；推荐 `A + D`。
- Plan：固定 workspace 字段、RPC/capability 字面量、response failure shape、managed/provider-owned tab policy、App mutation seam 和 sidebar fallback icon API。
- Execute 前：读取并保护任务 0034 当前 diff，确认 TDD seam，再取得精确 `Plan Approved`。
- Review：以目标 runtime 实际关闭、未归档、default agent 同 ID 恢复、图标优先级和旧 daemon gate 五条证据为主轴。
- Drift check date：`2026-08-03`。
