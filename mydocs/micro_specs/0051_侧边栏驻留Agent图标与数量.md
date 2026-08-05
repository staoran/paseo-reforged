# 侧边栏驻留 Agent 图标与数量 Micro Spec

## 0. 状态与索引

| 字段                      | 值                                                                    |
| ------------------------- | --------------------------------------------------------------------- |
| task_id                   | `0051`                                                                |
| spec layer                | `Feature Spec`                                                        |
| task status               | `已收口`                                                              |
| document status           | `Complete`                                                            |
| depth                     | `standard`                                                            |
| phase                     | `Review`                                                              |
| Execution Approval        | `Approved`                                                            |
| Approval Source           | `User；2026-08-05 确认 SidebarWorkspaceListProbe seam，批准执行 0051` |
| Prototype Approval        | `Approved`                                                            |
| Prototype Approval Source | `User；2026-08-05 用户要求先查看 Bot 与 Bot + 数量样式`               |
| file path                 | `mydocs/micro_specs/0051_侧边栏驻留Agent图标与数量.md`                |
| parent spec               | `N/A`                                                                 |
| superseded by             | `N/A`                                                                 |
| created / updated         | `2026-08-05 16:46 / 2026-08-05 20:05`                                 |

## 1. 目标与完成契约

- 当前理解：侧边栏不再为全部 runtime 已关闭的 workspace 显示 `PowerOff`；至少一个 Agent runtime 驻留时，以更贴近 Agent 语义的 Lucide `Bot` 呈现，并在多个驻留 Agent 时显示数量。
- 核心目标：按用户选定的方案 B 实施行尾 Bot + resident 数量，同时保留左侧活动状态，不再显示 closed runtime 图标。
- Done Contract：生产侧边栏在 resident 为零时无 runtime 图标、resident 为一时仅显示 Bot、resident 大于一时显示 Bot 与准确数量；Bot 位于相对时间之后、hover action 之前，并可与左侧 running/needs-input 等活动状态同时存在；定向测试、typecheck、lint 和 Web 视觉检查通过，throwaway 原型从主工作区移除。

## 2. 范围与事实

- 范围内：workspace 行的 runtime fallback 图标、未归档 managed Agent 的 resident 数量派生、Tooltip/accessibility 文案和对应回归测试。
- 范围外：多状态数量明细、Tab 数量、Agent/Tab 关闭生命周期、缓存淘汰、provider-owned subagent、协议字段和 daemon 行为。
- 当前任务单元：方案 B 已实施并由定向测试、隔离 E2E 和生产行截图验证，任务进入 Review 收口。
- 轻量评估：`升级 standard`；行为边界简单，但 resident 数量需贯穿 activity 派生、session/sidebar view-model、渲染和测试。
- 已确认事实（实施前）：`WorkspaceRuntimeResidency` 只有 `resident | closed`；`WorkspaceRuntimeResidencyIndicator` 使用 Lucide `Power/PowerOff`；runtime 图标只在 workspace `done` bucket 中作为 fallback。方案 B 将 resident 信息移到行尾独立呈现，不再受左侧活动状态优先级互斥。
- `grilling` 结论：`N/A`；目标和原型范围明确。
- 风险与未知：数量不能与本地 Tab 数混淆；行尾还包含相对时间和 hover action，窄宽度下必须保持标题可收缩且不挤出操作；多位数量需稳定宽度；closed 隐藏 runtime 图标后仍保留左侧状态槽的既有对齐。

## 3. 涉及文件与计划

| 文件                                                                        | 计划变化                                                                 | 事实源                                               |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------- |
| `packages/app/src/components/sidebar/sidebar-runtime-status.prototype.html` | throwaway 三方案预览，支持 `?variant=A/B/C` 和键盘切换                   | `prototype` UI 分支；真实 sidebar 密度与 Paseo theme |
| `packages/app/src/utils/workspace-agent-activity.ts`                        | 将 residency 枚举投影替换为未归档且非 closed Agent 的 workspace 计数索引 | `buildWorkspaceRuntimeResidencyIndex()`              |
| `packages/app/src/stores/session-store.ts`                                  | 在线更新和缓存恢复统一维护 resident Agent 计数索引                       | `setAgents()` / `restoreSessionReplica()`            |
| `packages/app/src/hooks/sidebar-workspaces-view-model.ts`                   | 向 `SidebarWorkspaceEntry` 投影 `residentAgentCount`                     | `createSidebarWorkspaceEntry()`                      |
| `packages/app/src/components/sidebar/sidebar-workspace-row-content.tsx`     | 左侧状态移除 runtime fallback；行尾按方案 B 渲染 Lucide Bot 与 N         | `WorkspaceStatusIndicator()` / `rowRight`            |
| 相关目标测试与 i18n 资源                                                    | 覆盖 0/1/N、活动状态共存、稳定引用和 Tooltip/accessibility               | 既有 session、sidebar view-model 与 list 集成测试    |
| `packages/app/e2e/workspace-navigation-regression.spec.ts` 等 E2E seam      | 迁移旧 runtime 图标断言，以隔离 daemon 验证 2 -> 1 -> 0 -> 1 生命周期    | 既有 workspace runtime reopen 场景                   |

1. 在现有 `SidebarWorkspaceListProbe` 集成测试中建立首个 RED：closed/0 不显示 runtime indicator，1 显示 Bot 不显示数字，N 显示 Bot + N，且 N 可与左侧 running 状态共存。
2. 将内部 residency 枚举改为 resident Agent 计数索引，贯穿 session store 和 sidebar view-model；补充计数、closed/archived 排除及稳定引用的定向测试。
3. 在 `rowRight` 的相对时间之后、hover action 之前实现方案 B，复用现有 tooltip 文案并让 accessibility label 携带数量；完成首个 GREEN。
4. 运行全部受影响测试文件、App typecheck、根 lint、格式与 Web 视觉检查；确认后删除 throwaway HTML 并回写验证证据。

## 4. 执行前检查点

- 当前目标：按方案 B 把 resident Agent 数量作为独立行尾信息呈现，并彻底移除 closed runtime glyph。
- 当前进度：0051 已登记；A/B/C 原型及窄视口验证完成；用户已选择 B 并确认 seam、批准执行；首个 RED 尚未写入。
- 当前动作是否仍服务核心目标：是；计划只替换 App 内部 runtime 摘要和 workspace 行呈现，不触碰 Agent/Tab 生命周期、协议或 daemon。
- 下一步：在 `sidebar-workspace-list.test.tsx` 建立首个集成 RED，再完成计数投影和方案 B 的最小 GREEN。
- 风险与回退：内部 map 从 closed/resident 枚举改为 resident count 会影响 session、view-model 和测试夹具命名，但不改变 wire contract；若行尾在真实窄侧边栏拥挤，优先让标题收缩，不隐藏数量或 hover action；可按单提交反向恢复原投影。
- 验证方式：首个纵向集成测试；`workspace-agent-activity`、`session-store`、`sidebar-workspaces-view-model` 和 `sidebar-workspace-list` 受影响测试文件；`npm run typecheck`、`npm run lint`、目标格式检查；桌面与 390px Web 视觉检查。
- TDD 判定、测试 seam 与验收行为：`TDD；首个纵向 seam 为 sidebar-workspace-list.test.tsx 的 SidebarWorkspaceListProbe：输入 closed-only、1 resident 和 N resident + running 的 session agents，观察最终 DOM 分别为无 runtime indicator、Bot 无数字、左侧 running 与右侧 Bot + N 同时存在。随后以 buildWorkspaceResidentAgentCountIndex() 单测锁定 closed/archived 排除和稳定引用。`
- seam 确认：`User；2026-08-05 用户确认 SidebarWorkspaceListProbe seam。`
- Execution Approval / Source：`Approved / User；2026-08-05 用户确认 seam，批准执行 0051。`

## 5. 执行与变更记录

- 实际改动：以 `buildWorkspaceResidentAgentCountIndex()` 替换 `resident | closed` 索引，session 在线更新和缓存恢复统一维护 workspace resident Agent 数量；sidebar view-model 投影 `residentAgentCount`；左侧移除 runtime fallback，行尾在相对时间之后、hover action 之前渲染 Lucide `Bot`，仅数量大于一时显示数字；8 个语言资源改为带 `{{count}}` 的 resident 文案并移除 `runtimeClosed`。
- 原型观察：A 最紧凑，但计数角标较小，活动状态存在时 Bot 语义会被替换；B 可同时保留左侧活动状态和右侧 resident Bot/数量，信息密度最均衡，当前建议采用；C 信息最显式，但增加行高、分隔和文字，视觉重量偏高。
- 用户决策：`2026-08-05 17:28` 用户选择方案 B；1 个 resident 只显示 Bot，N 个 resident 显示 Bot + N，位置与原型一致。
- 执行授权：`2026-08-05 17:34` 用户确认 `SidebarWorkspaceListProbe` seam 并批准执行 0051。
- TDD RED：`2026-08-05 17:53` 首个集成测试按预期失败；closed-only 行仍渲染 `workspace-status-indicator-runtime-closed`，证明旧 `PowerOff` 行为与方案 B 契约冲突。
- TDD GREEN：`2026-08-05 18:02` 同一测试通过；closed-only 无 runtime indicator、单 resident 仅 Bot、双 resident 与左侧 running 并存且显示 `2`。
- Review 补充：`2026-08-05 18:44` 发现 closed 行测试未直接排除新 Bot，且两个 Playwright seam 仍引用旧 runtime test id；补强 0 断言与计数排除夹具，并将真实浏览器生命周期断言迁移为 2 -> 1 -> 0 -> 1。
- 视觉与生命周期：隔离 Playwright daemon 验证 `2 -> 1 -> 0 -> 1` resident 变化、hover kebab 与 Bot + 2 共存，以及左侧 `done` 槽与右侧单 resident Bot 共存；303 x 36 生产 workspace 行截图无裁切、挤压或重叠。
- 清理与偏差：throwaway 原型和临时生产截图已移除，`8082` 与三轮 E2E 临时端口均释放；根 lint 仍被 0051 范围外的 `packages/server/src/server/agent/agent-manager.ts` 4 个既有规则错误阻塞，0051 的 25 个目标文件 lint 全部通过。未创建 branch、commit、PR 或 issue。
- Change Log：`2026-08-05 16:46` 分配 `0051`；`17:00` 完成 A/B/C 原型与视觉验证；`17:28` 用户选择 B；`17:34` seam 确认并获 Execute 批准；`17:53` 取得首个 RED；`18:02` 取得 GREEN；`18:44` 完成 changed-only Review 并补强 E2E；`19:09` 完成验证、清理与 Reverse Sync；`20:05` 用户要求按精确文件边界创建独立 commit。

## 6. 验证与完成判断

| 验收项         | 命令或步骤                                                                                                | 结果         | 证据                                                                                            |
| -------------- | --------------------------------------------------------------------------------------------------------- | ------------ | ----------------------------------------------------------------------------------------------- |
| A/B/C 原型     | Playwright Chromium 打开三个 `?variant=` URL                                                              | `通过`       | A/B/C 均为 6 行；`closedIconCount=0`；截图位于 `E:\Code\paseo-preview-0051\variant-{A,B,C}.png` |
| 切换与控制台   | 点击按钮、`ArrowLeft` / `ArrowRight`、收集 console error                                                  | `通过`       | 点击切到 B、按键切到 C；`errors=[]`                                                             |
| 窄视口布局     | Chromium `390px` 视口检查横向溢出                                                                         | `通过`       | `innerWidth=390`、`scrollWidth=390`、`overflow=false`                                           |
| 首个生产 RED   | `npx vitest run src/components/sidebar-workspace-list.test.tsx --bail=1 -t "shows resident agent counts"` | `RED`        | `1 failed / 7 skipped`；closed-only 行实际仍有 `runtime-closed` indicator                       |
| 首个生产 GREEN | 同一目标命令                                                                                              | `PASS`       | `1 passed / 7 skipped`；0/1/N 与活动状态共存均满足                                              |
| 定向单元测试   | 全部既定 0051 受影响 Vitest 文件；Review 后复跑 activity/list/activity-time                               | `通过`       | 首轮 154 tests 通过；Review 后分别 `13/13`、`8/8`、`9/9`                                        |
| 生命周期 E2E   | `workspace-navigation-regression.spec.ts -g "updates resident Agent counts"`                              | `通过`       | 隔离 daemon 中验证 `2 -> 1 -> 0 -> 1`、hover kebab 共存；`1 passed`                             |
| 独立状态 E2E   | `workspace-model-regressions.spec.ts -g "cross-workspace subagent opens"`                                 | `通过`       | 左侧 `done` 与右侧单 resident Bot 共存；`1 passed`                                              |
| 生产视觉       | Playwright 对 hover 中的真实 workspace 行执行 `locator.screenshot()` 并人工检查                           | `通过`       | `303 x 36`；Bot + 2 与 kebab 完整可见、无裁切或重叠；临时截图已清理                             |
| Typecheck      | `npm run typecheck`                                                                                       | `通过`       | 全 workspace typecheck 退出码 `0`                                                               |
| 目标 lint      | `npm run lint -- <25 个 0051 文件>`                                                                       | `通过`       | `0 warnings / 0 errors`                                                                         |
| 根 lint        | `npm run lint`                                                                                            | `范围外阻塞` | `agent-manager.ts` 3 个 complexity 与 1 个 nested ternary；与 0051 文件无交集                   |
| 格式与 diff    | 27 个目标文件 `format:check:files`；目标 `git diff --check`                                               | `通过`       | formatter 全通过；无 whitespace error                                                           |
| 清理与进程     | 核对 `8082`、三轮 E2E 动态端口和测试进程；保留 `6767`                                                     | `通过`       | 仅主 daemon `127.0.0.1:6767` / PID `5016` 仍监听                                                |

- 未验证项与原因：完整根 lint 未通过，但唯一阻塞来自 0051 范围外的 server dirty 改动；0051 目标 lint、typecheck、定向测试与 E2E 均已通过。
- 剩余风险：生产截图覆盖桌面宽度和数量 `2`；更窄生产视口与三位数数量未单独截图，现有 flex 收缩约束、390px 原型和 DOM 顺序测试提供替代证据。
- Done Contract 是否由证据满足：满足；0/1/N、活动状态共存、相对时间/hover action 顺序、可访问文案、视觉布局和原型清理均已有证据。

## 7. 恢复与同步

- 状态说明：`Review / 已收口 / Approved / Variant B Delivered`。
- 当前卡点：无；0051 已完成并获用户授权按精确边界独立提交。
- 下一步唯一动作：无强制动作；本次不包含 push/PR。
- Resume / Handoff：无需继续执行；独立 commit 仅包含本文件及 0051 的 25 个 App 目标文件，0050 和其他 dirty 改动保持原样。
- Project Sync Candidates：`无`；本次选型和验证结论属于 Feature Spec，不形成新的跨任务项目规则。
- 长期文档同步：`N/A`。

### 提交记录

| 提交信息（Commit Message）                         | 提交脚注（Commit Footer） | 关联改动或阶段 | 文档同步状态   | 备注                                                   |
| -------------------------------------------------- | ------------------------- | -------------- | -------------- | ------------------------------------------------------ |
| `feat(app): show resident Agent counts in sidebar` | `N/A`                     | `0051`         | `随本提交同步` | 用户于 2026-08-05 授权精确边界独立提交；未授权 push/PR |
