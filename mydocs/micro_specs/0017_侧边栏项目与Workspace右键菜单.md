# 侧边栏项目与 Workspace 右键菜单 Micro Spec

## 0. 状态与索引

| 字段               | 值                                                         |
| ------------------ | ---------------------------------------------------------- |
| task_id            | `0017`                                                     |
| spec layer         | `Feature Spec`                                             |
| task status        | `已收口`                                                   |
| document status    | `Completed`                                                |
| depth              | `standard`                                                 |
| phase              | `Review`                                                   |
| Execution Approval | `Approved`                                                 |
| Approval Source    | `User (2026-07-30)`                                        |
| file path          | `mydocs/micro_specs/0017_侧边栏项目与Workspace右键菜单.md` |
| parent spec        | `N/A`                                                      |
| superseded by      | `N/A`                                                      |
| created / updated  | `2026-07-30 03:35`                                         |

## 1. 目标与完成契约

- 当前理解：侧边栏项目和 workspace 行应通过右键打开与各自最右 kebab 按钮相同的菜单。
- 核心目标：接通现有 ContextMenu 基础设施和菜单 owner，不复制 handler 或创建第二套菜单定义。
- Done Contract：Web/Electron 的项目行、project workspace 行、status workspace 行均可右键；菜单项、条件、禁用态和动作与 kebab 一致；浏览器默认菜单不出现；Native 仍只用 kebab。

## 2. 范围与事实

- 范围内：三类 sidebar row 的 ContextMenu wiring、项目/workspace action 复用和目标 E2E。
- 范围外：Native 长按菜单、拖拽时序重设计、ContextMenu primitive 重写、新通用菜单框架。
- 当前任务单元：侧边栏右键入口；`parent spec=N/A`。
- 轻量评估：`standard`；多 renderer 共享同一菜单合同。
- 已确认事实：`components/ui/context-menu.tsx` 已实现 provider/trigger/content/item、Web 坐标定位和默认菜单抑制。
- 停用点：项目行在 `sidebar-workspace-list.tsx:1853` 传 `menuController={null}`；project workspace 在 `:1400` 同样停用；status workspace 在 `sidebar/sidebar-status-list.tsx:654` 尚未接线。
- 菜单 owner：项目 kebab/handler 位于 `sidebar-workspace-list.tsx:553-625`；workspace 菜单位于 `sidebar/sidebar-workspace-menu.tsx:66-159`。
- 老项目参考：当前老项目也停用；历史提交 `3c066f5dd` 只参考 wiring，旧菜单项不完整。
- 已选方案：提取最小 action 描述或共享 item body，由 Dropdown/Context 分别渲染；必要时让 open-in-file-manager item 支持 Context 容器。
- 实现结论：项目菜单和 workspace 菜单分别提取共享 item body，由 Dropdown/Context 两种容器渲染；三类 row 只负责接入对应 ContextMenu。
- 风险与未知：Native 长按 450ms 会与 180ms drag 预备竞争，因此本次保持 Native 仅使用 kebab；未新增长按菜单。

## 3. 涉及文件与计划

| 文件                                                             | 实际变化                                                         | 事实源                  |
| ---------------------------------------------------------------- | ---------------------------------------------------------------- | ----------------------- |
| `packages/app/src/components/sidebar-workspace-list.tsx`         | 项目和 project workspace 接入 ContextMenu，并复用项目菜单项 body | 现有 kebab/action owner |
| `packages/app/src/components/sidebar/sidebar-workspace-menu.tsx` | Dropdown/Context 共用 workspace 条件、状态与 handler             | 权威 workspace 菜单     |
| `packages/app/src/components/sidebar/sidebar-status-list.tsx`    | status workspace 接入同一 workspace Context menu                 | status row owner        |
| `packages/app/src/workspace/open-in-file-manager/menu-item.tsx`  | 支持 Dropdown/Context 两种 item 容器                             | 现有打开目录 action     |
| `packages/app/e2e/sidebar-context-menu.spec.ts`                  | 覆盖三类 row 的右键入口和代表性动作                              | 公共 UI seam            |

1. 先建立项目、project workspace、status workspace 的真实右键 RED。
2. 让现有菜单 action 成为唯一 owner，并接通 Web/Electron controller。
3. 回归左键导航、折叠、拖拽、kebab、归档 pending。

## 4. 执行前检查点

- 当前目标：右键与最右按钮菜单同构。
- 当前进度：只读调查完成，真实右键 seam 已由用户批准。
- 下一步：新增三类 sidebar row 的右键 RED，再复用现有菜单 owner。
- 风险与回退：若复用要求引入全局菜单框架，退回局部 action body。
- 验证方式：目标 E2E、Web/Electron smoke、typecheck、lint。
- TDD 判定、测试 seam 与验收行为：`TDD；用户实际右键菜单及动作结果。`
- seam 确认：`User`。
- Execution Approval / Source：`Approved / User (2026-07-30)`。

## 5. 执行与变更记录

- 实际改动：为项目 row、project workspace row、status workspace row 接入现有 ContextMenu；Dropdown 与 Context 复用同一组项目/workspace 菜单项定义；`OpenInFileManagerMenuItem` 增加容器适配；新增三条目标 E2E。
- 偏差与用户决策：本任务独立于侧边栏 diff 数隐藏任务 `0020`，虽有重叠文件但无父子关系；Native 保持原 kebab 入口，未增加长按行为。
- Change Log：`2026-07-29` 完成只读调查并建档；`2026-07-30` 用户批准方案与测试 seam；同日完成实现、聚焦验证与双轴 Review，未发现开放 finding。未保留独立 RED 输出，因此不将计划中的 RED 计作验证证据。

## 6. 验证与完成判断

| 验收项             | 命令或步骤                                      | 结果 | 证据                                                         |
| ------------------ | ----------------------------------------------- | ---- | ------------------------------------------------------------ |
| 三类右键入口与动作 | 目标 Playwright：`sidebar-context-menu.spec.ts` | PASS | `3 passed`；覆盖项目、project workspace、status workspace。  |
| 菜单 parity        | Review 共享 item owner 与三类 row 接线          | PASS | Dropdown/Context 共用项目或 workspace item body 与 handler。 |
| App 类型检查       | App scoped typecheck                            | PASS | 实施验证退出码为 0。                                         |
| 目标 lint          | 受影响文件 lint                                 | PASS | 实施验证退出码为 0。                                         |
| 格式与 diff        | 目标 format check、`git diff --check`           | PASS | 两项均通过。                                                 |

- 未验证项与原因：未在 Native 设备上做交互回归；本次未新增 Native 长按入口，代码保持既有 kebab 路径。未运行全量测试，符合项目仅运行受影响文件的规则。
- 剩余风险：E2E 验证代表性菜单项和动作，条件项全集的 parity 主要由共享 item body 的结构保证；连续右键切换是独立任务 `0024` 的已确认 RED，不属于本任务的三条 PASS，也不纳入本任务提交。
- Done Contract 是否由证据满足：`是；三类右键入口通过运行时 E2E，菜单内容与动作由共享 owner 保持一致，Native 行为未扩张。`

## 7. 恢复与同步

- 状态说明：`已收口 / Completed / Review`。
- 当前卡点：无。
- 下一步唯一动作：无；若后续发现 Native 长按需求，另立任务处理其与拖拽的手势冲突。
- Resume / Handoff：无需恢复；实现与聚焦验证已完成，未提交改动保留在当前工作区。
- Project Sync Candidates：`无`。
- 长期文档同步：`N/A`。

### 提交记录

| 提交信息（Commit Message）             | 提交脚注（Commit Footer） | 关联改动或阶段  | 文档同步状态 | 备注             |
| -------------------------------------- | ------------------------- | --------------- | ------------ | ---------------- |
| `feat(app): add sidebar context menus` | `N/A`                     | `0017 / Review` | `已同步`     | 用户授权独立提交 |
