# Host 与 Agent 元数据启动优化 Spec

## 0. 状态与索引

| 字段              | 值                                                                      |
| ----------------- | ----------------------------------------------------------------------- |
| task_id           | `0046`                                                                  |
| spec layer        | `Feature Spec`                                                          |
| task status       | `已收口`                                                                |
| mode              | `single_project`                                                        |
| phase             | `Review`                                                                |
| approval status   | `Plan Approved`                                                         |
| approval source   | `User；2026-08-09 /goal 明确授权按登记顺序执行，Round 3 文档终审无阻塞` |
| spec path         | `mydocs/specs/0046_Host与Agent元数据启动优化.md`                        |
| parent spec       | `mydocs/specs/0038_跨端会话性能与结论优先加载.md`                       |
| supersedes        | `N/A`                                                                   |
| current task unit | `metadata catalog、消费面迁移、静态审查与动态验证均已完成`              |
| created / updated | `2026-08-04 08:51 / 2026-08-10`                                         |

文件名保留原任务身份；stable 复核后，宽泛的 active-Host 调度和搜索首屏部分提交已从首批范围移除。

## 1. 目标、范围与完成契约

- 背景/问题：`AgentStorage.initialize()` 会枚举每个 Agent JSON，读取、`JSON.parse` 并完整 Zod 校验后才完成 daemon bootstrap；记录包含 config、runtimeInfo、persistence metadata 等普通目录/History 排名不需要的字段。会话数增长时启动 IO、解析和内存线性增长。
- 最终目标：AgentStorage 以版本化、原子、可重建的轻量 metadata catalog 启动；普通目录读取可分页，stable History 搜索可枚举完整轻量候选集，`get(id)` 或恢复 Agent 时才解析完整 record。
- 当前任务单元：只处理 daemon Agent metadata catalog、lazy full-record read、stable search/listing 消费，以及 0045 所需但仍由 AgentStorage 拥有的 staged-record commit seam。
- 范围内：manifest/catalog schema、record path、metadata index、ordinary page listing、complete search enumeration、persistence-handle index、upsert/remove/archive consistency、prepared record 的 stage/commit/discard、corrupt/missing/stale rebuild、lazy `get(id)` cache。
- 范围外：transcript/timeline 读取、Provider Runtime、0045 import manager、0042 durable Timeline、全局 Host priority scheduler、stable 搜索部分结果、Native/移动端验证。
- Done Contract：
  - 正常 daemon 启动只读取并校验 catalog 与轻量 mutation marker，不枚举、读取或解析全部完整 Agent JSON；bootstrap count、workspace bootstrap/backfill 等现有消费者均已迁移到 metadata API。
  - 普通无搜索目录先在完整轻量 metadata 集合上过滤、排序和定位 page，再只 materialize 最终 page ids；默认 `limit <= 200` 时 full-record parse 有界为最终候选数。History 搜索先对全部 eligible metadata candidates 排名，再只 materialize Top K；结果与全量完整 record 基线等价。
  - page/Top K materialization 期间若 targeted rebuild 改变 catalog generation，调用方必须基于新 generation 重新过滤、排序/排名和补页一次，不能把缺失条目作为正常短页或返回旧排名。
  - `get(id)`、Agent resume 或需要 config/persistence metadata 的路径惰性解析目标完整 record；并发相同 id 共享读取。
  - prepared record 位于正常 record tree 与 catalog 之外，普通 rebuild/list/get 均不可见；`commitPreparedRecord` 通过同一 mutation marker/generation 协议把 record 与 handle entry 一次提交，`discardPreparedRecord` 可幂等清理，0046 不拥有 import workflow。
  - upsert、rename path、archive、delete 和 owner/handle index 通过 store-owned mutation marker + catalog generation 协议保持崩溃可恢复；catalog 只是派生数据，可由 records 重建。
  - catalog 缺失/损坏/版本不支持、存在未清理 mutation marker 或 targeted `get` revision mismatch 时进入同一个 shared rebuild；一次调用期间最多全扫一次，重建原子提交且下一次启动不重复扫描。首次升级的空 record tree 也写入空 catalog；任何坏 record 单独报告，不丢其他 Agent。
  - stable search 不使用首个 page 或提前 partial Top K，跨 Host 全局排名语义保持。
- 失败或回炉方式：catalog 不可信时回退一次完整扫描并重建；不能返回不完整搜索结果，也不能让 manifest 成为无法恢复的第二真相源。

### 1.1 最小任务单元判断

- 为什么当前任务单元足够小：首批围绕 `AgentStorage` 一个深模块、两个读取面（普通分页、搜索完整枚举）和一个 store-owned prepared-record 写入面，不再同时修改 App Host scheduler 或 import workflow。
- 验证证据：AgentStorage 可用真实临时目录；session directory/history search 有 stable 排名测试；lazy get 可用读取计数 Adapter 断言。
- 模型可自主决定的范围：可调整内部 TypeScript 字段组织；控制路径固定为下述 reserved tree，必须提供 count/page/all-metadata/id/handle 与 prepare/commit/discard seams，不得排除 stable 排名/过滤和既有消费者必需字段，或把完整 config/runtimeInfo、system prompt、MCP config、persistence metadata 等重字段复制进 catalog。
- 拆分决定：`Accepted；stable 后收窄为 metadata 主任务`。

### 1.2 stable 影响与必要性

- stable History 搜索要求对全部持久化 Agent 的 workspace/title/branch/project metadata 评分后选 Top K；单一 `listPage` 路径不能同时满足普通分页和全局排名。
- `listRankedAgentHistoryEntries()` 明确先收集全部 entries 再 rank，因此 metadata catalog 必须提供 complete lightweight enumeration，而不是提前发布第一批结果。
- App `DirectorySync.fetchAgents()` 默认已经使用 `scope:"active"`，每个 Host 的 `maybeAutoBootstrapDirectories()` 独立运行；没有证据证明快速 Host 会等待另一个慢 Host 才显示普通目录。
- stable 跨 Host搜索使用 `Promise.allSettled` 后合并全局 Top K。等待目标 Host 成功/失败是正确性要求，不能用 active-Host first partial ranking 优化。
- DirectorySync 确实在单 Host 所有页完成后 commit，但默认 active scope 和 200 page limit 已缓解；没有 >200 active Agent/workspace 的现实证据，first-page commit 从本任务移除。
- 必要性结论：`保留 Agent metadata 子项，取消宽泛 Host 调度子项`。全量完整 JSON 解析问题仍明确，且 stable 提高 catalog 的必要性。
- 0045 正式依赖本任务提供的 persistence-handle index 和 prepared-record commit seam，避免导入协调 raw record/catalog 文件或维护第二份 manifest。

## 2. 上下文与调研

### 2.1 上下文来源

- 父 Spec 0038、stable 审计 0056、0045 导入索引需求。
- `packages/server/src/server/agent/agent-storage.ts`、`agent-history-search.ts`、`session.ts`。
- `packages/app/src/runtime/directory-sync/index.ts`、`host-runtime.ts`、`use-agent-history.ts`，用于核对并排除过时 Host 假设。
- `docs/data-model.md`、`docs/architecture.md`、`docs/timeline-sync.md`。

### 2.2 已确认事实

- `AgentStorage.initialize() -> load() -> scanDisk()` 对所有记录并发执行 read/JSON parse/Zod parse，并把完整 record 常驻 `cache`。
- `list()` 与 `get()` 都先等待同一全量 load；多个 session/import 路径通过 `list()` 获取实际只需的 metadata。
- stable History 搜索不读取 transcript，但需要 Agent metadata、workspace placement 和完整候选集。
- record upsert 可能因 cwd 改变路径；catalog 必须保存 canonical id/path 并与旧路径清理一致。
- daemon owner 与 provider persistence handle 已有内存 index，适合由轻量 catalog 重建。
- `buildStoredAgentPayload()` 还需要 config model/thinking、runtimeInfo 与完整 persistence 投影；因此 catalog 只负责候选过滤、排序和排名，最终响应条目必须由 lazy `get(id)` materialize，不能承诺首个响应零 full-record parse。
- `writeJsonFileAtomic()` 只提供临时文件写入与同目录 rename，没有文件或目录 `fsync`；本任务的 crash recovery 合同覆盖进程终止和部分步骤失败，不声称覆盖断电后的介质持久性。

#### 轻量 metadata 与控制路径

- reserved control root 固定为 `<agentStoragePath>/.paseo-agent-storage/`；catalog 为 `catalog.json`，marker 为 `mutation.json`，prepared records 位于 `staging/`，rebuild 隔离的无效/重复 loser 位于 `quarantine/`。record scan 必须显式排除整个 reserved root，根级或项目目录中的控制 JSON 均不得被解释为 Agent record。
- catalog envelope 固定包含 `version`、单调递增的 `generation` 和 `entries`。每个 entry 精确包含：`id`、baseDir-relative canonical `recordPath`、原始 record bytes 的 SHA-256 `recordRevision`、`provider`、`cwd`、可选 `workspaceId`、`createdAt`、`updatedAt`、可选 `lastActivityAt`、`lastUserMessageAt`、`lastMessageAt`、`title`、`labels`、`lastStatus`、可选 `lastModeId`、用于现有 filter 的派生 `effectiveThinkingOptionId`、attention 三字段、`internal`、`archivedAt`、可选 `timelineRevision`、可选 `owner`、可选轻量 `persistenceIdentity`，以及 prepared commit 幂等所需的可选 `preparedCommitId`。
- `persistenceIdentity` 只允许 `{ provider, sessionId, nativeHandle?: string }`；非 string `nativeHandle` 不进入 index，完整 `persistence.metadata` 不进入 catalog。完整 config、runtimeInfo、features、lastError、systemPrompt、MCP config 与任意 provider extra/metadata 均不得进入 catalog。
- catalog 中的 owner、handle、workspace 等查找 index 均从 entries 在内存派生，不持久化可独立漂移的第二份 map。`effectiveThinkingOptionId` 必须使用 `resolveEffectiveThinkingOptionId()` 的现行语义从 full record 派生；`recordPath` 必须是 reserved root 外、解析后仍位于 baseDir 内的规范相对路径。所有 metadata 返回值是不可变 snapshot/copy，调用方不能修改 store 内索引。

#### 现有 `AgentStorage.list()` 消费面迁移矩阵

| 消费面                                           | 目标 seam                                                              | 完成标准                                                                                                       |
| ------------------------------------------------ | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `bootstrap.ts` registry count                    | `countMetadata()`                                                      | daemon 正常启动零 full-record parse                                                                            |
| `workspace-registry-bootstrap.ts` 首次 bootstrap | `listAllMetadata()`                                                    | 只用 cwd/archive/timestamps；不 materialize full record                                                        |
| `backfill-workspace-id.migration.ts`             | `listAllMetadata()`，仅命中项 `get(id)` 后 `upsert`                    | 判断阶段保持轻量                                                                                               |
| `backfill-workspace-default-agent.migration.ts`  | `listAllMetadata()`                                                    | selection 所需字段全部在 entry                                                                                 |
| `agent-manager.ts` cascade archive               | `listAllMetadata()`，仅命中项由 `archiveSnapshot(id)` lazy get         | parent label/archive 判断保持轻量                                                                              |
| `agent-manager.ts` unarchive by handle           | `findByPersistenceHandle()`，选定后 `get(id)`                          | 不全扫 full records                                                                                            |
| `session.ts` chat/schedule mention roster        | `listAllMetadata()`                                                    | mention eligibility 只需 id/internal/archive/status                                                            |
| `session.ts` unarchive by persistence handle     | `findByPersistenceHandle()`，选定后 `get(id)`                          | 冲突按确定排序处理                                                                                             |
| `session.ts` 普通目录                            | `listAllMetadata()` 过滤/排序/page，最终 page ids `get(id)`            | 默认 page full parse `<= limit`，live id 去重                                                                  |
| `session.ts` History 搜索                        | `listAllMetadata()` 完整候选 rank，最终 Top K ids `get(id)`            | 不提前 partial Top K                                                                                           |
| `WorkspaceDirectory` workspace 状态聚合          | metadata-only stored payload projection + live payload                 | persisted pending permissions 固定为空；status/attention/parent/workspace/timestamp 不 materialize full record |
| `session.ts` workspace clear-attention           | workspace/attention metadata filter，最终命中 ids `get(id)`            | 只 materialize 实际更新的 stored records                                                                       |
| `session.ts` identifier resolve                  | id/title metadata index                                                | 不 materialize full record                                                                                     |
| `workspace-archive-service.ts`                   | workspace metadata index，命中项由 `archiveSnapshot(id)` lazy get      | 不全扫 full records                                                                                            |
| `tools/paseo-tools.ts` recent-agent list         | metadata 过滤/排序，与 live 候选合并后只 materialize 返回的 stored ids | 保持 limit 与输出等价                                                                                          |
| `import-sessions.ts` 三处 listing/import lookup  | `findByPersistenceHandle()` / handle key enumeration                   | 由 0045 完成迁移，0046 先交付 seam                                                                             |
| store compatibility/tests                        | 显式 `list()` full materialization 或私有 full scan                    | `list()` 保留旧顺序无保证语义，但不得再用于生产普通路径                                                        |

- 实施完成时，生产源码中不得再有会在正常 bootstrap、目录、搜索、工具、archive 或 import 路径调用全量 `agentStorage.list()` / `registry.list()` 的入口；`list()` 明确定义为显式 full-materialization compatibility seam，仅供测试或确实需要完整记录的维护调用，测试辅助调用不计入但应优先改用能表达意图的 seam。

### 2.3 方案与决策

| 方案                                                                      | 决策 | 理由                                                     |
| ------------------------------------------------------------------------- | ---- | -------------------------------------------------------- |
| 只给 `list()` 加 page limit                                               | 排除 | stable 搜索需要完整候选集，且 `get()` 仍被全量 load 阻塞 |
| catalog 保存完整 StoredAgentRecord                                        | 排除 | 不能减少解析、内存或敏感重字段重复                       |
| 轻量 catalog + ordinary page API + complete search enumeration + lazy get | 接受 | 同时满足启动、普通浏览和 stable 排名                     |
| 搜索先显示 active/第一 Host 的 partial Top K                              | 排除 | 会把不完整结果伪装成全局排名                             |
| catalog 损坏直接返回空目录                                                | 排除 | 会静默丢 Agent；必须一次性全扫重建                       |

#### Catalog commit / recovery 协议

1. 所有 public mutation 先进入 per-id queue；delete fence 在入队前同步置位。持有 per-id ownership 的 closure 再进入唯一 global catalog-generation queue；shared rebuild 也只作为该 global queue 的一个 operation 运行。global closure 不回调或等待任何 per-id public mutation，因而锁顺序永远是 `delete fence -> per-id queue -> global generation queue`。lazy read in-flight 不持有 mutation queue；mutation 在提交前等待该 id 已存在的 lazy read settlement，read mismatch 触发 rebuild 时也不持有 per-id/global queue。
2. global closure 修改 record 前原子写 marker，固定包含 schema version、operation id、base/next generation、operation、affected ids、old/new relative paths、record revision 与可选 prepared id；调用方不协调 raw files。
3. record upsert/delete/path rename 继续以原子文件操作完成。rename 先写新 record，再由 catalog generation 切换 canonical path，旧路径只在切换后清理；同一 id 的 cache/path/owner/handle 更新只发生在 catalog 切换后。
4. 根据 mutation 后 snapshot 写 next catalog generation 并原子替换 active catalog。catalog 切换成功后清理旧路径/staging，再清 marker；清理失败只留下可重建垃圾，不回滚已提交 generation。
   - marker 写入后的任一步失败都会设置进程内 `recoveryRequired` latch。catalog commit 前失败时原 mutation 拒绝；commit 后仅清理失败时 commit 结果仍可返回成功。无论哪种情况，后续 public read/mutation 在对外返回前都必须先通过 shared rebuild/recovery 清除 latch 与 marker，不能继续使用旧内存 snapshot。
5. 启动先读 marker 再读 catalog：marker 存在、catalog/version/schema/path 无效时进入一个进程内 shared rebuild；有效 catalog 且无 marker 时不枚举 record tree。空目录首次升级也写 `generation=0` 空 catalog。
6. targeted `get(id)` 读取 canonical path，先比较原始 bytes SHA-256，再 JSON/Zod parse；缺失、损坏或 revision mismatch 时只触发同一个 shared rebuild 并最多重试一次。重建后仍无有效目标则返回局部 miss/error，不伪造 metadata，也不重复全扫。
7. rebuild 显式排除 reserved root，扫描 records 并隔离坏 record；重复 id 以 `updatedAt desc -> createdAt desc -> normalized relative path asc` 确定 canonical winner。写 next catalog 后、清 marker 前，把重复 loser 移入 reserved quarantine；隔离失败则保留 marker，让下次启动重建，不能让 loser 留在普通 record tree 后仍宣告 recovery 完成。marker、record、catalog、旧路径/loser 清理各边界失败后，下一次启动只能得到有效旧 generation，或经一次 rebuild 得到新一致 generation。
8. `prepareRecord(record, expectation)` 先完整 Zod 校验并写入 reserved staging，返回 `{ preparedId, agentId, recordRevision }`；expectation 明确区分 `targetMustBeAbsent` 与 `expectedRecordRevision`。目标已存在/已变化时 prepare 或 commit 明确冲突，不覆盖未知 record。
9. `commitPreparedRecord(preparedId)` 在 global mutation 内校验 expectation，复用步骤 2-4，并把 `preparedCommitId` 放入 committed metadata；若 staging 已清但同 id/revision/commit id 已在 catalog，重复 commit 返回同一成功结果。`discardPreparedRecord(preparedId)` 在未提交时幂等删除 staging，在已提交时为不删除 Agent 的幂等 no-op；未知 id 返回 no-op。0045 重启 recovery 可用 opaque prepared id 重试 commit 或查询 handle/revision，不需要定位 raw path。
10. staging 在普通 list/get/rebuild 中始终不可见；启动不主动删除未知 staging。0045 transaction marker 负责在恢复完成后 discard 自己持有的 prepared id，避免 0046 猜测跨 store 所有权。

## 3. 计划与执行前检查点

### 3.1 文件变化

| 子项              | 候选文件                                                                                                              | 计划变化                                                                                                                         |
| ----------------- | --------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| catalog           | `packages/server/src/server/agent/agent-storage.ts`、新局部 Adapter/测试                                              | versioned metadata catalog、mutation marker、generation commit、atomic rebuild                                                   |
| lazy records      | AgentStorage read/write tests                                                                                         | per-id parse/cache/in-flight reuse、path migration                                                                               |
| consumers         | `bootstrap.ts`、workspace bootstrap/migrations/archive、`session.ts`、`workspace-directory.ts`、chat/tools 及定向测试 | 按迁移矩阵改用 count/page/all/index/lazy get；workspace 聚合使用 metadata-only stored projection，directory 最终页才 materialize |
| stable search     | `agent-history-search.ts`、session/history tests                                                                      | complete lightweight enumeration 后全局 rank                                                                                     |
| import store port | AgentStorage metadata/prepared-record interface                                                                       | 0045 使用 handle index 与 opaque prepare/commit/discard，不实现 import workflow                                                  |

### 3.2 签名与契约

| seam                    | 计划契约                                                                                                                                                                                                                                                                    |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| catalog bootstrap       | 版本、generation/revision、entries、canonical record path、mutation marker 和必要 indexes；原子读写                                                                                                                                                                         |
| count/page/all metadata | count；完整轻量枚举；page 使用固定 filter、`status_priority/created_at/updated_at/title` sort 和 opaque `{version,generation,sortTuple,id}` cursor，均不解析 full record；generation 不匹配明确返回 stale cursor，由 Session 映射为现有 invalid-cursor 错误                 |
| search enumeration      | 使用 all-metadata 返回全部 eligible lightweight candidates；调用者完成完整 rank                                                                                                                                                                                             |
| lazy get                | id -> full validated record；并发共享，坏 record 局部失败                                                                                                                                                                                                                   |
| bounded materialization | ids + expected catalog generation -> full records + current generation/retry flag；任一 get 触发 rebuild 或 generation 改变时，directory/history caller 最多重选一次 page/Top K，第二次仍不稳定则明确失败而非返回 partial                                                   |
| handle lookup           | `{provider, sessionId, nativeHandle?}` -> exact `(provider,sessionId)` 与可选 `(provider,nativeHandle)` string alias 的去重并集；值不 trim、不 stringify，非 string nativeHandle 不建 alias；全部匹配按 `updatedAt desc -> createdAt desc -> id asc` 排序，冲突不得静默覆盖 |
| catalog generation      | `getCatalogGeneration()` 返回当前只读 generation，供 0045 query cache key 使用；任何 committed mutation/rebuild 都变化                                                                                                                                                      |
| prepared record         | validated full record + absent/revision expectation -> opaque prepared result；commit 通过 marker/generation 公开 record + catalog，重复 commit 返回同一结果，discard 幂等且不删除已提交 Agent                                                                              |
| compatibility `list()`  | 对 catalog 全部 ids 显式调用 lazy `get` 并返回所有有效 full records；不得被生产普通读取路径调用                                                                                                                                                                             |

### 3.3 子 Spec 索引

N/A。

### 3.4 执行清单

- [x] 1. RED：1000 records 的正常 initialize 读取/解析 1000 个完整 JSON，普通 page/search/get 共用全量 load。
- [x] 2. GREEN：正常 initialize 只读 marker/catalog；bootstrap count、workspace bootstrap/migrations 零 full-record parse，普通首 page 只解析最终 ids 且 `<= limit`，`get(id)` 只解析目标 id。
- [x] 3. RED/GREEN：History 搜索枚举 1000 条轻量 metadata 后得到与完整 record 基线相同的 Top K/highlight/truncation，并只解析最终 Top K full records。
- [x] 3a. final page/Top K 中 record 缺失、损坏或 revision mismatch 时 shared rebuild 后重选并补页一次；持续 mutation 明确失败，不返回 partial/旧排名。
- [x] 4. 逐项迁移当前生产 `agentStorage.list()` 消费面；用 full-record 基线断言 workspace bootstrap/backfill、directory、tools/chat、archive/resolve 与 handle lookup 结果等价。
- [x] 5. 覆盖 upsert、cwd path rename、archive、delete、daemon owner、provider handle string/non-string/conflict index 和 prepared-record absent/revision conflict、重复 commit、stage/discard；staging 在普通 list/get/rebuild 中不可见。
- [x] 6. 在 marker、record/prepared move、catalog generation、旧路径/废弃 staging 清理边界注入失败，验证原子一致、幂等 recovery 或一次 rebuild。
- [x] 7. 覆盖首次空目录、missing/corrupt/version mismatch catalog、未清 marker、targeted get revision mismatch 的 shared 一次性全扫重建、坏单 record/重复 id 隔离和下一次启动零重复全扫。
- [x] 8. 验证旧 client directory 行为、stable search、0045 handle/prepared-record port、生产路径无全量 `list()`、typecheck 和 lint。

### 3.5 执行前检查点

- 当前目标与任务单元：stable-compatible Agent metadata catalog、lazy full record 与 store-owned prepared-record commit。
- 当前 phase：`Review；已收口`。
- approval status / source：`Plan Approved；User /goal`。
- 下一步：`None`。
- 风险与回退：catalog/record 跨文件提交、rename 和 crash recovery；mutation marker 让任何未完成提交 fail closed 到一次 record 全扫重建，不能信任看似可解析但 generation 不一致的 catalog，也不能返回部分搜索结果。
- 验证方式：AgentStorage、session directory/history search、旧 client compatibility 及第 6 节集成回归均 PASS；根 typecheck、lint、format 均 PASS。
- TDD 判定：`TDD；AgentStorage marker/catalog/count/page/all/index/get/prepare/commit/discard public seam。RED：正常启动全量 parse、prepared record 意外可见，或跨文件 crash 产生静默 stale catalog；GREEN：catalog 启动、消费者迁移、lazy get、prepared commit、完整轻量 search 与一次 rebuild 等价。`
- seam 确认：`User；/goal 已确认 stable 后删除 Host scheduler，并按本文 catalog/search/materialization/prepared seam 进入 Execute`。

## 4. 跨项目扩展

N/A。

## 5. 执行记录

| 步骤                 | 状态 | 说明                                                                                                                                                                                             |
| -------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| stable 复核与重规划  | 完成 | 保留 catalog，删除 active-Host/first-page/search partial 承诺                                                                                                                                    |
| 文档静态审查 Round 1 | 完成 | 修复 wire/materialization、精确 schema、consumer、reserved path、锁序、handle 与 prepared lifecycle 阻塞；复审补齐 duplicate quarantine、shared rebuild serialization、cursor 与 generation seam |
| 文档静态审查 Round 2 | 完成 | 逐项核对 15 个生产 full-list 调用和 0045 handle/query cache/prepared port；补齐 targeted rebuild 后重选补页与运行中 recovery latch                                                               |
| 文档静态审查 Round 3 | 完成 | 终审补齐 `WorkspaceDirectory` 与 clear-attention 两个间接 materialization 消费面；目标、边界、锁序、恢复和 0045 port 无剩余阻塞                                                                  |
| 产品代码             | 完成 | catalog、metadata consumer migration、lazy materialization、handle index 与 staged-record seam 已实现；定向与集成验证 PASS                                                                       |
| 代码静态审查 Round 1 | 完成 | 修复 recovery identity、lazy cache revision、generation-bound session page、provider-only metadata projection 与测试替身迁移                                                                     |
| 代码静态审查 Round 2 | 完成 | 修复 prepared recovery 二次中断 identity、后续 revision 幂等边界、staging discard、scan IO 错误、materialization retry、clear-attention 二次核对与 metadata helper shape                         |
| 代码静态审查 Round 3 | 完成 | 修复 prepared commit 全局提交点 expectation 重验、rebuild generation 单调性、目录 metadata 状态等价、handle/duplicate 排序、catalog duplicate path 与 cursor tuple 校验；无剩余静态阻塞          |

## 6. 验证

| 项目                               | 结果 | 证据/原因                                                                                                                                                                                                        |
| ---------------------------------- | ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 文档结构与父链                     | PASS | parent=0038、Review/Plan Approved                                                                                                                                                                                |
| 当前 storage/search/directory 事实 | PASS | 全量 parse、complete ranking、active scope 和 per-Host bootstrap 已静态核对                                                                                                                                      |
| 核心 catalog/lazy 验证             | PASS | AgentStorage `29/29`、AgentManager `164/164`、session `158/158`（1 skipped）                                                                                                                                     |
| 生产消费面与生命周期验证           | PASS | MCP `113/113`、agent loading `2/2`、auto archive `17/17`、chat mentions `9/9`、session workspaces `109/109`（4 skipped）、provisioning `38/38`、workspace archive `15/15`、worktree session `25/25`（1 skipped） |
| 项目静态门禁                       | PASS | 根 typecheck、lint（0 warning/0 error）与 format 通过                                                                                                                                                            |

- 集成验证：0045 已消费 handle index，父 Spec 0038 已收口。
- Done Contract 是否由证据满足：`是`。

## 7. 评审（Review）

| 评审轴                | 结论         | 阻塞                                                                         |
| --------------------- | ------------ | ---------------------------------------------------------------------------- |
| 目标与 Spec 完成度    | `PASS`       | 实现、消费面迁移、三轮静态审查和统一动态验证均完成                           |
| Spec 与 stable 一致性 | `PASS`       | 保留 complete-candidate Top K，排除 partial search                           |
| 实现风险              | `Controlled` | persistent catalog、rebuild、lazy cache 和 prepared commit 均有故障/集成回归 |

- Overall Verdict：`PASS；0046 Done Contract 已由核心与生产消费面验证满足`。
- Blocking Issues：`None`。

## 8. 偏差、变更与反向同步

- `2026-08-04`：从 0038 拆出 Host/metadata 启动计划，原 seam 获确认。
- `2026-08-06`：移除 0039 baseline，以 active-first/concurrency/bounded listing 结构合同替代。
- `2026-08-09`：stable 搜索要求完整候选集，否决单一 listPage/partial Top K；当前 App 已按 Host 独立、active scope 启动，故删除宽泛 Host scheduler/first-page 范围，保留轻量 catalog + lazy full record，并建立 0046 -> 0045 依赖；执行就绪审查后补齐生产 `list()` 消费面迁移矩阵和 marker/generation 崩溃恢复协议。
- `2026-08-09`：文档静态审查 Round 1 修复首 page/wire 冲突，锁定精确 metadata、reserved control tree、全部生产 consumer、global/per-id/read 锁序、handle 冲突与 prepared-record 幂等；复审增加 duplicate quarantine、shared rebuild generation serialization、generation-bound cursor 和 0045 cache generation seam。
- `2026-08-09`：文档静态审查 Round 2 核对全部 15 个生产 full-list 调用、0045 当前 provider/session/native alias 行为和 0042 store port；补充 materialization generation 变化后的整页/Top K 重选，以及 mutation failure 后同进程 recovery latch。
- `2026-08-09`：文档静态审查 Round 3 发现并补齐 `WorkspaceDirectory` 与 workspace clear-attention 两个间接 full materialization 入口；终审无剩余阻塞，按 User `/goal` 记录 Plan Approved 并进入 Execute。
- `2026-08-09`：完成 catalog/lazy materialization/consumer migration/handle/prepared seam 与测试代码；三轮代码静态审查修复 recovery identity、generation/revision 竞态、全局提交点 expectation、scan IO 分类、目录状态等价、排序与 cursor/path 校验，静态收口为待验证。
- `2026-08-10`：使用正确 Server 配置完成 catalog、manager、session、MCP、loading、archive、chat、workspace、provisioning 与 worktree 单文件验证；根 typecheck/lint/format 通过，lint 反馈的复杂度与等价表达式修订后核心文件复验保持全绿。
- Spec 反向同步结果：父 Spec 与总表已同步“保留 metadata、取消 Host 广泛子项”并标记已收口。

## 9. 恢复、长期知识与提交关联

- 状态说明：`已收口 / Review / Plan Approved / Goal`。
- 当前卡点：`None`。
- 下一步唯一动作：`None；父 Spec 0038 已汇总任务组结果`。
- Resume / Handoff 锚点：第 1.2、2.3、3.2-3.5 节与 0045。
- Project Sync Candidates：`无；catalog、prepared record 与存储布局已同步既有长期入口`。
- 长期文档同步：`已同步 docs/data-model.md、docs/architecture.md`。

### 提交记录

| 提交信息（Commit Message）                             | 提交脚注（Commit Footer） | 关联项目 / 改动或阶段 | 文档同步状态 | 备注          |
| ------------------------------------------------------ | ------------------------- | --------------------- | ------------ | ------------- |
| `perf: add lazy agent metadata catalog`（`6b0583881`） | `N/A`                     | `paseo / 0046`        | `已同步`     | 0046 逻辑边界 |
