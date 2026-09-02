# 会话 Token 费用与使用情况降噪 Micro Spec

## 0. 状态与索引

| 字段               | 值                                                       |
| ------------------ | -------------------------------------------------------- |
| task_id            | `0101`                                                   |
| spec layer         | `Feature Spec`                                           |
| task status        | `已收口`                                                 |
| document status    | `Completed`                                              |
| depth              | `standard`                                               |
| phase              | `Review`                                                 |
| Execution Approval | `Approved`                                               |
| Approval Source    | `User`                                                   |
| file path          | `mydocs/micro_specs/0101_会话Token费用与使用情况降噪.md` |
| parent spec        | `N/A`                                                    |
| superseded by      | `N/A`                                                    |
| created / updated  | `2026-08-27 / 2026-09-02`                                |

## 1. 目标与完成契约

- 当前理解：会话界面需要以辅助信息显示当前 Agent 已上报的实时 token 与费用；缺失、无效、不支持或查询错误时静默隐藏，不能影响会话主流程。设置的“使用情况”页当前会展示固定 fetcher 的 `Unavailable` 卡片，应改为只展示实际可查询的 provider。
- 核心目标：复用既有 `AgentUsage` / `lastUsage` 数据，在 Context Window tooltip 中独立展示有效的输入、缓存输入、输出 token 与权威费用；设置页过滤不可用的账号配额结果。
- Done Contract：有效字段逐项显示，不以 `$0` 或估算值替代缺失值；无 usage、无上下文窗口、provider 缺失、查询失败时不影响 composer；设置页不存在可用 provider 时显示空态；定向测试、类型检查、lint、格式和差异检查通过。

## 2. 范围与事实

- 范围内：`ContextWindowMeter` tooltip、composer 对现有 `lastUsage` 的传递、provider usage 设置页的展示过滤、相关 App 测试与任务记录。
- 范围外：新增 token 计费估算、修改 Agent/provider 数据采集、将 usage 持久化、修改 protocol/RPC、将全部 Agent 强制适配、错误提示或会话运行逻辑。
- 当前任务单元：基于已有可选数据的 App 展示层改动，附带设置页的 fail-closed 可用性降噪。
- 轻量评估：`standard`；涉及多个共享 App surface，但不改公共 wire contract。
- 已确认事实：`AgentUsage` 已定义 input/cache/output/cost/context 字段；daemon 已将 `usage_updated` 写入 `lastUsage`，App session store 已同步；现有 ContextWindowMeter 仅显示 context 和正费用；provider usage service 固定创建八个 fetcher，并以 `unavailable` 返回无凭证 provider。
- `grilling` 结论（如使用）：`N/A`。
- 风险与未知：不同 provider 的 token 范围可能是 completion、step 或累计 session，故不标注“会话累计”；费用仅显示 provider 的 `totalCostUsd`，不推算；已有无凭证 provider 仍可通过服务端 API 获取数据，但 UI 在结果为 `available` 前不显示。

## 3. 涉及文件与计划

| 文件                                                                           | 计划变化                                               | 事实源                         |
| ------------------------------------------------------------------------------ | ------------------------------------------------------ | ------------------------------ |
| `packages/app/src/components/context-window-meter.tsx`、测试                   | 增加独立 token/cost 提示行及缺失值过滤                 | `AgentUsage`、现有 tooltip     |
| `packages/app/src/composer/index.tsx`                                          | 将既有 Agent usage 字段传给 meter                      | session store `lastUsage`      |
| `packages/app/src/provider-usage/settings-section.tsx`、测试                   | 只渲染 status 为 `available` 的 provider，空时显示空态 | quota fetcher unavailable 合同 |
| `packages/app/src/i18n/resources/*.ts`、资源测试                               | 补齐 token 标签翻译                                    | 现有 contextWindow 文案约束    |
| `mydocs/micro_specs/0101_会话Token费用与使用情况降噪.md`、`mydocs/todolist.md` | 维护执行与验证事实                                     | 项目工作流参数                 |

1. 先建立 token 字段与 unavailable 过滤的定向测试，让缺失/无效数据有稳定断言。
2. 以最小 UI 变更接入既有 `lastUsage`，并补齐所有语言资源。
3. 运行受影响测试和静态检查，回写验证结论。

## 4. 执行前检查点

- 当前目标：只显示已由 Agent 或 provider 权威上报的 usage，失败时安静降级。
- 当前进度：tooltip、composer usage 投影、available-only 设置列表、空态、i18n 与回归测试均已完成并提交。
- 当前动作是否仍服务核心目标：`是；不引入新采集或计费逻辑。`
- 下一步：`无；0101 已收口。`
- 风险与回退：新 UI 仅位于 tooltip；任何值校验失败即不渲染；设置页仅改变渲染筛选，服务端 fetch 行为不动。
- 验证方式：受影响 Vitest/Browser E2E、`npm run typecheck`、`npm run lint`、目标文件格式检查和 `git diff --check`。
- TDD 判定、测试 seam 与验收行为：`TDD；ContextWindowMeter 展示层对有效/缺失/非法 usage 的行级行为，ProviderUsageSettingsSection 对 available-only 列表和空态的行为。`
- seam 确认：`User；用户明确要求有则显示、无则隐藏、出错隐藏，且指出使用情况页全为 Unavailable。`
- Execution Approval / Source：`Approved / User；2026-08-27 “继续”。`

## 5. 执行与变更记录

- 实际改动：Context Window tooltip 逐项展示 provider 已上报的 input、cached input、output token 与正费用；无 context window 但存在 usage 时仍可打开提示。设置页和 tooltip provider 列表只展示 `available` 且无错误的结果，全不可用时显示既有空态；未新增估算、采集、持久化或协议字段。
- 偏差与用户决策：无。
- Change Log：`2026-08-27` 建立 0101 micro-spec；用户明确的 fail-closed 策略作为展示合同。
- Change Log：`2026-09-02` 恢复并完成实现；定向 Vitest、两条 Browser E2E 命令、根 typecheck/lint、格式与差异检查通过，代码提交为 `6004fb55b`。

## 6. 验证与完成判断

| 验收项                  | 命令或步骤                                                                                                     | 结果 | 证据                                                         |
| ----------------------- | -------------------------------------------------------------------------------------------------------------- | ---- | ------------------------------------------------------------ |
| tooltip 行级 usage 显示 | `npx vitest run src/components/context-window-meter.utils.test.ts src/provider-usage/display.test.ts --bail=1` | PASS | 2 files / 11 tests；有效字段独立显示，缺失/非法/零值不伪造   |
| 设置页 unavailable 降噪 | `provider-usage-settings.spec.ts`、`provider-usage-tooltip.spec.ts` 两条定向 Browser E2E 命令                  | PASS | 两条命令均退出 0；错误/不可用项隐藏，空态与 tooltip 可见     |
| 静态检查                | `npm run typecheck`、`npm run lint`、`npm run format`、`git diff --check`                                      | PASS | typecheck 退出 0；lint 0 warnings / 0 errors；格式与差异通过 |

- 未验证项与原因：未执行 Android/iOS 真机 UI smoke；共享 React 渲染路径、纯展示策略单测、Browser E2E 与根静态检查已覆盖本任务主要风险。
- 剩余风险：provider 的 usage 统计口径不完全统一，界面不作累计语义承诺。
- Done Contract 是否由证据满足：是。

## 7. 恢复与同步

- 状态说明：`Review / 已收口 / Completed`。
- 当前卡点：`无。`
- 下一步唯一动作：`无。`
- Resume / Handoff：实现与测试已在 `6004fb55b` 提交；如 provider 后续改变 usage 口径，仍应保持 fail-closed 展示合同。
- Project Sync Candidates：`无；现有 ProviderUsage 固定 fetcher 与 unavailable 合同已由代码和测试维护。`
- 长期文档同步：`N/A`。

### 提交记录

| 提交信息（Commit Message）                       | 提交脚注（Commit Footer） | 关联改动或阶段 | 文档同步状态 | 备注                          |
| ------------------------------------------------ | ------------------------- | -------------- | ------------ | ----------------------------- |
| `feat(app): surface authoritative session usage` | `N/A`                     | `0101`         | `已同步`     | `6004fb55b`；实现与回归已提交 |
