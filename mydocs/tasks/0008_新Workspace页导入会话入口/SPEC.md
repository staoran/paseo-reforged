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
