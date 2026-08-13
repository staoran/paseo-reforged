# 会话状态隔离与 Windows 渲染驻留 Spec

## 0. 状态与索引

| 字段              | 值                                                                           |
| ----------------- | ---------------------------------------------------------------------------- |
| task_id           | `0044`                                                                       |
| spec layer        | `Feature Spec`                                                               |
| task status       | `已收口`                                                                     |
| mode              | `single_project`                                                             |
| phase             | `Review`                                                                     |
| approval status   | `Plan Approved`                                                              |
| approval source   | `Goal；2026-08-09 /goal 已授权按登记顺序执行，文档静态审查 round 1 修订收口` |
| spec path         | `mydocs/specs/0044_会话状态隔离与Windows渲染驻留.md`                         |
| parent spec       | `mydocs/specs/0038_跨端会话性能与结论优先加载.md`                            |
| supersedes        | `N/A`                                                                        |
| current task unit | `结构合同、静态审查与可执行定向验证完成；浏览器 smoke 例外已记录`            |
| created / updated | `2026-08-04 08:51 / 2026-08-09`                                              |

本文件是 0038 的剩余状态通知与 Windows 面板驻留子 Spec；0040 负责聊天 row/重型内容本身。

## 1. 目标、范围与完成契约

- 背景/问题：当前已经有 `subscribeWithSelector`、agent-specific selectors、inactive `useRetainedValue`、workspace mounted cap=3 和 Web partial virtualization，原计划中的“建立整套 per-agent external store + weighted retention”已不再必要。剩余可确认问题是 `retainedTabIds` 会在 cap 之前全部加入，modified file tabs 可无界突破完整组件树上限；inactive AgentStream 仍订阅其 stream head/capability/cursor selectors。
- 最终目标：不破坏草稿、终端、浏览器和滚动锚点的前提下，让普通可回收 panel 与 inactive Agent 更新成本有明确上限，并把不可回收 modified-file 驻留单独计数、显式呈现（本任务只提供内部诊断 shape，不新增用户可见文案）。
- 当前任务单元：只处理 `useMountedTabSet`/workspace pane retention、inactive Agent selector 接线，以及 modified file recoverability 的只读取证与 correctness exception。
- 范围内：普通 panel per-pane mount policy、retained exception 计数/原因、inactive Agent stream subscription、modified file 现有 ownership 取证、Windows mounted-count/恢复测试，以及共享 AgentStream 接线若被修改时的 Native active-path 正确性回归。
- 范围外：新建第二套 session/per-agent store、通用 weighted cache、全局 memory-pressure framework、0040 Web virtualization/fold、Native 列表调优与移动端性能测试。
- Done Contract：
  - 普通 agent/terminal/browser panel 在 20 次切换后仍受当前每 pane cap 约束，被驱逐后不保留重型订阅。
  - inactive Agent 不因自己的 live head 持续更新而执行完整 render/layout 路径；其他 Agent 更新保持 selector 隔离。
  - modified file 在本任务中保持挂载，作为携带 `modified-state-not-recoverable` 原因的显式 correctness exception；普通 cap 与 exception count 分开报告，不能把总 mounted count 伪称为硬上限。
  - recoverability checkpoint 只记录现有 ownership 是否已原子拥有 draft、selection 和 pending-save；无论结果如何，本任务不实施 modified-file 驱逐。若证据支持驱逐，另建任务并重新批准。
  - Windows 滚动锚点、文字选择、输入草稿、terminal/browser state 不因本任务回归。
- 失败或回炉方式：逐 panel kind 保留旧驻留；优先保留已验证的 inactive selector 和可回收 panel cap，不强制卸载不可恢复状态。

### 1.1 最小任务单元判断

- 为什么当前任务单元足够小：只收敛现有 retention hook 和 AgentStream active boundary，不再设计通用缓存系统。
- 验证证据：`use-mounted-tab-set`、workspace deck、split pane、panel attributes 和 AgentStream 均有定向测试 seam。
- 模型可自主决定的范围：可调整 inactive selector 的内部接线和 exception 诊断 shape；Web-only inactive boundary 应保持平台隔离，共享 AgentStream 接线变化必须保留 Native active 行为；不得新增 file draft store、实施 modified-file 驱逐或改变 Native 专属策略。
- 拆分决定：`Accepted；stable 后缩减`。

### 1.2 stable 影响与必要性

- stable History 搜索没有修改 workspace retention 或 session selectors，对本项无直接影响。
- `useMountedTabSet.deriveMountedTabLru()` 先加入所有 `retainedTabIds`，再对 previous LRU 应用 `maxSize`；因此 cap 对 modified set 不是硬上限。
- `usePublishPanelInstanceAttributes()` 当前只有 file pane 发布 `modified=true`，所以“modified 无界”是文件编辑器状态问题，不应扩展成所有 panel 的通用 weighted cache。
- AgentStream inactive 时已用 `useRetainedValue` 冻结 stream presentation，但 `AgentStreamSection` 和 `AgentStreamView` 仍读取 stream tail、projection lane、head、turn/cursor/capability 等高频 selector；需在 selector 返回稳定 inactive sentinel，并禁止 inactive `autoExpandActivity` detail 预取，再以 render/layout 调用次数验证。
- 必要性结论：`缩减保留并后置`。已有缓解覆盖大部分原问题，剩余范围明确但收益低于 0040-0043。

## 2. 上下文与调研

### 2.1 上下文来源

- 父 Spec 0038、0035 tab/runtime 回收结果、0040 render 聚合计划。
- `workspace-deck-retention.ts`、`use-mounted-tab-set.ts`、`workspace-screen.tsx`、`split-container.tsx`。
- `retained-panel.tsx`、`panel-instance-attributes.ts`、`file-pane/pane.tsx`、`agent-stream/view.tsx`。

### 2.2 已确认事实

- workspace deck 最多保留 3 个 workspace；focused/split pane 默认最多挂载 3 个普通 tab。
- inactive panel 使用 `display:none` 并保留 native/React subtree；AgentStream 通过 `useRetainedValue` 冻结 history/head/turn presentation。
- modified file tab 以 correctness 为由全部加入 retained set，当前可超过 cap。
- Zustand 已启用 `subscribeWithSelector`，AgentStream 的多数读取按 serverId/agentId 定位；原“全局任意 Agent 都让所有 view render”的描述过时。

### 2.3 方案与决策

| 方案                                                  | 决策 | 理由                                                          |
| ----------------------------------------------------- | ---- | ------------------------------------------------------------- |
| 新建 per-agent external store 和 weighted panel cache | 排除 | 与现有 Zustand selector、retention hook 重复，范围过大        |
| 先验证并切断 inactive Agent 的昂贵订阅/重算           | 接受 | 局部、可测、不会丢状态                                        |
| 对所有 modified tab 直接应用 cap                      | 排除 | 会丢未保存文本或 pending save                                 |
| 在本任务实现 modified-file 驱逐                       | 排除 | 当前没有已确认的完整恢复 seam；取证结果只决定是否创建后续任务 |

## 3. 计划与执行前检查点

### 3.1 文件变化

| 子项                     | 候选文件                                                                                                | 计划变化                                                                                                                                                                                                                                         |
| ------------------------ | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| retention policy         | `use-mounted-tab-set.ts`、`panel-instance-attributes.ts`、workspace/split pane 及测试                   | `retainedTabReasons: ReadonlyMap<tabId, "modified-state-not-recoverable">` 输入；返回 `mountedTabIds`、`ordinaryMountedTabIds`、`retainedExceptionTabIds`、`retainedExceptionCount` 和 `retainedExceptionReasons`，普通 cap 只约束 ordinary 集合 |
| inactive Agent           | `agent-panel.tsx` 的 `AgentStreamSection`、`agent-stream/view.tsx` 及测试                               | inactive 时高频 selector 只返回稳定 sentinel，`buildAgentStreamRenderModel`/`layoutStream` 不因 head/cursor/capability 变化重算；激活时读取最新值；`autoExpandActivity` 仅在 active 发 detail                                                    |
| modified file checkpoint | `file-pane/pane.tsx`、`file-pane/editor/model.ts`、`file-pane/editor/view.web.tsx` 与记录               | 只读取 content/draft、CodeMirror selection/cursor、autosave/pending-save 的实际 owner，登记是否能原子恢复；不改 ownership、不驱逐                                                                                                                |
| integration              | `use-mounted-tab-set.test.ts`、新增 `e2e/browser/workspace-retention.spec.ts`、AgentStream browser seam | 20 次切换的 ordinary/exception mounted count、被驱逐后卸载，以及 active/inactive 恢复；动态命令仍统一后置                                                                                                                                        |

### 3.2 签名与契约

| seam                    | 计划契约                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `useMountedTabSet`      | 输入 `retainedTabReasons: ReadonlyMap<string, RetainedTabReason>`，其中 `RetainedTabReason = "modified-state-not-recoverable"`；`ordinaryMountedTabIds.size <= max(1, cap)`，其中 active/previous LRU 只从非 exception tab 选择；`retainedExceptionTabIds`（含 active modified tab）不占 ordinary cap；`mountedTabIds` 是两者并集且保持 active/exception/LRU 稳定顺序。`useModifiedPanelTabReasons` 是现有 panel attribute registry 到该 map 的唯一适配层；旧 `useModifiedPanelTabIds` 若仍有外部调用保持只读兼容。 |
| inactive Agent boundary | `active=false` 时 `AgentStreamSection` 的 `agentStreamTail`、projection lane、message submissions、turn presentation、pending permissions，以及 `AgentStreamView` 的 `agentStreamHead`、timeline cursor/epoch/newer、presentation capabilities selector 返回模块级稳定 sentinel；`useChatOutline.enabled` 和 `autoExpandActivity` detail effect 同时为 false。render model/layout/detail callback 调用计数不因这些更新增加；`active=true` 的下一次 render 读取最新 authoritative presentation                       |
| modified file exception | `modified-state-not-recoverable`；保持挂载，不属于 ordinary cap，诊断同时报告 ordinary 与 exception count                                                                                                                                                                                                                                                                                                                                                                                                           |

### 3.3 子 Spec 索引

N/A。

### 3.4 执行清单

- [x] 1. RED fixture：新增 inactive sentinel/Zustand listener、detail prefetch、older-history active gate 与 ordinary cap 测试代码；遵守任务组约束未运行，因此不把它记录为已观察到的 RED。
- [x] 2. GREEN implementation：`AgentStreamSection`/`AgentStreamView` 的 tail/head/projection/message/turn/permission/cursor/capability selector 使用稳定 inactive sentinel，outline/detail/pagination 同受 active gate；重新激活 selector 直接读取最新 store snapshot，status/attention/mutation selector 保持原接线。
- [x] 3. 回归代码：`use-mounted-tab-set.test.ts` 连续切换 20 次 ordinary agent/terminal/browser/draft，断言 ordinary cap、modified exception 与被驱逐 subtree 卸载；精确组件 seam 取代新增 browser fixture，Windows browser smoke 仍留在步骤 5。
- [x] 4. Recoverability checkpoint：`FileEditorModel.getSnapshot()` 只拥有 content/modified/version，`EditableFilePane` 在 React local state 持有 cursor，CodeMirror `EditorView.state.selection` 持有 selection；autosave timer、in-flight sequence 与 `suspendAutosave()` 均由 model 实例拥有，`dispose()` 会清除它们。当前没有原子恢复全部状态的外部 seam，故保持 `modified-state-not-recoverable`、挂载且不驱逐。
- [x] 5. 已完成 ordinary/exception、inactive selector、older-history gate 与共享接线定向验证；Windows targeted Playwright 以小规模场景尝试后仍在通用 teardown 超时，未取得有效浏览器动态证据，不继续形成长循环。

### 3.5 执行前检查点

- 当前目标与任务单元：现有 retention/selector 的剩余上限。
- 当前 phase：`Review；已收口`。
- approval status / source：`Plan Approved / Goal；2026-08-09 /goal`。
- 下一步：`None`。
- 风险与回退：inactive selector 若破坏重新激活恢复则回退该接线；modified file 始终保留旧驻留，因此本任务不承担草稿迁移风险。
- 验证方式：retained selectors `2/2`、mounted `6/6`、panel attributes `3/3`、older gate `6/6` 均 PASS；根 typecheck、lint、format 均 PASS。Windows Playwright 未取得有效浏览器证据，按第 6 节验证例外收口。
- TDD 判定：`TDD；首个 RED 只使用 inactive render/layout 调用次数。ordinary mounted-set 是回归守卫；modified-file checkpoint 不改变行为，TDD=N/A。`
- seam 确认：`原 seam=User；Goal 已授权按本 Spec 收窄后的 seam 写测试与实现`。

## 4. 跨项目扩展

N/A。

## 5. 执行记录

| 步骤                 | 状态 | 说明                                                                                                                                                    |
| -------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| stable 复核与重规划  | 完成 | 删除新 store/weighted cache/memory-pressure 广泛范围                                                                                                    |
| 文档静态审查 round 1 | 完成 | 修复 Goal 批准状态、retention 输入/输出 shape、inactive selector sentinel/active gate、20 次切换证据和 modified-file ownership 取证边界；无新增架构范围 |
| 文档静态审查 round 2 | 完成 | 明确 `useModifiedPanelTabReasons` 适配层、active exception 不占 ordinary cap、selector/render/detail RED 证据和 AgentPanel mutation/attention 不 gate   |
| 文档静态审查 round 3 | 完成 | 校正 `FileEditorModel.getSnapshot()`/CodeMirror view seam、`useChatOutline` active gate 及 Review/集成旧状态；无剩余文档阻塞                            |
| 产品代码             | 完成 | ordinary/exception retention、inactive session selectors、detail/outline/pagination active gate 与重新激活最新快照已实现；定向测试 PASS                 |
| 代码静态审查 round 1 | 完成 | 修复 retention type 反向依赖、View 级 history/detail 防线，并补 selector listener 与 subtree unmount 测试 seam                                          |
| 代码静态审查 round 2 | 完成 | 收窄父层 projection subscription identity，补重新激活读取最新 projection lane 的断言；无行为阻塞                                                        |
| 代码静态审查 round 3 | 完成 | 核对旧 API、selector 绕过、React 恢复路径、Native active shared shape 与 modified-file owner；无剩余静态阻塞                                            |

## 6. 验证

| 项目               | 结果         | 证据/原因                                                                                                                           |
| ------------------ | ------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| 文档结构与父链     | PASS         | parent=0038、Review/Plan Approved/Goal                                                                                              |
| 当前缓解与剩余缺口 | PASS         | selectors、cap、retained override 和唯一 modified publisher 已核对                                                                  |
| 产品代码静态审查   | PASS         | 三轮有界审查后无剩余阻塞；`git diff --check` 无 whitespace error                                                                    |
| 动态产品验证       | PARTIAL PASS | retained selectors `2/2`、mounted retention `6/6`、panel attributes `3/3`、older-history gate `6/6`；targeted Playwright 无有效证据 |
| 项目静态门禁       | PASS         | 根 typecheck、lint（0 warning/0 error）与 format 通过                                                                               |

- 集成验证：0046/0045 均已完成，父 Spec 0038 已统一收口。
- Done Contract 是否由证据满足：`核心结构合同满足；Windows 浏览器 smoke 因通用 E2E teardown 超时作为明确验证例外保留`。

## 7. 评审（Review）

| 评审轴                | 结论                             | 阻塞                                                                              |
| --------------------- | -------------------------------- | --------------------------------------------------------------------------------- |
| 目标与 Spec 完成度    | `PASS with validation exception` | 实现、静态审查和全部可执行定向验证完成；浏览器 smoke 未取得证据                   |
| Spec 与当前代码一致性 | `PASS`                           | ordinary/exception shape、inactive sentinel 与 recoverability checkpoint 均已落地 |
| 实现风险              | `Low-Medium`                     | ordinary/exception 和 active gate 已验证；真实 Chromium 选择/驻留仍需 CI 证据     |

- Overall Verdict：`PASS with validation exception；本地任务收口，浏览器 smoke 风险上收 0038`。
- Blocking Issues：`None in product code；Playwright 基础设施未返回可归因产品 DOM 的证据`。

## 8. 偏差、变更与反向同步

- `2026-08-04`：从 0038 拆出状态隔离和 retention 计划。
- `2026-08-06`：移除 0039 profiler，改用 mounted/subscription 结构合同。
- `2026-08-09`：确认大部分隔离与驻留已存在；删除并行 per-agent store、weighted cache 和广义 memory-pressure，收敛到 retained cap、inactive selector 和必要的 file draft 取证；执行就绪审查后把首个 RED 固定为 inactive 重算，并明确 modified-file 驱逐需另建任务。
- `2026-08-09`：文档静态审查 round 1 固定 retained reason/count shape、inactive selector sentinel 与 `autoExpandActivity` active gate、ordinary cap 的 20 次切换证据和 modified-file owner 取证范围；Goal 授权进入 Execute。
- `2026-08-09`：文档静态审查 round 2 明确 `useModifiedPanelTabReasons` 适配层、active exception 不占 ordinary cap、selector/render/detail 的 RED 证据和不 gate AgentPanel mutation/attention；无新增架构范围。
- `2026-08-09`：文档静态审查 round 3 校正 `FileEditorModel.getSnapshot()` 与 CodeMirror view seam 引用，并锁定 `useChatOutline` active gate；无剩余文档阻塞。
- `2026-08-09`：完成 ordinary/exception retention、inactive selector sentinel、detail/outline/pagination active gate、重新激活最新快照与定向测试代码；三轮代码静态审查修复类型依赖方向、外部 pagination/detail 绕过和 projection identity 订阅后无剩余阻塞。modified-file 取证确认 content/modified、cursor/selection 与 autosave 生命周期尚未由单一外部 seam 原子拥有，继续作为 correctness exception 驻留。
- `2026-08-10`：统一验证通过 retained selectors `2/2`、mounted retention `6/6`、panel attributes `3/3`、older-history gate `6/6` 及根静态门禁；targeted Playwright 的小规模用例仍在通用 teardown 超时，按有界退出条件停止重试。
- Spec 反向同步结果：父 Spec 与总表登记“缩减保留；modified file 为显式 correctness exception；浏览器 smoke 为验证例外”。

## 9. 恢复、长期知识与提交关联

- 状态说明：`已收口 / Review / Plan Approved / Goal；浏览器验证例外已记录`。
- 当前卡点：`None for local implementation；targeted Playwright 基础设施超时留待 CI`。
- 下一步唯一动作：`None；父 Spec 0038 已汇总验证例外`。
- Resume / Handoff 锚点：第 1.2、2.3、3.2-3.5 节。
- Project Sync Candidates：`无；retention 细节仍属 Feature Spec，timeline display lane 已同步长期入口`。
- 长期文档同步：`已同步 docs/timeline-sync.md、docs/architecture.md 中可复用合同`。

### 提交记录

| 提交信息（Commit Message）                                | 提交脚注（Commit Footer） | 关联项目 / 改动或阶段 | 文档同步状态 | 备注          |
| --------------------------------------------------------- | ------------------------- | --------------------- | ------------ | ------------- |
| `perf: isolate retained session rendering`（`edf25e290`） | `N/A`                     | `paseo / 0044`        | `已同步`     | 0044 逻辑边界 |
