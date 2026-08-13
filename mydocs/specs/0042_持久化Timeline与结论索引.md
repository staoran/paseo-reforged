# 持久化 Timeline 与结论索引 Spec

## 0. 状态与索引

| 字段              | 值                                                      |
| ----------------- | ------------------------------------------------------- |
| task_id           | `0042`                                                  |
| spec layer        | `Feature Spec`                                          |
| task status       | `已收口`                                                |
| mode              | `single_project`                                        |
| phase             | `Review`                                                |
| approval status   | `Plan Approved`                                         |
| approval source   | `User；2026-08-09 /goal 明确授权按登记顺序完成本任务组` |
| spec path         | `mydocs/specs/0042_持久化Timeline与结论索引.md`         |
| parent spec       | `mydocs/specs/0038_跨端会话性能与结论优先加载.md`       |
| supersedes        | `N/A`                                                   |
| current task unit | `durable Timeline 实现、静态审查与统一动态验证均已完成` |
| created / updated | `2026-08-04 08:51 / 2026-08-10`                         |

`mode` 只表示任务作用域；本文件是 0038 的 durable timeline 子 Spec。

## 1. 目标、范围与完成契约

- 背景/问题：现有 `AgentTimelineStore` 生产 bootstrap 未注入 durable Adapter，冷开可能消费 provider history 或依赖全内存 rows。
- 最终目标：以版本化 immutable segments、原子 generation manifest 和 coverage metadata 持久化 canonical rows、epoch/seq，支持不加载完整历史 rows 的 bounded tail/before/after；completed-turn ranges 作为可丢弃派生索引按 0043 的实际读取需要另行加入。
- 当前任务单元：只负责 daemon durable canonical timeline 的 generation、恢复、替换、删除、有界读取和 eligibility metadata；不在本项启用 stored/completed fast path。
- 范围内：file/in-memory Adapters、positive-limit bounded read、stage/commit/flush、partial/corrupt segment recovery、epoch replace、physical delete/archive retention、旧历史一次性回填、durable generation 与 StoredAgentRecord optional `timelineRevision` 的写入和保留。
- 范围外：summary/detail wire RPC、App UI、SQLite、内容猜测 final、加密 at rest。
- Done Contract：重启后恢复 active generation 的 epoch/nextSeq 和 canonical coverage；positive-limit tail/before/after 只读取相交 segments，不把完整 rows 复制进 live memory；部分/损坏 segment、manifest 或 working generation fail closed。store 只把 `coverage=complete`、无 working generation且 durable `timelineRevision`/epoch/generation 与 StoredAgentRecord 精确匹配报告为 eligible；非空但 building/incomplete/mismatch 必须报告 fallback。0042 仍让 `ensureAgentLoaded()`/普通 fetch 走现有 provider/live-store 路径，只有 0043 才消费 eligibility 跳过 provider。physical delete 清理全部 generations，archive 保留；同一 Agent 的失败回填在一次 load/hydrate 调用内只尝试一次。0043 需要的 completed range/summary 必须是可丢弃重建的派生数据，不属于本项 canonical manifest 的完整性条件。
- 失败或回炉方式：若 summary index 不能安全推进 canonical coverage，只落 durable rows/seq，结论读取延后到 0043，不跳过 seq。

### 1.1 最小任务单元判断

- 为什么当前任务单元足够小：围绕 `AgentTimelineStore` 一个深模块及 file/in-memory 两个等价 Adapters；fast-path wire/UX 和 completed-turn 派生索引均留给 0043。
- 验证证据：真实临时目录可覆盖崩溃恢复，现有 in-memory store 保留快速测试。
- 模型可自主决定的范围：可在 Execute Research 中选择保守、显式且受 bounded read/write 与崩溃恢复测试约束的 segment/flush 阈值和内部文件名；不得改变下述 completeness/generation 提交顺序、依赖机器性能基线、引入数据库或猜测 provider completion。
- 拆分决定：`Accepted`。

### 1.2 stable 影响与范围调整

- 当前证据：`AgentManager` 已有可选 `durableTimelineStore` seam 和持久化写入钩子，但生产 `bootstrap.ts` 未注入 Adapter；默认 live store 仍是 `InMemoryAgentTimelineStore`。`handleFetchAgentTimelineRequest()` 先 `ensureAgentLoaded()`，stored-only Agent 仍可能恢复 provider 并遍历 `streamHistory()`。
- stable 影响：History 搜索只对 Agent 元数据排名，不提供 transcript 或 Timeline；它新增 stored/archived Agent 的打开入口，因此提高 durable read 的收益，而不是替代本任务。
- 必要性结论：`保留并分阶段`。生产 durable canonical store 是已存在 interface 的缺失实现；原计划把 completed index 与基础存储同时设为首批门槛过重。
- 第一阶段必需：stage/commit、restart、positive-limit tail/before/after、replace/rewind、physical delete/archive retention、partial/corrupt recovery、coverage state、生产接线以及旧会话一次性回填。0042 只暴露 eligibility，不据此跳过 provider。
- 第二阶段按需：只在 0043 的零 Activity summary/detail 需要时增加 completed-turn ranges；不能为了派生索引重新要求每次启动全量加载 rows。

## 2. 上下文与调研

### 2.1 上下文来源

- 需求来源：父 Spec 0038 Phase 2。
- 项目事实源：`docs/data-model.md`、`docs/timeline-sync.md`、`docs/architecture.md`、父 Spec。
- Codemap / Context Bundle：`N/A`。
- 关联任务记录：0016 提出 durable 延后方案；0033/0036 保留显式 timeline phase；0043 消费本模块。

### 2.2 调研结论

- 已确认事实：`AgentTimelineStore` interface、`InMemoryAgentTimelineStore`、timeline projection 与真实测试已存在。
- 未知与开放问题：segment row 上限可在实现中选择一个显式常量，但不得改变 completeness 语义；本项不承诺跨平台目录 `fsync` 保证，原子性边界采用项目既有的 temp-file + rename，并以故障注入证明 fail closed。
- 风险与约束：canonical timeline 是权威数据；派生 index 才能丢弃重建。canonical segment 缺失、损坏或不连续时只能 fail closed 并由 provider 重新回填；replace 必须通过新 generation 原子切换，旧 generation 在切换完成后才可清理。
- `grilling` 结论：`N/A`。

### 2.3 方案与决策

- 已选方案：扩展现有 store interface，文件 Adapter 隐藏 raw files、per-agent mutation queue、generation manifest、segment directory 和恢复；in-memory Adapter 保持同一状态机行为。
- 选择理由：一个小 interface 承载复杂存储语义，调用者不协调文件生命周期。

#### Coverage / generation 状态机

| 状态或事件     | 必须行为                                                                                                                                           | fast path 资格                                                        |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `building`     | 新建、provider 回填、refresh 或 rewind 前先持久化新 generation manifest；rows/index 尚不可声明完整                                                 | 禁止                                                                  |
| `incomplete`   | 任一 append、flush、校验或回填失败后保留已验证 rows，但记录失败 generation/revision；同一请求只尝试一次                                            | 禁止，后续显式打开/重试可重新回填                                     |
| `complete`     | 全部 rows、segment 校验和与 epoch/seq window 已落盘后，原子切换 active generation；再让 StoredAgentRecord 指向 store 返回的同一 `timelineRevision` | 仅 revision/epoch/generation 全部匹配且没有 working generation 时允许 |
| live append    | completed generation 收到新 canonical row 前先使 fast-path marker 失效；final/close drain 成功后才能提交新的 complete coverage                     | drain 前禁止                                                          |
| replace/rewind | 在独立 generation 中构建和校验，原子切换 active manifest；旧 cursor 变 stale，旧 generation 延后清理                                               | 仅新 generation complete 后允许                                       |

- working generation 不进入 fast-path eligibility：已有 active complete generation 时可供显式 committed read，但 working marker 使 eligibility fail closed；没有 active generation 时显式报告无可靠 durable coverage。只有 `commit generation` 才切换 active pointer。
- `timelineRevision` 由 durable store 在 generation commit 时生成并返回，是 StoredAgentRecord 的可选兼容字段和 active manifest 的匹配键；`AgentStorage.applySnapshot()` 必须保留已有 revision，并提供同一 per-agent 写队列上的 revision 更新，避免普通 snapshot 静默清除或用 stale record 回写。旧记录缺失时一律 fallback，不从 `updatedAt`、非空 rows 或文本内容推断。
- 当前后台 best-effort append 不能直接产生 `complete`。进入可能改变 canonical history 的 provider resume、prompt/turn、force hydrate 或 rewind 前，必须先 await working marker；随后所有 stage/update/commit 在 store 内按 Agent 串行。只有 provider history 明确 complete、显式 `turn_completed` 后 event/coalescer/store queues 全部 drain，或确认无 active/pending turn 的受控 close drain 才可 commit；failed/canceled/error、写失败或未知 terminal state 写入 `incomplete`。崩溃发生在任一边界时，重启只能看到旧 active + working（不 eligible）、incomplete，或新 active + record mismatch（不 eligible），不能出现非空即可信。
- canonical manifest 中的 segment range/checksum 是 bounded read 的必要目录，不是可删除 sidecar；缺失或损坏时该 generation 不 eligible。0043 的 completed-turn/summary index 才是可丢弃重建的 sidecar，损坏不得反向改变 canonical coverage。

#### 文件、分页与阶段边界

- 文件根固定为 `$PASEO_HOME/timelines/`，不得放入会被 `AgentStorage.scanDisk()` 当作 Agent JSON 扫描的 `$PASEO_HOME/agents/`。per-agent 目录使用 `sha256(agentId)`，manifest 保存原始 `agentId` 并在每次打开时核对，避免 path traversal 和错误目录复用。
- generation manifest 只保存固定大小 segment 的 `{file, minSeq, maxSeq, rowCount, checksum}` 元数据；segment 是经过 schema 校验的 immutable JSON rows。tail/before/after 先用 range 选择相交 segment，再读取并裁剪到调用者提供的正整数 `limit`。现有 `limit=0` 全量语义不得进入 durable page API；需要全量回填/重建的内部路径显式逐页迭代。
- segment object 位于 per-agent `segments/<sha256>.json`，generation manifest 只按 checksum 引用；相同内容可跨 active/working generation 复用。commit 后的 cleanup 只删除不再被 active/working manifest 引用的 object，且 cleanup 失败只留冗余文件，不能回滚已验证的新 active。`state.json` 原子保存 active/working generation id；提交顺序固定为 segment objects -> working manifest -> complete manifest -> active pointer -> StoredAgentRecord revision -> best-effort unreachable cleanup。
- active/working generation 的 rows 必须按 seq 严格递增且连续，`nextSeq=maxSeq+1`；空 history 以零 segment、`minSeq=maxSeq=0`、`nextSeq=1` 的 complete generation 表达。append 只允许 epoch 与 active/working 相同，否则调用方必须 replace；更新既有 row 通过 copy-on-write 新 segment 完成，不能原地改写 active segment。
- store API 以 `stageRows(agentId, { epoch, mode: "append" | "replace", rows })`、`updateStagedRow`、`commit(agentId)`、`markIncomplete`、`getCoverage(agentId, { expectedRevision? })`、`fetchCommittedPage`、`flush` 和 `deleteAgent` 为语义边界；调用方不持有 raw path 或自行协调 lock/rename/cleanup。`replace` 保留旧 active，直到新 generation 完整校验并切换；`getCoverage` 只有 expected revision 精确匹配且无 working generation 时返回 eligible。
- 0042 生产接线只负责写入、record revision 与可查询 eligibility；不得根据 durable coverage 设置 `historyPrimed`、改变 `ensureAgentLoaded()`、让 `fetchTimeline()` 从空 live store 返回，或宣告协议 capability。0043 才把 eligible durable page 接到 stored payload/summary fast path。
- 现有 `AgentManager.getTimelineRows()`、`fetchTimeline()` 和 prompt-index/projection 调用在 0042 保持 live-store only；注册时 `nextSeq`/last-message 恢复改从 coverage metadata 或一个 bounded tail page取得，不保留 `getCommittedRows()` 这类生产全量 durable convenience。测试若需检查 durable 内容，直接走 `fetchCommittedPage()` 逐页读取。
- 旧会话回填只在既有 `ensureAgentLoaded()` 的单次 provider hydrate 中惰性发生，不在 daemon bootstrap 枚举 Agent 或预读 transcript；这避免与 0046 的启动 catalog 目标冲突。并发相同 Agent load 继续复用现有 initialization promise。

### 2.4 下一步动作

- store seam 已获用户确认；本项已解除 0039 基线依赖，且 `/goal` 已授权按登记顺序执行。三轮文档静态审查已锁定 0042/0043 阶段边界、revision 所有权/保留、path safety、每 Agent 串行化、positive-limit API、terminal completion、content-addressed segment 与 live-only ordinary reads，无剩余阻塞。
- 首个 RED 使用真实临时目录覆盖 append/restart/partial tail。

## 3. 计划与执行前检查点

### 3.1 文件变化

| 项目/子项 | 文件或子 Spec                                                     | 计划变化                                                                                   | 原因                   |
| --------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ---------------------- |
| interface | `packages/server/src/server/agent/agent-timeline-store-types.ts`  | stage/commit/completeness、positive-limit canonical page、replace/flush；派生读取留给 0043 | store seam             |
| adapters  | `agent-timeline-store.ts`、`file-agent-timeline-store.ts` 及测试  | in-memory/file 等价状态机；file 使用 immutable checked segments                            | 生产与测试             |
| wiring    | `agent-manager.ts`、`agent-storage.ts`、`bootstrap.ts` 及定向测试 | 注入生产 Adapter、revision 保留、stage/commit 与 eligibility 查询；不启用 fast path        | 为 0043 提供可靠数据源 |

### 3.2 签名与契约

| 项目/子项    | 接口、类型或签名                              | 计划变化                                                                                                                   | 兼容性                                                                             |
| ------------ | --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| store        | `AgentTimelineStore`                          | stage append/replace、positive-limit canonical page、commit/invalidate coverage、delete、flush；summary/activity 留给 0043 | 现有 live `InMemoryAgentTimelineStore` 保持同步 API，durable port 独立命名避免混用 |
| adapters     | file + in-memory                              | 相同错误、ordering、epoch/seq/revision/completeness 语义                                                                   | 不暴露 raw file/index                                                              |
| record match | StoredAgentRecord optional `timelineRevision` | store commit 后更新；普通 snapshot 保留；只与 complete active generation 且无 working generation 匹配                      | 可选字段保持旧记录可读                                                             |

### 3.3 子 Spec 索引

N/A。

### 3.4 执行清单

- [x] 1. 测试代码：真实临时目录下 stage/restart/page/partial or corrupt segment/delete，以及“已有 active 但 working 写失败”的非空数据，锁定 coverage fail-closed 与 positive-limit page。
- [x] 2. 实现：版本化 per-agent immutable checked segments、working/active generation manifests、原子 pointer 切换、per-agent mutation queue 和 recovery cleanup；canonical range directory 损坏时不得宣称 complete。
- [x] 3. 生产 bootstrap 注入 file Adapter；AgentStorage schema/update/snapshot 保留 optional `timelineRevision`；0042 只暴露 complete+match eligibility，不设置 `historyPrimed` 或改变普通 fetch/provider hydrate。
- [x] 4. provider history complete 时以 replace generation 提交；live prompt/turn/rewind 先 await working marker，再 stage rows；显式 `turn_completed` 或确认无 active/pending turn 的受控 close 在 event/coalescer/store queues drain 后提交，failed/canceled/error/未知 terminal state 标记 incomplete。
- [x] 5. 旧/导入会话每次 load/hydrate 调用至多一次 provider fallback，成功提交 complete generation；失败保留 incomplete 且不损坏旧 active generation，不在同一次调用内重复扫描。
- [x] 6. 在 working marker、segment、generation manifest、active pointer、StoredAgentRecord revision 和旧 generation cleanup 各边界注入失败，验证结果只能 fallback、读取旧 committed page但不 eligible，或读取 revision 匹配的新 complete generation。
- [x] 7. 定向验证 physical delete、archive retention、flush、并发 stage/commit/update 和 row ordering；所有 durable page 调用提供正整数 limit，重建/回填使用显式逐页内部迭代。completed-turn/summary sidecar 不在 0042 实现。
- [x] 8. 回归 ordinary `getTimelineRows()`/fetch/prompt index 只读 live store；coverage metadata 和 bounded tail 恢复不得设置 `historyPrimed`，bootstrap 不扫描 timeline rows。

### 3.5 执行前检查点

- 当前目标与任务单元：durable canonical store、coverage metadata 与 0043 可消费的有界读取端口；不实现派生索引或 fast path。
- 当前 phase：`Review；已收口`。
- approval status / source：`Plan Approved / User；2026-08-09 /goal 明确授权按顺序完成 0041-0046 与 0038 集成`。
- 下一步：`None`。
- 风险与回退：canonical segment 或 revision/completeness 不可靠时保留旧 active 供诊断读取但 eligibility fail closed，并走 provider fallback；不以“非空”放行，也不从损坏 segment 猜测完整 rows。
- 验证方式：file timeline `9/9`、memory timeline `4/4`、AgentStorage `29/29`、AgentManager `164/164` 均 PASS；根 typecheck、lint、format 均 PASS。
- TDD 判定、测试 seam 与验收行为：`TDD；durable AgentTimelineStore public interface + 真实临时目录。RED：非空 incomplete/崩溃边界被误判 eligible，或重启/尾写后不能 positive-limit 读；GREEN：file Adapter 只提交匹配 generation，epoch/seq/revision/ordering 正确，corrupt/missing segment fail closed。`
- seam 确认：`User；用户于 2026-08-04 明确确认 0039-0046 当前登记的全部 TDD seams`。

## 4. 跨项目扩展

N/A。

## 5. 执行记录

| 步骤/子项          | 实际变化或子 Spec 锚点                         | 状态   | 偏差与处理                                                                                                                                                   |
| ------------------ | ---------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 子 Spec 建档       | 本文件                                         | 完成   | 未修改产品代码或数据                                                                                                                                         |
| 文档静态审查       | 三轮 bounded review                            | PASS   | 修复阶段边界、revision/路径/并发/分页、completion、segment ownership 与 ordinary read 合同                                                                   |
| 产品实现与测试代码 | Execute；三轮静态代码 review                   | 完成   | file/in-memory generation、manager drain、storage revision、bootstrap wiring；修复 checksum/尺寸/range fail-closed、working pointer recovery、分页进展保护   |
| 动态验证反馈循环   | `agent-manager.test.ts` terminal event seam    | 已定位 | durable completion 的合法 `await` 打破测试对同调用栈完成的隐式假设；事件未丢失，测试改为显式等待 `turn_completed`，不改变产品事件顺序                        |
| 动态验证反馈循环   | `agent-manager.test.ts` archive timestamp seam | 已定位 | durable close 的真实 I/O 使 `updatedAt` 与 `archivedAt` 相差不再稳定小于 5ms；改为断言 persisted `updatedAt` 等于 emitted closed state 且不早于 `archivedAt` |

## 6. 验证

| 项目/验收项  | 命令或步骤                     | 结果 | 证据                                                                                                                  | 未验证原因 |
| ------------ | ------------------------------ | ---- | --------------------------------------------------------------------------------------------------------------------- | ---------- |
| 文档结构     | 模板、父链、编号与状态检查     | PASS | parent=0038、Review/Plan Approved                                                                                     | N/A        |
| 产品验证     | 第 3.4 节                      | PASS | file store `9/9`、in-memory store `4/4`、AgentStorage `29/29`、AgentManager `164/164`、session `158/158`（1 skipped） | N/A        |
| 项目静态门禁 | 根 `typecheck`、`lint`、format | PASS | typecheck 通过；lint 0 warning/0 error；format 成功                                                                   | N/A        |

- 集成验证：0043 消费已完成，父 Spec 0038 已收口。
- 剩余风险：provider completion 仍只消费显式 terminal/commit 边界，不猜测完成；阈值必须保持显式、有界且不改变正确性语义。
- Done Contract 是否由证据满足：`是`。

## 7. 评审（Review）

| 评审轴             | 结论   | 证据或阻塞问题                                                                  |
| ------------------ | ------ | ------------------------------------------------------------------------------- |
| 目标与 Spec 完成度 | `PASS` | 8 项执行清单、生产 wiring、静态审查和动态验证均已完成                           |
| Spec 与执行一致性  | `PASS` | generation/revision、bounded paging、recovery 与 ordinary live-store 边界均对齐 |
| 实现质量与风险     | `PASS` | 故障注入、checksum、页边界、terminal commit 与 fallback 回归通过                |

- Overall Verdict：`PASS；0042 Done Contract 已由定向存储与集成验证满足`。
- Blocking Issues：`None`。
- Cross-project consistency：`N/A`。

### 7.1 回归风险

| project_id | Regression risk | 依据                     |
| ---------- | --------------- | ------------------------ |
| `paseo`    | `High`          | 权威历史、崩溃恢复和迁移 |

### 7.2 Touched Projects

N/A。Orphan changes：`None`。

## 8. 偏差、变更与反向同步

- Plan-Execution Diff：`实现按计划完成；补充 checksum 内容校验、损坏 state fail-closed、working pointer recovery 与 durable last-message 分页进展保护`。
- Change Log：`2026-08-04 08:51` 从 0038 Phase 2 拆出；`2026-08-04 09:40` 用户确认当前登记的 TDD seam；`2026-08-06 18:45` 取消 0039 基线依赖，改以 bounded read/write、崩溃恢复和 provider fallback 禁止合同选择阈值；`2026-08-09` stable 复核确认生产 durable Adapter 仍缺失，并把 completed index 从基础存储首批门槛调整为 0043 按需派生；执行就绪审查后以 completeness/generation/`timelineRevision` 取代“非空 durable”判定；第一轮文档静态审查锁定 0042 只生产 eligibility、0043 才消费 fast path，并补齐 revision 保留、path safety、mutation queue、positive-limit page 与 crash ordering；第二轮移除 0043 projection/index 范围，收紧 terminal completion 与 corrupt canonical fallback；第三轮锁定 content-addressed segment、commit/cleanup 顺序、live-only ordinary reads 和 lazy backfill，确认无剩余文档阻塞；`2026-08-10` 统一动态验证发现 `agent-manager.test.ts` 以 idle state 作为 terminal stream 的同步完成代理，durable commit await 后稳定失败；最小反馈循环证明事件只是延后，测试改为显式等待同一 `turn_completed`；同文件 archive 用例的 5ms wall-clock 阈值也被 durable close I/O 稳定击穿，改为 persisted/emitted timestamp 一致和相对 `archivedAt` 单调的确定性断言。
- 用户决策：`/goal` 已授权按登记顺序完成本任务组；canonical Activity 不删除，所有动态测试最后统一运行。
- Validation Log：`2026-08-10` 使用正确 Server Vitest 配置通过 file `9/9`、in-memory `4/4`、AgentStorage `29/29`、AgentManager `164/164` 和 session `158/158`（1 skipped）；根 typecheck/lint/format 通过。
- Spec 反向同步结果：总表与父 Spec 已同步 0042 为已收口。

## 9. 恢复、长期知识与提交关联

- 状态说明：`已收口 / Review / Plan Approved / Goal`。
- 当前卡点：`None`。
- 下一步唯一动作：`None；父 Spec 0038 已汇总任务组结果`。
- Resume / Handoff 锚点：第 1、2.2、3.2、3.4、3.5 节与父 Spec。
- Project Sync Candidates：`无；durable generation、timelineRevision 与存储位置已同步既有长期入口`。
- 长期文档同步：`已同步 docs/data-model.md、docs/timeline-sync.md、docs/architecture.md`。

### 提交记录

| 提交信息（Commit Message） | 提交脚注（Commit Footer） | 关联项目 / 改动或阶段 | 文档同步状态 | 备注                 |
| -------------------------- | ------------------------- | --------------------- | ------------ | -------------------- |
| `<待提交>`                 | `N/A`                     | `paseo / 0042`        | `未请求提交` | 用户未授权 commit/PR |
