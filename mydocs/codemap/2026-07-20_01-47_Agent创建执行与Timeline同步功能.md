# Agent 创建、执行与 Timeline 同步 CodeMap (feature)

> Depth-first route from creation entry to converged client timeline. Source and tests win on drift.

## 1. Orientation

- Goal: 定位 Agent 从 App/CLI/MCP 创建、provider 执行，到 Timeline 实时投递与权威补齐的完整主链。
- Scope: create request、workspace intent、provider session、initial prompt、stream normalization、`epoch/seq`、selective/legacy delivery、paged catch-up。
- Non-Scope: 各 provider SDK 内部实现、具体 message renderer、provider-owned subagent 的独立 timeline、agent rewind/fork 细节。
- Primary question: “创建请求在哪里变成 provider run，产生的事件如何最终且不重不漏地出现在 App Timeline？”
- Confidence:
  - confirmed: 主路由、核心分支、protocol schema、server event pipeline、App sequencing/catch-up 和测试入口已由源码复核。
  - inferred: provider 的持久历史质量决定 daemon restart 后可重建的细节；各 provider 不保证完全相同。
  - unknown: production 默认装配未注入 `durableTimelineStore`，而 `StoredAgentRecord` 不含 timeline；“durable rows”跨 daemon restart 的精确保证需按 provider/装配另行验证。

## 2. Context Tree

```text
Node: Agent Create / Run / Timeline Sync
  -> Node: Entry
  -> Node: Main Flow
  -> Node: Branches
  -> Node: Data And Dependencies
  -> Node: Effects
  -> Node: Related Capabilities
  -> Node: Risk And Unknowns
  -> Node: Validation
```

### Node: Agent Create / Run / Timeline Sync

- Type: `capability`
- Status: `confirmed`
- Purpose: 为创建失败、stream 丢失/重复、reload/resume 和跨版本投递问题提供最短源码路径。
- Read First:
  - [`docs/timeline-sync.md`](../../docs/timeline-sync.md): live 与 authoritative history 的合同。
  - [`packages/server/src/server/agent/create-agent/create.ts`](../../packages/server/src/server/agent/create-agent/create.ts) :: `createAgentCommand`。
  - [`packages/server/src/server/agent/agent-manager.ts`](../../packages/server/src/server/agent/agent-manager.ts) :: `createAgent`, `handleStreamEvent`, `recordAndDispatchTimelineItem`。
  - [`packages/app/src/timeline/session-stream-reducers.ts`](../../packages/app/src/timeline/session-stream-reducers.ts) :: `processAgentStreamEvent`。
- Edges / Children:
  - `Entry`: App、CLI、MCP 收敛到 shared command。
  - `Main Flow`: request -> provider session -> event -> sequenced timeline -> App convergence。
  - `Branches`: workspace/provider/prompt/delivery/sequence/lifecycle 分支。
  - `Data And Dependencies`: Agent record、timeline store、protocol、provider、client state。
  - `Effects`: persisted snapshot、live messages、catch-up pages、UI state、attention/auto-archive。
- Evidence: symbols and tests listed below。
- Unknowns: durable timeline 的默认 restart storage 边界见 Risk node。
- Next Drill-Down: 创建失败从 Entry 下钻；Timeline 缺口从 server record/dispatch 与 App sequencing 同时下钻。

### Node: Entry

- Type: `entry`
- Status: `confirmed`
- Purpose: 区分三种调用面和它们何时绕过 WebSocket create request。
- Read First:
  - App draft: [`workspace-tab.tsx`](../../packages/app/src/composer/draft/workspace-tab.tsx) :: `submitDraftCreateRequest` -> `client.createAgent()`。
  - CLI: [`run.ts`](../../packages/cli/src/commands/agent/run.ts) :: `runRunCommand` -> workspace resolution -> `client.createAgent()`。
  - MCP: [`paseo-tools.ts`](../../packages/server/src/server/agent/tools/paseo-tools.ts) :: `create_agent` -> shared `createAgentCommand()`。
  - Client: [`daemon-client.ts`](../../packages/client/src/daemon-client.ts) :: `DaemonClient.createAgent`。
  - Wire: [`messages.ts`](../../packages/protocol/src/messages.ts) :: `CreateAgentRequestMessageSchema`。
- Edges / Children:
  - App/CLI call `Main Flow` via `create_agent_request` and correlated `status.agent_created/agent_create_failed`。
  - MCP calls `Main Flow` at `createAgentCommand({ kind: "mcp" })` through daemon-injected dependencies。
  - guarded by: App requires connected client, selected provider, workspace directory and opaque workspace id；server validates directories/provider/mode。
  - configured by: provider/model/mode/thinking/features、workspace/worktree intent、initial prompt、attachments、labels、auto-archive。
- Evidence: caller searches and the three entry implementations。
- Unknowns: schedule/loop/Hub also reuse the command or AgentManager, but are outside this UI/CLI/MCP feature boundary。
- Validation: App draft unit test、CLI run tests、MCP tool tests、protocol parse tests。
- Next Drill-Down: caller-specific option precedence should be read in that caller, not duplicated in shared command。

### Node: Main Flow

- Type: `flow`
- Status: `confirmed`
- Purpose: 路由从用户 intent 到最终收敛，不复述 provider 实现。
- Route:
  1. [`workspace-tab.tsx`](../../packages/app/src/composer/draft/workspace-tab.tsx) :: `submitDraftCreateRequest` / [`run.ts`](../../packages/cli/src/commands/agent/run.ts) :: `runRunCommand` -> assemble config, `workspaceId`, prompt and optional worktree options。
  2. [`daemon-client.ts`](../../packages/client/src/daemon-client.ts) :: `createAgent` -> schema-parse `create_agent_request`, correlate request id, return created snapshot or throw failure。
  3. [`messages.ts`](../../packages/protocol/src/messages.ts) :: `CreateAgentRequestMessageSchema` -> authoritative wire shape and backward-compatible optional fields。
  4. [`session.ts`](../../packages/server/src/server/session.ts) :: `handleCreateAgentRequest` -> validate requested directory, derive title, optionally create worktree, resolve workspace/caller intent and cleanup ownership。
  5. [`create.ts`](../../packages/server/src/server/agent/create-agent/create.ts) :: `createAgentCommand` -> resolve session/MCP input, provider mode/features, required workspace id, prompt and run options。
  6. [`agent-manager.ts`](../../packages/server/src/server/agent/agent-manager.ts) :: `createAgentInternal` -> normalize config, require enabled/available provider, build launch context, `client.createSession()`, `registerSession()`。
  7. [`create.ts`](../../packages/server/src/server/agent/create-agent/create.ts) :: `sendInitialPrompt` -> [`agent-prompt.ts`](../../packages/server/src/server/agent/agent-prompt.ts) :: `startCreatedAgentInitialPrompt` -> AgentManager stream/run path；无 prompt 时停在已创建 session。
  8. [`agent-manager.ts`](../../packages/server/src/server/agent/agent-manager.ts) :: `subscribeToSession` -> `enqueueSessionEvent` serializes per-agent provider events -> `dispatchSessionEvent` -> `handleStreamEvent`。
  9. Timeline event -> `onStreamTimelineEvent` -> `recordAndDispatchTimelineItem` -> in-memory row with `seq`/`epoch`, optional durable append, then `AgentManagerEvent.agent_stream`。
  10. [`session.ts`](../../packages/server/src/server/session.ts) serializes and emits live `agent_stream` to eligible sessions；selective clients receive subscribed agents, legacy clients receive global delivery。
  11. [`session-context.tsx`](../../packages/app/src/contexts/session-context.tsx) queues `agent_stream`; [`session-stream-reducers.ts`](../../packages/app/src/timeline/session-stream-reducers.ts) :: `processTimelineSequencingGate` accepts next seq, drops stale/foreign epoch, or requests catch-up on gap。
  12. [`daemon-client.ts`](../../packages/client/src/daemon-client.ts) :: `fetchAgentTimeline` -> `fetch_agent_timeline_request`; [`session.ts`](../../packages/server/src/server/session.ts) returns projected bounded page；App applies overlap reconciliation and follows `hasNewer` until false。
- Key Objects:
  - [`agent-sdk-types.ts`](../../packages/server/src/server/agent/agent-sdk-types.ts) :: `AgentClient`, `AgentSession`, `AgentStreamEvent`。
  - [`agent-timeline-store.ts`](../../packages/server/src/server/agent/agent-timeline-store.ts) :: `InMemoryAgentTimelineStore`。
  - [`agent-storage.ts`](../../packages/server/src/server/agent/agent-storage.ts) :: `StoredAgentRecord` and JSON snapshot storage。
  - [`timeline-sync-plan.ts`](../../packages/app/src/timeline/timeline-sync-plan.ts) / [`viewed-timeline-sync.ts`](../../packages/app/src/timeline/viewed-timeline-sync.ts) :: authoritative catch-up and visible-agent subscriptions。
- Edges / Children:
  - branches to `Branches` before workspace resolution, provider launch, prompt start, delivery and sequence application。
  - writes/emits through `Effects`: agent snapshots, timeline rows/events, status/update/attention messages。
  - depends on protocol, workspace provisioning, provider runtime, WebSocket session and App store。
- Evidence: source route and [`docs/timeline-sync.md`](../../docs/timeline-sync.md)。
- Unknowns: provider-specific history replay may normalize or omit provider-native details。
- Validation: server create/manager tests plus App reducer/pagination tests prove both sides of the boundary。
- Next Drill-Down: inspect only the numbered step adjacent to the symptom, then its direct callers/tests。

### Node: Branches

- Type: `branch`
- Status: `confirmed`
- Purpose: 标出会改变 workspace ownership、agent existence 或 timeline convergence 的分支。
- Branches:
  - Workspace intent:
    - Source: [`session.ts`](../../packages/server/src/server/session.ts) :: `handleCreateAgentRequest`, create-agent intent resolver。
    - Condition: explicit `workspaceId`、`callerAgentId`、new directory workspace、legacy/new worktree intent。
    - Effect: agent 必须被 stamp 到一个 resolved opaque workspace id；fresh worktree 使用其新 workspace。
    - Status: `confirmed`
  - Missing directory / failed worktree:
    - Source: `handleCreateAgentRequest` and `CreateAgentLifecycleDispatch`。
    - Condition: requested/resolved cwd 不存在或 worktree setup fails。
    - Effect: correlated create failure；已创建且仍 owned 的 worktree 尝试 cleanup。
    - Status: `confirmed`
  - Provider/mode unavailable:
    - Source: [`create.ts`](../../packages/server/src/server/agent/create-agent/create.ts) :: `resolveSessionCreateAgent`; `AgentManager.createAgentInternal`。
    - Condition: provider disabled/unavailable、saved mode no longer exists、config normalization fails。
    - Effect: create fails before usable agent；源码注释确认 directory-only workspace cleanup 仍有 pre-existing gap。
    - Status: `confirmed`
  - Initial prompt absent:
    - Source: `resolveSessionCreateAgent` / `createAgentCommand`。
    - Condition: no text/images/attachments after normalization。
    - Effect: session and agent snapshot created, no initial run。
    - Status: `confirmed`
  - Prompt / permission / cancellation / failure:
    - Source: [`agent-manager.ts`](../../packages/server/src/server/agent/agent-manager.ts) :: stream event handlers。
    - Condition: provider requests permission or emits terminal turn event。
    - Effect: lifecycle, waiter, attention, timeline and optional auto-archive updates。
    - Status: `confirmed`
  - Out-of-band prompt:
    - Source: `AgentManager.tryRunOutOfBand`。
    - Condition: provider session accepts side-effect command during an active turn。
    - Effect: timeline events still use record/dispatch path; handler error becomes assistant error row。
    - Status: `confirmed`
  - Selective vs legacy delivery:
    - Source: [`viewed-timeline-sync.ts`](../../packages/app/src/timeline/viewed-timeline-sync.ts), session capability checks。
    - Condition: `server_info.features.selectiveAgentTimeline`。
    - Effect: selective subscription + grace vs global live stream；both retain authoritative catch-up。
    - Status: `confirmed`
  - Sequence decision:
    - Source: [`session-stream-reducers.ts`](../../packages/app/src/timeline/session-stream-reducers.ts) :: `classifySessionTimelineSeq`。
    - Condition: init, exact next, stale, gap, foreign epoch, or new epoch starting at seq 1。
    - Effect: apply/drop/catch-up/reset live timeline。
    - Status: `confirmed`
  - Catch-up pagination:
    - Source: [`docs/timeline-sync.md`](../../docs/timeline-sync.md), Session fetch handler, App timeline sync plan。
    - Condition: cursor known/unknown, before/after direction, `hasNewer`。
    - Effect: latest tail for first load; resume after cursor to completion; older pages user-driven。
    - Status: `confirmed`
  - Auto-archive:
    - Source: create lifecycle dispatch and [`docs/agent-lifecycle.md`](../../docs/agent-lifecycle.md)。
    - Condition: `autoArchive` and first terminal turn event。
    - Effect: agent archived；owned isolated workspace may be archived and worktree removed when last reference ends。
    - Status: `confirmed`
- Evidence: named symbols, protocol feature flags and focused tests。
- Unknowns: provider-native retry semantics are provider-specific。
- Validation: use Branch Index test mapping below。
- Next Drill-Down: verify only the branch whose condition is present in the failing request/event。

### Node: Data And Dependencies

- Type: `dependency`
- Status: `confirmed`
- Purpose: 区分 wire、runtime、persistent snapshot 和 App presentation state。
- Read First:
  - Agent snapshot: [`agent-storage.ts`](../../packages/server/src/server/agent/agent-storage.ts), `$PASEO_HOME/agents/.../*.json`。
  - Timeline runtime: [`agent-timeline-store.ts`](../../packages/server/src/server/agent/agent-timeline-store.ts), `epoch`, monotonic `seq`, projected ranges。
  - Protocol: [`messages.ts`](../../packages/protocol/src/messages.ts) for create/stream/fetch schemas and feature flags。
  - Provider: [`providers`](../../packages/server/src/server/agent/providers) via `AgentClient.createSession()` and `AgentSession.subscribe()`。
  - App state: SessionContext + timeline reducers + visible-agent sync；optimistic prompt is presentation state, not canonical history。
- Edges / Children:
  - provider events provide data to AgentManager。
  - AgentManager writes snapshots and timeline state, emits session events。
  - fetch reads current agent timeline and projects pages to App。
  - failures surface through correlated status/RPC error, stream terminal events, gaps or provider history limitations。
- Evidence: storage schemas, manager implementation and timeline docs。
- Unknowns: default production `durableTimelineStore` is absent from current `bootstrap.ts`; provider history is therefore important for restart hydration。
- Validation: restart/rehydration tests plus in-process timeline store tests。
- Next Drill-Down: storage claims require reading current `bootstrap.ts`, not only interfaces or docs。

### Node: Effects

- Type: `effect`
- Status: `confirmed`
- Purpose: 明确成功、部分成功和失败后可见的状态。
- Effects:
  - State changes: agent enters initializing/idle/running/error/closed; workspace activity aggregates by `workspaceId`。
  - Writes: non-internal agent snapshot JSON；timeline row in in-memory store and optional configured durable store；provider-native session files remain provider-owned。
  - Returned values: correlated `agent_created` snapshot or `agent_create_failed` error；MCP receives structured create result。
  - Messages emitted: `agent_update`/state, `agent_stream`, permission, attention and fetch timeline responses。
  - Downstream behavior: App opens/updates agent pane, advances cursor, triggers catch-up, reconciles optimistic prompt and canonical projection。
  - User-visible effect: every daemon-committed current-tail row should eventually appear when the client opens/resumes that agent。
- Evidence: Session status emission, AgentManager dispatch, App reducers, timeline invariant doc。
- Unknowns: delivery while provider/daemon is permanently lost cannot be reconstructed beyond persisted/provider history。
- Validation: timeline reconnect/window e2e and App pagination specs。
- Next Drill-Down: inspect status/state separately from timeline; one can succeed while initial prompt execution fails。

### Node: Related Capabilities

- Type: `capability`
- Status: `confirmed`
- Purpose: 显示会共享 agent/workspace/timeline 合同但不属于本图的入口。
- Relations:
  - upstream: workspace creation/selection、provider catalog/config、host connection/capabilities。
  - downstream: permissions、notifications/attention、auto-archive、fork/rewind、schedule/loop/Hub execution。
  - shared model: Workspace ownership, Agent lifecycle, provider persistence handle。
  - shared config: provider mode/model/features、MCP tool injection、client capabilities。
  - companion map: [`Workspace、Worktree 与归档恢复`](2026-07-20_01-47_Workspace-Worktree与归档恢复功能.md)。
- Evidence: create command callers, manager services and lifecycle docs。
- Unknowns: related feature branches are not fully traced here。
- Next Drill-Down: cross into companion map only when workspace placement/archive is part of the task。

### Node: Risk And Unknowns

- Type: `risk`
- Status: `confirmed`
- Purpose: 防止“live 看到了”被误判为“history 已收敛”，或创建副作用被遗漏。
- Risks:
  - Live delivery is not correctness: presence/focus may affect notification, never stream correctness。Verify: gap/reconnect tests and authoritative fetch。
  - Page is bounded but catch-up must be complete: stop only at `hasNewer=false`。Verify: App pagination e2e。
  - Epoch/seq is source position, rendered index/provider id is not durable。Verify: reducer and fork boundary tests。
  - Projected page can overlap live deltas: append-only UI merge duplicates content。Verify: `sourceSeqRanges` reducer tests。
  - Provider mode validation happens after some workspace/worktree setup: directory-only cleanup gap is explicitly documented in source。Verify: create failure tests and registry state。
  - Protocol compatibility: optional fields and feature-gated delivery must remain readable by old peers。Verify: protocol/client/server contract tests。
  - Timeline durability boundary: current default bootstrap uses in-memory timeline and agent snapshots omit rows。Verify: trace bootstrap injection and provider history on daemon restart before promising persistence。
- Unknowns:
  - Exact cross-restart completeness for each provider: needs provider-specific real session/restart test。
  - Whether future bootstrap injects a durable timeline implementation: re-check constructor wiring on drift。
- Next Drill-Down: read [`docs/timeline-sync.md`](../../docs/timeline-sync.md), then only the relevant manager/reducer test block。

### Node: Validation

- Type: `validation`
- Status: `confirmed`
- Purpose: 覆盖创建侧和消费侧，避免只验证一半链路。
- Validation Entry:
  - Create command: [`create.test.ts`](../../packages/server/src/server/agent/create-agent/create.test.ts)、[`create-agent-lifecycle-dispatch.test.ts`](../../packages/server/src/server/agent/create-agent-lifecycle-dispatch.test.ts)。
  - Agent manager/store: [`agent-manager.test.ts`](../../packages/server/src/server/agent/agent-manager.test.ts)、[`agent-manager-stream-coalescing.test.ts`](../../packages/server/src/server/agent/agent-manager-stream-coalescing.test.ts)、[`agent-timeline-store.test.ts`](../../packages/server/src/server/agent/agent-timeline-store.test.ts)。
  - Session/worktree/auto-archive: [`session.create-agent-worktree-autoarchive.e2e.test.ts`](../../packages/server/src/server/session.create-agent-worktree-autoarchive.e2e.test.ts)。
  - Protocol: [`messages.create-agent-worktree-autoarchive.test.ts`](../../packages/protocol/src/messages.create-agent-worktree-autoarchive.test.ts)、[`messages.create-agent-client-message-id.test.ts`](../../packages/protocol/src/messages.create-agent-client-message-id.test.ts)。
  - App entry/reducer: [`workspace-tab.test.ts`](../../packages/app/src/composer/draft/workspace-tab.test.ts)、[`session-stream-reducers.test.ts`](../../packages/app/src/timeline/session-stream-reducers.test.ts)、[`viewed-timeline-sync.test.ts`](../../packages/app/src/timeline/viewed-timeline-sync.test.ts)。
  - End-to-end convergence: [`selective-timeline-delivery.e2e.test.ts`](../../packages/server/src/server/selective-timeline-delivery.e2e.test.ts)、[`timeline-reconnect-contract.e2e.test.ts`](../../packages/server/src/server/daemon-e2e/timeline-reconnect-contract.e2e.test.ts)、[`agent-timeline-pagination.spec.ts`](../../packages/app/e2e/agent-timeline-pagination.spec.ts)。
  - Local command: `npx vitest run <one-listed-test-file> --bail=1`；App e2e 按单个 spec 的项目命令运行。
  - Logs: checkout-local `.dev/paseo-home/daemon.log`；trace keys include `agent.manager.enqueue/dequeue/dispatch_stream`。
- Edges / Children:
  - proves: create option resolution, provider registration lifecycle, seq/epoch gates and current-tail convergence。
  - does not prove: every real provider、mobile background OS behavior or relay outage without the corresponding focused integration test。
- Evidence: test files exist and target the named boundaries。
- Unknowns: exact test command for a real provider depends on local provider setup/auth。
- Next Drill-Down: pick one server test and one App reducer/e2e only when a change crosses both sides。

## 3. Compact Indexes

### Entry Point Index

| Entry            | Path                                                    | Handler / Function         | Status    | Notes                                        |
| ---------------- | ------------------------------------------------------- | -------------------------- | --------- | -------------------------------------------- |
| App composer     | `packages/app/src/composer/draft/workspace-tab.tsx`     | `submitDraftCreateRequest` | confirmed | requires connected client/provider/workspace |
| CLI              | `packages/cli/src/commands/agent/run.ts`                | `runRunCommand`            | confirmed | resolves existing/new workspace first        |
| MCP              | `packages/server/src/server/agent/tools/paseo-tools.ts` | tool `create_agent`        | confirmed | calls shared command directly                |
| WebSocket client | `packages/client/src/daemon-client.ts`                  | `createAgent`              | confirmed | correlated status response                   |
| Daemon session   | `packages/server/src/server/session.ts`                 | `handleCreateAgentRequest` | confirmed | owns request side effects/cleanup            |

### Key Object Index

| Object                            | Path                                                       | Kind       | Responsibility                               | Used By                  |
| --------------------------------- | ---------------------------------------------------------- | ---------- | -------------------------------------------- | ------------------------ |
| `CreateAgentRequestMessageSchema` | `packages/protocol/src/messages.ts`                        | schema     | wire contract                                | client/session           |
| `createAgentCommand`              | `packages/server/src/server/agent/create-agent/create.ts`  | function   | shared session/MCP creation                  | Session, MCP, automation |
| `AgentManager`                    | `packages/server/src/server/agent/agent-manager.ts`        | class      | provider lifecycle + timeline event pipeline | daemon services          |
| `InMemoryAgentTimelineStore`      | `packages/server/src/server/agent/agent-timeline-store.ts` | class      | epoch/seq rows and page fetch                | AgentManager             |
| `ViewedTimelineSync`              | `packages/app/src/timeline/viewed-timeline-sync.ts`        | controller | selective subscription + catch-up            | SessionContext           |
| `processAgentStreamEvent`         | `packages/app/src/timeline/session-stream-reducers.ts`     | reducer    | sequencing and presentation state            | SessionContext queue     |

### Branch Index

| Branch            | Source                                 | Condition                       | Effect                         | Status    |
| ----------------- | -------------------------------------- | ------------------------------- | ------------------------------ | --------- |
| Workspace intent  | `session.ts`, `create-agent/intent.ts` | explicit/caller/new/worktree    | resolved ownership             | confirmed |
| Provider config   | `create.ts`, `agent-manager.ts`        | disabled/unavailable/stale mode | create failure                 | confirmed |
| No initial prompt | `create.ts`                            | no prompt content               | idle created session           | confirmed |
| Delivery policy   | `viewed-timeline-sync.ts`              | selective feature flag          | subscriptions vs global stream | confirmed |
| Sequence gate     | `session-stream-reducers.ts`           | stale/gap/epoch                 | drop/catch-up/reset            | confirmed |
| Auto-archive      | lifecycle dispatch                     | terminal turn + option          | agent/workspace archive        | confirmed |

### Quick File Index

- [`docs/timeline-sync.md`](../../docs/timeline-sync.md): convergence contract。
- [`packages/server/src/server/agent/create-agent/create.ts`](../../packages/server/src/server/agent/create-agent/create.ts): shared creation route。
- [`packages/server/src/server/agent/agent-manager.ts`](../../packages/server/src/server/agent/agent-manager.ts): provider events and timeline rows。
- [`packages/server/src/server/session.ts`](../../packages/server/src/server/session.ts): request handler, delivery and fetch pages。
- [`packages/app/src/contexts/session-context.tsx`](../../packages/app/src/contexts/session-context.tsx): client event wiring。
- [`packages/app/src/timeline/session-stream-reducers.ts`](../../packages/app/src/timeline/session-stream-reducers.ts): seq/epoch reconciliation。

## 4. Next Drill-Down

- For implementation: read the exact Entry caller, then `createAgentCommand`, manager handler and one adjacent test。
- For risk review: read protocol compatibility rules, timeline sync doc and capability gate cleanup comments。
- For debugging: correlate `requestId`, `agentId`, `epoch`, `seq` and daemon trace from create handler through App reducer。
- For historical/compatibility confirmation: `rg "COMPAT\\("` in protocol/session/create/timeline files and inspect git history only for the affected branch。
- Drift check date: `2026-07-20`；index: [`.skills/project/CODEMAP_INDEX.md`](../../.skills/project/CODEMAP_INDEX.md)。
