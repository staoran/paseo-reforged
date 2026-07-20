# Terminal、Binary Frame 与 Backpressure CodeMap (feature)

> Agent-facing route from PTY bytes to xterm commit. Source and tests win when this map drifts.

## 1. Orientation

- Goal: 定位 Terminal 创建/订阅、binary frame 双向传输、snapshot catch-up 和 backpressure 的完整链路。
- Scope: PTY + headless xterm、worker IPC、两级 output coalescing、WebSocket binary frame、slot routing、App xterm write queue、resize/input、snapshot/restore/reconnect。
- Non-Scope: Terminal activity hook/notification业务、terminal UI 样式、file-transfer binary protocol、shell setup script 内容。
- Primary question: “PTY 输出如何低延迟到达客户端；客户端跟不上时，系统在哪里切换为 snapshot 且不丢不重？”
- Confidence:
  - confirmed: frame layout、两级 coalescer、revision replay、backpressure thresholds、App write barrier 和测试/benchmark 入口已由源码复核。
  - inferred: 实际延迟由共享 daemon/browser main loop、PTY/OS 和 relay 加密负载共同决定。
  - unknown: relay transport 不暴露 `bufferedAmount`，无法区分快慢 relay client；当前实现因此在 byte threshold 直接 fallback。

## 2. Context Tree

```text
Node: Terminal Stream
  -> Node: Entry
  -> Node: Main Flow
  -> Node: Branches
  -> Node: Data And Dependencies
  -> Node: Effects
  -> Node: Related Capabilities
  -> Node: Risk And Unknowns
  -> Node: Validation
```

### Node: Terminal Stream

- Type: `capability`
- Status: `confirmed`
- Purpose: 为 echo latency、burst lag、snapshot corruption、resize ownership 和 reconnect 丢输出提供最短调查路径。
- Read First:
  - [`docs/terminal-performance.md`](../../docs/terminal-performance.md): pipeline、阈值和性能不变量。
  - [`terminal-session-controller.ts`](../../packages/server/src/terminal/terminal-session-controller.ts) :: `bindActiveStream`, `trySendSnapshot`, `replayTerminalOutputAfterSnapshot`。
  - [`terminal-stream-router.ts`](../../packages/client/src/terminal-stream-router.ts) :: slot/frame routing。
  - [`terminal-emulator-runtime.ts`](../../packages/app/src/terminal/runtime/terminal-emulator-runtime.ts) :: `processOutputQueue`。
- Edges / Children:
  - `Entry`: create/subscribe/input/resize 和 reconnect restore。
  - `Main Flow`: PTY -> worker -> daemon -> binary WS -> client router -> xterm。
  - `Branches`: binary fallback、snapshot mode、backpressure signal、capability、multi-client、exit。
  - `Data And Dependencies`: slot、revision、snapshot state、buffer counters、transport metrics。
- Evidence: named source symbols and focused tests below。
- Unknowns: production contention must be measured; static code cannot prove latency percentiles。
- Next Drill-Down: correctness issue follows revision/snapshot route；latency issue follows both coalescers and runtime metrics。

### Node: Entry

- Type: `entry`
- Status: `confirmed`
- Purpose: 从真实 client intent 进入 terminal lifecycle 和 stream binding。
- Read First:
  - UI surface: [`terminal-pane.tsx`](../../packages/app/src/components/terminal-pane.tsx)。
  - App stream lifecycle: [`terminal-stream-controller.ts`](../../packages/app/src/terminal/runtime/terminal-stream-controller.ts) :: `setTerminal`。
  - Client API: [`daemon-client.ts`](../../packages/client/src/daemon-client.ts) :: `createTerminal`, `subscribeTerminal`, `sendTerminalInput`。
  - Wire schemas: [`messages.ts`](../../packages/protocol/src/messages.ts) :: terminal requests/responses。
  - Daemon boundary: [`terminal-session-controller.ts`](../../packages/server/src/terminal/terminal-session-controller.ts) :: `dispatch`, `handleBinaryFrame`。
- Edges / Children:
  - `create_terminal_request` creates a workspace-owned PTY through the worker manager。
  - `subscribe_terminal_request` assigns a per-client slot and sends the response before initial snapshot/restore frame。
  - Input/resize uses binary once the slot exists；without a slot, client falls back to JSON `terminal_input`。
  - guarded by: absolute/allowed cwd、workspace ownership、terminal existence、binary channel availability、256 slot ceiling。
- Evidence: client methods, protocol schema, daemon controller and terminal e2e。
- Unknowns: exact component mounting/retention policy is UI-specific and outside the stream contract。
- Validation: subscribe/create protocol tests, stream controller unit test and daemon terminal e2e。
- Next Drill-Down: attachment problems start at subscribe response/slot；PTY spawn failures start at worker create request。

### Node: Main Flow

- Type: `flow`
- Status: `confirmed`
- Purpose: 固定低延迟主干及 snapshot catch-up 的顺序保证。
- Route:
  1. [`TerminalStreamController.setTerminal`](../../packages/app/src/terminal/runtime/terminal-stream-controller.ts) calls `DaemonClient.subscribeTerminal()` with optional `live|visible-snapshot|full-snapshot` restore intent。
  2. [`TerminalSessionController.bindActiveStream`](../../packages/server/src/terminal/terminal-session-controller.ts) allocates slot `0..255`, subscribes to the `TerminalSession`, and marks the stream as needing initial state/ready signal。
  3. Terminal creation runs in a forked worker via [`worker-terminal-manager.ts`](../../packages/server/src/terminal/worker-terminal-manager.ts); [`terminal.ts`](../../packages/server/src/terminal/terminal.ts) spawns `node-pty`, feeds `@xterm/headless`, and increments `stateRevision` only after headless write commit。
  4. [`terminal-worker-process.ts`](../../packages/server/src/terminal/terminal-worker-process.ts) applies a leading+trailing `TerminalOutputCoalescer` (default 5 ms), forwards at most one burst IPC message per window, and carries the last/highest chunk revision。
  5. The daemon parent mirror forwards `TerminalSession` events to a second per-client coalescer in `TerminalSessionController`。
  6. When streaming normally, the controller emits an `Output` frame: one opcode byte + one slot byte + raw UTF-8 bytes via [`binary-frames/terminal.ts`](../../packages/protocol/src/binary-frames/terminal.ts)。
  7. For a direct socket, after output exceeds 256 KiB since snapshot, fallback occurs only if socket `bufferedAmount` exceeds 4 MiB；with no signal (relay), fallback occurs at the 256 KiB threshold。The controller buffers new revisions while snapshot is in flight。
  8. Snapshot/restore pulls worker state only after pending worker output is flushed；the frame carries a snapshot grid or ANSI restore stream and its revision becomes the replay cutoff。
  9. `replayTerminalOutputAfterSnapshot` sends the input-mode preamble and buffered output with `revision > replayRevision`, then resumes normal streaming and resets the byte counter。
  10. [`websocket-server.ts`](../../packages/server/src/server/websocket-server.ts) sends raw binary frames；[`DaemonClient.tryHandleBinaryFrame`](../../packages/client/src/daemon-client.ts) demuxes file-transfer first, then terminal frames and runtime metrics。
  11. [`TerminalStreamRouter`](../../packages/client/src/terminal-stream-router.ts) maps slot back to terminal id and emits `output|snapshot|restore` to App `TerminalStreamController`。
  12. [`TerminalEmulatorRuntime.processOutputQueue`](../../packages/app/src/terminal/runtime/terminal-emulator-runtime.ts) submits contiguous plain writes without per-frame serialization；clear/snapshot/suppress-input barriers wait behind a zero-length xterm sentinel。
  13. Reverse path: xterm input/claimed resize -> `sendTerminalInput` -> binary `Input/Resize` -> Session controller -> PTY；resize flushes pending input before resizing headless xterm and PTY。
- Key Objects:
  - [`TerminalStreamOpcode`](../../packages/protocol/src/binary-frames/terminal.ts): `Output`, `Input`, `Resize`, `Snapshot`, `Restore`。
  - [`TerminalOutputCoalescer`](../../packages/server/src/terminal/terminal-output-coalescer.ts): shared leading+trailing throttle。
  - [`TerminalSession`](../../packages/server/src/terminal/terminal.ts): PTY, headless state, revision, replay preamble。
  - [`ActiveTerminalStream`](../../packages/server/src/terminal/terminal-session-controller.ts): per-client slot, buffers, counter and snapshot state。
- Edges / Children:
  - branches to `Branches` on restore mode, capability, transport signal, slot/binary availability and terminal exit。
  - depends on `node-pty`, headless xterm, process IPC, WebSocket, xterm.js renderer and workspace ownership。
- Evidence: [`docs/terminal-performance.md`](../../docs/terminal-performance.md) and source route above。
- Unknowns: relay encryption/base64 time is outside this stream controller and can dominate main-loop latency。
- Validation: focused unit/e2e plus latency benchmark, not source inspection alone。
- Next Drill-Down: identify the slow/lost stage with revisions and metrics before changing either coalescer。

### Node: Branches

- Type: `branch`
- Status: `confirmed`
- Purpose: 标出会改变 frame shape、catch-up策略或 PTY ownership 的条件。
- Branches:
  - Binary channel unavailable / slot missing:
    - Source: `bindActiveStream`, `DaemonClient.sendTerminalInput`。
    - Effect: stream subscribe cannot bind a binary slot；input/resize may use legacy JSON fallback。
    - Status: `confirmed`
  - Slot exhaustion:
    - Source: `allocateSlot` with `MAX_TERMINAL_STREAM_SLOTS=256`。
    - Effect: subscribe fails rather than reusing an active slot。
    - Status: `confirmed`
  - Initial state vs restore:
    - Source: [`terminal-restore.ts`](../../packages/server/src/terminal/terminal-restore.ts)。
    - Condition: no restore, `live`, `visible-snapshot`, `full-snapshot`。
    - Effect: grid snapshot、snapshot-less ready path、bounded ANSI history or full ANSI history。
    - Status: `confirmed`
  - Backpressure signal:
    - Source: Session `getTransportBufferedAmount` and controller gate。
    - Condition: direct numeric buffered amount vs relay/no signal。
    - Effect: direct client streams past 256 KiB while draining；unknown signal forces snapshot at threshold。
    - Status: `confirmed`
  - Reflow capability:
    - Source: `CLIENT_CAPS.terminalReflowableSnapshot`。
    - Effect: daemon includes optional per-row wrap flags；old clients receive strict legacy shape。
    - Status: `confirmed`
  - Output during snapshot:
    - Source: `bufferedOutputs`, `replayTerminalOutputAfterSnapshot`。
    - Effect: revisions at/before snapshot are dropped, later revisions replay in order。
    - Status: `confirmed`
  - Multiple clients:
    - Source: per-Session controller and terminal e2e。
    - Effect: each client has independent slot/coalescer/backpressure; shared PTY output fans out。
    - Status: `confirmed`
  - Resize ownership:
    - Source: App runtime and architecture contract。
    - Condition: actual viewport change or user focus/tap vs passive restore/visibility refit。
    - Effect: claim resize only for interaction; passive refit uses `shouldClaim=false`。
    - Status: `confirmed`
  - Reconnect/exit:
    - Source: DaemonClient slot clearing, App stream controller, daemon subscription。
    - Effect: reconnect re-subscribes and catches up from current snapshot；terminal exit is final and emits `terminal_stream_exit`。
    - Status: `confirmed`
- Evidence: controller/runtime tests and daemon terminal e2e cases。
- Unknowns: OS-specific PTY scheduling differences require platform runs。
- Validation: use the Branch Index tests below。
- Next Drill-Down: never alter snapshot mode and backpressure gate in one unmeasured change。

### Node: Data And Dependencies

- Type: `dependency`
- Status: `confirmed`
- Purpose: 区分 transient stream identity、authoritative terminal state和 transport pressure。
- Read First:
  - PTY/headless state: [`terminal.ts`](../../packages/server/src/terminal/terminal.ts)。
  - Worker IPC protocol: [`terminal-worker-protocol.ts`](../../packages/server/src/terminal/terminal-worker-protocol.ts)。
  - Frame codec: [`binary-frames/terminal.ts`](../../packages/protocol/src/binary-frames/terminal.ts)。
  - Snapshot rendering: [`terminal-snapshot.ts`](../../packages/protocol/src/terminal-snapshot.ts)。
  - App retained visible snapshots: [`workspace-terminal-session.ts`](../../packages/app/src/terminal/runtime/workspace-terminal-session.ts)。
- Critical values:
  - frame header: 2 bytes (`opcode`, `slot`)。
  - slot domain: `0..255`, per connected Session。
  - worker/per-client coalescer window: default 5 ms, leading+trailing。
  - output threshold: `256 KiB`; direct client buffer threshold: `4 MiB`。
  - revision: headless state commit sequence used only for snapshot replay dedup。
- Edges / Children:
  - worker owns authoritative input-mode tracking and snapshot state。
  - daemon caches replay preamble and owns per-client pressure decisions。
  - client router owns ephemeral slot mapping；App runtime owns presentation queue。
- Evidence: constants, source comments and tests。
- Unknowns: WebSocket/relay does not expose an application-level ACK or per-terminal credit protocol。
- Validation: codec/unit tests plus slow-client e2e and metrics。
- Next Drill-Down: protocol changes start at codec + demux + both router tests；performance changes start at benchmark baseline。

### Node: Effects

- Type: `effect`
- Status: `confirmed`
- Purpose: 明确 normal stream、fallback 和 failure 的可见结果。
- Effects:
  - Normal output: raw bytes arrive as small binary frames and xterm commits in order。
  - Sustained burst: chunks are coalesced before IPC and again per client, reducing main-loop work。
  - Slow/unknown transport: full/bounded snapshot replaces accumulated history, then only later revisions replay。
  - Input: binary keystrokes reach PTY with one process-boundary batch; resize flushes pending input first。
  - Reconnect: slot map is rebuilt and current terminal state restores previous output/input mode。
  - Exit: stream detaches, buffers/coalescer clear, client gets terminal exit event。
  - Observability: daemon logs `ws_runtime_metrics` including `eventLoopDelay` and `bufferedAmount`。
- Evidence: session controller, client/runtime code and terminal e2e。
- Unknowns: latency degradation caused by unrelated large `agent_stream` must be measured outside terminal-only code。
- Validation: benchmark + browser perf specs + production metrics。
- Next Drill-Down: compare event-loop delay against xterm commit delay to separate server from client contention。

### Node: Related Capabilities

- Type: `capability`
- Status: `confirmed`
- Purpose: 标出共享 transport/ownership 但不属于本图的能力。
- Relations:
  - upstream: workspace-owned terminal creation/list/subscription。
  - downstream: terminal activity, notifications, capture, links and workspace archive teardown。
  - shared transport: JSON session messages、file-transfer binary demux、direct/relay WebSocket。
  - shared performance: agent stream serialization and relay E2EE run on shared main loops。
  - companion map: [`Relay 配对、E2E 加密与远程连接`](2026-07-20_09-20_Relay配对E2E加密与远程连接功能.md)。
- Evidence: Session/WebSocket wiring and performance doc。
- Unknowns: Terminal activity state machine is intentionally not traced here。
- Next Drill-Down: enter Relay map only when the symptom occurs exclusively or differently over relay。

### Node: Risk And Unknowns

- Type: `risk`
- Status: `confirmed`
- Purpose: 防止“优化”破坏 latency 或 snapshot correctness。
- Risks:
  - Trailing-only coalescing adds the full window to every idle keystroke echo。
  - Coalescing after IPC reintroduces main-loop flood；worker must batch first。
  - Merged output must carry the last revision or replay can lose output。
  - Non-output events/snapshot requests must flush worker output first or order/dedup breaks。
  - Snapshot fallback based only on produced bytes repeatedly builds huge grid snapshots for healthy clients。
  - Serializing every App write waits on xterm parse ticks and inflates burst latency；only barriers should wait。
  - Relay has no `bufferedAmount` signal and adds pure-JS NaCl + base64 per frame, so terminal behavior differs from direct sockets。
  - Passive resize claims can steal shared PTY size from the interacting client。
- Unknowns:
  - A better relay pressure signal/credit protocol is not implemented。
  - Known contention from large `agent_stream` and multi-socket JSON serialization remains outside this map's implementation scope。
- Next Drill-Down: read benchmark results and one failing focused test before editing thresholds or queues。

### Node: Validation

- Type: `validation`
- Status: `confirmed`
- Purpose: 同时验证 codec、ordering、fallback 和 user-perceived latency。
- Validation Entry:
  - Codec/router: [`terminal.test.ts`](../../packages/protocol/src/binary-frames/terminal.test.ts)、[`terminal-stream-router.test.ts`](../../packages/client/src/terminal-stream-router.test.ts)。
  - Coalescing/backpressure: [`terminal-output-coalescer.test.ts`](../../packages/server/src/terminal/terminal-output-coalescer.test.ts)、[`terminal-session-controller.test.ts`](../../packages/server/src/terminal/terminal-session-controller.test.ts)。
  - App queue: [`terminal-stream-controller.test.ts`](../../packages/app/src/terminal/runtime/terminal-stream-controller.test.ts)、[`terminal-emulator-runtime.test.ts`](../../packages/app/src/terminal/runtime/terminal-emulator-runtime.test.ts)。
  - End-to-end: [`terminal.e2e.test.ts`](../../packages/server/src/server/daemon-e2e/terminal.e2e.test.ts) cases for raw bytes, reconnect, slow client, multi-client, resize, 1 MiB burst。
  - Fast benchmark: `npx tsx scripts/benchmark-terminal-latency.ts` (isolated daemon, random port)。
  - Browser perf: [`terminal-performance.spec.ts`](../../packages/app/e2e/terminal-performance.spec.ts)、[`terminal-keystroke-stress.spec.ts`](../../packages/app/e2e/terminal-keystroke-stress.spec.ts) with `PASEO_TERMINAL_PERF_E2E=1`。
  - Production: inspect `ws_runtime_metrics.eventLoopDelay` and `.bufferedAmount` in checkout-local daemon log。
- Edges / Children:
  - proves: frame validity, snapshot ordering, direct/unknown pressure paths and xterm barrier semantics。
  - does not prove: every OS PTY, real mobile relay network or production main-loop mix without matching run。
- Evidence: listed tests and documented benchmark expectations。
- Unknowns: threshold changes require before/after percentiles, not only green correctness tests。
- Next Drill-Down: run one unit file for logic and the benchmark only when performance behavior changes。

## 3. Compact Indexes

### Entry Point Index

| Entry         | Path                                                     | Handler / Function                       | Status    | Notes                              |
| ------------- | -------------------------------------------------------- | ---------------------------------------- | --------- | ---------------------------------- |
| App attach    | `app/src/terminal/runtime/terminal-stream-controller.ts` | `setTerminal`                            | confirmed | subscribe/restore/resize           |
| Client stream | `client/src/daemon-client.ts`                            | `subscribeTerminal`, `sendTerminalInput` | confirmed | slot-aware binary + JSON fallback  |
| Daemon stream | `server/src/terminal/terminal-session-controller.ts`     | `bindActiveStream`                       | confirmed | per-client slot/coalescer/snapshot |
| Worker PTY    | `server/src/terminal/terminal-worker-process.ts`         | `watchTerminal`                          | confirmed | pre-IPC coalescer                  |
| Renderer      | `app/src/terminal/runtime/terminal-emulator-runtime.ts`  | `processOutputQueue`                     | confirmed | plain write fast path + barriers   |

### Branch Index

| Branch         | Source                  | Condition                    | Effect                         | Status    |
| -------------- | ----------------------- | ---------------------------- | ------------------------------ | --------- |
| Binary/legacy  | client + Session        | slot/binary unavailable      | binary or JSON input           | confirmed |
| Restore mode   | `terminal-restore.ts`   | live/visible/full/none       | ready, ANSI or grid state      | confirmed |
| Pressure       | Session controller      | bytes + buffered/null signal | stream or snapshot             | confirmed |
| Reflow         | client capability       | wrap flag support            | optional wrap metadata         | confirmed |
| Resize claim   | App runtime             | interaction vs passive refit | shared PTY size ownership      | confirmed |
| Exit/reconnect | client/server lifecycle | transport or PTY close       | snapshot rebuild or final exit | confirmed |

### Quick File Index

- [`docs/terminal-performance.md`](../../docs/terminal-performance.md): performance contract and measurements。
- [`packages/server/src/terminal/terminal.ts`](../../packages/server/src/terminal/terminal.ts): PTY/headless state/revision。
- [`packages/server/src/terminal/terminal-session-controller.ts`](../../packages/server/src/terminal/terminal-session-controller.ts): per-client stream and backpressure。
- [`packages/protocol/src/binary-frames/terminal.ts`](../../packages/protocol/src/binary-frames/terminal.ts): frame source of truth。
- [`packages/client/src/terminal-stream-router.ts`](../../packages/client/src/terminal-stream-router.ts): slot demux。
- [`packages/app/src/terminal/runtime/terminal-emulator-runtime.ts`](../../packages/app/src/terminal/runtime/terminal-emulator-runtime.ts): xterm commit pipeline。

## 4. Next Drill-Down

- For implementation: read `docs/terminal-performance.md`, then one pipeline stage and its adjacent test。
- For risk review: check leading/trailing semantics, revision source, flush ordering, pressure signal and resize claim。
- For debugging: correlate terminal id, slot, revision, frame opcode/bytes, snapshot count, socket buffered amount and xterm commit timing。
- For historical/compatibility confirmation: inspect terminal restore/reflow capability comments and legacy JSON input path before narrowing schemas。
- Drift check date: `2026-07-20`; index: [`.skills/project/CODEMAP_INDEX.md`](../../.skills/project/CODEMAP_INDEX.md)。
