# Timeline 增量回收与崩溃安全 Spec

本 Spec 约束 `FileAgentTimelineStore` 在长时间 `working` generation 中的 segment 回收。用户已明确批准 Plan；首轮实现和自动验证已完成，本轮静态审查修复与验证也已完成，未清理现有 `$PASEO_HOME/timelines`，也未重启 daemon。

## 0. 状态与索引

| 字段              | 值                                                                      |
| ----------------- | ----------------------------------------------------------------------- |
| task_id           | `0098`                                                                  |
| spec layer        | `Feature Spec`                                                          |
| task status       | `已收口`                                                                |
| mode              | `single_project`                                                        |
| phase             | `Review`                                                                |
| approval status   | `Plan Approved`                                                         |
| approval source   | `User；2026-08-19 “将该方案写入 Heavy Spec，完成 Plan Approved 检查点”` |
| spec path         | `mydocs/specs/0098_Timeline增量回收与崩溃安全.md`                       |
| parent spec       | `N/A`                                                                   |
| supersedes        | `N/A`                                                                   |
| current task unit | `全部 3 条 Standards findings 已修复、验证并通过本次提交收口`           |
| created / updated | `2026-08-19 11:26 +08:00 / 2026-08-19 21:26 +08:00`                     |

## 1. 目标、范围与完成契约

- 背景/问题：`FileAgentTimelineStore` 以内容寻址的 immutable segment 保存 canonical timeline。`appendRows()` 在尾 segment 未满时会读出旧尾、追加 rows、写入新 hash 文件，再原子替换 working manifest；`updateStagedRow()` 也会写入替代 segment。旧文件在 commit 后的 `cleanup()` 才被清理。长期 Goal 会让同一个 working generation 数百次或数千次改写尾 segment，产生大量已不被 active/working manifest 引用的近似累计版本，最终可能触发 `ENOSPC`。
- 最终目标：在不改变 durable timeline 的公开接口、generation 状态机、崩溃恢复边界和跨端同步合同的前提下，把不再被 active 或当前 working generation 引用的 segment 在每次成功发布 working manifest 后增量回收，并在重启后的下一次该 Agent mutation 中清理崩溃遗留孤儿。
- 当前任务单元：已修改 file-backed Adapter 的回收时序、故障注入和定向测试，并把稳定合同同步到现有 timeline 文档；不修改公开 store/wire/client。
- 范围内：
  - `stageRows()` 与 `updateStagedRow()` 成功发布 working manifest 后的定向 segment 回收。
  - 每个 Agent、每个 store 进程实例第一次 mutation 前的一次 lazy orphan sweep，避免 daemon 启动时全量扫描。
  - 删除失败的进程内 pending retry set；下一次 mutation 重试，进程崩溃后由 lazy sweep 重新发现。
  - active/current working 引用快照、文件名校验、per-agent mutation queue 串行化和 fail-closed 删除门禁。
  - working manifest 发布后、删除前崩溃，以及删除失败的 fault injection 与恢复测试。
  - 现有 commit generation cleanup、checksum/range/revision、`tail/before/after` 和 working fast-path 门禁回归。
  - `docs/timeline-sync.md` 中增量回收、恢复边界和断电非承诺的稳定说明。
- 范围外：
  - 修改 `AgentTimelineStore` interface、WebSocket schema、客户端、relay、cursor、epoch、revision、分页或 live `agent_stream` 语义。
  - 原地覆盖、截断或复用旧 segment 文件；segment 继续是 immutable、checksum 命名的内容寻址对象。
  - daemon 启动时扫描全部 Agent，或为本任务新增全局后台 GC、定时器、CLI/RPC 和 UI。
  - 本次直接删除 `C:\Users\staor\.paseo\timelines` 中的现有文件、重启受保护的 `6767` daemon，或承诺立即回收从不再发生 mutation 的历史 Agent。
  - 为 `writeFileAtomic()` 增加 `fsync`，或宣称突然断电、磁盘控制器丢写情况下的 durability；本任务只维持现有 atomic rename/进程崩溃合同。
- Done Contract：
  - 无注入故障时，每次 append/update 成功返回后，属于本次旧 working 版本、且不被 active 或新 working manifest 引用的合法 hash segment 已被删除。
  - 第一次 mutation 会先对该 Agent 做一次安全 lazy sweep；在 state、active manifest、working manifest 均可完整解析时，清除此前崩溃留下的未引用合法 hash segment。未知文件名和无法证明安全的文件保持不动。
  - 删除或目录枚举失败不把已经成功发布的 stage 标为 `incomplete`，不改变调用成功语义；失败目标进入待重试集合，后续 mutation 重新读取引用集合后再决定是否删除。
  - 任一删除目标在实际删除前满足 `candidate ∉ refs(active) ∪ refs(currentWorking)`；引用状态或任一当前引用 manifest 无法完整读取时，本轮不删除任何 segment。
  - segment 写失败或 working manifest 发布失败沿用既有 fail-closed/incomplete 行为，旧 manifest 引用文件不被删除；新孤儿由后续 lazy sweep 回收。
  - 重启后 active generation 仍能通过 checksum/range 校验；working 仍使 `eligible === false`；继续 append、commit 后 `tail`、`before`、`after` 的 rows、window、cursor reset/gap 语义与改动前一致。
  - 既有 `AgentTimelineStore` interface、wire schema 和 App 代码零变化；现有 generation cleanup 仍在 commit 后执行。
- 失败或回炉方式：任一测试发现 active/current working 引用被删、删除错误污染 stage 状态、恢复后分页结果变化，立即回炉到只保留 RED 和故障证据；不启用增量删除。由于没有持久格式或公开契约变化，回退只需移除 Adapter 内部维护逻辑，既有文件仍可由旧实现读取。

### 1.1 最小任务单元判断

- 为什么当前任务单元足够小：问题和修复都封装在单一 file-backed Adapter 内；public store、AgentManager、wire 和 App 无需变化。源码、同文件测试和一处稳定文档可以用一个故障矩阵完成端到端证明。
- 验证证据：现有测试已覆盖 stage/commit/restart、positive-limit paging、working/incomplete fail-closed 和 fault injection；新增测试只需扩展相同真实临时目录 seam。
- 模型可自主决定的范围：私有 helper 和内部结果类型的具体命名、测试数据规模、待重试 Set 的组织方式可按现有文件风格确定；不得移动删除边界、修改接口或扩大为全局 GC。
- 拆分决定：`Accepted`

## 2. 上下文与调研

### 2.1 上下文来源

- 需求来源：用户对 `C:\Users\staor\.paseo\timelines\a8b63c80d08ad6eb7557682a9ce0e8b99a900f69926f295481f6aa429eaffba6\segments` 的空间异常调查，以及“按这个边界设计修复方案，并证明不会破坏崩溃恢复和跨端追平”的明确要求。
- 项目事实源：`PROJECT.md`、`docs/timeline-sync.md`、`packages/server/src/server/agent/file-agent-timeline-store.ts`、`packages/server/src/server/agent/file-agent-timeline-store.test.ts`、`packages/server/src/server/agent/agent-timeline-store-types.ts`、`packages/server/src/server/atomic-file.ts`。
- Codemap：`N/A`
- Codemap Mode：`N/A`
- Context Bundle：`N/A`
- Context Bundle Level：`N/A`
- 关联任务记录：`mydocs/specs/0042_持久化Timeline与结论索引.md` 定义 immutable segment、atomic generation manifest、working fail-closed、commit cleanup 和 bounded read 合同；本任务只修复其长期 working 生命周期中的回收缺口。

### 2.2 调研结论

#### 已确认事实

- 目标目录采样时共有 `1008` 个文件，占 `548.7 MiB`。文件名全部匹配内容 SHA-256，没有字节级完全重复文件；用户看到的“相同”实质是同一未满尾 segment 被连续追加后形成的大量近似累计版本，不是 hash 冲突或同步副本。
- `seq 1537–1792` 的一个尾段存在 `256` 个累计版本，最终有效版本 `1.42 MiB`，累计物理占用 `199.2 MiB`，写放大约 `140x`。
- 全局只读扫描记录到 `63` 个 timeline Agent 目录，其中 `9` 个有 `working: building` 且明显受影响；物理占用约 `1357.91 MiB`，当前 active/working 引用约 `93.04 MiB`，未引用约 `1264.86 MiB`。
- 目标 Agent 已出现 `154` 次 durable append 失败，首要错误为 `ENOSPC`。安全回收必须先释放既有孤儿，但仍需要足够写入一个新 immutable replacement segment 的瞬时磁盘余量。
- `appendRows()` 会在未满尾段上写新 hash segment，随后 `stageRows()` 原子写 working manifest；旧 hash 直到 commit 后 `cleanup()` 才被清除。长期 Goal 的 working generation 可能很久不 commit，因此当前设计的回收边界过晚。
- `updateStagedRow()` 具有相同的 copy-on-write 替换行为，也必须使用相同回收边界。
- 所有 mutation 已通过 `pendingMutations` 按 Agent 串行；`fetchCommittedPage()` 只从 `state.activeGenerationId` 读取 complete manifest，live `agent_stream` 不读取 segment 文件。
- `getCoverage()` 在存在 working generation 时保持 `eligible: false`；存储 fast path 只接受 revision 匹配且没有 working 的 complete active generation。
- `writeFileAtomic()` 的合同是临时文件加同目录 rename，没有 file/directory `fsync`；因此只能证明进程崩溃和原子可见性，不能扩展为突然断电安全。
- 先前使用真实 `FileAgentTimelineStore` 和临时目录做过可行性实验：working 期间可把 `40` 个物理文件裁到 `11` 个引用文件；重启后 active 可读、working 为 `building`、`eligible: false`；继续 append/commit 后 `tail/before/after` 一致。模拟 working manifest 发布失败后，孤儿可从 `3` 个裁到 `2` 个，重启仍保持 active 可读、working `incomplete`、commit 正确拒绝。该实验是 Plan 证据，不替代落地后的自动化验收。

#### 未知与开放问题

- 生产卷在首次安全回收前是否至少保留一个 replacement segment 的写入余量；算法不能为了腾空间先删仍被旧 manifest 引用的文件。
- Windows 上杀毒软件、索引器或临时句柄可能让 `unlink` 短暂失败；按删除失败可重试处理，不把平台差异升级为 stage 失败。
- 从不再发生 mutation 的历史 Agent 不会触发 lazy sweep；本任务有意不增加启动扫描或后台全局 GC，是否需要独立维护命令另立任务决定。
- 本任务不改变现有 commit 后 generation/segment cleanup 的并发合同；若后续发现 commit cleanup 与并发 committed read 存在独立竞态，应另建任务，不在本次顺手重构。

#### 风险与约束

- canonical segment 属于权威数据。任何“先删旧文件、再发布新 manifest”都会把普通写失败升级为不可恢复数据损坏，禁止采用。
- content-addressed 文件可以同时被 active 和 working generation 引用；仅按“旧 working 不再引用”判断会误删 active 尾段，必须做集合差并在删除前重读当前引用。
- pending delete 中的 hash 将来可能被相同内容再次引用；重试时不得盲删，必须重新排除 active/current working 引用。
- 回收失败是空间维护失败，不是 canonical stage 失败；若共用现有 `catch` 并调用 `writeIncompleteBestEffort()`，会把已成功发布的 generation 错误降级为 `incomplete`。
- state 或当前引用 manifest 损坏时无法证明文件无引用。安全策略只能是不删并让既有读取路径 fail closed。
- lazy sweep 只能删除严格匹配 `${sha256}.json` 的 segment；未知文件、临时文件和目录不在本任务的删除域内。

### 2.3 方案与决策

- 备选方案：
  - A：维持只在 commit 后调用 `cleanup()`。拒绝：长期 Goal 的 working generation 不 commit，空间继续无界增长。
  - B：原地覆盖尾 segment 或在写新 segment 前删旧文件。拒绝：破坏 immutable/checksum 合同，并让 segment/manifest 之间的崩溃窗口丢失当前 working 数据。
  - C：daemon 启动时扫描全部 timeline 目录。拒绝：把局部维护放大为启动时全盘 I/O，且一个损坏 Agent 会扩大影响范围。
  - D：working manifest 发布后的定向回收，加每 Agent 首次 mutation 的 lazy orphan sweep 和待重试集合。采用。
- 已选方案：D。`AgentTimelineStore` 保持为深接口，所有新语义封装在 `FileAgentTimelineStore` Adapter 内；in-memory store、AgentManager、protocol 和 App 不感知回收。
- 选择理由：回收点位于“新引用已原子可见”之后，故障只会多留垃圾而不会少留权威文件；热路径只处理本次差集，重启修复才做一次目录枚举，成本与受影响 Agent 的实际活动对齐。

#### 引用集合与删除不变量

对同一 Agent，在 per-agent mutation queue 内定义：

- `A = refs(current state.activeGenerationId)`，无 active 时为空集。
- `Wprev = refs(本次发布前的 working manifest)`，无 previous working 时为空集。
- `Wnext = refs(本次原子发布后的 current working manifest)`。
- `R = A ∪ Wnext`，这是删除后必须完整存在的权威引用闭包。
- 热路径候选 `Dhot = Wprev - Wnext - A`。
- lazy sweep 候选 `Dsweep = validHashSegmentFilesOnDisk - R`。

任何实际删除都必须满足：

`deleteTargets ⊆ (Dhot ∪ Dsweep ∪ pendingRetry) - R`

引用快照必须来自同一 Agent mutation queue 内的当前 state 和它指向的 manifests。读取或解析 state、active manifest、working manifest 任一失败时，`R` 不完整，本轮 `deleteTargets = ∅`。pending retry 也必须重新套用此公式，不能信任旧快照。

#### 写入与回收顺序

1. 进入现有 per-agent mutation queue；重试该 Agent 的 pending delete，并在本进程首次 mutation 时尝试一次 lazy sweep。两者均先构造完整 `R`，失败只跳过回收。
2. 读取和验证当前 state/working；保留本次变化前的 working segment 文件集合。
3. 通过现有 `writeSegment()` 原子落盘新 immutable segment。失败时旧 manifest 和旧文件不变，沿用现有 incomplete/fail-closed 路径。
4. 构造新 working manifest，并通过现有 `writeGeneration()` 原子发布。发布失败时不得删除旧 working 引用；新 segment 只是孤儿，记录为待 sweep 或由重启后的 lazy sweep 发现。
5. working manifest 成功发布后，权威 mutation 已完成。此后重新确认 state 指向的 active/current working manifests，计算 `Dhot`，再做 best-effort 删除。
6. `ENOENT` 视为删除已完成；其他删除错误加入 per-agent pending set。回收 helper 不向 authoritative stage `catch` 抛出，不调用 `writeIncompleteBestEffort()`，因此成功 stage 保持成功。
7. 下一次 mutation 先重读 `R` 再处理 pending set。进程崩溃会丢失内存 set，但新 store 实例对该 Agent 的首次 mutation 会用 `Dsweep` 重新发现同一批孤儿。
8. commit 的 complete manifest、active pointer 和既有 `cleanup(agentId)` 顺序保持不变；增量回收绝不删除 active 引用，也不接管 generation manifest 清理。

#### 内部实现边界

- `appendRows()`/`updateStagedRow()` 需要保留 publication 前后的 manifest 或 segment 集合，使发布成功后能计算 `Dhot`；具体使用内部结果对象还是私有 helper 由 Execute 阶段按最小改动选择。
- 新增每 Agent 的 `pendingSegmentDeletes: Map<string, Set<string>>` 和首次 sweep 状态；Agent mutation 完成且无 pending 时可释放空集合，避免常驻增长。
- lazy sweep 只枚举当前 Agent 的 `segments/`，只接受 `SHA256_RE` 对应的 `.json` 文件；不会沿目录、处理未知文件或跨 Agent 删除。
- fault injection 至少增加“working manifest 已发布、删除尚未开始”和“segment 删除失败”两个边界。前者用于模拟进程崩溃，不能被 authoritative write catch 改写为普通删除失败；后者必须被吞并并进入 retry。
- cleanup helper 的“无 logger”现状不通过新增公共依赖解决；本任务用确定性 retry 和 fault tests 保证行为。若需要长期可观测指标，单独设计 telemetry，不扩张当前存储修复。

#### 崩溃恢复证明

| 故障时刻                                   | 持久状态                                                         | 可恢复性结论                                                   | 后续回收                                            |
| ------------------------------------------ | ---------------------------------------------------------------- | -------------------------------------------------------------- | --------------------------------------------------- |
| 新 segment rename 前失败                   | 旧 working manifest 及其 segment 完整；原子 helper 尝试移除 temp | 继续使用旧 working；现有错误路径可标记 incomplete              | 无权威旧文件被删；残留未知 temp 不在本任务删除域    |
| 新 segment 已落盘、working manifest 未发布 | 旧 working 仍是唯一可见引用；新 hash 是孤儿                      | 重启读取旧 working 或既有 incomplete marker，active 不受影响   | 下一次 mutation 的 lazy sweep 在完整 `R` 下删除孤儿 |
| working manifest 已发布、删除前崩溃        | 新 working 已完整引用新 segment；旧 segment 只是多余文件         | 重启读取新 working；存在 working 时仍 fail closed 于 fast path | 下一次 mutation lazy sweep 删除旧孤儿               |
| 删除部分目标后崩溃                         | 已删文件均不在 `A ∪ Wnext`；未删目标只是垃圾                     | active 与 current working 的引用闭包完整                       | 下一次 mutation 继续 sweep 剩余垃圾                 |
| 单个删除失败                               | manifest 已发布，stage 仍成功；失败文件留在磁盘                  | canonical 状态不降级为 incomplete                              | 同进程下一次 mutation retry；重启后 lazy sweep      |
| state 或当前引用 manifest 不可读           | 无法构造完整 `R`                                                 | 沿用既有 fail-closed 行为，不尝试猜测恢复                      | 本轮零删除，等待数据修复或后续可读状态              |
| working commit 为 active 后                | complete manifest 和 active pointer 使用既有顺序                 | 新 active 的全部 segment 在 commit 前已校验且从未进入删除候选  | 保留既有 commit 后 generation cleanup               |

证明只依赖三个现有/新增约束：segment 与 manifest 使用同目录 atomic rename；同一 Agent 的 mutation 串行；删除只发生在新 manifest 发布之后且排除 active/current working 引用。因此任一进程崩溃点最多增加未引用文件，不会制造被当前 state 引用但已删除的 segment。此证明不覆盖缺少 `fsync` 的突然断电场景。

#### 跨端追平不变性证明

| 消费路径                 | 当前权威输入                                                   | 本方案影响                                             | 不变性结论                                                       |
| ------------------------ | -------------------------------------------------------------- | ------------------------------------------------------ | ---------------------------------------------------------------- |
| live `agent_stream`      | AgentManager 内存 canonical rows/事件                          | 不改 AgentManager、protocol 或发送路径                 | 持续订阅端的实时 delivery 完全不变                               |
| `fetchCommittedPage()`   | `state.activeGenerationId` 指向的 complete manifest            | `A` 永远从删除候选排除                                 | committed `tail/before/after` 仍读取同一 rows、range 和 checksum |
| stored-session fast path | revision 匹配的 valid active，且 `working === null`            | working 状态、revision 和 eligibility 代码不变         | 构建中或 incomplete 仍为 `eligible: false`，不会发布部分历史     |
| reconnect/tail bootstrap | bounded authoritative tail 与现有 cursor/window                | 不改 epoch、seq、window、reset、gap、hasOlder/hasNewer | 断线端按原 cursor 合同追到同一 active history                    |
| commit 后跨端追平        | 新 working 校验后成为 active，registry 持久化 timelineRevision | 增量删除只处理旧 working 差集；新 working 全部引用保留 | commit 后新 revision 和完整分页可见性不变                        |

未引用 segment 不属于任何可达 generation，也不参与 live stream、fast path、分页或断线追平。删除它们只改变物理占用，不改变任何跨端可观察状态。

### 2.4 下一步动作

- 下一步动作 1：`已完成`；首个 RED 观察到物理 segment 为 `5` 而非期望的 `3`，最小 GREEN 在 manifest 发布后回收旧 working 尾段并保留 active 引用。
- 下一步动作 2：`已完成`；Adapter 私有回收、lazy sweep、pending retry、故障矩阵、restart/commit/paging 回归和 `docs/timeline-sync.md` 均已落地。首轮提交后的 3 条 Standards findings 已修复、通过定向验证并由本次提交收口。

## 3. 计划与执行前检查点

### 3.1 文件变化

| 项目/子项      | 文件或子 Spec                                                        | 计划变化                                                                        | 原因                                                              |
| -------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Server Adapter | `packages/server/src/server/agent/file-agent-timeline-store.ts`      | 增加 publication 后定向回收、lazy sweep、pending retry、引用快照和 fault points | 修复长期 working segment 无界累积，同时保持 public interface 不变 |
| Server tests   | `packages/server/src/server/agent/file-agent-timeline-store.test.ts` | 新增真实临时目录下的空间边界、故障矩阵、重启与 paging 回归                      | 用可观察文件集合和读取结果证明安全性                              |
| Timeline docs  | `docs/timeline-sync.md`                                              | 记录 segment 增量回收、不变量、lazy sweep 和 atomic rename 非断电承诺           | 把稳定 durable timeline 合同放回现有事实源                        |
| Heavy Spec     | `mydocs/specs/0098_Timeline增量回收与崩溃安全.md`                    | 记录设计、批准、执行与验证证据                                                  | 当前任务唯一活跃 Spec                                             |
| Task index     | `mydocs/todolist.md`                                                 | 登记 `0098`、状态和编号基线                                                     | 保持任务索引一致                                                  |

### 3.2 签名与契约

| 项目/子项         | 接口、类型或签名                                               | 计划变化                                                   | 兼容性                                                    |
| ----------------- | -------------------------------------------------------------- | ---------------------------------------------------------- | --------------------------------------------------------- |
| Public store      | `AgentTimelineStore`                                           | `无变化`                                                   | file/in-memory Adapter 和所有 consumer 保持源码及行为兼容 |
| Fault seam        | `FileAgentTimelineStoreFaultPoint`                             | 新增 `working_manifest_published` 与 `segment_delete`      | 仅 server 内部测试 seam；无 wire 或持久格式变化           |
| Adapter state     | `pendingSegmentDeletes`、首次 sweep 状态                       | 新增私有 per-agent 内存集合                                | 不持久化；重启由 lazy sweep 重建事实，不形成第二权威源    |
| Reference helper  | `readCurrentSegmentReferences(agentId)` 等私有 helper          | 完整读取 active/current working 引用；失败返回“不允许删除” | fail closed；不改变读取 API                               |
| Reclaim helper    | `reclaimSegmentsBestEffort(agentId, candidates)` 等私有 helper | 每次删除前重验引用并把失败加入 retry                       | 回收错误与 authoritative mutation 隔离                    |
| Persisted schemas | `AgentStateSchema`、`GenerationManifestSchema`、segment JSON   | `无变化`                                                   | 旧目录可直接读取，无 migration                            |

### 3.3 子 Spec 索引

`N/A - 单项目单一 Adapter 任务，不拆分子 Spec。`

### 3.4 执行清单

- [x] 1. RED：连续逐行 append 未满尾段，断言物理 hash segment 收敛到 active/current working 引用集合附近，并断言 active 共享文件仍存在。
- [x] 2. RED：`updateStagedRow()` 替换 working segment 后回收旧 working 文件，但保留 active 仍引用的文件。
- [x] 3. RED：segment 写失败、working manifest 发布失败时不删除旧引用；重启后下一 mutation 回收新孤儿。
- [x] 4. RED：working manifest 已发布、删除前崩溃；重启 active 可读、working 为 building/fast-path ineligible，继续 mutation 后孤儿被回收。
- [x] 5. RED：删除失败不使 stage 失败、不标记 incomplete；下一 mutation 在重验引用后重试成功。
- [x] 6. RED：malformed state、active manifest 或 current working manifest 时物理 segment 集合保持不变。
- [x] 7. GREEN：实现热路径 manifest 差集和 publication 后 best-effort 删除，确保回收不在 authoritative write `catch` 内。
- [x] 8. GREEN：实现 per-agent lazy sweep、pending retry 和合法 hash 文件门禁；保留 commit generation cleanup。
- [x] 9. REFACTOR：收敛引用集合/删除 helper，保持 `AgentTimelineStore`、persisted schema、AgentManager 和客户端零变化。
- [x] 10. 回归：restart 后继续 append/commit，核对 checksum/range/revision、working eligibility 和 `tail/before/after`。
- [x] 11. 文档与静态验证：同步 `docs/timeline-sync.md`，运行目标 Vitest、`npm run typecheck`、`npm run lint` 和目标格式检查。
- [x] 12. Review：回写实际文件集合、故障矩阵结果、Plan-Execution Diff、剩余风险和 Done Contract。

### 3.5 执行前检查点

- 当前目标与任务单元：在 `FileAgentTimelineStore` 内按 manifest publication 边界增量回收未引用 segment；实现与验证已完成。
- 当前 phase：`Review`；首轮提交的静态审查与本轮 Standards findings 修复验证均已完成。
- approval status / source：`Plan Approved / User；2026-08-19 “将该方案写入 Heavy Spec，完成 Plan Approved 检查点”`。
- 下一步：`已完成`；用户已授权只提交 0098 四个文件，本次提交不带入 0099 或其他并行改动。
- 风险与回退：最高风险是误删 canonical 引用；通过 `deleteTargets ∩ (A ∪ Wnext) = ∅`、per-agent queue、fail-closed 引用快照和真实重启测试约束。失败即移除回收实现并保留 RED，不迁移格式。
- 验证方式：物理文件集合断言 + 真实 Adapter 临时目录重启 + fault injection + committed paging 结果比较 + 既有目标测试 + typecheck/lint/format。
- TDD 判定、测试 seam 与验收行为：`TDD；使用现有 FileAgentTimelineStoreFaultPoint 和真实临时目录，先观察文件集合与恢复行为 RED，再实现最小 Adapter 内部变化。`
- seam 确认：`User；用户明确要求按“新 manifest 原子发布后再回收、保留 active/current working 引用、lazy 恢复孤儿”的边界设计并完成 Plan Approved。`

## 4. 跨项目扩展

`N/A - 单项目任务，无跨项目 Registry、Provider/Consumer 契约或集成顺序。`

## 5. 执行记录

| 步骤/子项     | 实际变化或子 Spec 锚点                                                     | 状态   | 偏差与处理                                                                                           |
| ------------- | -------------------------------------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------- |
| Research      | 完成目录只读诊断、源码路径核对、现有恢复/跨端合同分析和临时目录可行性实验  | `完成` | 用户所称“内容相同”校正为 hash 不同的近似累计版本；根因判断不变                                       |
| Plan          | 完成本 Spec 的 Adapter 边界、集合不变量、崩溃矩阵、跨端证明与 TDD 验收     | `完成` | `N/A`                                                                                                |
| Plan Approved | 记录用户 2026-08-19 明确指令                                               | `完成` | 用户随后明确要求按 0098 开始 RED 并完成实现                                                          |
| Execute       | Adapter 增量回收、lazy sweep、pending retry、fault seam 与 15 个回归已完成 | `完成` | 11 个行为先观察明确 RED；4 个 fail-closed/安全证明直接保持 GREEN                                     |
| Review        | 目标测试、静态门禁、格式、diff 与长期文档同步                              | `完成` | 3 条 Standards findings 已修复并验证；未修改 public store、persisted schema、wire、client 或现有数据 |

## 6. 验证

| 项目/验收项      | 命令或步骤                                                                                   | 结果                | 证据                                                                              | 未验证原因             |
| ---------------- | -------------------------------------------------------------------------------------------- | ------------------- | --------------------------------------------------------------------------------- | ---------------------- |
| 诊断数据         | 只读统计目标与全局 timeline 目录、manifest 引用和 hash                                       | `PASS`              | 目标 `1008 / 548.7 MiB`；全局未引用约 `1264.86 MiB`；文件名与内容 SHA-256 一致    | `N/A`                  |
| 方案可行性       | 真实 Adapter + 临时目录裁剪、restart、append、commit、paging 与 manifest failure 实验        | `PASS（Plan 证据）` | `40 -> 11` 文件；重启 working/eligibility 和 `tail/before/after` 合同保持         | 尚未成为仓库自动化测试 |
| 任务文件格式     | `npm run format:check:files -- <4 个 Standards 修复文件>`                                    | `PASS`              | `2026-08-19 19:31 +08:00`，四个目标文件全部符合格式                               | `N/A`                  |
| Adapter 定向测试 | `npx vitest run packages/server/src/server/agent/file-agent-timeline-store.test.ts --bail=1` | `PASS`              | 既有 9 个加新增 15 个，共 `24/24`；覆盖空间收敛、全部故障边界和分页恢复           | `N/A`                  |
| TypeScript       | `npm run typecheck`                                                                          | `PASS`              | 退出码 `0`                                                                        | `N/A`                  |
| 目标 Lint        | `npx oxlint <2 个目标 TypeScript 文件>`                                                      | `PASS`              | `0 warnings / 0 errors`                                                           | `N/A`                  |
| 全仓 Lint        | `npm run lint`                                                                               | `PASS`              | `3546` 个文件，`0 warnings / 0 errors`                                            | `N/A`                  |
| Standards 修复   | 控制流静态复核 + `git diff --check`                                                          | `PASS`              | 发布失败、发布后中断与 pending retry 语义保持；目标及全仓 diff 检查退出码均为 `0` | `N/A`                  |

- 集成验证：真实 `FileAgentTimelineStore` 临时目录在 publication 后中断并重启，继续 append/commit 后 active revision 合格，`tail/before/after` 结果与 cursor/window 合同保持。
- 剩余风险：首次回收仍需要一个 replacement segment 的瞬时空间；不活动 Agent 不会自动触发 lazy sweep；突然断电 durability 不在现有原子写合同内。
- Done Contract 是否由证据满足：`是；24/24 定向测试、typecheck、目标与全仓 lint、格式和 diff 检查通过；未覆盖突然断电 durability。`

## 7. 评审（Review）

| 评审轴             | 结论   | 证据或阻塞问题                                                                    |
| ------------------ | ------ | --------------------------------------------------------------------------------- |
| 目标与 Spec 完成度 | `PASS` | 范围、删除不变量、故障矩阵、跨端路径、测试 seam 和回退均已明确                    |
| Spec 与执行一致性  | `PASS` | 实现保持 Adapter 内部边界；实际 helper/fault 名称和补充故障窗口已回写             |
| 实现质量与风险     | `PASS` | 两条 mutation 路径共用发布/失败收口；每次删除前重验引用；24/24 与全部静态门禁通过 |

- Overall Verdict：`PASS`
- Blocking Issues：`None`。
- Cross-project consistency：`N/A`

### 7.1 回归风险

| project_id | Regression risk | 依据                                                                                       |
| ---------- | --------------- | ------------------------------------------------------------------------------------------ |
| `paseo`    | `High`          | 触及 canonical timeline 文件删除；必须以 active/current working 引用闭包和崩溃测试证明安全 |

### 7.2 Touched Projects

`N/A`

- Orphan changes：`None；本任务实际只修改 Paseo 项目内登记的五个文件。`

## 8. 偏差、变更与反向同步

- Plan-Execution Diff：实现未新增内部 append result 类型，而是在 publication 边界记录候选并在 pre-publication 失败后重新武装 lazy sweep；额外覆盖批量 append 部分写入、replacement pointer 失败和 Agent 删除后重建三个同边界故障，未扩大公开范围。
- Change Log：`2026-08-19：创建 Heavy Spec 0098 并完成 Plan Approved；随后以 TDD 实现 manifest publication 后增量回收、lazy orphan sweep、pending retry 和两个 fault points，新增 15 个回归并同步 timeline 文档；首轮提交后修复任务状态/编号、重复状态转换和变量名称注释 3 条 Standards findings。`
- 用户决策：接受 Adapter 内部修复边界；不把近似重复 segment 解释为跨端同步副本，不通过提前删除或原地覆盖换取空间。
- Spec 反向同步结果：任务已更新为 `0098 / 已收口 / spec / 已同步`；总表当前编号基线为 `0099`、下一建议编号为 `0100`，并行后续任务保持不变。

## 9. 恢复、长期知识与提交关联

- 状态说明：首轮实现、测试和长期文档已提交；本轮全部 3 条 Standards findings 已修复、验证并通过本次提交收口；没有清理现有 timeline 数据、修改 wire/client 或重启 daemon。
- 当前卡点：`无`。
- 下一步唯一动作：`N/A - 0098 已收口。`
- Resume / Handoff 锚点：核心实现位于 `reclaimSegmentsBestEffort()` 与 `prepareSegmentReclamationBestEffort()`；任何后续改动继续保持删除前重验引用和回收错误不污染 stage。
- Project Sync Candidates：`无；稳定合同已同步到 docs/timeline-sync.md。`
- 长期文档同步：`已完成；docs/timeline-sync.md 记录增量回收、lazy sweep、fail-closed 和非 fsync 证明边界。`

### 提交记录

| 提交信息（Commit Message）                                  | 提交脚注（Commit Footer） | 关联项目 / 改动或阶段    | 文档同步状态 | 备注                               |
| ----------------------------------------------------------- | ------------------------- | ------------------------ | ------------ | ---------------------------------- |
| `fix(server): incrementally reclaim timeline segments`      | `N/A`                     | `paseo / 实现与验证`     | `已同步`     | 本提交；用户于 2026-08-19 明确授权 |
| `fix(server): address timeline reclamation review findings` | `N/A`                     | `paseo / Standards 修复` | `已同步`     | 本次提交；只包含 0098 四个文件     |
