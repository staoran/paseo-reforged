# Activity 折叠渲染与按需物化 Spec

## 0. 状态与索引

| 字段              | 值                                                        |
| ----------------- | --------------------------------------------------------- |
| task_id           | `0040`                                                    |
| spec layer        | `Feature Spec`                                            |
| task status       | `已收口`                                                  |
| mode              | `single_project`                                          |
| phase             | `Review`                                                  |
| approval status   | `Plan Approved`                                           |
| approval source   | `User；2026-08-09 /goal 明确授权按登记顺序完成本任务组`   |
| spec path         | `mydocs/specs/0040_Activity折叠渲染与按需物化.md`         |
| parent spec       | `mydocs/specs/0038_跨端会话性能与结论优先加载.md`         |
| supersedes        | `N/A`                                                     |
| current task unit | `折叠/按需物化实现与可执行验证完成；浏览器验证例外已记录` |
| created / updated | `2026-08-04 08:51 / 2026-08-09`                           |

`mode` 只表示任务作用域；本文件是 0038 的 Activity 渲染子 Spec。

## 1. 目标、范围与完成契约

- 背景/问题：当前 View 虽跳过部分折叠 renderer，历史数组、layout 和 list 仍含过程成员。
- 最终目标：折叠轮次在共享 render model 中只有一个 Activity row；展开时才为目标轮次物化 detail 和重型内容。
- 当前任务单元：优化共享 render model 与 Windows Web/Chromium 可见路径，并为消费同一 model 的 Native strategy 保留正确性合同。
- 范围内：`layoutStream`、`buildAgentStreamRenderModel`、strategy input、Web virtualization、fold row 的展开渲染、可见时 Markdown/diff/Mermaid/tool detail，以及 Native strategy 对共享聚合 shape 的最窄回归测试。
- 范围外：Activity 网络读取、summary/detail RPC、Native FlatList 参数调优、移动端性能结论、持久化与导入。
- Done Contract：一个已完成 turn 的 user row、5000 个 Activity 过程项和 final row，在 Web/Native strategy 顶层只表现为 `user + 1 fold + final`；折叠成员不再成为 strategy/layout/DOM/FlatList rows。fold 顶层 key/anchor 沿用其 host item id，跨 `tail/liveHead` 时只由 host 所在 lane 持有；展开 detail 嵌在同一 fold row 内，不重新向 strategy 暴露 5000 rows。final、权限/问题、顺序、滚动锚点和文字选择保持；只展开目标 turn；不可见重型内容不解析或挂载。
- 失败或回炉方式：若窗口或卸载破坏锚点/选择，回退 Web 单项策略，保留已验证的单行 render model。

### 1.1 最小任务单元判断

- 为什么当前任务单元足够小：围绕 `AgentStreamRenderModel` 一个 interface，可独立测试和回退。
- 验证证据：现有 layout/model/strategy/Web virtualization 定向测试可作为公共测试面。
- 模型可自主决定的范围：可选择内部 fold descriptor shape，并仅为适配共享 shape 修改 Native strategy；不得调节 Native FlatList 参数或改变网络加载语义。
- 拆分决定：`Accepted`。

### 1.2 stable 影响与范围调整

- 当前证据：`layoutSegment()` 仍对每个 Activity 成员创建 `StreamLayoutItem`；`renderStreamItem()` 在折叠时才让非 host 返回 `null`；Web strategy 仍为 `segments.historyMounted` 的每个成员创建外层 `<div>` row。
- 已有缓解：fold projection cache、recent mounted window 和 partial virtualization 降低了部分重复计算，但没有让折叠轮次成为单个 layout/list/DOM row；超长单轮还可能因 mounted window 回退到 user message 而整体进入 mounted 区。
- stable 影响：History 搜索会增加长 stored 会话的打开机会，但没有修改 render model、fold 或 virtualization。
- 必要性结论：`保留`。问题可由当前源码直接证明，不依赖性能基线。
- 调整边界：本项只负责 render-row 聚合和不可见重型内容惰性物化；“未展开 Activity 不读取/不传输”继续由 0043 负责，避免在 UI 层伪装网络优化。

## 2. 上下文与调研

### 2.1 上下文来源

- 需求来源：父 Spec 0038；用户要求默认折叠过程延迟甚至永不加载。
- 项目事实源：父 Spec、`docs/timeline-sync.md`、`docs/testing.md`、0016、0033。
- Codemap / Context Bundle：`N/A`。
- 关联任务记录：0016/0033 已建立 Activity Fold 行为，本任务只减少其 render 成本。

### 2.2 调研结论

- 已确认事实：`buildAgentStreamRenderModel`、`layoutStream`、`StreamRenderInput` 和 Web virtualization 均有现成测试。
- 未知与开放问题：重型解析缓存和 worker 不属于当前最小方案；没有独立缺陷证据与另行批准时不加入。
- 风险与约束：不能隐藏 final、permission/question 或破坏历史位置语义。
- 跨平台边界：聚合发生在 `AgentStreamRenderModel`/`StreamRenderInput` 共享 seam 之前，因此 Native 必须消费同一 fold descriptor；Native 验证只覆盖 item identity、顺序、展开/折叠与必要状态，不要求真机性能基线。
- canonical/lane 边界：fold projection 先以 store 提供的 canonical `tail + head` 顺序识别 turn 和成员，再分别投影回原 lane，最后应用 Web/Native 既有 ordering。一个 fold 由最早 Activity 成员作为 host；即使其后成员跨入 `liveHead`，也只在 host 原 lane 生成一个顶层 row，并从两个 lane 的顶层 projection 移除其余成员；final answer 不属于 fold。
- identity 边界：fold 的交互 id 继续使用 `activity:<userId 或 hostItemId>`，但 strategy key、历史测量 id、prepend anchor 和 reading-position id 使用既有 `hostItemId`，避免把合成 id 泄漏给只认识 timeline item id 的滚动/outline 消费者；descriptor 另保留 member ids。任何按隐藏 member id 发起的 outline/search `scrollToMessage()` 必须先解析到 host row，再由既有测量/settle 流程定位，不能因聚合而静默失效。
- 完成态边界：历史 turn 在出现 `final_answer` 后为 completed；canonical 最新 turn 只有同时出现 `final_answer` 且 `effectiveTurnPresentation.isActive === false` 才为 completed。`isTurnActive` 是 UI 展示态的权威输入，不能再以可能滞后的 `context.status === "running"` 单独决定折叠；没有 final 的 error/idle turn 仍保持未完成并展开。
- auxiliary 边界：permission/question 由现有 live auxiliary seam 渲染，不是 `StreamItem` fold member，不参与聚合、排序或 lane 归属；final answer 保持普通顶层 row。
- tool-detail 边界：`prepareToolCallHistory()` / `projectToolCallDetailLevel()` 可在 fold projection 前进行一次轻量分组与 overview metadata 归纳，以保持既有连续 tool-call 语义；该阶段不得创建 ReactNode、Markdown AST、diff、Mermaid 或 `ToolCallDetailsContent`。重型 detail renderer 只允许由普通可见 row 或当前已展开 fold 内的 member 调用。0040 不把轻量 overview 分组重构成另一套按需索引。
- `grilling` 结论：`N/A`。

### 2.3 方案与决策

- 已选方案：在 render model interface 前完成 fold 聚合，strategy 只接收 fold descriptor 或展开后的目标 detail。
- 选择理由：复杂度集中在一个深模块，Web/未来其他策略无需重复理解折叠成员。

#### 共享 render row 合同

- `StreamRenderSegments` 从裸 `StreamItem[]` 调整为共享 discriminated union `StreamRenderRow[]`：`{ kind: "item", id: item.id, item }` 或 `{ kind: "activity", id: hostItemId, item: hostItem, fold }`。`fold` 包含稳定 `hostItemId`、交互 id、completed/duration metadata、按 canonical 顺序保存的轻量 member 引用和 member id 集合。descriptor 本身不得创建 ReactNode、Markdown AST、diff、Mermaid 或 tool detail。
- `AgentStreamRenderModel.history/segments` 的顶层 row 集合是 Web virtualizer、Web mounted rows 和 Native FlatList 的唯一 data source；不得保留一套供 Web 聚合、另一套供 Native 展开的平行 shape。
- `buildAgentStreamRenderModel()` 先在 canonical `tail + head` 上识别 fold，再把行投影到 host 原 lane，然后才做平台 ordering 和 Web window split。`historyVirtualized/historyMounted/liveHead` 的数量阈值、window、key 和估高都基于投影后的 row；跨 lane fold 不得重复出现。
- `layoutStream()` 只为顶层普通/fold rows计算相邻关系、spacing、footer host 与跨 `history/liveHead` 边界；fold 成员的 detail layout 由展开 row 内的独立 helper 按 canonical member 顺序按需生成。折叠和展开都只占一个顶层 strategy row；其他 fold 的 member layout 和 renderer 不运行。
- Web partial virtualization 在投影后的 rows 上切窗和估高；Activity row 不允许被拆分。Native 保持既有 FlatList 参数，只把 data/keyExtractor/renderItem 适配为同一 `StreamRenderRow`。

### 2.4 下一步动作

- render seam 已获用户确认；本项已解除 0039 基线依赖，且 `/goal` 已授权按登记顺序执行。三轮文档静态审查、实现和三轮代码静态审查均无剩余阻塞；动态测试命令统一延后到 0038 集成阶段。
- 压力输入使用 5000 个具有唯一 `messageId` 的 assistant Activity 条目，避免测试数据先被 reducer 合并；折叠态压力证据与小规模展开交互证据分开。

## 3. 计划与执行前检查点

### 3.1 文件变化

| 项目/子项      | 文件或子 Spec                                                                                 | 计划变化                                                                    | 原因               |
| -------------- | --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | ------------------ |
| model          | `packages/app/src/agent-stream/model.ts` 及测试                                               | discriminated fold descriptor、canonical 聚合与 lane 投影                   | 单一渲染 interface |
| layout         | `packages/app/src/agent-stream/layout.ts` 及测试                                              | 只布局顶层 rows；展开时按需布局目标 fold members                            | 降低默认布局工作   |
| view           | `packages/app/src/agent-stream/view.tsx` 及定向测试                                           | fold header 与展开 detail 嵌在同一 strategy row；重型 renderer 受展开态门控 | 延迟物化           |
| strategy       | `packages/app/src/agent-stream/strategy.ts`、`strategy-web.tsx`、`strategy-native.tsx` 及测试 | Web/Native 消费同一 row shape、id 与顺序                                    | 共享 interface     |
| virtualization | `packages/app/src/agent-stream/web-virtualization.ts` 及测试                                  | 以聚合 row 计数、切窗和估高                                                 | 稳定窗口           |
| tool detail    | `packages/app/src/tool-calls/detail-level/projection.ts` 及现有测试                           | 仅核验/维持轻量 metadata 边界；无证据时不改生产实现                         | 防止范围漂移       |

### 3.2 签名与契约

| 项目/子项    | 接口、类型或签名                                                             | 计划变化                                                                           | 兼容性                            |
| ------------ | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | --------------------------------- |
| render model | `StreamRenderRow` / `AgentStreamRenderModel` / `buildAgentStreamRenderModel` | 每个有 Activity 的 turn 恰有一个 activity row；普通/final row 保持原 item identity | 顶层类型为内部契约                |
| layout       | `layoutStream` / fold detail layout helper                                   | 顶层只布局 rows；member layout 只针对展开目标 fold生成                             | 保留 spacing/footer/tool sequence |
| strategy     | `StreamRenderInput`                                                          | detail 仅在展开目标 turn 时出现；Web/Native 接收相同 row id、identity 与顺序       | 不修改 Native FlatList 参数       |

### 3.3 子 Spec 索引

N/A。

### 3.4 执行清单

- [x] 1. pure model 以 `user + 5000 Activity members + final` 输入锁定 `user + fold + final`，并覆盖跨 `tail/liveHead` 投影；统一验证已通过。
- [x] 2. 实现：把折叠前移到 render model，每个 Activity turn 只生成一个 fold row；final、普通 item、row id 和 lane host 保持。
- [x] 3. pure layout/strategy：折叠态不生成 member layout/renderer；只展开目标 fold 后才按 canonical 顺序生成其 member detail，并保持 spacing、tool sequence、footer 与 Web/Native order/key。
- [x] 4. 测试覆盖 `isTurnActive` 与 final 组合、手动 expand/collapse、live update、permission/question auxiliary 和 history/live boundary；统一 Vitest 已通过。
- [x] 5. Web/Native strategy 消费同一 `StreamRenderRow`，Native renderer 接收 revision 后的实际 `historyRows`，且未改变 Native FlatList 参数。
- [x] 6. 5000 项折叠压力合同由 pure model 验证；真实浏览器 spec 只保留 1 项和 3 项小 turn 的目标 fold、row identity 与文字选择。小规模场景仍在通用 Playwright teardown 超时，未取得有效浏览器动态证据，按有界退出条件停止重试。
- [x] 7. 结构测试代码锁定展开前不调用 member layout/重型 renderer；轻量 overview projection 保持，网络预取仍由 0043 验收。

### 3.5 执行前检查点

- 当前目标与任务单元：折叠单行和按需物化。
- 当前 phase：`Review；已收口`。
- approval status / source：`Plan Approved / User；2026-08-09 /goal 明确授权按顺序完成 0041-0046 与 0038 集成`。
- 下一步：`None`。
- 风险与回退：锚点或选择回归时回退 Web 窗口策略。
- 验证方式：pure model `12/12`、layout `35/35`、Web strategy `13/13`、mock provider `16/16` 均 PASS；根 typecheck、lint、format 均 PASS。小规模 Playwright 因通用 teardown 超时未取得有效浏览器证据，按第 6 节验证例外收口；不要求 Native 真机性能测量。
- TDD 判定、测试 seam 与验收行为：`TDD；AgentStreamRenderModel/StreamRenderInput public interface。RED：5000 个折叠项仍生成 5000 rows；GREEN：每个完成轮次一个 fold row，展开只物化目标 turn。`
- seam 确认：`User；用户于 2026-08-04 明确确认 0039-0046 当前登记的全部 TDD seams`。

## 4. 跨项目扩展

N/A。

## 5. 执行记录

| 步骤/子项             | 实际变化或子 Spec 锚点                                                            | 状态 | 偏差与处理                                                                                              |
| --------------------- | --------------------------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------- |
| 文档门禁              | 三轮静态审查                                                                      | 完成 | 锁定 canonical/lane projection、完成态、重型内容边界和 hidden-member jump                               |
| render model / layout | `model.ts`、`layout.ts`、`strategy.ts`                                            | 完成 | 顶层统一为 `item/activity` row，member layout 仅在目标 fold 展开时生成；定向测试 PASS                   |
| Web / Native 接线     | `strategy-web.tsx`、`strategy-native.tsx`、`view.tsx`、virtualization/scroll seam | 完成 | 两端消费同一 row shape；Native FlatList 参数未改变；隐藏 member jump 映射到 host row；定向测试 PASS     |
| 验收代码              | pure Vitest、strategy mock、browser E2E                                           | 完成 | 5000 项 pure model 压力合同 PASS；小规模 Playwright 按第 6 节验证例外记录                               |
| 代码评审              | 三轮静态审查与修复                                                                | PASS | 修复 reducer 合并测试数据、超大展开 E2E、Native revision row 传递和未使用 timing 参数；第三轮无剩余阻塞 |

## 6. 验证

| 项目/验收项         | 命令或步骤                              | 结果       | 证据                                                                                           | 未验证原因                         |
| ------------------- | --------------------------------------- | ---------- | ---------------------------------------------------------------------------------------------- | ---------------------------------- |
| 文档结构            | 模板、父链、编号与状态检查              | PASS       | parent=0038、Plan Approved                                                                     | N/A                                |
| 产品代码静态审查    | 三轮 bounded review                     | PASS       | 第 5、7 节                                                                                     | N/A                                |
| `git diff --check`  | `git diff --check`                      | PASS       | 无 whitespace error；仅行尾转换提示                                                            | N/A                                |
| 定向 Vitest         | layout/model/Web strategy/mock provider | PASS       | layout `35/35`、model `12/12`（含 5000 -> 1 fold）、strategy `13/13`、mock `16/16`             | N/A                                |
| targeted Playwright | 小规模 fold/identity/selection          | 无有效证据 | 1/3 项用例在产品断言前后均被通用 teardown 超时吞没；失败快照仅见清理后的 Workspace unavailable | E2E 基础设施超时，不能归因产品 DOM |
| 项目静态门禁        | 根 typecheck、lint、format              | PASS       | typecheck 通过；lint 0 warning/0 error；format 成功                                            | N/A                                |

- 集成验证：父 Spec 0038 已收口。
- 剩余风险：真实 Chromium 中的展开、row identity、文字选择和锚点仍缺本地动态证据；展开后的超大 detail 仍可能较慢，但不影响已验证的默认折叠 shape。
- Done Contract 是否由证据满足：`核心 render/model 合同满足；真实浏览器交互作为明确验证例外保留`。

## 7. 评审（Review）

| 评审轴             | 结论                             | 证据或阻塞问题                                                     |
| ------------------ | -------------------------------- | ------------------------------------------------------------------ |
| 目标与 Spec 完成度 | `PASS with validation exception` | 实现、pure 压力合同、静态审查和可执行定向验证完成                  |
| Spec 与执行一致性  | `PASS`                           | 实现遵守单一 row shape、canonical/lane、按需 member 和 Native 边界 |
| 实现质量与风险     | `PASS with browser residual`     | typecheck/lint 与定向 Vitest 通过；真实浏览器证据受基础设施阻塞    |

- Overall Verdict：`PASS with validation exception；0040 本地实现收口`。
- Blocking Issues：`None in product code；targeted Playwright 未取得有效证据`。
- Cross-project consistency：`N/A`。

### 7.1 回归风险

| project_id | Regression risk | 依据                           |
| ---------- | --------------- | ------------------------------ |
| `paseo`    | `High`          | 影响聊天渲染、折叠、锚点与选择 |

### 7.2 Touched Projects

N/A。Orphan changes：`None`。

## 8. 偏差、变更与反向同步

- Plan-Execution Diff：压力输入由可能被 reducer 合并的连续 `todo` 改为具有唯一 `messageId` 的 assistant Activity；5000 项用例只证明折叠态顶层 shape，展开/identity/文字选择改由 1 项和 3 项小 turn 证明；隐藏 member jump 使用 pure resolver 测试，避免让超大 E2E 同时承担不相关交互结论。均不改变产品合同。
- Change Log：`2026-08-04 08:51` 从 0038 Phase 1/4 的渲染范围拆出；`2026-08-04 09:40` 用户确认当前登记的 TDD seam；`2026-08-06 18:45` 取消 0039 基线依赖，以折叠行数、detail renderer 调用和 mounted content 的确定性断言验收；`2026-08-09` 复核 stable 后确认问题仍存在，并明确网络读取仍归 0043；执行就绪审查后补入共享 render model 的 Native strategy 正确性合同；第二轮静态文档审查锁定 discriminated row、canonical/lane 投影、`isTurnActive` 完成态和轻量 tool overview 边界，并把浏览器交互证据从 JSDOM 单测中分离；第三轮补齐隐藏 member id 到 host row 的 jump 映射，确认无剩余文档阻塞并按 `/goal` 进入 Execute；实现和三轮代码静态审查完成，修复压力 fixture、浏览器用例范围、Native revision rows 与无效 helper 参数后无剩余静态阻塞，动态验证延后到 0038 集成。
- Validation Log：`2026-08-10` layout `35/35`、model `12/12`、Web strategy `13/13`、mock provider `16/16` 及根静态门禁通过；5000 项 Playwright 方案因实时注入、gate 和单响应注入均超时而撤销，保留小规模用例，但同样因通用 teardown 超时未取得有效证据。
- 用户决策：`/goal` 已授权按 0041 -> 0040 -> 0042 -> 0043 -> 0044 -> 0046 -> 0045 -> 0038 集成推进。Native 只允许共享 shape 适配和正确性回归，不做专属调优；所有动态测试最后统一运行。
- Spec 反向同步结果：总表与父 Spec 已同步 0040 为已收口并登记浏览器验证例外。

## 9. 恢复、长期知识与提交关联

- 状态说明：`已收口 / Review / Plan Approved / Goal；浏览器验证例外已记录`。
- 当前卡点：`None for local implementation；targeted Playwright 基础设施超时留待 CI`。
- 下一步唯一动作：`None；父 Spec 0038 已汇总验证例外`。
- Resume / Handoff 锚点：第 1、3.2、3.4、3.5 节与父 Spec。
- Project Sync Candidates：`无；projection/display lane 的可复用合同已同步 docs/timeline-sync.md`。
- 长期文档同步：`已同步 docs/timeline-sync.md`。

### 提交记录

| 提交信息（Commit Message） | 提交脚注（Commit Footer） | 关联项目 / 改动或阶段 | 文档同步状态 | 备注                 |
| -------------------------- | ------------------------- | --------------------- | ------------ | -------------------- |
| `<待提交>`                 | `N/A`                     | `paseo / 0040`        | `未请求提交` | 用户未授权 commit/PR |
