# 关闭末个标签后切换 Workspace Micro Spec

## 0. 状态与索引

| 字段               | 值                                                       |
| ------------------ | -------------------------------------------------------- |
| task_id            | `0081`                                                   |
| spec layer         | `Feature Spec`                                           |
| task status        | `已收口`                                                 |
| document status    | `Completed`                                              |
| depth              | `standard`                                               |
| phase              | `Review`                                                 |
| Execution Approval | `Approved`                                               |
| Approval Source    | `User`                                                   |
| file path          | `mydocs/micro_specs/0081_关闭末个标签后切换Workspace.md` |
| parent spec        | `N/A`                                                    |
| superseded by      | `N/A`                                                    |
| created / updated  | `2026-08-18`                                             |

## 1. 目标与完成契约

- 当前理解：关闭当前 workspace 的最后一个 managed Agent 标签并得到 daemon 权威成功结果后，应先过滤出至少有一个活跃 Agent 的其他 workspace；只有这类候选存在时才按状态排序，否则进入 New Workspace。
- 核心目标：在不改变 Agent runtime close transaction、失败语义和 workspace layout 合同的前提下，把末标签后的固定 New Workspace 跳转改为确定性的跨 workspace 选择。
- Done Contract：排除刚被清空的当前 workspace，只从同时拥有有效未归档默认 Agent 且 `residentAgentCount > 0` 的 workspace 中选择；按“最新未读/待处理 → 最新已读完成 → 最新工作中”跳转，同一优先层按 `statusEnteredAt` 从新到旧；只有 closed 或其他非 resident Agent 的 workspace 时保留 0074 的 New Workspace 与当前 host/project 上下文；定向单测、真实 Playwright、typecheck、lint、格式与差异检查通过。

## 2. 范围与事实

- 范围内：单个 managed root Agent 标签权威关闭成功且整个 workspace layout 变空后的目标选择、跨 host workspace 导航、New Workspace fallback，以及相应纯函数和真实浏览器回归。
- 范围外：daemon/protocol 状态语义、Agent archive/runtime close、sidebar 分组和排序、批量关闭、terminal/browser/passive 标签、启动恢复策略。
- 当前任务单元：替换 0074 已验证的末标签成功跳转策略，复用同一个 transaction 边界。
- 轻量评估：`standard`；生产改动集中于 workspace 跳转编排，但需要跨 session 选择、状态优先级和真实路由验证。
- 已确认事实：0074 只在 `closed: true` 后清理标签，并在全 workspace 无剩余 tab 时跳 New Workspace；0076 将 `attention` 表示为 Ready to review、`done` 表示 Done、`running` 表示 Working；sidebar workspace 导航通过 `navigateToWorkspace()` 打开稳定 `defaultAgentId`；`buildWorkspaceResidentAgentCountIndex()` 排除已归档、无 workspace 及 `status === "closed"` 的 Agent，因此 `residentAgentCount > 0` 是本任务的“有活跃 Agent”权威口径。
- `grilling` 结论（如使用）：`N/A`。
- 风险与未知：当前 workspace 必须排除，否则会立即重开刚关闭的默认 Agent；不能把仅有可恢复 closed Agent 记录的 workspace 作为 `done` 候选；用户已确认排序的前提是至少存在一个有活跃 Agent 的 workspace。

## 3. 涉及文件与计划

| 文件                                                                           | 计划变化                                                                                         | 事实源                            |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ | --------------------------------- |
| `packages/app/src/screens/workspace/last-agent-tab-navigation.ts`              | 新增纯选择策略：过滤候选、映射优先层、按状态进入时间选择最新目标                                 | session store、0076 状态语义      |
| `packages/app/src/screens/workspace/last-agent-tab-navigation.test.ts`         | 覆盖当前 workspace 排除、三层优先级、同层最新、跨 host、无有效默认 Agent fallback                | 用户给出的选择顺序                |
| `packages/app/src/screens/workspace/workspace-screen.tsx`                      | 在 0074 的 authoritative commit 边界调用选择策略；有目标时复用 `navigateToWorkspace()`，否则 New | 现有 close transaction 与路由文档 |
| `packages/app/e2e/browser/workspace-navigation-regression.spec.ts`             | 保留无候选进入 New Workspace 的合同，并增加存在候选时自动切换及打开稳定默认 Agent 的真实回归     | 0074 既有隔离 daemon/browser seam |
| `mydocs/micro_specs/0081_关闭末个标签后切换Workspace.md`、`mydocs/todolist.md` | 回写批准、RED/GREEN、验证和完成状态                                                              | 项目工作流参数                    |

1. 先建立纯选择策略和真实路由合同的精确 RED，锁定优先级与 fallback。
2. 最小替换 0074 的跳转目标，不改变关闭失败、多标签或其他 tab 类型行为。
3. 运行受影响的单文件测试、目标 Playwright、根 typecheck/lint、格式与差异检查并回写证据。

## 4. 执行前检查点

- 当前目标：末个 managed Agent 标签权威关闭后，只在存在有活跃 Agent 的其他 workspace 时按已确认优先级跳转，否则进入 New Workspace。
- 当前进度：`residentAgentCount > 0` 候选门禁、三层排序、workspace close 接线、纯策略 RED→GREEN、真实路由与静态门禁均已完成。
- 当前动作是否仍服务核心目标：`是；只替换权威关闭成功后的目的地选择。`
- 下一步：`创建用户已授权的 0081 独立本地提交；不 push。`
- 风险与回退：选择必须跨所有已水合 session、排除当前 workspace，并要求有效未归档 `defaultAgentId`；回退只需恢复 0074 的 New Workspace fallback，不影响 daemon 持久状态。
- 验证方式：新纯函数 Vitest `--bail=1`；既有 workspace navigation Playwright 精确用例；根 `npm run typecheck`、`npm run lint`、目标 format/check 与 `git diff --check`。
- TDD 判定、测试 seam 与验收行为：`TDD；纯函数 seam 固化候选过滤、优先级和最新排序，真实 Playwright seam 证明末标签关闭后实际切换路由并打开目标默认 Agent，同时保留无候选 fallback。`
- seam 确认：`N/A；复用 0074 已验证的真实 browser + 隔离 daemon seam，并新增无副作用纯选择 seam。`
- Execution Approval / Source：`Approved / User；用户于 2026-08-18 回复“确认上述优先级，批准执行 0081”。`

## 5. 执行与变更记录

- 实际改动：新增纯选择策略，复用 sidebar 的有效状态、默认 Agent 和 resident Agent 计数，排除当前/空/archiving/归档 Agent/无活跃 Agent workspace；按已批准三层优先级和 `statusEnteredAt` 选择跨 host 最新目标；0074 的空 layout 成功边界有目标时调用 `navigateToWorkspace()`，否则保留携带当前 host/project 上下文的 New Workspace fallback；纯函数和真实浏览器回归同时覆盖 active 与 closed-only 分支。
- 偏差与用户决策：`用户确认 needs_input / failed / attention 同属第一优先的未读/待处理层，并补充只有存在活跃 Agent workspace 时才应用该排序。`
- Change Log：`2026-08-18：完成现状核对、任务登记、最小计划与执行前检查点，等待用户批准。`
- Change Log：`2026-08-18：用户确认完整优先级并批准执行 0081；进入 Execute，先建立 RED。`
- Change Log：`2026-08-18：纯策略 RED 稳定得到 null；真实 Playwright RED 明确得到 /new 而非目标 workspace。`
- Change Log：`2026-08-18：选择器与 workspace close 接线完成；纯策略 7/7、真实路由 2/2、根 typecheck 和目标 lint 通过。根 lint 唯一失败来自并行 0080 的 mock-load-test-agent constructor complexity 22，未越界修改。`
- Change Log：`2026-08-18：用户纠正候选前提；只有 residentAgentCount > 0 的 workspace 才参与 needs_input / failed / attention → done → running 排序，无此类 workspace 时进入 New Workspace。任务重新打开。`
- Change Log：`2026-08-18：resident 门禁 RED 稳定返回 closed-only workspace；加入 residentAgentCount > 0 过滤后纯策略 8/8，closed-only fallback 与 active workspace 跳转真实路由 2/2，根 typecheck/lint 通过。`

## 6. 验证与完成判断

| 验收项              | 命令或步骤                                                                                                                  | 结果 | 证据                                                                                         |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------- | ---- | -------------------------------------------------------------------------------------------- |
| 首轮纯策略 RED      | `rtk npx vitest run packages/app/src/screens/workspace/last-agent-tab-navigation.test.ts --bail=1`                          | RED  | 首个优先级断言 expected actionable target / actual `null`                                    |
| 首轮真实路由 RED    | 目标 Playwright `--grep "opens another Agent workspace after closing the last agent tab"`                                   | RED  | expected review workspace route / actual `/new?...`；隔离 daemon 与 Metro 正常回收           |
| resident 门禁 RED   | 同一纯策略 Vitest                                                                                                           | RED  | expected `null` / actual `agent-closed-only`，证明原实现会误选无 resident Agent 的 workspace |
| 纯策略 GREEN        | 同一纯策略 Vitest                                                                                                           | PASS | `1 file / 8 tests passed`；三层排序及 resident/empty/archiving/archived/current 过滤均通过   |
| 真实路由与 fallback | 目标 Playwright `--grep "returns to New Workspace when only closed-Agent workspaces remain\|opens another Agent workspace"` | PASS | `2 passed`；closed-only 进入 New Workspace，有 resident Agent 时切换并打开默认 Agent         |
| 根类型检查          | `rtk npm run typecheck`                                                                                                     | PASS | 退出码 0；协议 validator 生成链无差异                                                        |
| 根 lint             | `rtk npm run lint`                                                                                                          | PASS | `0 warnings / 0 errors`，3520 个文件通过                                                     |
| 格式与差异          | 6 个 0081 文件 `format:check:files`；目标 `git diff --check`                                                                | PASS | 项目 formatter 与 whitespace 检查通过                                                        |
| 资源回收            | Playwright teardown                                                                                                         | PASS | 测试输出确认 worker daemon `52186` 与 Metro `60082` 均 stopped                               |

- 未验证项与原因：未做 Native 人工路由 smoke，选择与导航使用现有跨平台 helper 并由 Web 真实流程覆盖。
- 剩余风险：跨 host 和 `needs_input / failed` 分支由纯函数覆盖，真实 Playwright 只验证同 host `attention` 候选；跨 host 路由 helper 已有既有独立回归。
- Done Contract 是否由证据满足：`是；活跃 Agent 前置门禁、三层排序、closed-only fallback、真实跳转、静态与资源边界均有证据。`

## 7. 恢复与同步

- 状态说明：`Review / 已收口 / Completed`。
- 当前卡点：`N/A。`
- 下一步唯一动作：`创建用户已授权的 0081 独立本地提交；不 push。`
- Resume / Handoff：0081 已按最终活跃 Agent 口径完成；后续回归先读第 1、4、6 节，并继续保护其他任务的现有改动。
- Project Sync Candidates：`无；这是 0074 路由行为的局部调整，未形成新的公共契约或跨任务架构规则。`
- 长期文档同步：`N/A`。

### 提交记录

| 提交信息（Commit Message）                                      | 提交脚注（Commit Footer） | 关联改动或阶段 | 文档同步状态 | 备注                    |
| --------------------------------------------------------------- | ------------------------- | -------------- | ------------ | ----------------------- |
| `feat(app): prioritize active workspace after closing last tab` | `N/A`                     | `0081`         | `本提交`     | 用户已授权；未授权 push |
