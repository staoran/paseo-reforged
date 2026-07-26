# Findings: 会话重试状态

## 范围与基线

- 父项：二号总表 `P-02`。
- 本轮刻意收敛为 **Codex-only**：Research 先定义最小外部字段与定向测试清单，产品实现随后由用户单独批准。
- supporting audit 只写入本文件；实际实现与验证时间线由 `progress.md` 维护，父任务另行维护二号总表投影。未更新 CodeMap。
- 本机 Codex：`codex-cli 0.145.0`；官方源码 tag：`rust-v0.145.0`（`1635de866c61d1b76e50b31928ee6d61482435a8`）。
- Paseo 基线：`upstream/main@65633004b23d6eeeda9321e04f096ca647694b2b`，package version `0.2.1`。

## 修正后的 Codex 结论

此前“Codex 不能显示重试次数”的结论不完整。

- app-server `error` notification 没有独立的 structured `attempt`、`maxAttempts` 或 delay 字段。
- 但必填的 `error.message` 就是 Codex CLI 已格式化、面向用户的 retry 文案，例如 `Reconnecting... 2/5`。
- Paseo 应 **逐字显示** `error.message`。这样保留 CLI 已显示的次数，不猜测数字，也不依赖未文档化的 message grammar。
- 此结论只覆盖 app-server 可见的 stream/compact retry，并不代表每次内部 HTTP retry 都会通知 UI：`request_max_retries` 是可静默成功的 transport loop；耗尽后可能才触发外层 stream retry。

面向用户的状态语义仍是 `retrying`，而不是 `reconnecting`：overload、rate limit 或 stream 断开均可能重试，却不一定重建连接。

## 上游证据

| 事实                       | 可复现证据                                                                                                                                                     | 对 Paseo 的影响                                                                       |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| 稳定 v2 notification shape | 本机 `0.145.0` 的 `codex app-server generate-json-schema --out <tmp>` 与 `generate-ts`；`v2/ErrorNotification` 必填 `error`、`threadId`、`turnId`、`willRetry` | 原生 thread/turn identity 可用于精确归属 retry state。                                |
| Error 内容                 | 生成的 `v2/TurnError.ts`：`message: string`、`codexErrorInfo`、`additionalDetails`                                                                             | footer 只使用 `message`；`additionalDetails` 是底层诊断材料，不能复制进去。           |
| Retry notification mapping | `codex-rs/app-server/src/bespoke_event_handling.rs:943-958` 把 `EventMsg::StreamError` 映射为 `ErrorNotification { willRetry: true }`                          | 收到 `willRetry: true` 是中间 retry，不是 terminal turn failure。                     |
| Terminal mapping           | `bespoke_event_handling.rs:1584-1599` 对 terminal error 发 `willRetry: false`                                                                                  | 它是显式 reset boundary。                                                             |
| 次数文案格式               | `codex-rs/core/src/responses_retry.rs:48-75` 在 `notify_stream_error` 前格式化 `Reconnecting... {retry_count}/{max_retries}`                                   | 保留完整 string；不要增加 parsed number field。                                       |
| Release WebSocket 特例     | `responses_retry.rs:59-63`；`core/tests/suite/websocket_fallback.rs:127-205` 的 `websocket_fallback_hides_first_websocket_retry_stream_error`                  | release 首条可为 `2/5`；测试不得要求从 `1/5` 开始。                                   |
| Transport fallback         | `responses_retry.rs:31-45` 先 warning、重置 retry counter、再把 WebSocket 切至 HTTPS                                                                           | 可见顺序可为 `5/5 -> warning -> 1/5`；warning 必须先清除旧 label。                    |
| Local/remote compact       | `core/src/compact.rs:301-318` 发 `Reconnecting... N/M`；`core/src/compact_remote_v2.rs:345-380` 复用 stream retry helper                                       | 合法的 Codex-native `/compact` retry 可在没有 Paseo composer foreground turn 时存在。 |
| 仅 UI-producing sources    | `0.145.0` production `notify_stream_error` 调用在 `compact.rs:305` 与 `responses_retry.rs:67`；`session/mod.rs:3815-3831` 发 `EventMsg::StreamError`           | 只对该可观察合同负责，不承诺静默 request-level retry。                                |
| TUI 行为                   | `tui/src/chatwidget/streaming.rs:284-294` 将 raw message 装入 status header；`protocol.rs:21-30` 在下一条 live non-retry notification 恢复                     | Paseo 要镜像原文，并在恢复的 live activity 清除；不能从 timeline 推断恢复。           |
| Replay 行为                | 官方 TUI replay tests 拒绝从 replayed error 恢复 retry status                                                                                                  | retry 是 live runtime state，不是 history。                                           |
| HTTP retry 区别            | `model-provider-info/src/lib.rs:262-277` 构造 `request_max_retries`；`codex-client/src/retry.rs:49-72` sleep/retry 时不发 event                                | 不能承诺 UI 覆盖每个 low-level retry。                                                |

Context7 的官方 Codex protocol source 也确认：`ErrorNotification` 必填上述四个字段，stream error 为 `willRetry=true`、terminal 为 `false`，且 `additionalDetails` 是独立的 underlying-error string。

Context7 的 app-server README 还确认 runtime `warning` 只有可选 `threadId` 与 `message`；初始化/config warning 可以没有 threadId。只有已确认 root thread/native turn 的 runtime warning 才能清 retry，不能把无 threadId 的 warning 套入“缺 threadId 即 root”的默认路由。

Codex 的 `stream_max_retries` 默认值为 5、可配置且上限为 100；`N/M` 中的 `M` 不能硬编码为 5，进一步说明 Paseo 只能原样透传文案。

## 当前 Paseo 缺口与陷阱

1. `packages/server/src/server/agent/providers/codex-app-server-agent.ts` 的 `CodexNotificationSchema` 没有 `method: "error"` 或 runtime `warning` 分支；官方 notification 当前落入 `unknown_method`。warning 不能复用“无 threadId 即 root”的通用路由默认值。
2. 现有 `turn/completed` transform 保留 `status`、`errorMessage`、`threadId`，却丢掉官方 `params.turn.id`。必须保留 native ID 来过滤 stale terminal event；Paseo permissive parser 可暂时把它设为 optional，但 fixture 要覆盖官方 required shape。
3. `notifySubscribers()` 会用 Paseo 的 `activeForegroundTurnId` 给 event 附加 `turnId`，覆盖 provider event turn ID。Codex 原生 `threadId`/`turnId` 必须在到达这里 **之前** 校验，之后才能绑定 Paseo foreground ID 给 manager routing。
4. 当前 route 有 `root`、`sub_agent` 与 `pending_sub_agent`。child、pending child、unmapped thread 的 retry 永远不能改 root footer；尤其在 `currentThreadId` 尚未已知时，不能假定 error 属于 root。
5. fake app server 的 `completeTurn()` 当前不带 `turn.id`，虽然官方 notification 要求它；放任该松散 fixture 会掩盖 stale-terminal bug。
6. App 只接受 `updatedAt` 不旧于当前值的 agent directory update（`packages/app/src/utils/agent-directory-update-policy.ts`）。每次 set/clear 都必须推进 timestamp，否则有效 retry snapshot 可被当 stale 丢弃。
7. `emitState()` 默认持久化。retry state 必须排除 `StoredAgentRecord`，并通过 `persist: false` 或等效 non-durable path 发出；daemon restart 不得复活旧 label。
8. `listAgentPayloads()` 把 live 与 persisted agent 合并为同一 `AgentSnapshotPayload[]`；活动列表可以合法携带 live retry，但 stored record 和 `AgentListItemPayload` 不能携带。测试不能只检查较窄的 list item 类型，否则会漏掉 `fetch_agents` 的实际 wire shape。
9. `ReplicaCache` 的写入 serializer 当前手工复制 snapshot 字段，但 `StoredAgentSchema` 复用了 `AgentSnapshotPayloadSchema`；新增字段后必须同时验证写入和 rehydrate 都不会保留预置的 retry key。

## 进一步遗漏审计

- **App 传播链**：`normalizeAgentSnapshot()` 当前只返回 App `Agent` 的显式字段；`Agent`、`ChatAgentStateShape`、`selectChatAgentState()`、`buildChatAgentFromState()`、`AgentScreenAgent` 和 `AgentStreamView` 都是独立投影点。只改 protocol/schema 或只改 `TurnFooter` 都会得到“snapshot 有值但 footer 不更新”的假阳性。
- **memo 失效条件**：`AgentStreamView` 通过 `agentStreamViewPropsEqual()` 自定义比较 `context`。retry 文案变化必须进入 `collectAgentScreenAgentDiffs()`，否则 `TurnFooter` 不会重新渲染；`TurnFooter` 自身也是 memo，新增 prop 还必须随 `useMemo(turnFooterNode)` 依赖变化。
- **sync/source 门禁**：`use-agent-screen-state-machine` 可以在 `source: "stale"` 下继续显示上一次 agent；`AgentPanel` 当前只把 `effectiveAgent` 传给 `AgentStreamView`，没有传 `sync`。因此 footer 必须同时要求 `source: "authoritative"`、`sync.status: "idle"` 和 `status: "running"`，否则 reconnect/catch-up/sync-error 期间会展示旧 retry 文案。
- **详情入口复用**：`fetch_agent`、timeline response 和 MCP `get_agent_status` 复用 `AgentSnapshotPayload`，活动 agent 会自然带上 live 字段。这不是新增字段泄漏；真正的持久化边界仍是 `StoredAgentRecord`、`AgentListItemPayload` 和 replica cache。
- **关闭/替换路径**：`prepareAgentForClosure()` 当前 spread 原对象；close、reload、replace、archive 前后都必须有显式 retry clear，不能只测试 `turn/completed`。否则 closed snapshot 或新注册 session 可能继承旧文案。
- **warning 的两种空值**：官方 `WarningNotification.threadId` 可以缺失，也可以显式为 `null`；两者都不等于 root。只有已经确认 root thread 且存在 current native turn association 的 runtime warning 才能清除 retry。
- **完成通知的兼容降级**：稳定 schema 要求 `turn/completed.turn.id`，但现有 fake helper 没有该字段。若 parser 为旧 Codex 保留 optional，缺 ID 的完成通知不能清除当前 retry，否则 stale terminal 会误清新 turn 状态。
- **清除位置**：`notifySubscribers()` 会把任何 provider event 改标为 `activeForegroundTurnId`，当前 `handleNotification()` 在 root/sub-agent/pending-sub-agent 分流后才进入具体 handler。retry set/clear 与“正常 live activity”clear 必须在 root route、native thread/turn 校验完成后集中处理；不能放在 `notifySubscribers()` 之后，也不能在 child/pending/invalid/unknown handler 中顺带清除。
- **MultiAgent 例外**：普通 spawned child 的 retry 不能投影到父会话；但 upstream review 会以父 `TurnContext` 转发 `StreamError`。实现和测试必须按 native root route 判定，而不能根据“来自 subagent/review”做一刀切过滤。
- **测试形态约束**：仓库测试规则禁止 JSDOM/RN component mount 作为中间测试形态；footer 的用户可见文案应由真实浏览器/E2E 断言，纯函数/投影才使用单元测试。

## 最小公共协议

仅向 `AgentSnapshotPayloadSchema` 增加一个 optional field：

```ts
providerRetryMessage?: string
```

语义：

- 字段存在：provider 当前正在 retry；原样渲染该 string。
- 字段缺失：没有当前 provider retry。App 在 in-memory agent view 归一化为 `null`。
- 它仅是 snapshot field。既有 `agent_update`/snapshot delivery 已可承载；不新增 RPC、event namespace、public retry object、`attempt`、`maxAttempts`、delay、wire `updatedAt` 或 capability gate。
- 不解析 `N/M`、不翻译成虚构 numeric field、也不再造 footer grammar；Codex 拥有 message 与次数措辞。
- 活动 `fetch_agents`/`agent_update` snapshot 可以承载它；但不进入 `StoredAgentRecord`、`AgentListItemPayload`、durable timeline row、history/replay 或 client-persistent replica cache。
- 新 client 连接旧 daemon 时收到 absence 并渲染 `null`；旧 client 忽略 append-only optional field。这是被动 snapshot presentation，不需要 degraded action path。

server 可持有私有 ephemeral tuple，例如 `{ message, nativeThreadId, nativeTurnId }`，用于 ownership 和 stale filtering；它是实现细节，不能上 wire。

## Codex 状态规则

1. 只有所有官方 required fields 都存在时才解析 live app-server `error` notification。
2. 先解析 native `threadId`。只有已知 root thread 才有资格影响 root footer。
3. 把 native `turnId` 与当前 native root turn 比较，再转换成 Paseo event。stale old turn 既不能替换也不能清除较新的 retry message。
4. `willRetry: true` 时设置 raw `error.message`。native thread/turn 有效的 out-of-band `/compact` retry 即使没有 Paseo composer foreground ID 也应接受；不能以 `activeForegroundTurnId` 缺失为由拒绝。
5. matching `willRetry: false` 时 clear。matching terminal `turn/completed`、新 root `turn/started`、当前 root thread/turn 关联的任意后续 live non-retry notification、close/reload 和 recovered live root activity 也 clear。transport-fallback warning 没有 required native turn ID，只有 root thread 与当前 native turn association 已知时才能 clear；无 threadId 的 config/init warning 不得 clear。
6. provider history/replay 永远不 set retry state；同一 daemon 的新订阅可从当前内存 snapshot 恢复正在进行的 retry。disconnect/reload 时立即清 local App state，client cache 与 daemon restart 不得复活旧文案。
7. child、pending-child 与 unmapped notification 保持隔离；Codex provider-subagent UI 不属于本阶段 footer 范围。

## 定向测试清单

### Codex adapter：`codex-app-server-agent.test.ts` 与 `codex/test-utils/fake-app-server.ts`

- fake `error` notification helper 带齐四个 required native fields；`completeTurn()` 默认带 native turn ID。
- `turn/started` 后发 `willRetry: true` 的 `Reconnecting... 2/5`，再发 `3/5`；证明 adapter 原样转发，无 parsed number 或 `additionalDetails`。
- release-WebSocket fixture 首条使用 `2/5`；要求 `1/5` 的测试是错误的。
- `willRetry: false` clear，且不能把中间 retry 变为 duplicate terminal event。
- 当前 root thread/turn 关联的任意 live non-retry notification（delta/item/usage 等）、matching `turn/completed`、new `turn/started` 与 `close()` 都 clear；无 threadId 的 config/init warning 不在此列。
- `5/5 -> warning -> 1/5`：warning 先清旧值，后续 retry 再发布新 raw value。
- runtime `warning` 必须带匹配 root `threadId` 且已有 current native turn association 才能清除；无 threadId 的 config/init warning 不得清除。
- 缺 `willRetry`、`threadId`、`turnId` 或 `error.message` 的 malformed error 走既有 invalid/unknown path，不能改 retry state。
- old native turn 的 retry/completion 不能 overwrite/clear current native turn state。
- child、pending-child、unmapped thread error 不更新 root footer；root thread ownership 未确认前不得接收。
- native `/compact` retry 在 native thread/turn 有效、Paseo foreground turn 缺失时仍被接受。

### Manager 与 projection：`agent-manager.test.ts`、`agent-projections.test.ts`、`agent-updates-service.test.ts`

- 建模 set、replace、clear transition 为 ephemeral manager state；每次 emitted snapshot 的 `updatedAt` 单调变新。
- `toAgentPayload()` 只在 live 时含 `providerRetryMessage`；`toStoredAgentRecord()` 即使后续发生无关 persist 也永不含该字段。
- retry update 不写 timeline row，也不改变 `AgentListItemPayload`。
- 同一 daemon 的新订阅可以收到当前内存 retry；持久化 bootstrap 不得覆盖较新的 buffered live snapshot。活动 `fetch_agents` 可携带 live 值，stored/list-item projection 不得携带。
- terminal、cancel、reload、session close 在 final snapshot 前清内存值。

### Protocol 与 App：`agent-feature-schemas.test.ts`、`agent-snapshots.test.ts`、`agent-directory-reconciliation.test.ts`、`use-agent-screen-state-machine.test.ts`、`runtime/replica-cache/index.test.ts`，以及必要的新 footer test

- protocol 接受有/无 optional string 的 snapshot；缺字段的 old-server snapshot 仍有效。
- `normalizeAgentSnapshot()` 把 absence 转为 `null`；后到的 clear snapshot 必须覆盖旧 retry value，不能被 local retention 留住。
- directory reconciliation 接受较新的 set/clear snapshot，拒绝刻意更旧的 snapshot，保护 stale delivery。
- replica cache 写入不保存 retry；即使 raw cache 预置该 key，rehydrate 也必须丢弃。
- agent running 时 footer 显示精确 Codex message；normalized value 为 `null` 后不显示 retry label。
- provider history/replay 单独存在时不能重建 footer；同一 daemon 的 fresh authoritative snapshot 可以恢复仍在进行的 retry，client cache/daemon restart 不可以。

## 提交前 P1 根因与最终结论

- **R1 / stale compaction**：`thread/compacted` 只校验 root thread 和“存在当前 turn”，携带旧 `turnId` 的迟到通知因而会清除新 turn 的 retry。修复只在该 root retry handler 增加 native turn 匹配；无 `turnId` 的兼容通知保持原行为。
- **R2 / closure 时间戳**：`prepareAgentForClosure()` 清除 retry 后生成 closed snapshot，却沿用最后一份 running/retry snapshot 的 `updatedAt`。修复在构造 closed snapshot 前调用现有单调 `touchUpdatedAt()`，使乱序接收端能稳定选择 closed/null。
- **R3 / bootstrap completion order**：同一 agent 的多个 live payload 异步构建时，pending Map 按完成顺序覆盖；旧 retry 可晚于较新 clear 完成。修复在现有 buffer 写入点比较 upsert 的 `updatedAt`，拒绝较旧版本覆盖较新版本。
- 三项均通过公开 subscription 输出验证，未新增协议字段、Provider 分支或抽象。最终 Standards/Spec 复审未发现新的 Codex-only 阻断项。

## 延后与剩余不确定性

- 未向真实 Codex session 注入 transient failure；fake app-server test 是 deterministic validation layer，真实 UI 路径由浏览器 WebSocket snapshot 注入用例覆盖。
- Codex 未来可能改变文案或 retry budget；raw passthrough 能容忍，parsing 不能。
- 引用的 upstream local compact retry test 当前是 ignored；它是设计证据，不是稳定 black-box guarantee。
- 其他 provider 的 retry shape 与 multi-provider public abstraction 明确延期；本文不选择其第一阶段实现。
- Windows Playwright harness 无法进入浏览器阶段；Linux/CI 仍需运行新增的 provider retry E2E。

## Change Log

- 2026-07-26：修正 Codex retry-count 结论，以单字段 `providerRetryMessage?: string` snapshot contract 替换公共 retry object。
- 2026-07-26：补充 release WebSocket、transport fallback、compaction、silent HTTP retry、native thread/turn routing、non-durable state 和 snapshot ordering 的源码证据。
- 2026-07-26：加入 Codex-only 定向测试清单；随后取得执行批准并完成本地实现与非浏览器验证。
- 2026-07-26：记录并修复 stale compaction、closure 时间戳和 bootstrap completion-order 三个提交前 P1；最终复审恢复为 PASS。
- 2026-07-25：补充 warning threadId、同 daemon subscription、活动 `fetch_agents`、list-item/cache projection 与 retry budget 的遗漏边界，并将协议测试入口校正为 `agent-feature-schemas.test.ts`。
