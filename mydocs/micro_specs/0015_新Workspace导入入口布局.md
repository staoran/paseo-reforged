# 新 Workspace 导入入口布局 Micro Spec

## 0. 状态与索引

| 字段               | 值                                                   |
| ------------------ | ---------------------------------------------------- |
| task_id            | `0015`                                               |
| spec layer         | `Feature Spec`                                       |
| task status        | `已收口`                                             |
| document status    | `Completed`                                          |
| depth              | `standard`                                           |
| phase              | `Review`                                             |
| Execution Approval | `Approved`                                           |
| Approval Source    | `User (2026-07-30)`                                  |
| file path          | `mydocs/micro_specs/0015_新Workspace导入入口布局.md` |
| parent spec        | `N/A`                                                |
| superseded by      | `N/A`                                                |
| created / updated  | `2026-07-30 09:19`                                   |

## 1. 目标与完成契约

- 当前理解：New Workspace 页的导入会话入口在 desktop 不应独占一行；compact 仍需避免横向溢出。
- 核心目标：只修布局，不改变任务 `0008` 已验证的导入、禁用、cwd、fresh workspace 和导航语义。
- Done Contract：desktop (`md+`) 中入口与 Project/Host/Isolation/Base 位于同一控制带；compact (`xs/sm`) 继续纵向排列且不横向溢出；两种布局下入口均可打开，并始终保留在同一父结构中。

## 2. 范围与事实

- 范围内：`new-workspace-screen.tsx` 的 form/secondary action 布局和现有 E2E 几何断言。
- 范围外：`ImportSessionEntry` 业务逻辑、server/protocol、28px 像素级按钮复刻、无 cwd 时从禁用改为隐藏。
- 当前任务单元：单一响应式布局纠偏；`parent spec=N/A`。
- 轻量评估：`standard`；一处产品布局和一条公共 UI 回归。
- 已确认事实：当前 `packages/app/src/screens/new-workspace-screen.tsx:2145` 把入口放在 `{formStack}` 后的独立 `secondaryActions`，所以所有宽度都独占一行；样式 owner 在 `:2223`。
- 老项目参考：`E:\Code\paseo-reclaude\packages\app\src\screens\new-workspace-screen.tsx:1953` 在 `md+` 同排、`xs/sm` 纵排。
- 已选方案：以结构稳定的父 View 包住现有 form stack 和 entry，仅在 desktop 横排；不把有状态 entry 移进断点分支。
- 风险与未知：现有通用 `sm` Button 为 32px，老项目为 28px badge；当前需求只包含布局，不顺带改尺寸。共享 `AdaptiveModalSheet` 会在打开状态跨 compact/desktop 时自行 dismiss，本任务不修改该公共生命周期，只保证页面不会通过断点条件分支额外重挂载入口。

## 3. 涉及文件与计划

| 文件                                                | 计划变化                                 | 事实源                  |
| --------------------------------------------------- | ---------------------------------------- | ----------------------- |
| `packages/app/src/screens/new-workspace-screen.tsx` | desktop 同排、compact 纵排、subtree 稳定 | 当前/老项目 screen 对照 |
| `packages/app/e2e/new-workspace-entry.spec.ts`      | 增加 desktop 同带与 compact 无溢出断言   | 现有 import E2E         |

1. 先用 `boundingBox()` 让 desktop/compact 几何验收 RED。
2. 只调整 screen 父布局，保留 entry props 和行为。
3. 运行目标 E2E、typecheck、lint、目标格式与 diff check。

## 4. 执行前检查点

- 当前目标：修复 desktop 独占一行，同时不回归 compact。
- 当前进度：方案与 UI seam 已由用户批准，进入 Execute。
- 当前动作是否仍服务核心目标：`是`；只调整响应式父布局并补充对应几何回归，不触及导入业务语义。
- 下一步：写 desktop/compact 几何 RED，再做最小布局调整。
- 风险与回退：若稳定父布局仍导致 sheet 重挂载，停止并回到布局结构审查。
- 验证方式：目标 Playwright + `390x844`/desktop smoke。
- TDD 判定、测试 seam 与验收行为：`TDD；New Workspace 公共几何与可操作入口。`
- seam 确认：`User`。
- Execution Approval / Source：`Approved / User (2026-07-30)`。

## 5. 执行与变更记录

- 实际改动：在 `new-workspace-screen.tsx` 增加稳定的 `controlBand`，`xs` 纵排、`md+` 横排；入口继续使用原 props 和同一 JSX 子树。E2E 拆为 desktop 与 compact 两个独立切片，分别验证几何、可操作性和 cwd 请求。
- 偏差与用户决策：初版长 E2E 需要关闭 sheet 后再跨断点，暴露共享 Close pressable 无 button role 以及 `AdaptiveModalSheet` 断点 dismiss；按任务边界拆成两个独立切片，不修改共享弹层。compact 不能从 Welcome 页直接使用 desktop sidebar helper，因此测试先在 desktop 进入目标页，再缩到 `390x844` 验证公开响应式行为。
- Change Log：`2026-07-29` 完成只读对照并建档；`2026-07-30` 用户批准方案与测试 seam；同日完成几何 RED、最小布局 Green、E2E 拆分及验证；双轴审查补齐 micro-spec 必填检查点，代码与测试无需修复。

## 6. 验证与完成判断

| 验收项              | 命令或步骤                                                                                                                      | 结果             | 证据                                                           |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ---------------- | -------------------------------------------------------------- |
| 当前/老项目结构对照 | 读取两份 `new-workspace-screen.tsx`                                                                                             | PASS             | 根因是显式 `secondaryActions`，不是断点失效。                  |
| desktop 几何 RED    | 目标 E2E 的同带中心差断言                                                                                                       | RED              | 旧布局中心差 `62px`，阈值为 `<=1px`。                          |
| desktop Green       | `rtk npm run test:e2e --workspace=@getpaseo/app -- e2e/new-workspace-entry.spec.ts --grep "lays out and opens import sessions"` | PASS，`1 passed` | 同带几何、sheet 打开和 selected cwd 请求均通过。               |
| compact Green       | `rtk npm run test:e2e --workspace=@getpaseo/app -- e2e/new-workspace-entry.spec.ts --grep "stacks and opens import sessions"`   | PASS             | 纵排、`390px` 无横向溢出及 sheet 打开均通过；退出码 `0`。      |
| App typecheck       | App workspace typecheck                                                                                                         | PASS             | 实现后通过。                                                   |
| 目标 lint           | 目标 screen/test lint                                                                                                           | PASS             | `0 errors`；screen 仅有 4 个既有 array-type warning。          |
| 全 App lint         | App workspace lint                                                                                                              | BLOCKED（无关）  | 6 个既有 `react/display-name` 错误，不由本任务引入。           |
| 格式与 diff         | `npm run format:files -- <两个目标文件>`；`git diff --check -- <两个目标文件>`                                                  | PASS             | 最终格式检查与空白错误检查均通过。                             |
| 审查静态复验        | 目标 lint；App typecheck；三个所有权文件格式检查；两个代码文件 `git diff --check HEAD`                                          | PASS             | lint `0 warnings / 0 errors`；typecheck `ok`；其余退出码 `0`。 |

- 未验证项与原因：打开 sheet 后跨断点的保持状态属于共享 `AdaptiveModalSheet` 生命周期，超出本任务边界。
- 剩余风险：共享 sheet 在打开状态跨 compact/desktop 时仍会 dismiss；页面入口自身保持稳定父结构。
- Done Contract 是否由证据满足：`是；请求的 desktop/compact 布局与两端可操作性均由独立 E2E 证明。`

## 7. 恢复与同步

- 状态说明：`已收口 / Review / Completed`。
- 当前卡点：无。
- 下一步唯一动作：根 Agent 将任务状态同步到 `mydocs/todolist.md`。
- Resume / Handoff：无需恢复实现；如扩大到 sheet 跨断点保持打开，应新建独立任务并审查共享 `AdaptiveModalSheet`。
- Project Sync Candidates：`无`。
- 长期文档同步：`N/A`。

### 提交记录

| 提交信息（Commit Message）                              | 提交脚注（Commit Footer） | 关联改动或阶段  | 文档同步状态 | 备注             |
| ------------------------------------------------------- | ------------------------- | --------------- | ------------ | ---------------- |
| `fix(app): align import action with workspace controls` | `N/A`                     | `0015 / Review` | `已同步`     | 用户授权独立提交 |
