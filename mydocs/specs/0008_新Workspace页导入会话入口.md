# 新Workspace页导入会话入口 Spec

> 历史迁移说明：本文于 2026-08-02 从 `mydocs/tasks/0008_新Workspace页导入会话入口/` 迁移为当前规则集的单文件 Heavy Spec。第 0-9 章是当前权威摘要；第 10 章按源文件保存完整历史原文和 SHA-256，仅用于追溯，不构成新的执行授权。

## 0. 状态与索引

| 字段              | 值                                               |
| ----------------- | ------------------------------------------------ |
| task_id           | `0008`                                           |
| spec layer        | `Feature Spec`                                   |
| task status       | `已收口`                                         |
| mode              | `single_project`                                 |
| phase             | `Review`                                         |
| approval status   | `Plan Approved`                                  |
| approval source   | `User`                                           |
| spec path         | `mydocs/specs/0008_新Workspace页导入会话入口.md` |
| parent spec       | `mydocs/specs/0002_fork改进与主线覆盖总控.md`    |
| supersedes        | `N/A`                                            |
| current task unit | `历史任务记录迁移与归档`                         |
| created / updated | `2026-07-25 / 2026-08-02`                        |

## 1. 目标、范围与完成契约

- 背景/问题：该任务使用旧规则集的多文件任务包记录，现需迁移为当前单文件 Spec。
- 最终目标：在新 Workspace 页面提供当前项目会话导入入口并完成成功导航。
- 当前任务单元：无损迁移历史记录并关闭旧路径。
- 范围内：当前项目会话列表、无目标导入、失败可见性、成功导航及窄 App 回归。
- 范围外：改变 server 默认导入规则、跨项目导入、重构 Home 或全量 E2E。
- Done Contract：当前摘要覆盖任务状态、关键事实、方案、执行、验证、风险和提交；全部旧 Markdown 原文及内容哈希保存在第 10 章；旧目录仅在迁移验证通过后删除。
- 失败或回炉方式：任一源文件未被完整嵌入、哈希不符或格式检查失败时，保留旧目录并重新生成，不以不完整的新 Spec 替代源记录。

### 1.1 最小任务单元判断

- 为什么当前任务单元足够小：单个 task_id 只生成一份对应 Spec，不合并不同任务的事实或授权。
- 验证证据：源文件清单、SHA-256、完整内容包含检查和 Markdown 格式检查。
- 模型可自主决定的范围：章节重组、历史摘要和附录顺序；不得改写历史授权或扩大任务结论。
- 拆分决定：`Accepted`

## 2. 上下文与调研

### 2.1 上下文来源

- 需求来源：用户要求将历史文档转为新规则集格式后删除旧文档。
- 项目事实源：`PROJECT.md`、Git 历史、当前源码以及第 10 章保存的旧任务包。
- Codemap：`N/A`
- Codemap Mode：`N/A`
- Context Bundle：`N/A`
- Context Bundle Level：`N/A`
- 关联任务记录：`mydocs/specs/0002_fork改进与主线覆盖总控.md`

### 2.2 调研结论

已确认事实：

- 入口复用现有 import contract，并把 workspace 目标创建和成功导航串联。
- 失败状态保持可见，Linux E2E 当时按用户决定延后。
- 实现进入 feb4e82d5，并在后续发布历史中保留。

- 未知与开放问题：无影响本次历史迁移的开放问题；动态 refs、外部服务和旧基线只按历史快照理解。
- 风险与约束：历史 Linux E2E 延后结论不能替代当前跨平台回归。
- `grilling` 结论（如使用）：未使用；迁移目标与删除范围已由用户明确。

### 2.3 方案与决策

- 备选方案：保留旧任务包、只写摘要后删除、或在新 Spec 中同时保存摘要和完整原文。
- 已选方案：使用当前模板的 0-9 章保存权威摘要，并在第 10 章无损嵌入全部旧文件。
- 选择理由：消除并行真相源，同时避免删除未提交历史记录造成证据丢失。

历史任务关键决策：

- 只在新 Workspace 页面增加入口，不建立第二套导入服务。
- 复用 server 的 untargeted import 默认规则。

### 2.4 下一步动作

- 下一步唯一动作：N/A；任务已提交。

## 3. 计划与执行前检查点

### 3.1 文件变化

| 项目/子项    | 文件或子 Spec                                    | 计划变化                     | 原因                     |
| ------------ | ------------------------------------------------ | ---------------------------- | ------------------------ |
| 历史任务记录 | `mydocs/tasks/0008_新Workspace页导入会话入口/`   | 合并到当前单文件 Spec 后删除 | 消除旧规则集多文件真相源 |
| 当前 Spec    | `mydocs/specs/0008_新Workspace页导入会话入口.md` | 新建                         | 使用当前 Heavy Spec 模板 |

### 3.2 签名与契约

| 项目/子项 | 接口、类型或签名     | 计划变化 | 兼容性         |
| --------- | -------------------- | -------- | -------------- |
| 文档迁移  | 运行时接口与数据契约 | 无变化   | 仅迁移历史记录 |

### 3.3 子 Spec 索引

N/A；该历史 task_id 迁移为单个 Spec。

### 3.4 执行清单

- [x] 1. 读取并归档旧任务包全部 Markdown 文件。
- [x] 2. 建立当前模板要求的状态、目标、上下文、执行、验证和提交摘要。
- [x] 3. 记录源文件 SHA-256 并验证完整内容已嵌入。
- [x] 4. 在新 Spec 验证通过后删除旧目录。

### 3.5 执行前检查点

- 当前目标与任务单元：历史任务单文件迁移。
- 当前 phase：`Review`
- approval status / source：`Plan Approved / User`；用户已明确授权转换并删除旧文档。
- 下一步：验证格式、内容哈希和旧路径引用。
- 风险与回退：验证失败时不删除旧目录；Git 可恢复原 tracked 文件，未跟踪源内容已完整嵌入第 10 章。
- 验证方式：生成器内容包含检查、格式检查、旧路径检索和 Git 范围审查。
- TDD 判定、测试 seam 与验收行为：`N/A`；当前改动只迁移历史文档，不改变运行时行为。
- seam 确认：`N/A`

## 4. 跨项目扩展

N/A；单项目历史文档迁移。

## 5. 执行记录

| 步骤/子项 | 实际变化或子 Spec 锚点                 | 状态   | 偏差与处理                   |
| --------- | -------------------------------------- | ------ | ---------------------------- |
| 1         | 增加页面入口与会话列表状态。           | 已记录 | 详细时间线见第 10 章原始记录 |
| 2         | 接入导入 mutation、失败状态与导航。    | 已记录 | 详细时间线见第 10 章原始记录 |
| 3         | 完成 P1 修复、精确范围审查和自动验证。 | 已记录 | 详细时间线见第 10 章原始记录 |
| 文档迁移  | 旧任务包完整原文进入第 10 章           | 已完成 | 不改写原始记录               |

## 6. 验证

| 项目/验收项    | 命令或步骤                        | 结果   | 证据           | 未验证原因 |
| -------------- | --------------------------------- | ------ | -------------- | ---------- |
| App 单测       | 入口、状态和导航相关定向测试      | `PASS` | 历史任务记录   | `N/A`      |
| Windows 主场景 | 目标 E2E                          | `PASS` | 历史任务记录   | `N/A`      |
| 静态门禁       | 96/96、typecheck、lint、format    | `PASS` | 历史任务记录   | `N/A`      |
| 迁移完整性     | 源文件 SHA-256 与完整内容包含检查 | `PASS` | 第 10.1 节清单 | `N/A`      |

- 集成验证：当前迁移不改变产品代码；历史产品验证结果按上表和第 10 章保留。
- 剩余风险：历史 Linux E2E 延后结论不能替代当前跨平台回归。
- Done Contract 是否由证据满足：是

## 7. 评审（Review）

| 评审轴             | 结论   | 证据或阻塞问题                                  |
| ------------------ | ------ | ----------------------------------------------- |
| 目标与 Spec 完成度 | `PASS` | 历史结论和完整原文已迁移                        |
| Spec 与执行一致性  | `PASS` | 新摘要不扩大旧授权，原文无损保留                |
| 实现质量与风险     | `PASS` | 历史 Linux E2E 延后结论不能替代当前跨平台回归。 |

- Overall Verdict：`PASS`
- Blocking Issues：None
- Cross-project consistency：`N/A`

### 7.1 回归风险

| project_id | Regression risk | 依据                              |
| ---------- | --------------- | --------------------------------- |
| `paseo`    | `Low`           | 当前只迁移 Markdown，不改变运行时 |

### 7.2 Touched Projects

N/A。

- Orphan changes：`None`

## 8. 偏差、变更与反向同步

- Plan-Execution Diff：历史任务的计划与执行偏差按第 10 章原记录保存；本迁移不重新裁决。
- Change Log：2026-08-02 将旧多文件任务包迁移为当前单文件 Heavy Spec。
- 用户决策：转换历史文档，验证后删除旧目录；0031 由其他会话处理，不在本迁移范围。
- Spec 反向同步结果：第 0-9 章成为当前权威摘要，第 10 章保存只读历史原文。

## 9. 恢复、长期知识与提交关联

- 状态说明：`已收口`
- 当前卡点：`N/A`
- 下一步唯一动作：N/A；任务已提交。
- Resume / Handoff 锚点：本文第 0 章；详细历史见第 10 章。
- Project Sync Candidates：无；本迁移不从一次性历史记录推导新的长期规则。
- 长期文档同步：仅更新旧任务路径登记，不改变产品知识。

### 提交记录

| 提交信息（Commit Message）                                                                   | 提交脚注（Commit Footer） | 关联项目 / 改动或阶段    | 文档同步状态 | 备注           |
| -------------------------------------------------------------------------------------------- | ------------------------- | ------------------------ | ------------ | -------------- |
| `feat(app): 在新 Workspace 页导入当前项目会话`（`feb4e82d5f0e8ddacf85217664941a9e27ab7dc6`） | `N/A`                     | `paseo / 导入入口与导航` | 已同步       | 历史提交已存在 |

## 10. 历史原始记录

### 10.1 源文件完整性清单

以下哈希按 LF 规范化且去除文件尾空白后计算。

| 源文件         | 规范化字节数 | SHA-256                                                            |
| -------------- | -----------: | ------------------------------------------------------------------ |
| `SPEC.md`      |        22124 | `d9861f4b38201484ee3c6c8b0f879e6005591cb004f5ed1394d0126bf9fa2dcf` |
| `findings.md`  |        13136 | `f185016f14483c9f6f17caaf62b4c6cc691d3c24e0a7191ae1aaa8041ace1c28` |
| `progress.md`  |        12311 | `2844d5fdcb1ff155b0dad9abca0a72d11ec4c8d5db6b4ff7bd7deb8578eabeea` |
| `task_plan.md` |         3700 | `8e15ef7e8a4d01c0889be3b2f0e18d0ed1594f8708800de9e06edfd5aeb6b817` |

### 10.2 原 `SPEC.md`

```text
# New Workspace 页导入会话入口 Feature Spec

本文件保存 `M-22` 的修正后合同。用户已于 `2026-07-25` 回复精确字样 `Plan Approved`，并于 `2026-07-26` 授权 P1 修复、失败可见性回归和精确暂存审查；随后明确将 Linux Playwright 延后，以 Windows 主场景证据判断当前提交。Git commit 与 push 仍未授权。

## 任务索引

| 字段         | 值                                                                              |
| ------------ | ------------------------------------------------------------------------------- |
| task_id      | `0008`                                                                          |
| 任务深度     | `standard`（新增 App 入口和窄 UI 回归；server 默认规则直接复用）                |
| 创建时间     | `2026-07-25`                                                                    |
| 最近更新     | `2026-07-26`                                                                    |
| 当前阶段     | `Review Complete / READY TO COMMIT`                                             |
| 批准状态     | `P1 Fix Complete / 17 exact M-22 paths staged / commit not authorized`          |
| Parent Spec  | [0002/M-22](../0002_fork改进与主线覆盖总控/SPEC.md#12-子-spec-抽取合同)         |
| 关联任务     | [0005/M-21](../0005_导入会话标题传递/SPEC.md)                                   |
| 关联 docs    | `docs/agent-lifecycle.md#tabs-vs-archive`、`docs/expo-router.md#agent-targets`  |
| 关联 CodeMap | `N/A`（入口、组件、provisioning 和导航 owner 已由当前源码确认，模块边界未变化） |

## 父 Spec 绑定与基线

| 字段            | 值                                         |
| --------------- | ------------------------------------------ |
| 总表 ID         | `M-22`                                     |
| 父表状态        | `MISSING_NEW_WORKSPACE_IMPORT_ENTRY`       |
| 父表优先级      | `P1`                                       |
| 收益/预计成本   | `高 / S`                                   |
| Research `HEAD` | `084dca00b7bff618b09458082d878decfdd40918` |
| `origin/main`   | `b64f4f35784876021268583b1736ad951495946c` |
| `upstream/main` | `65633004b23d6eeeda9321e04f096ca647694b2b` |
| M-21 本地提交   | `084dca00b7bff618b09458082d878decfdd40918` |

`origin/main`、最新 `upstream/main` 和 Research 基线 `084dca00b` 均没有 New Workspace 页导入入口。三者已有无目标导入创建 fresh workspace 的 server 规则；该基线另有 M-21 的导入标题链路。

## 当前行为与精确缺口

| 导入入口                 | 会话列表范围                                      | import request       | 既有 workspace 行为                                                                         |
| ------------------------ | ------------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------- |
| Home / Open Project      | Host 全局，未传 `cwd`                             | 不传 `workspaceId`   | 按所选 session 的 cwd 创建 fresh workspace，再进入 agent route                              |
| 已有 Workspace 菜单      | 当前 workspace 的 `cwd`                           | 传当前 `workspaceId` | 复用当前 workspace，在其中新增 agent tab                                                    |
| New Workspace 页（M-22） | 应为当前选中 project 的 `selectedSourceDirectory` | 应不传 `workspaceId` | 应沿用无目标导入规则，在当前 project 下创建 fresh local workspace 并打开 imported agent tab |

前两行是现有行为，不属于 M-22 的新增范围。当前缺口仅是第三行：`new-workspace-screen.tsx` 已拥有选中的 Host、project、source directory 和 runtime client，但没有打开 `ImportSessionSheet` 的入口或成功导航接线。

## 目标与 Done Contract

### 核心目标

在 New Workspace 页增加可见的“Import session”次级操作。它默认列出当前选中 project 的会话；选择会话后走既有 untargeted import，在该 project 下创建一个新的 local workspace 容器，并在其中打开 imported agent tab。

### Done Contract

1. New Workspace 主内容区存在带图标和文字的导入操作，复用 `importSession.title` 文案；有稳定 test ID 和可访问名称。
2. 操作绑定当前 `selectedServerId`、runtime client 和 `selectedSourceDirectory`；没有选中 project/source directory、Host 未连接或页面正在创建 workspace 时不可触发。
3. 打开的 `ImportSessionSheet` 收到 `cwd={selectedSourceDirectory}`，因此请求和 server 二次过滤都只保留与当前 project root realpath 等价的 Provider sessions。
4. New Workspace 入口不向 sheet 传 `workspaceId`。导入 request 继续携带 M-21 已接通的 `workspaceTitle`，但不携带现有 workspace 目标。
5. 既有 `runInImportWorkspace()` 为该 untargeted import 生成 fresh opaque workspace ID；同一 active project root 被 `getOrCreateActiveByRoot()` 复用。导入不创建 worktree，也不受页面的 Isolation、Base、prompt 或附件状态影响。
6. 导入成功后使用返回 agent 的权威 `workspaceId` 和 `{ kind: "agent", agentId }` 调用既有 workspace 导航，使用户直接进入新 workspace 的 imported agent tab。
7. Home 的 Host 全局导入和已有 Workspace 的 targeted import 行为、标签页归属与筛选范围保持不变。
8. 新入口的 UI/接线回归、既有 import sheet 定向测试、provisioning 定向测试、typecheck、lint、格式与 diff 检查通过。

### 最终审查修复合同

1. Recent Provider sessions 的 React Query cache identity 必须包含 `serverId`；同 cwd、同 Provider 的两个 Host 不得共享可点击缓存行。
2. `onImported` 后置处理（包含返回 Promise）失败时，sheet 不得先关闭；失败状态必须留在当前 UI 中供用户看到和关闭。
3. 缺失 workspace ID 必须抛出携带 `agentId` 的类型化错误。

定向测试必须覆盖跨 Host cache isolation 与回调失败可见性；任务文档中的测试路径、Review 状态和实际证据必须一致。

## Scope

### In Scope

- New Workspace 页的导入操作、打开/关闭状态和禁用状态。
- 用当前选择的 Host/client/source directory 配置既有 `ImportSessionSheet`。
- 明确省略 `workspaceId`，并在成功后按返回的 agent workspace 打开 agent tab。
- 一个可独立测试的窄 UI seam；复用现有 Button、图标、sheet、翻译键和导航 helper。
- 复用 `0005/M-21` 的标题字段、三态语义、capability gate 与相邻测试。

### Out of Scope

- 不修改 Home 导入或已有 Workspace 菜单导入的列表范围、目标 workspace 或成功导航；P1 仅让 Home project 注册失败回传给 sheet。
- 不修改 `runInImportWorkspace()`、project/workspace registry、agent import、协议 schema、capability 或持久化模型。
- 不把 New Workspace 页当前选择的 Isolation/Base 应用于导入，不为导入创建 worktree。
- 不新增 Host 选择器、project 注册流程、fallback RPC 或新的导入 sheet。
- 不新增翻译文案；复用现有 `importSession.title` 和 sheet 文案。
- 不处理 symlink 别名映射为不同 project record 的历史边界；若正常 exact-root 用例不能复用当前 project，停止并回到 Plan Review。
- 不运行全量测试，不连接或重启端口 `6767` 的主 daemon，不 commit 或 push。

## 已确认复用链

| 环节            | 当前 owner                                                    | M-22 处理                                                             |
| --------------- | ------------------------------------------------------------- | --------------------------------------------------------------------- |
| 当前项目上下文  | `new-workspace-screen.tsx`、`new-workspace/project-picker.ts` | 直接使用 `selectedServerId`、`client`、`selectedSourceDirectory`      |
| 列表与导入 UI   | `components/import-session-sheet.tsx`                         | 传当前 cwd，不传 `workspaceId`；不复制 sheet                          |
| 当前项目筛选    | `server/agent/import-sessions.ts`                             | 复用 `createRealpathAwarePathMatcher(request.cwd)`                    |
| fresh workspace | `workspace-provisioning-service.ts`                           | 复用 untargeted `createWorkspaceForDirectory()` 和 fresh ID           |
| project 归属    | `workspace-registry.ts`                                       | 复用 active exact-root project allocation                             |
| 标题            | `0005/M-21` 本地提交                                          | 复用 `workspaceTitle`、fresh workspace/agent title 和 capability gate |
| tab 导航        | `navigateToWorkspace()` 与 workspace tabs model               | 用 import response 的 `agent.workspaceId` 和 agent target             |

## 0005/M-21 复用判定

| 范围                           | 能否直接复用 | 结论                                                                  |
| ------------------------------ | ------------ | --------------------------------------------------------------------- |
| Import sheet 与 Provider title | 是           | 当前组件已经发送 `workspaceTitle`，M-21 已让本地 daemon 保留标题三态  |
| capability gate                | 是           | 新入口使用同一个 sheet，不建立第二套版本分支                          |
| workspace 创建与 project 归属  | 不来自 M-21  | 这是更早主线已有的 untargeted import 默认规则，M-22 直接调用即可      |
| agent tab 导航                 | 不来自 M-21  | 使用现有 workspace/tab 导航；M-21 未修改路由或 tab model              |
| New Workspace 页面入口         | 否           | `084dca00b` 没有修改 New Workspace 页面，这是 M-22 必须新增的产品代码 |

结论：M-22 可以直接建立在已完成的 `0005/M-21` 本地提交上，并复用其标题链路；但 M-22 仍需要新增 App 入口和成功导航，不能再判定为“只补 server 组合回归”。

## 最小实施计划

1. 新增一个 colocated 的 New Workspace import entry 组件，负责图标文字操作、sheet 可见状态、当前 cwd/Host 接线和成功导航。
2. 在 `new-workspace-screen.tsx` 的 Composer 相邻次级操作区渲染该组件，只传当前页面已经计算出的 context，不复制 project selection 状态。
3. 为入口 model、共享 sheet completion 和 Home completion 增加纯 port/adapter 回归；真实 Playwright 覆盖入口、sheet 与当前 cwd 接线，复跑既有 sheet 与 provisioning 回归。
4. Review 时确认另外两个入口没有改动，并把实际结果反向同步到本任务和父 `0002`。

## 计划文件影响

| 文件                                                                                               | 计划动作       | 边界                                                           |
| -------------------------------------------------------------------------------------------------- | -------------- | -------------------------------------------------------------- |
| `packages/app/src/screens/new-workspace-screen.tsx`                                                | 接入导入 entry | 只提供当前页面 context，不复制导入逻辑                         |
| `packages/app/src/screens/new-workspace/import-session-entry.tsx`                                  | 新增窄 UI 组件 | 复用 Button、`ImportSessionSheet` 和 `navigateToWorkspace()`   |
| `packages/app/src/screens/new-workspace/import-session-entry-model.ts`                             | 新增纯 seam    | 隔离禁用态和权威 workspace/tab 导航逻辑                        |
| `packages/app/src/screens/new-workspace/import-session-entry.test.ts`                              | 新增定向测试   | 覆盖禁用态、成功导航和缺失 workspace ID                        |
| `packages/app/src/components/import-session-sheet-view-model.{ts,test.ts}`                         | 新增 pure seam | 覆盖 Host cache key、awaited completion 与失败时不关闭         |
| `packages/app/src/hooks/open-project.{ts,test.ts}`                                                 | 新增 Home seam | 复用真实 project 注册结果；失败时拒绝且不导航                  |
| `packages/app/src/components/import-session-sheet.test.tsx`                                        | 新增组合回归   | 真实 sheet 接入 Home completion helper，覆盖注册失败可见性     |
| `packages/app/src/screens/open-project-screen.tsx`                                                 | 修正 Home 回调 | 调用 Home completion seam，将失败作为 awaited completion error |
| `packages/server/src/server/session/workspace-provisioning/workspace-provisioning-service.test.ts` | 只运行         | 复用 fresh workspace 与 active project 证据                    |
| 本任务四文件与父 `0002`                                                                            | 更新状态       | 父表只保存摘要，不复制执行日志                                 |

## 验收与验证计划

1. `rtk npx vitest run packages/app/src/components/import-session-sheet-view-model.test.ts --bail=1`
2. `rtk npx vitest run packages/app/src/hooks/use-open-project.test.ts --bail=1`
3. `rtk npx vitest run packages/app/src/components/import-session-sheet.test.tsx --bail=1`
4. `rtk npx vitest run packages/app/src/screens/new-workspace/import-session-entry.test.ts --bail=1`
5. `rtk npx vitest run packages/server/src/server/session/workspace-provisioning/workspace-provisioning-service.test.ts --bail=1`
6. Linux/CI：`npm run test:e2e --workspace=@getpaseo/app -- e2e/new-workspace-entry.spec.ts`。
7. `rtk npm run typecheck`、`rtk npm run lint`、对本次实际修改文件运行 `rtk npm run format:files -- ...`。
8. `rtk git diff --check`、定向路径状态检查和 source/spec 对照。

## 风险与回退

| 风险                                            | 门禁/回退                                                                                       |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| 把 New Workspace 导入误接成 targeted import     | 测试精确断言 request 不含 `workspaceId`；失败即回退入口接线                                     |
| 列表泄漏到 Host 全局或其他 project              | 没有 `selectedSourceDirectory` 时禁用；断言 fetch request 携带当前 cwd                          |
| 导入后打开旧 workspace                          | 只信任 import response 的 `agent.workspaceId`，不从 cwd 或当前 selection 猜 workspace           |
| 页面 Isolation 被误用于导入                     | entry 不接收 worktree/ref/composer 状态；server/protocol 零改动                                 |
| cwd 的 symlink 别名绕过 exact-root project 复用 | 本任务只承诺正常 current-root 路径；出现红色证据时暂停并重新设计显式 project 归属，不静默扩协议 |

## 实施与验证结果

- New Workspace 页已渲染带图标、可访问名称和稳定 test ID 的 `Import session` 次级操作；无 client、无 cwd、Host 断开或页面正在创建时禁用。
- entry 向既有 sheet 传当前 `selectedSourceDirectory`，没有传 `workspaceId`；成功回调只使用 imported agent 的 `workspaceId` 和 ID 打开 agent tab。
- P1 本地回归已通过：sheet view model `34/34`、Home completion `9/9`、sheet `18/18`、entry model `3/3`、provisioning `32/32`，合计 `96/96`。typecheck、lint、17 文件格式检查、staged/worktree diff check 和 staged 双轴审查均通过。
- recent-session query key 已加入 `serverId`；同 cwd/provider 的 Host B 不再显示 Host A 缓存行。`onImported` 现在支持并等待 Promise：共享 completion 在回调 rejection 时不关闭 sheet 或打开 targeted tab；Home 的真实 completion helper 将 project 注册失败变为 rejection 且不导航。缺失 workspace ID 使用携带 `agentId` 的类型化错误。
- 新增组件组合回归把真实 `ImportSessionSheet` 接到真实 Home completion helper：成功 import 后 project 注册失败会显示 sheet 错误，且不关闭、不导航。默认 daemon 仍缺可导入的 provider-session fixture，因此完整 Home 页面 E2E 仍是残余测试缺口；目标 Linux Playwright 只验证新入口、sheet 和 current-project cwd。
- `1440x900` desktop 与 `390x844` compact smoke 通过：入口无重叠，modal/bottom sheet 可打开，列表显示当前 `E:\Code\paseo` project sessions。
- 新增 Playwright 用例验证入口、sheet 和 fetch cwd；Windows 现有 global setup 仍因 `which` 与裸 `spawn("npx")` 阻塞，未把该用例记为已通过。第二次 `tencent-ssh` 重试未启动目标用例；用户随后明确延后 Linux 验证。远端同名隔离容器已不存在，本地临时副本已删除。
- 根级 `npm run format:check -- <paths>` 因脚本固定执行 `oxfmt --check .` 而扫描全仓，并报告 2934 个基线格式问题；M-22 使用可传参的 `format:files -- --check` 完成 12 文件定向验证，不扩散全仓格式改动。

## Checkpoint

- 核心目标已完成：New Workspace 页可按当前 project 打开导入列表，并沿用 untargeted fresh workspace 规则。
- M-21 标题链路、既有 sheet、provisioning 和 workspace/tab 导航均直接复用；P1 仅让 Home 的既有异步 project 注册正确参与 sheet 完成状态。
- 异步 Home completion 的 rejection/no-navigation 与共享 sheet 的失败可见性已由纯 seam 和组件组合回归覆盖；17 条精确 M-22 路径已暂存且 staged 双轴审查通过。用户明确将 Linux/CI Playwright 延后，不再作为当前 Windows 主场景提交门禁；Git commit 与 push 未获授权。

## Review Verdict

| 轴                    | 结论                    | 证据                                                                                         |
| --------------------- | ----------------------- | -------------------------------------------------------------------------------------------- |
| Spec 质量与需求完成度 | `PASS`                  | P1 异步完成合同和 Home failure 组件可见性已覆盖；完整 Home 页面 E2E 仍是显式残余测试缺口     |
| Spec-Source Fidelity  | `PASS`                  | 当前工作树、`origin/main`、`upstream/main`、server 筛选/provisioning 与 M-21 diff 已核对     |
| Implementation        | `PASS`                  | 当前 context、untargeted sheet、awaited Home completion 和 imported workspace/tab 导航已接通 |
| Verification          | `PASS / LINUX DEFERRED` | 定向回归 `96/96`、static、格式、diff 与 staged review 通过；Linux Playwright 由用户明确延后  |

## Plan-Execution Diff

- 为遵守 `docs/testing.md` 的纯单元 seam 规则，禁用态、导航参数与类型化错误放在 colocated model 中测试；真实入口、sheet 和 cwd 接线由 Playwright 用例覆盖。
- 最终审查把共享 sheet 的 Host query identity 与成功回调顺序纳入范围；P1 进一步使 `onImported` 成为 awaited Promise seam，并以真实 sheet 加 Home completion helper 的组件组合回归覆盖 project 注册失败可见性。完整 Home 页面 E2E 仍等待可导入的确定性 provider fixture；server、protocol、persistence 与三个入口的 workspace 归属合同未改变。

## Change Log

- `2026-07-25`：初建 M-22 时误把目标收窄为 fresh workspace 到 agent tab 的组合回归。
- `2026-07-25`：按用户纠正重写为 New Workspace 页导入入口；保留既有入口行为，新增当前 project 列表、untargeted import 和成功导航合同。
- `2026-07-25`：完成本地实现、定向验证与 desktop/compact smoke；Review PASS，尚未 stage、commit 或 push。
- `2026-07-25`：修复 recent-session 跨 Host cache identity、同步回调失败可见性和缺失 workspace ID 错误类型。
- `2026-07-25`：重开 P1 并修复异步 Home project 注册失败：`onImported` Promise 在 close 前完成；初版 JSDOM/mock 可见性测试随后移除，改为 pure completion seams。
- `2026-07-26`：Linux E2E 在 `tencent-ssh` 隔离容器中于 `npm ci` 后因 Docker 存储耗尽停止；清理临时容器和副本，不将该结果记为测试通过。
- `2026-07-26`：P1 pure seam 回归通过 `95/95`；typecheck、lint 与 `git diff --check HEAD` 通过，17 条精确路径已暂存，待格式复验、staged review 和 Linux Playwright，仍不提交或 push。
- `2026-07-26`：补真实 sheet 与 Home completion helper 的失败可见性组件回归，sheet 增至 `18/18`、定向合计 `96/96`；typecheck 与 lint 再次通过。
- `2026-07-26`：第二次 Linux 隔离容器在 detached `npm ci --ignore-scripts` 后遇到远端 sshd banner 超时；Playwright 未启动，容器待主机恢复后检查和清理，不给最终提交结论。
- `2026-07-26`：17 条精确 M-22 路径重新暂存；17 文件格式、staged/worktree diff check 与 staged 规范/Spec 双轴审查通过，未发现新代码问题。
- `2026-07-26`：用户明确以 Windows 为主要使用场景，将 Linux Playwright 延后；远端隔离容器已不存在，本地临时副本已删除。当前 staged diff 可提交，仍未 commit 或 push。

## Resume / Handoff

- 当前状态：P1 本地修复与 `96/96` 定向回归已完成；主 daemon `6767` 未连接或重启。
- 当前无阻塞提交项；Linux Playwright、完整 Home 页面与 import/navigation E2E 作为后续残余验证，仍缺默认 provider fixture。
- 下一步：用户授权后提交当前 17 路径；不 push。
```

### 10.3 原 `findings.md`

```text
# New Workspace 页导入会话入口调查发现

本文件记录 `M-22` 的源码事实、入口差异、默认归属规则和 M-21 复用判断。合同见 `SPEC.md`，当前门禁见 `task_plan.md`，动作记录见 `progress.md`。

## Execute 结论

- 页面入口已按研究结论接通：当前 project cwd 进入既有 sheet，request 保持 untargeted，成功导航只使用 import response 的 workspace/agent 身份。
- 本地实现没有修改 server、protocol 或 persistence；Home 的正常列表范围、untargeted placement 和成功导航未改，P1 仅修正其 project 注册失败回传。M-21 标题链路可直接复用的判断成立。
- P1 定向回归 `96/96`、typecheck、lint、17 文件格式、diff check 与精确 staged 双轴审查已通过。用户明确将 Linux Playwright 延后，不作为当前 Windows 主场景提交门禁；隔离环境已清理。

## 任务绑定

| 字段        | 锚点                                                                    |
| ----------- | ----------------------------------------------------------------------- |
| task_id     | `0008`                                                                  |
| Parent Spec | [0002/M-22](../0002_fork改进与主线覆盖总控/SPEC.md#12-子-spec-抽取合同) |
| 关联任务    | [0005/M-21](../0005_导入会话标题传递/SPEC.md)                           |

## F1 - Git 与上游基线

| 事实                                                                                                            | 证据                          | 结论                                |
| --------------------------------------------------------------------------------------------------------------- | ----------------------------- | ----------------------------------- |
| `HEAD=084dca00b`，相对 `origin/main=b64f4f357` ahead 1                                                          | Git refs                      | ahead 提交是已完成的 M-21           |
| 最新本地 `upstream/main=65633004b`                                                                              | Git ref 与此前 `ls-remote`    | 上游复核基线已更新                  |
| `origin/main`、`upstream/main`、Research 基线 `084dca00b` 的 New Workspace screen 均未引用 `ImportSessionSheet` | `git grep` 与基线源码         | New Workspace 导入入口确实缺失      |
| 两条远端均已有 `runInImportWorkspace()` 的 untargeted fresh workspace 规则                                      | `git grep` 与当前源码         | server 默认行为不是 M-22 新功能     |
| `084dca00b` 增加 import title 传递但未修改 New Workspace screen                                                 | `git diff origin/main...HEAD` | M-21 可复用，不能替代 M-22 页面入口 |

## F2 - 三种入口的当前合同

| 入口                           | list `cwd`               | request `workspaceId` | 结果                                                     |
| ------------------------------ | ------------------------ | --------------------- | -------------------------------------------------------- |
| Home / Open Project            | 省略                     | 省略                  | Host 全局列表；按 session cwd 创建 fresh workspace       |
| Workspace 菜单                 | 当前 workspace directory | 当前 workspace ID     | 当前 workspace 列表；导入为该 workspace 的 agent tab     |
| New Workspace（Research 基线） | 尚无入口                 | 尚无 request          | M-22 应使用当前 project cwd，但保持 untargeted placement |

用户指出的“不同入口有不同标签页和 workspace 行为”与源码一致。M-22 不统一这些行为，也不把 Home 或 Workspace 入口改成当前 project 模式。

## F3 - New Workspace 已有当前项目上下文

| 位置                              | 已确认事实                                                                                             | 对 M-22 的意义                                    |
| --------------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------- |
| `packages/app/src/app/new.tsx`    | route 接收 `serverId/dir/name/projectId`                                                               | 项目入口可预选 Host 与 project                    |
| `new-workspace/project-picker.ts` | `selectedSourceDirectory` 由 `getHostProjectSourceDirectory(selectedProject, selectedServerId)` 得到   | 无需新增 project lookup 或从路径反推 UI selection |
| `new-workspace-screen.tsx`        | 已有 `selectedServerId`、runtime `client`、`isConnected`、`selectedProject`、`selectedSourceDirectory` | 导入 entry 只需消费现有 context                   |
| `new-workspace-screen.tsx`        | Research 基线只渲染 project/host/isolation/base 与 Composer                                            | 精确缺口是导入操作和 sheet/navigation 状态        |

## F4 - 当前项目列表筛选

- `ImportSessionSheet` 在收到 `cwd` 时，对每个启用 Provider 调用 `fetchRecentProviderSessions({ cwd, providers, limit })`。
- recent-session React Query key 由 `serverId`、`cwd` 和 Provider 共同确定；同路径、同 Provider 的不同 Host 不再共享缓存结果。
- `listImportableProviderSessions()` 把 request cwd 传给 provider manager，并再次用 `createRealpathAwarePathMatcher(request.cwd)` 过滤返回 session。
- path matcher 比较 lexical 与可解析 realpath 变体，目标是路径等价，不是目录树包含关系。
- 因此把 `selectedSourceDirectory` 传给 sheet 可以得到当前 project root 的 Provider session 列表；不能传 `null`，否则会退化为 Home 的 Host 全局列表。

## F5 - untargeted import 的 workspace/project 默认规则

- `ImportSessionSheet` 只在 `workspaceId` prop truthy 时把该字段放进 `importAgent()`；New Workspace 不提供该 prop 即为 untargeted import。
- `runInImportWorkspace()` 在没有 requested workspace 时调用 `createWorkspaceForDirectory(input.cwd, input.initialTitle)`。
- `createWorkspaceForDirectory()` 每次调用 `generateWorkspaceId()`，即使同 cwd 已有 workspace 也创建 fresh opaque workspace。
- 没有显式 `projectId` 时，provisioning 通过 `getOrCreateActiveByRoot()` 复用同 root 的 active project；正常 current-root 路径会落在当前 project 下。
- fresh workspace 使用 checkout/local placement；页面的 worktree isolation、base ref、prompt 和附件均不参与 import。
- symlink 别名可通过列表的 realpath 筛选，但 project registry 的 exact-root allocation 仍以路径等价规则为准。该极端边界尚未证明，应避免把它写成已保证的跨别名 project identity。

## F6 - 成功导航

- `importAgent()` 返回完整 agent snapshot，其中 `workspaceId` 是 server 创建并传给 agent manager 的权威 ID。
- `navigateToWorkspace()` 已被 New Workspace 创建链路使用，支持传入 agent tab target。
- M-22 可直接用 `{ serverId, workspaceId: agent.workspaceId, target: { kind: "agent", agentId: agent.id } }` 导航，不需要先 `project.add`、按 cwd 查 workspace 或经过 Home agent route。
- import response 缺失 workspace ID 时，entry 抛出携带 `agentId` 的 `ImportedSessionWorkspaceMissingError`；sheet 在回调成功前不会关闭，因此该失败会显示为可见的 mutation error。
- 这条导航不会改变另外两个入口的现有策略。

## F7 - 0005/M-21 复用边界

| 范围                        | 复用结论                                                           |
| --------------------------- | ------------------------------------------------------------------ |
| Provider title 到 request   | 直接复用当前 `ImportSessionSheet` 的 `workspaceTitle: entry.title` |
| server title 三态           | 直接复用 M-21 的 omitted/null/string 语义与 capability gate        |
| workspace/project placement | 使用更早主线默认规则，不归因于 M-21                                |
| tab navigation              | 使用既有 workspace tab model，不归因于 M-21                        |
| New Workspace entry         | M-21 未实现，必须由 M-22 新增                                      |

## F8 - 最窄测试 seam

- `new-workspace-screen.tsx` 超过 2000 行且没有 screen-level test；为一个入口建立整屏 mock harness 成本和脆弱性过高。
- 一个 colocated entry 组件可以真实渲染 Button 与 `ImportSessionSheet`，只接收当前 server/client/cwd/disabled，并自行处理成功导航。
- 纯 entry model 覆盖没有 cwd 时禁用、返回 workspace/tab 导航和缺失 workspace ID；Playwright 覆盖入口、sheet 和当前 cwd。默认 daemon 尚无可选的 deterministic provider session，故 import request 的无 `workspaceId` 与真实导航仍是显式 E2E 缺口。
- `import-session-sheet.test.tsx` 复用现有 JSDOM harness，将真实 sheet 接到真实 Home completion helper；provisioning service tests 继续只作 server 回归基线。

## F9 - 最终审查问题与修复证据

| 审查问题                                 | RED 证据                             | 修复与 GREEN 证据                                                         |
| ---------------------------------------- | ------------------------------------ | ------------------------------------------------------------------------- |
| recent-session cache 未按 Host 隔离      | 切换 Host 后仍显示 `Host A session`  | pure query-root 回归加入 `serverId`，避免同 cwd/provider 的 Host 共享 key |
| 完成回调失败前 sheet 已关闭              | `onImported` 抛错后 sheet DOM 已卸载 | pure completion 回归在 rejection 时不调用 `onClose` 或 targeted tab       |
| 缺失 workspace ID 缺少可识别的错误上下文 | 原实现只抛出普通 `Error`             | `ImportedSessionWorkspaceMissingError` 携带 imported agent 的 `agentId`   |

额外文档漂移已同步修正：entry 测试路径由 `.test.tsx` 改为实际的 `.test.ts`；补充 Home failure 组件可见性后，P1 的 source-level 定向回归为 `96/96`。

## F10 - 异步 Home 完成回调

- 后续 staged review 证明 F9 的 callback failure 回归只覆盖同步 `throw`：`onImported` 被声明为 `void`，sheet 也未等待返回值。
- Home 的 `handleImported` 原先启动未等待的 `openImportedProject()`；其 `{ ok: false }` 结果会在 sheet 已关闭后被静默忽略。
- 修复后的 callback 类型为 `void | Promise<void>`，sheet 在 `onClose` 前等待它；Home 将 project 注册失败转换为 rejection。共享 completion seam 断言失败时不关闭/不打开 targeted tab，组件组合回归进一步断言真实 sheet 显示错误且不关闭、不导航。完整 Home 页面 E2E 仍需要真实可导入 provider-session fixture。

## 未验证项

| 项目                                                    | 当前判定         | Execute 时处理                                          |
| ------------------------------------------------------- | ---------------- | ------------------------------------------------------- |
| symlink alias session 是否仍复用 UI 当前 project record | 非主路径，未保证 | 不扩当前计划；若 normal path 红测失败则回到 Plan Review |
| 旧 daemon 不支持 M-21 title capability                  | 已有明确 gate    | 沿用 Update Host 空态，不新增降级路径                   |

## F11 - Linux E2E 执行边界

- 本机没有 WSL Linux 发行版；Windows global setup 不能作为 Linux E2E 证据。
- 用户授权后，`tencent-ssh` Docker context 使用一次性 Playwright `v1.56.1-noble` 容器，并只复制 `HEAD` 加 8 个 M-22 产品/E2E 文件，排除 `.dev`、`node_modules`、任务文档和无关未跟踪内容。
- 容器在 `npm ci` 阶段写入约 `621MB` 后，Docker 返回 `no space left on device`；目标 Playwright 尚未开始。已删除该容器和本地临时副本，不清理任何远程既有容器、镜像或卷。

## F12 - Home 失败可见性与第二次 Linux 重试

- 两个分离的 pure seam 测试不足以直接证明用户能在 sheet 中看到 Home project 注册失败；新增组件组合回归使用真实 `ImportSessionSheet` 和真实 `completeImportedProjectSession()`，断言错误文案可见、sheet 不关闭、agent 不导航。
- 默认 E2E daemon 仍没有确定性可导入 Provider session，因此完整 Home 页面 E2E 和完整 import/navigation E2E 仍是残余测试缺口；新增 Playwright 只覆盖 New Workspace 入口、sheet 与 current-project fetch cwd。
- 第二次 `tencent-ssh` 隔离容器已避开磁盘和生命周期脚本问题，但 detached 安装后 sshd 无法返回 banner，目标 Playwright 未启动。主机恢复后确认同名容器已不存在，本地临时副本已删除；用户明确将 Linux 验证延后。
```

### 10.4 原 `progress.md`

```text
# New Workspace 页导入会话入口进度

## 2026-07-25 初始立项（已被纠正）

- 初始判断误把 M-22 定义为“fresh workspace ID 到 agent tab 的组合回归”。
- 该判断确认了 server 默认规则和 M-21 复用边界，但把已存在的行为当成主要交付物，偏离了用户需要的 New Workspace 页面入口。
- 旧计划中的单个 server 组合测试不再是 M-22 的实施目标；未执行该测试修改。

## 2026-07-25 目标纠正与 Feature Spec 重写

- 用户纠正：核心目标是在 New Workspace 页新增“Import session”入口；默认加载当前 project sessions，并通过既有 untargeted import 在当前 project 下创建 fresh workspace 承接 imported agent/tab。
- 页面证据：route 和 screen 已有 `selectedServerId`、`selectedProject`、`selectedSourceDirectory`、runtime client 与连接状态，但没有 `ImportSessionSheet` 入口。
- 列表证据：sheet 会把 cwd 发给 `fetchRecentProviderSessions()`；server 使用 realpath-aware matcher 二次过滤。
- placement 证据：不传 `workspaceId` 时，server 每次生成 fresh workspace ID，并通过 active exact-root project allocation 复用当前 project。
- 导航证据：import response 已包含 agent 的权威 `workspaceId`，可直接交给 `navigateToWorkspace()` 和 agent tab target。
- 入口边界：Home 继续是 Host 全局 untargeted import；Workspace 菜单继续是当前 workspace targeted import；M-22 不统一或重写两者。
- 复用结论：M-21 的标题字段、三态语义和 capability gate 可直接复用；workspace/project placement 与 tab model 来自更早主线。
- 文档变更：任务目录更名为 `0008_新Workspace页导入会话入口`，四份记录全部重写；父 `0002` 同步改为页面入口缺口。
- 执行状态：`LOCKED`，等待精确 `Plan Approved`；未修改产品或测试文件。

## 当前验证

| 验收项                   | 状态    | 说明                                                                          |
| ------------------------ | ------- | ----------------------------------------------------------------------------- |
| Git/source/upstream 复核 | `PASS`  | 三个基线均无 New Workspace import entry；untargeted 默认规则存在              |
| 当前 project context     | `PASS`  | `selectedSourceDirectory` 来自当前 selected project/Host                      |
| 列表与 placement 链      | `PASS`  | cwd 双层筛选、fresh workspace、active root project 复用已由源码和既有测试确认 |
| M-21 复用边界            | `PASS`  | 只复用标题/capability；不归因 workspace/navigation                            |
| 文档格式与链接           | `PASS`  | 11 个相关文件格式通过；M-21/M-22 父子路径与 anchors 可达；M-22 旧引用为零     |
| 总表统计与证据闭包       | `PASS`  | 64 个唯一 ID；四组 `23/10/22/9`；E01-E23 均有定义                             |
| typecheck/lint           | `PASS`  | typecheck 退出码 0；lint 为 0 warnings、0 errors；无生成文件漂移              |
| Git 范围                 | `PASS`  | `git diff --check` 通过；仅保留既有 0005 改动和未跟踪任务文档                 |
| 产品定向测试             | not run | 本轮只获授权修正文档；产品 Execute 仍锁定                                     |
| 全量测试                 | not run | 项目明确禁止本地全量测试                                                      |

## 2026-07-25 Plan Approved 与 Execute 启动

- 用户回复精确字样 `Plan Approved`；M-22 的产品代码与定向测试执行门解除，Git stage、commit、push 仍未授权。
- 当前核心目标不变：New Workspace 页使用当前 project cwd 打开既有 import sheet，以 untargeted request 创建 fresh workspace，并导航到返回 agent 的 workspace/tab。
- 当前阶段进入 T1：先建立用户可观察 seam 的失败回归，再做最小 App 入口与接线；server、protocol、persistence 和既有导入入口保持零改动。
- 已加载项目要求的 `sdd-riper-one-light`、`karpathy-guidelines` 和满足自主触发条件的 `tdd`；测试仍服从 `docs/testing.md` 的 ports/adapters 或真实 E2E 边界。

## 2026-07-25 Execute 与 Review 完成

- 新增 `NewWorkspaceImportSessionEntry`，复用通用 Button 和既有 `ImportSessionSheet`；页面只传 `selectedServerId`、runtime client、`selectedSourceDirectory` 和阻塞状态。
- sheet 调用明确不传 `workspaceId`。成功后通过纯 helper 使用 imported agent 的权威 `workspaceId` 与 `{ kind: "agent", agentId }` 导航；兼容 schema 返回缺失 workspace ID 时显式拒绝，不建立 fallback。
- 为避免 Node 单测加载 React Native Flow 源，纯禁用/导航 seam 放入同目录 `import-session-entry-model.ts`，没有引入组件 mock。
- 新增真实 UI Playwright 用例，断言入口可见可用、sheet 打开，并从 WebSocket frame 观察 fetch request 的 cwd 等于当前 project root。
- 验证通过：entry `3/3`、import sheet `17/17`、workspace provisioning `32/32`、`npm run typecheck`、`npm run lint`（0 warnings / 0 errors）、目标文件格式化和 `git diff --check`。
- Playwright 用例未在 Windows 本机执行：现有 global setup 依赖 Unix `which`，并以裸 `spawn("npx")` 启动 Metro，分别失败于 command not found 与 `ENOENT`；未为 M-22 修改 harness，留给 Linux/CI。
- 隔离 smoke 使用 `6768` daemon 与 `8081` Expo Web，未触碰 `6767`。`1440x900` 与 `390x844` 下入口均无重叠，desktop modal 与 compact bottom sheet 均可打开，列表实际显示 `E:\Code\paseo` project sessions。
- Review：`PASS WITH WINDOWS E2E LIMITATION`。server、protocol、persistence、Home 导入和 Workspace targeted import 均未修改；工作树未 stage、commit 或 push。

## 2026-07-25 最终审查修复启动

- 最终 diff 审查撤销此前预写的 PASS：recent-session query key 缺少 `serverId`，同 cwd/Provider 的跨 Host 缓存会复用；`onImported` 抛错发生在 sheet 关闭之后，失败状态不可见；缺失 workspace ID 只抛普通 `Error`，没有携带结构化 agent 上下文。另发现 Spec 的 seam 测试命令误写为 `.test.tsx`。
- 用户已明确授权修复三项代码问题并补定向测试。当前核心目标仍是 New Workspace 页按当前 Host/project 导入会话，范围只扩到既有 `ImportSessionSheet` 的 Host cache identity、后置回调失败顺序和 entry 的类型化错误。
- 当前状态：先建立跨 Host cache isolation 与回调失败可见性的 RED 回归；尚未 stage、commit 或 push。

## 2026-07-25 最终审查修复与复审完成

- 跨 Host cache isolation 回归先 RED：同 cwd/provider 切换到 Host B 后仍显示 `Host A session`；query key 加入 `serverId` 后 GREEN。
- 完成回调失败回归先 RED：`onImported` 抛错前 sheet 已关闭、DOM 为空；完成回调移到 `onClose` 前后 GREEN，错误文案保持可见且 `onClose` 未调用。
- 缺失 workspace ID 改为 `ImportedSessionWorkspaceMissingError`，错误实例携带 imported agent 的 `agentId`。
- 最终定向测试通过：entry `3/3`、sheet `19/19`、provisioning `32/32`，合计 `54/54`。
- `npm run typecheck` 通过；`npm run lint` 为 0 warnings、0 errors；12 个目标文件的 `format:files -- --check` 和 `git diff --check` 通过，无生成文件漂移。
- 根级 `format:check` 脚本固定扫描 `.`，即使追加路径仍报告 2934 个全仓基线格式问题；本轮没有运行全仓格式化，也没有修改 M-22 之外的文件来处理该基线。
- Review：`PASS WITH WINDOWS E2E LIMITATION`。新增 Playwright 用例仍因现有 Windows harness 的 Unix `which` 与裸 `spawn("npx")` 限制未执行；本轮未重启 `6767`，未 stage、commit 或 push。

## 2026-07-25 P1 异步完成回调修复启动

- 后续 staged review 发现：`ImportSessionSheet` 的 `onImported` 类型为同步 `void` 且未等待；Home 的 `handleImported` 以 fire-and-forget 方式执行 `openImportedProject()`，因此异步失败仍会在 sheet 关闭后发生。
- 用户授权让 `onImported` 支持并等待异步结果、补 Home 失败可见性测试、同步任务状态日期、重新暂存审查并在 Linux/CI 执行 Playwright；commit 与 push 仍未授权。

## 2026-07-25 P1 异步完成回调本地验证

- 初版通过 JSDOM/mock 复制 Home callback 的失败可见性测试随后被审查否决并移除；它不绑定真实 Home 实现，且违反 `docs/testing.md` 的测试边界。
- `onImported` 改为 `void | Promise<void>` 并在 `onSuccess` 中等待；Home 回调改为等待真实 project 注册 completion，失败时抛回 sheet。
- 替代回归：共享 sheet completion helper 覆盖异步等待与失败时不 close/tab，Home completion helper 覆盖 project 注册失败拒绝和不导航；直接 Home error UI E2E 仍需要可导入的默认 provider fixture。
- Linux E2E 尚未运行：本机没有 WSL 发行版；当前 Docker context 为远程 `tencent-ssh`，未在未获授权前复制未提交工作树到该环境。

## 2026-07-26 P1 暂存与 Linux E2E 执行

- 用户授权后，从 `HEAD` 导出受跟踪源码并仅叠加 8 个 M-22 产品/E2E 文件；副本排除 `.dev`、`node_modules`、任务文档、Git 历史和无关未跟踪内容。
- `tencent-ssh` 上的 Playwright `v1.56.1-noble` 容器在 `npm ci` 后耗尽 Docker 存储，后续 `docker exec` 返回 `no space left on device`；目标用例没有开始，不能标记 PASS 或 FAIL。
- 已删除唯一创建的远程容器（约 `621MB` 可写层）和本地临时副本；没有停止、删除或清理任何远程既有容器、镜像、卷或主 daemon。
- 下一步：重跑静态检查后精确暂存 17 条 M-22 路径并完成 staged review；Linux E2E 需在有足够磁盘的环境重新执行。

## 2026-07-26 P1 纯 seam 回归与记录校正

- 新增 `buildRecentProviderSessionsQueryRoot()` 与 `completeImportedSession()`，使 cache identity 和 awaited completion 可在不挂载组件的情况下测试。
- 新增 `completeImportedProjectSession()`，由真实 Home callback 调用；其失败会拒绝回调，因而共享 sheet mutation 保持错误状态而不提前关闭。
- 定向回归：sheet view model `34/34`、Home completion `9/9`、既有 sheet `17/17`、entry model `3/3`、provisioning `32/32`，合计 `95/95`。
- 已通过：本轮 typecheck、lint 与 `git diff --check HEAD`。17 条精确路径已暂存；尚待：17 文件格式复验、staged review、隔离 Linux Playwright；不提交或 push。

## 2026-07-26 Home 失败可见性回归与 Linux 重试阻塞

- 补充真实 `ImportSessionSheet` 与 `completeImportedProjectSession()` 的组件组合回归：import 成功后 project 注册失败时显示 sheet 错误，且不关闭、不导航。sheet `18/18`，定向回归合计 `96/96`。
- `npm run typecheck` 再次通过；`npm run lint` 为 0 warnings、0 errors；没有生成文件漂移。
- `tencent-ssh` 上复用 `paseo-m22-e2e-20260726-1150` 隔离容器，以 `npm ci --ignore-scripts --prefer-offline` 避开先前生命周期脚本 `spawn ENOMEM`。attached SSH 在依赖下载后重置，改为 detached 重跑后远端 sshd 持续无法返回 banner；90 秒连接窗口仍超时。
- Playwright 目标命令尚未启动，不能记为 PASS 或 FAIL；主机恢复前也无法确认安装结果或清理该隔离容器。最终提交结论保持阻塞，Git commit 与 push 未执行。
- 17 条精确 M-22 路径已重新暂存；17 文件格式、`git diff --cached --check`、`git diff --check` 与 staged 规范/Spec 双轴审查通过，未发现新代码问题。0005 和其他未跟踪任务内容未暂存。

## 2026-07-26 Windows 主场景提交裁决

- 用户明确先不执行 Linux Playwright，以 Windows 为主要使用场景，接受该用例和完整 Home/import/navigation E2E 作为后续残余验证。
- `tencent-ssh` 恢复后确认同名隔离容器已不存在；本地临时副本 `paseo-m22-linux-20260726-1150` 已删除，隔离环境清理完成。
- 当前 17 路径 staged diff 可提交；Git commit 与 push 尚未执行。
```

### 10.5 原 `task_plan.md`

```text
# New Workspace 页导入会话入口任务计划

## Spec 绑定

| 字段           | 值                                                                      |
| -------------- | ----------------------------------------------------------------------- |
| task_id        | `0008`                                                                  |
| 需求与决策权威 | `SPEC.md#new-workspace-页导入会话入口-feature-spec`                     |
| Done Contract  | `SPEC.md#done-contract`                                                 |
| Parent Spec    | [0002/M-22](../0002_fork改进与主线覆盖总控/SPEC.md#12-子-spec-抽取合同) |

## 当前状态

- 阶段：`Review Complete / READY TO COMMIT`
- 执行门：`OPEN`
- 所需授权：已于 `2026-07-25` 收到精确 `Plan Approved`；`2026-07-26` 完成 P1 修复与 staged review，用户随后明确延后 Linux E2E
- 最近进度：`progress.md#2026-07-26-windows-主场景提交裁决`

## Checklist

- [x] 核对 New Workspace route、选中 project、source directory、Host 和 client context。
- [x] 核对三种现有导入入口的 cwd、workspace target 和导航差异。
- [x] 核对当前 project 会话列表的 provider/server 双层 cwd 筛选。
- [x] 核对 untargeted import 的 fresh workspace 与 active project root 复用规则。
- [x] 区分 `0005/M-21` 可复用标题链路与 M-22 必须新增的 App 入口。
- [x] 把父 `0002/M-22` 从组合回归改为页面入口缺口。
- [x] T1：新增 colocated import entry，并接入 New Workspace 当前 context 与成功导航。
- [x] T2：新增 entry 定向测试并复跑既有 sheet/provisioning 回归。
- [x] T3：运行 typecheck、lint、格式、diff 和 desktop/compact smoke。
- [x] T4：完成 Review，回写实际偏差、验证和父表状态。
- [x] T5：修复 Host cache identity、回调失败可见性和验证文档漂移，重新完成 Review。
- [x] T6：让 `onImported` 等待异步 Home 完成回调，完成 failure UI 回归、静态检查与 staged review；Linux E2E 经用户明确延后，不作为当前 Windows 主场景提交门禁。

## 依赖与顺序

| 任务 | 依赖                                             | 完成证据                                                               |
| ---- | ------------------------------------------------ | ---------------------------------------------------------------------- |
| T1   | 用户 `Plan Approved`；当前 `084dca00b` M-21 提交 | `PASS`：页面打开 current-project sheet；未传 `workspaceId`             |
| T2   | T1                                               | `PASS`：entry `3/3`、sheet `19/19`、provisioning `32/32`               |
| T3   | T2                                               | `PASS`：typecheck/lint/format/diff 与两个 viewport smoke               |
| T4   | T1-T3                                            | `PASS`：Spec/progress/父表已同步；Windows E2E 限制已明确记录           |
| T5   | 最终 diff 审查                                   | `PASS`：两条新增回归先 RED 后 GREEN；定向测试合计 `54/54`              |
| T6   | P1 异步 Home completion                          | `PASS`：定向回归 `96/96`、static 与 staged review PASS；Linux E2E 延后 |

## 执行约束

- T1-T5 已获用户明确授权；只允许修改批准的 App 入口、定向测试和任务记录。
- server、protocol、persistence 和 routing 默认零改动；正常 exact-root 行为不成立时停止并重新审批。
- 不改变 Home 或 Workspace import 入口，不建立共享导入策略抽象。
- 不运行全量测试，不触碰主 daemon `6767`，不 commit 或 push。
```
