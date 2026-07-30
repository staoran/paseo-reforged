# Workspace 顶部显示分支名 Micro Spec

## 0. 状态与索引

| 字段               | 值                                                   |
| ------------------ | ---------------------------------------------------- |
| task_id            | `0021`                                               |
| spec layer         | `Feature Spec`                                       |
| task status        | `已收口`                                             |
| document status    | `Completed`                                          |
| depth              | `fast`                                               |
| phase              | `Review`                                             |
| Execution Approval | `Approved`                                           |
| Approval Source    | `User (2026-07-30)`                                  |
| file path          | `mydocs/micro_specs/0021_Workspace顶部显示分支名.md` |
| parent spec        | `N/A`                                                |
| superseded by      | `N/A`                                                |
| created / updated  | `2026-07-30 10:00`                                   |

## 1. 目标与完成契约

- 当前理解：Workspace 顶部标题应显示当前 Git 分支，而不是导入会话产生的默认 workspace/session name。
- 核心目标：只修改 header source projection，复用已有实时 branch 数据。
- Done Contract：有效 branch 优先显示；pending/error 使用有效缓存 branch；detached `HEAD`、空 branch 或旧 daemon 缺字段回退项目名；非 Git workspace 保留 workspace name；重复 subtitle 隐藏。

## 2. 范围与事实

- 范围内：workspace header title 优先级、source-of-truth 单测和既有 header E2E 契约。
- 范围外：浏览器 document title、agent/terminal tab label、protocol/daemon、workspace name 持久化。
- 当前任务单元：纯 header projection；`parent spec=N/A`。
- 轻量评估：`fast`；纯 projection、现有稳定测试 seam 和一条既有 E2E 契约同步。
- 已确认根因：`packages/app/src/screens/workspace/workspace-header-source.ts:39-46` 直接返回 `workspace.name`；同文件 `:59-70` 已得到 `currentBranchName`，但只供菜单使用。
- 会话名链：import sheet 将 session title 作为 workspace title，registry 采用 title priority，再投影为 descriptor name；因此 header 显示会话名是确定行为。
- 数据链事实：checkout query/cache/daemon observer 已处理 branch 更新，无需新字段或订阅。
- 老项目参考：老项目固定显示 `projectDisplayName`，只证明 header 不应消费 session name；它没有 branch-title 实现。
- 已选优先级：ready live branch > pending/error cached runtime branch > Git project display name；non-git workspace name。
- 实现结论：只调整 header source projection；ready 使用有效 live branch，pending/error 使用有效 cached branch，Git fallback 使用项目名，non-git 继续使用 workspace name。
- 风险与未知：未改变 `isGitCheckout` 的来源，explorer/header actions 继续只受 ready checkout 事实控制。

## 3. 涉及文件与计划

| 文件                                                                   | 实际变化                                                             | 事实源             |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------- | ------------------ |
| `packages/app/src/screens/workspace/workspace-header-source.ts`        | 实现 live/cached branch、Git project fallback 与 subtitle 去重优先级 | 现有 branch source |
| `packages/app/src/screens/workspace/workspace-source-of-truth.test.ts` | 覆盖 branch 优先级、cache、detached/空 branch、旧 daemon 和 non-git  | 现有纯 seam        |
| `packages/app/e2e/branch-switcher.spec.ts`                             | 将旧的自定义标题断言改为验证 header 随 `main -> dev` 实时更新        | 既有公开 UI seam   |

1. 为 imported title + `feat/live` 建立 RED，并覆盖 fallback。
2. 只修改纯 projection，不触碰 route/header 组件。
3. 运行目标 Vitest、branch-switcher E2E、typecheck、lint 和格式检查。

## 4. 执行前检查点

- 当前目标：Git workspace 顶部显示 branch。
- 当前进度：根因、数据源和 source output seam 已由用户确认。
- 下一步：为 branch title 与 fallback 写 RED，再修改纯 projection。
- 风险与回退：若 branch source 在旧 daemon 下不可区分 Git/non-Git，回退项目名，不猜 session title。
- 验证方式：现有 source-of-truth 单测。
- TDD 判定、测试 seam 与验收行为：`TDD；workspace header source 的公开输出。`
- seam 确认：`User`。
- Execution Approval / Source：`Approved / User (2026-07-30)`。

## 5. 执行与变更记录

- 实际改动：新增 branch name 规范化；Git header 的 ready 标题优先 live branch，pending/error 优先 cached runtime branch，无有效 branch 时回退项目名；non-git 保留 workspace name；标题与副标题相同则隐藏副标题。补齐 source-of-truth 回归测试。
- Review 修复：生产实现无需调整。原测试分别覆盖 live 与 cache，但没有构造二者冲突，无法证明优先级；也没有证明 ready 的 `HEAD`、空值或缺失 branch 不会误用 stale cache。现已加入这些反例，并覆盖旧 daemon 缺少 `gitRuntime` 时的 error 回退。集成检索同时发现 `branch-switcher.spec.ts` 仍断言旧的自定义 workspace 标题，已改为验证 header 随真实分支从 `main` 更新为 `dev`。
- 偏差与用户决策：本任务不修改浏览器/标签页标题，标签字号另见独立任务 `0022`；未触碰 checkout observer、协议或持久化链路。
- Change Log：`2026-07-29` 完成只读调查并建档；`2026-07-30` 用户批准方案与测试 seam；同日完成实现、聚焦验证与 Review，并补强优先级反例。未保留独立 RED 输出，因此不将计划中的 RED 计作验证证据。

## 6. 验证与完成判断

| 验收项              | 命令或步骤                                       | 结果 | 证据                                                                                                                 |
| ------------------- | ------------------------------------------------ | ---- | -------------------------------------------------------------------------------------------------------------------- |
| 标题优先级与回退    | 目标 Vitest：`workspace-source-of-truth.test.ts` | PASS | `12/12`；覆盖 live > stale cache、pending/error cache、ready/cache 的 HEAD/空值、旧 daemon 和 Git/non-git fallback。 |
| Review 文件级静态   | 目标 lint、format check、`git diff --check`      | PASS | 两个 TypeScript 文件 `0 warnings / 0 errors`；三个所有权文件格式通过；目标 tracked diff check 通过。                 |
| Header 实时更新 E2E | 目标 Playwright：`branch-switcher.spec.ts`       | PASS | `1 passed`；自定义 workspace 标题后 header 仍显示 `main`，切换后更新为 `dev`。                                       |
| 最终根级静态检查    | `rtk npm run typecheck`、`rtk npm run lint`      | PASS | 审查与 E2E 修复后通过；lint 为 `0 warnings / 0 errors`。                                                             |

- 未验证项与原因：未收集 iOS/Android/desktop/web 四平台截图；本轮浏览器 E2E 已覆盖 live observer 驱动的 header 更新。未运行全量测试，符合项目仅运行受影响文件的规则。
- 剩余风险：旧 daemon/运行时若不给 branch，会按合同显示 Git 项目名；Native 共享 projection 已由单测覆盖，但未做设备视觉 smoke。
- Done Contract 是否由证据满足：`是；12 个聚焦测试覆盖标题优先级、detached/空值、缓存、旧 daemon 和 non-git 合同，浏览器 E2E 验证真实分支更新，最终静态检查通过。`

## 7. 恢复与同步

- 状态说明：`已收口 / Completed / Review`。
- 当前卡点：无。
- 下一步唯一动作：无。
- Resume / Handoff：无需恢复；实现与聚焦验证已完成，未提交改动保留在当前工作区。
- Project Sync Candidates：`无`。
- 长期文档同步：`N/A`。

### 提交记录

| 提交信息（Commit Message）                      | 提交脚注（Commit Footer） | 关联改动或阶段  | 文档同步状态 | 备注             |
| ----------------------------------------------- | ------------------------- | --------------- | ------------ | ---------------- |
| `fix(app): show git branch in workspace header` | `N/A`                     | `0021 / Review` | `已同步`     | 用户授权独立提交 |
