# ReplicaCache 写放大治理 Spec

## 0. 状态与索引

| 字段              | 值                                                      |
| ----------------- | ------------------------------------------------------- |
| task_id           | `0041`                                                  |
| spec layer        | `Feature Spec`                                          |
| task status       | `已收口`                                                |
| mode              | `single_project`                                        |
| phase             | `Review`                                                |
| approval status   | `Plan Approved`                                         |
| approval source   | `User；2026-08-09 /goal 明确授权按登记顺序完成本任务组` |
| spec path         | `mydocs/specs/0041_ReplicaCache写放大治理.md`           |
| parent spec       | `mydocs/specs/0038_跨端会话性能与结论优先加载.md`       |
| supersedes        | `N/A`                                                   |
| current task unit | `实现、三轮静态审查与任务组统一动态验证均已完成`        |
| created / updated | `2026-08-04 08:51 / 2026-08-09`                         |

`mode` 只表示任务作用域；本文件是 0038 的 ReplicaCache 子 Spec。

## 1. 目标、范围与完成契约

- 背景/问题：Replica cache 订阅整个 session store，流式期间可能每 `750ms` 捕获和重写 bounded payload。
- 最终目标：缓存写入只由明确领域变更、trailing/idle 和生命周期事件触发，持续流式不产生周期性全量写。
- 当前任务单元：只治理非权威 display replica 的 capture/persist 写放大。
- 范围内：per-host payload、固定领域 dirty 集合、dirty revision、final/focus/lifecycle flush，以及通过 `ReplicaCacheStorage` 调用序列验证写入有界；共享 runtime 的 Web/Native 生命周期正确性均需覆盖。
- 范围外：durable canonical timeline、summary/detail RPC、AsyncStorage 加密、通用缓存框架。
- Done Contract：持续 stream 不按 750ms 连续 `setItem`；同一持续更新窗口只在静默 trailing、final、focus change、background 或 close 时写入；写成功只清除已捕获 revision，写期间的新 dirty 和写失败均保留待写状态；clean lifecycle 事件不写；恢复仍是 bounded display replica，失败不影响 authoritative hydration。
- 失败或回炉方式：若新调度丢失必要 display state，恢复该领域旧 flush 触发，不改变权威同步路径。

### 1.1 最小任务单元判断

- 为什么当前任务单元足够小：围绕现有 `ReplicaCache`/`ReplicaCacheStorage` interface，可用内存 Adapter 独立验证。
- 验证证据：现有 `index.test.ts` 已有 `MemoryStorage` Adapter。
- 模型可自主决定的范围：可在测试约束内选择 trailing 延迟常量和内部 bitset 表示；不得改变下述 dirty 领域、flush 顺序或把 display replica 提升为真相源。
- 拆分决定：`Accepted`。

### 1.2 stable 影响与范围调整

- 当前证据：`PERSIST_DELAY_MS` 仍为 `750`；`ReplicaCache.start()` 订阅整个 `useSessionStore`，任意 store 更新都会 `schedulePersist()`，timer 到期后完整 capture、serialize 并调用 `setItem`。
- 已有缓解：payload 限制为 1 MiB、单个 timeline 50 items，写队列可串行且失败后允许后续写继续；当前 `flush()` 在写成功前清除 `needsPersist`，并没有保留失败 dirty。这些限制单次大小，不限制持续流式期间的写频率。
- stable 影响：History 搜索没有修改 Replica cache 的触发或持久化语义。
- 必要性结论：`保留，最高优先级`。改动局部、seam 稳定，且写放大无需真实性能基线即可用调用次数证明。
- 调整边界：继续只处理 display replica 的 domain dirty、trailing/idle 和生命周期 flush，不引入通用缓存框架，也不持久化 authoritative cursor/epoch。

## 2. 上下文与调研

### 2.1 上下文来源

- 需求来源：父 Spec 0038 Phase 1。
- 项目事实源：`docs/architecture.md`、父 Spec、`packages/app/src/runtime/replica-cache`。
- Codemap / Context Bundle：`N/A`。
- 关联任务记录：0038 定义缓存语义；0035 已收口视图/runtime 回收。

### 2.2 调研结论

- 已确认事实：`ReplicaCacheStorage` 是现有 seam，生产使用 AsyncStorage，测试使用 MemoryStorage。
- 已锁定 dirty 领域：`host registry`、`focused agent identity/metadata`、`focused workspace/project projection`、`focused timeline display tail`。具体触发和明确非触发项以下表为唯一实施映射；新增或删除领域、字段或调用点需先回写本 Spec。
- 风险与约束：cache 可丢弃但不能污染远程 hydration 标志或覆盖 authoritative snapshot。
- `grilling` 结论：`N/A`。

#### Dirty domain 实施映射

| domain                                 | 触发源与稳定比较                                                                                                                                                                                                                                                                                   | capture 内容                                                                                                                          | 明确非触发                                                                                                                                                                                                |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `host registry`                        | `ReplicaCache.setHosts()` 比较 active `serverId` 集合；`reconcileServerId()` 比较 old/new id                                                                                                                                                                                                       | 只管理 ReplicaCache 中 `StoredHost.serverId` 的剪枝、重键和 bounded payload 持久化；不 capture `HostProfile`                          | host label/color/connection 等 `REGISTRY_STORAGE_KEY` 字段由 `HostRuntimeStore.persistHosts()` 独立持久化，不映射进 ReplicaCache domain                                                                   |
| `focused agent identity/metadata`      | 对每个 active Host 比较 `session.focusedAgentId`；Agent object identity 只用于避免重复投影，真正 dirty 判定比较与 `serializeAgent()` 完全一致的 stable replica projection                                                                                                                          | `serializeAgent(focusedAgent)` 及上一个可用 focused id；projection 排除 `providerRetryMessage`，并把 `pendingPermissions` 固定为 `[]` | 非 focused Agent 的 `setAgents()`、focused Agent 仅 permission/provider-retry 变化、等价 snapshot object 替换、`agentLastActivity`、audio、messages、file explorer、queued message、hydration/cursor 标志 |
| `focused workspace/project projection` | workspace/project object identity 只用于避免重复投影，dirty 判定分别比较 `serializeWorkspace()`/`serializeProject()` 的 stable replica projection；对应 mutation 为会改变该投影的 `setWorkspaces()`/`mergeWorkspaces()`/`removeWorkspace()` 与 `setProjects()`/`upsertProject()`/`removeProject()` | 一个 focused workspace 和其 project                                                                                                   | 不改变 focused 投影的其他 workspace/project 更新、等价 descriptor object 替换，以及 restore/loading/error UI 状态                                                                                         |
| `focused timeline display tail`        | `agentStreamTail.get(id)` array identity 只用于避免重复投影，dirty 判定比较过滤、截断、date encode 后的 bounded stable projection；对应 `setAgentStreamTail()`/`setAgentStreamState()`/`applyAgentTimelineResponseState()` 等会改变 focused tail entry 的路径                                      | `selectAgentTimelineState()` 的可显示 rows，过滤 unreconciled local user message 并取最后 50 项                                       | `agentStreamHead` 中未对账的本地展示、非 focused Agent timeline、等价 tail array 替换、canonical cursor/hasOlder/hasNewer/sync-generation 单独更新、composer 草稿和其他 store slice                       |

- `ReplicaCache.start()` 订阅 session store 后先为 active Host 保存上表稳定投影；后续 whole-store notification 只做投影比较，未改变上表任一投影时必须 no-op。
- focus 从 A 切到 B 时，订阅回调已能读到 B 的 Agent/workspace/project/timeline 后才标记四个 payload domain 并立即 flush；从 B 变为 `null` 时保留 B 作为最后可恢复 focused view。
- final 不从 whole-store 订阅中假定事件顺序。`DirectorySync.onAgentStoppedRunning` 在 Agent replica 已提交后报告 `source="status"`；`SessionProvider` 在收到 `turn_completed`/`turn_failed`/`turn_canceled` 时先 `flushAgent(agentId)` 提交该 Agent 的 48ms reducer queue，再报告 `source="stream"`。信号只在 `agentId` 等于该 Host 当前 focused id，或 focus 为 `null` 时等于 last-focused id 时接受；其他 Agent final 直接 no-op。同 Agent 两个信号汇合后只请求一次该 Host 的 dirty flush；只到达一个信号时以 `PERSIST_DELAY_MS` 有界兜底，不无界等待。

### 2.3 方案与决策

- 已选方案：`ReplicaCache` 内部拥有 capture/persist 调度；调用方只报告领域变更和生命周期，不协调定时器或序列化。
- 选择理由：保持 interface 小，写入策略与兼容恢复集中在一个深模块。

#### Dirty / flush 状态机

1. 每个 Host 维护单调递增的 dirty revision 与领域 bitset；领域更新只标脏并重置一个 trailing debounce，不形成周期 timer。
2. trailing 静默、final、focus change、background、close 触发 capture；focus change 在新 focused state 已进入 session store 后捕获，background/close 对全部 dirty Host flush。
3. 写入携带 captured revision。成功后只清除 `revision <= captured revision` 的领域；写期间再次变脏的领域继续保留并重新调度。
4. `setItem` 失败时保留相同 dirty revision，由下一个 trailing/lifecycle 触发重试；不启动无界即时重试循环。
5. clean Host 的 lifecycle 事件是 no-op。close/dispose 通过 runtime 可等待的生命周期入口 drain 当前 write queue；浏览器无法等待的终止事件只提供 best-effort，因为 replica 不是同步真相源。

#### 显式 API、owner 与并发语义

| owner / API                                                                 | 契约                                                                                                                                                                                                                           |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ReplicaCache.flush(): Promise<void>`                                       | 保留现有强制 capture/persist 语义，即使 clean 也可写入，供既有测试和显式快照调用者使用；不得静默改成 dirty-only                                                                                                                |
| `ReplicaCache.flushDirty(): Promise<void>`                                  | final/focus/background/pagehide 的 dirty-only 入口；清除 trailing timer，clean 时 no-op；重复并发调用合并进同一 flush loop                                                                                                     |
| `ReplicaCache.drain(): Promise<void>`                                       | close/dispose 的可等待入口；先请求一次 dirty flush，再等待该请求前已 capture 的写入和并发合并进同一 loop 的写入结束，storage 失败后不无界重试                                                                                  |
| `ReplicaCache.notifyFinal(serverId, agentId, source): void`                 | 先校验 `agentId` 是该 Host 当前/last-focused cache target，否则 no-op；`source` 为 `"status" \| "stream"`；按 Host/Agent 合并双信号，两者到达立即 `flushDirtyHost(serverId)`，单信号在 `PERSIST_DELAY_MS` 后兜底；重复信号幂等 |
| `ReplicaCache.flushDirtyHost(serverId): Promise<void>`                      | final 专用的 host-scoped dirty 入口；只取消该 Host trailing timer、capture/清除该 Host domain revision，其他 Host 与 registry revision/timer 保持不变                                                                          |
| `HostRuntimeStore.flushReplicaCache(): Promise<void>`                       | App 生命周期唯一公开转发点，调用 `flushDirty()`                                                                                                                                                                                |
| `HostRuntimeStore.drainReplicaCache(): Promise<void>`                       | 可等待的 runtime close/dispose 转发点，调用 `drain()`                                                                                                                                                                          |
| `HostRuntimeStore.notifyReplicaCacheFinal(serverId, agentId, source): void` | `DirectorySync` 与 `SessionProvider` 共享的 final 转发点，不在 UI 协调 timer                                                                                                                                                   |

- 生命周期注册位于 `packages/app/src/app/_layout.tsx` 的 root effect：Native 的 `AppState active -> background/inactive` 调用 `flushReplicaCache()`；Web 的 `visibilitychange` 只在 `document.visibilityState === "hidden"` 时调用，`pagehide` 调用同一 best-effort 入口。effect teardown 必须移除 AppState/DOM listeners；DOM 访问受 `isWeb` 保护。
- 可等待的 Electron/runtime close 只能从已有 owner 调用 `drainReplicaCache()`；如当前没有可等待 close hook，本项不伪造强一致 unload，以 `pagehide` best-effort 和 `HostRuntimeStore` 可测 drain seam 验收。
- 单一 flush loop 串行 storage write。每次 capture 记录 host/domain revision 快照；成功只清除不大于该快照的 revision，失败不清除。同一 write 未完成前到达的 focus/final/lifecycle 请求只设置后续 loop 意图，不排队相同 payload 的重复 write。
- trailing timer 按 Host 独立，registry 使用独立 timer；因此 Host A 的 focus/final 不取消或提前 capture Host B 正在流式的 dirty 窗口。background/pagehide/close 才使用全局 `flushDirty()`。
- “一个 dirty 窗口”从 clean -> dirty 开始，在最后一次领域更新后 `PERSIST_DELAY_MS` 无新更新时结束；每次更新都重置 trailing timer。该窗口内无 lifecycle/final/focus 事件时最多一次 trailing write；事件提前写成功则取消该窗口的 trailing write。写中再次变脏会开启新窗口。
- 连续 `visibilitychange(hidden)` + `pagehide` 或 Native 重复 background 事件在没有新 revision 时合计最多一次 write；clean 时为零次。

### 2.4 下一步动作

- storage seam 已获用户确认；本项已解除 0039 基线依赖，当前以 `/goal` 授权进入 Execute。
- 首个 RED 使用 MemoryStorage 观察 sustained stream 的持久化结果序列。

## 3. 计划与执行前检查点

### 3.1 文件变化

| 项目/子项    | 文件或子 Spec                                                                                                                                | 计划变化                                            | 原因                       |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- | -------------------------- |
| cache        | `packages/app/src/runtime/replica-cache/index.ts` 及测试                                                                                     | domain dirty、trailing/lifecycle flush              | 核心 module                |
| runtime      | `packages/app/src/runtime/host-runtime.ts`、`packages/app/src/app/_layout.tsx`、`packages/app/src/runtime/replica-cache/lifecycle.ts` 及测试 | 报告 host/focus/final 与 Web/Native lifecycle 事件  | 生产接线                   |
| stream final | `packages/app/src/contexts/session-context.tsx`、`packages/app/src/timeline/session-stream-reducers.ts` 及测试                               | terminal reducer commit 与 status/stream final 汇合 | 消除独立事件顺序竞争       |
| store        | `packages/app/src/stores/session-store.ts` 候选局部                                                                                          | 实际未修改；稳定投影保留在 cache module 内          | 避免扩大共享 store surface |

### 3.2 签名与契约

| 项目/子项         | 接口、类型或签名      | 计划变化                                                                                                       | 兼容性                                 |
| ----------------- | --------------------- | -------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| storage seam      | `ReplicaCacheStorage` | 保持 get/set interface                                                                                         | 现有 AsyncStorage/MemoryStorage 均可用 |
| cache module      | `ReplicaCache`        | 新增领域 dirty、revision 与 `flushDirty()`/`drain()`；保留强制 `flush()`                                       | 旧 payload 仍可丢弃/读取               |
| runtime lifecycle | `HostRuntimeStore`    | 新增 `flushReplicaCache()`/`drainReplicaCache()`/`notifyReplicaCacheFinal()`，root layout 注册 Native/Web 事件 | 无新 wire 或 payload 契约              |

### 3.3 子 Spec 索引

N/A。

### 3.4 执行清单

- [x] 1. 写入 sustained stream 的 storage 调用序列回归；按用户要求尚未执行 RED。
- [x] 2. 实现按 Host/domain revision capture，持续流式只重置 trailing debounce，不周期 flush。
- [x] 3. 写入 final、focus change、Web visibility/pagehide、Native AppState background、close/drain 和写失败恢复覆盖；final 同时覆盖两种信号顺序、reducer queue 先提交、非 focused no-op 与 Host 隔离。
- [x] 4. 写入 fake timer/MemoryStorage 验收：零周期写、dirty window 上限、lifecycle 幂等、写中 revision、失败 dirty、无关与等价 projection 零写。
- [x] 5. 最终统一运行旧 cache、损坏 cache、authoritative hydration、typecheck 与 lint 验证。

### 3.5 执行前检查点

- 当前目标与任务单元：Replica cache 写入调度。
- 当前 phase：`Review；已收口`。
- approval status / source：`Plan Approved / User；2026-08-09 /goal 明确授权按顺序完成 0041-0046 与 0038 集成`。
- 下一步：`None`。
- 风险与回退：按领域恢复旧 flush，不触碰 authoritative state。
- 验证方式：ReplicaCache `19/19`、lifecycle `2/2`、HostRuntime `69/69` 均 PASS；根 typecheck、lint、format 均 PASS；不采集跨端性能基线或要求移动端真机。
- TDD 判定、测试 seam 与验收行为：`TDD；ReplicaCacheStorage public Adapter。RED：持续 stream 周期 setItem，且写失败/写中再 dirty 会被旧状态清除；GREEN：domain revision + trailing/lifecycle flush，写入次数结构有界、失败 dirty 保留且恢复语义不变。`
- seam 确认：`User；用户于 2026-08-04 明确确认 0039-0046 当前登记的全部 TDD seams`。

## 4. 跨项目扩展

N/A。

## 5. 执行记录

| 步骤/子项    | 实际变化或子 Spec 锚点 | 状态 | 偏差与处理                                                                                                                        |
| ------------ | ---------------------- | ---- | --------------------------------------------------------------------------------------------------------------------------------- |
| 子 Spec 建档 | 本文件                 | 完成 | 未修改产品代码                                                                                                                    |
| 文档静态审查 | 第 2.2-3.4 节          | 完成 | 3 轮上限；修复 domain 映射、lifecycle owner、final 顺序与 host-scoped flush 阻塞，不再扩展第 4 轮                                 |
| 产品 Execute | 第 3.4 节              | 完成 | 实现 domain revision/trailing flush、final 双信号、runtime lifecycle 与 drain seam；未修改 session store                          |
| 代码静态审查 | 产品 diff              | 完成 | 3 轮上限；修复 flush await/失败触发、lifecycle/terminal 可测 seam、LRU 重键回归、Agent 移除时 timeline 误复用；第三轮后无静态阻塞 |

## 6. 验证

| 项目/验收项  | 命令或步骤                                               | 结果 | 证据                                                       | 未验证原因 |
| ------------ | -------------------------------------------------------- | ---- | ---------------------------------------------------------- | ---------- |
| 文档结构     | 模板、父链、编号与状态检查                               | PASS | parent=0038、Review/Plan Approved                          | N/A        |
| 代码静态审查 | Spec 对照、并发/失败路径、跨文件接线、`git diff --check` | PASS | 3 轮静态审查；diff whitespace clean                        | N/A        |
| 产品验证     | 第 3.4 节                                                | PASS | ReplicaCache `19/19`、lifecycle `2/2`、HostRuntime `69/69` | N/A        |
| 项目静态门禁 | 根 `typecheck`、`lint`、format                           | PASS | typecheck 通过；lint 0 warning/0 error；format 成功        | N/A        |

- 集成验证：父 Spec 0038 已收口。
- 剩余风险：平台终止事件不保证异步写完成；该风险由非权威 cache 语义和下次 authoritative tail 恢复承接，不把 unload 写入伪装成强一致保证。
- Done Contract 是否由证据满足：`是`。

## 7. 评审（Review）

| 评审轴             | 结论   | 证据或阻塞问题                                                  |
| ------------------ | ------ | --------------------------------------------------------------- |
| 目标与 Spec 完成度 | `PASS` | 实现、测试、三轮静态审查和统一动态验证均完成                    |
| Spec 与执行一致性  | `PASS` | dirty domain、final、lifecycle、失败与兼容边界均有对应实现/断言 |
| 实现质量与风险     | `PASS` | 并发、失败重试、lifecycle 与旧 cache 回归均通过定向验证         |

- Overall Verdict：`PASS；0041 Done Contract 已由静态与动态证据满足`。
- Blocking Issues：`None`。
- Cross-project consistency：`N/A`。

### 7.1 回归风险

| project_id | Regression risk | 依据                         |
| ---------- | --------------- | ---------------------------- |
| `paseo`    | `High`          | 影响本地恢复和生命周期持久化 |

### 7.2 Touched Projects

N/A。Orphan changes：`None`。

## 8. 偏差、变更与反向同步

- Plan-Execution Diff：未新增 session store selector/domain version；稳定投影完全封装在 `ReplicaCache`，并新增小型 lifecycle 与 terminal-order helper 以形成可测 seam。
- Change Log：`2026-08-04 08:51` 从 0038 Phase 1 拆出；`2026-08-04 09:40` 用户确认当前登记的 TDD seam；`2026-08-06 18:45` 取消 0039 基线依赖，以零周期写和生命周期 flush 有界的存储调用序列验收；`2026-08-09` 复核 stable 后确认触发链未变；3 次静态文档审查补齐四域 stable projection、host registry、flush/drain、final 与 host-scoped flush；`/goal` 授权后完成产品实现和测试代码；3 次静态代码审查修复 flush 并发/失败、LRU、timeline dependency 与可测接线问题，动态验证按任务组要求延后。
- 用户决策：按 0041 -> 0040 -> 0042 -> 0043 -> 0044 -> 0046 -> 0045 -> 0038 顺序循环执行；每项先文档静态审查、实现、代码静态审查，所有动态测试最后统一运行。
- Validation Log：`2026-08-10` 统一验证通过 ReplicaCache `19/19`、lifecycle `2/2`、HostRuntime `69/69` 以及根 typecheck/lint/format；lint 反馈只引发等价分支重写和最窄复杂度说明，复验保持全绿。
- Spec 反向同步结果：总表与父 Spec 已同步 0041 为已收口。

## 9. 恢复、长期知识与提交关联

- 状态说明：`已收口 / Review / Plan Approved / Goal`。
- 当前卡点：`None`。
- 下一步唯一动作：`None；父 Spec 0038 已汇总任务组结果`。
- Resume / Handoff 锚点：第 1、3.2、3.4、3.5 节与父 Spec。
- Project Sync Candidates：`无；ReplicaCache dirty/flush 的稳定合同已同步 docs/architecture.md`。
- 长期文档同步：`已同步 docs/architecture.md`。

### 提交记录

| 提交信息（Commit Message） | 提交脚注（Commit Footer） | 关联项目 / 改动或阶段 | 文档同步状态 | 备注                 |
| -------------------------- | ------------------------- | --------------------- | ------------ | -------------------- |
| `<待提交>`                 | `N/A`                     | `paseo / 0041`        | `未请求提交` | 用户未授权 commit/PR |
