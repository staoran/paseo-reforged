# 侧边栏相对时间 Hermes 兼容 Micro Spec

## 0. 状态与索引

| 字段               | 值                                                    |
| ------------------ | ----------------------------------------------------- |
| task_id            | `0048`                                                |
| spec layer         | `Feature Spec`                                        |
| task status        | `待验证`                                              |
| document status    | `Active`                                              |
| depth              | `fast`                                                |
| phase              | `Review`                                              |
| Execution Approval | `Approved`                                            |
| Approval Source    | `User（2026-08-05 14:32）`                            |
| file path          | `mydocs/micro_specs/0048_侧边栏相对时间Hermes兼容.md` |
| parent spec        | `N/A`                                                 |
| superseded by      | `N/A`                                                 |
| created / updated  | `2026-08-05 13:53 / 2026-08-05 16:13`                 |

## 1. 目标与完成契约

- 当前理解：`v0.2.5-beta.2` 新增的侧边栏活动时间在 elapsed time 达到 1 分钟后无保护地调用 `Intl.RelativeTimeFormat`；React Native 0.81.5 锁定的 Hermes 未实现该构造器，导致 Android 在渲染 workspace 行时抛出 `TypeError`。
- 核心目标：保留支持 `Intl.RelativeTimeFormat` 的 Web/桌面运行时现有格式，同时在 Hermes 等缺少该 API 的运行时使用项目八种 locale 的资源化紧凑回退，确保侧边栏不因活动时间渲染而崩溃。
- Done Contract：缺少 `Intl.RelativeTimeFormat` 时，“刚刚”、分钟、小时、天、周均返回确定的本地化文本且不抛错；支持该 API 时现有输出保持不变；八种 locale 资源键一致；原始复现、定向测试、App typecheck、根 lint、差异检查和静态代码审查通过；真实 Android smoke 按用户决定延期到包含本修复的测试版发布后手工验收。

## 2. 范围与事实

- 范围内：`packages/app` 的相对时间能力检测、资源化 fallback、侧边栏调用接线、八种 locale 资源和定向回归测试。
- 范围外：升级 Expo、React Native 或 Hermes；引入 FormatJS polyfill 链；修改其他时间格式；修复无关测试基础设施；创建 beta、tag、PR 或发布。
- 当前任务单元：修复侧边栏活动时间对 Hermes 缺失 `Intl.RelativeTimeFormat` 的兼容问题。
- 轻量评估：`足够小`；根因已通过最小复现与 Hermes 锁定源码确认，改动局限在 App 时间格式化、资源和测试。
- 已确认事实：`a32ab5489` 在 beta.2 首次引入 `formatRelativeTime`；`elapsedMinutes < 1` 不构造 formatter，`>= 1` 才崩溃；同一缺失 API 条件下八种 locale 均复现；Node 26/jsdom 具备该 API，现有测试无法暴露 Hermes 能力差异；Hermes 支持 `Intl.NumberFormat`，可用于 fallback 数字本地化；当前 FormatJS relative-time polyfill 还依赖 Hermes 缺失的 `Intl.Locale` 与 `Intl.PluralRules`，不作为首选。
- `grilling` 结论（如使用）：`N/A`。
- 风险与未知：资源模板需保持八种 locale 的插值占位符一致；capability guard 不能改变支持运行时的既有输出；现有侧边栏组件测试在当前工作区会被 `__DEV__ is not defined` 的导入问题提前阻断，仅允许做使目标 seam 可运行的最小测试侧调整，不扩为测试基础设施重构；当前机器无 `adb`，真实 APK 验收条件未知。

## 3. 涉及文件与计划

| 文件                                                                           | 计划变化                                                                      | 事实源                                |
| ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- | ------------------------------------- |
| `packages/app/src/utils/time.ts`                                               | 在构造前检查 capability，并允许调用方提供资源化 fallback；保留原有时间 bucket | 当前实现与 Hermes 能力证据            |
| `packages/app/src/utils/time.test.ts`                                          | 在恢复全局描述符的前提下模拟缺失 API，建立首个 RED/GREEN 切片                 | TDD 核心 seam                         |
| `packages/app/src/components/sidebar/sidebar-workspace-activity-time.tsx`      | 将当前 locale 的分钟/小时/天/周资源模板接入 fallback                          | `docs/i18n.md` 的组件翻译边界         |
| `packages/app/src/components/sidebar/sidebar-workspace-activity-time.test.tsx` | 在缺失 API 条件下验证用户可见文本；仅做目标测试所需的最小 harness 调整        | TDD UI seam                           |
| `packages/app/src/i18n/resources/{ar,en,es,fr,ja,pt-BR,ru,zh-CN}.ts`           | 新增紧凑的 minute/hour/day/week ago 模板并保持占位符一致                      | 支持 locale 清单与现有 `justNow` 资源 |
| `packages/app/src/i18n/resources.test.ts`                                      | 明确断言新增英文事实源键；复用现有八语种 parity/placeholder 检查              | `docs/i18n.md`                        |
| `mydocs/todolist.md`、本 micro-spec                                            | 维护编号、批准状态、执行证据与恢复锚点                                        | 项目工作流参数                        |

1. 用户确认下述两个 public seam，并明确批准执行后，先在纯函数 seam 建立缺失 API 的 5 分钟 RED，再做 capability guard 与 fallback callback 的最小 GREEN。
2. 在组件 seam 建立中文 `5分钟前` 的可见行为 RED，再接入四种单位资源；随后逐片覆盖小时、天、周和支持 API 的既有路径。
3. 运行定向资源/时间/组件测试、静态检查和原始复现；Android production APK smoke 按用户后续决定延期到测试版发布后手工执行。

## 4. 执行前检查点

- 当前目标：让侧边栏相对时间在缺少 `Intl.RelativeTimeFormat` 的 Hermes 上继续渲染本地化文本，而不改变支持运行时的既有行为。
- 当前进度：Seam A/B、八语种资源、组件接线、自动验证和修正后的静态代码审查均通过；用户已授权提交本任务代码和文档，真实 Android production smoke 延期到测试版发布后。
- 当前动作是否仍服务核心目标：`是；计划只覆盖 capability guard、资源 fallback、调用接线和直接回归证据。`
- 下一步：提交 0048 的独立代码和文档；下一测试版发布后安装 production APK，手工验证含超过 1 分钟活动记录的侧边栏。
- 风险与回退：当前自动测试通过遮蔽 API 模拟 Hermes 能力差异，仍需真实 Hermes 包证明；若 smoke 失败，回到组件 seam 复现实际差异，不扩大为 polyfill 或框架升级。
- 验证方式：定向 Vitest 单文件带 `--bail=1`、App typecheck、根 lint、`git diff --check`、缺失 API 原始复现，以及可用时的 Android production smoke。
- TDD 判定、测试 seam 与验收行为：`TDD；Seam A = 导出的 formatRelativeTime：临时遮蔽 Intl.RelativeTimeFormat 后，5 分钟输入不抛错并经 fallback 得到确定文本，且全局描述符在测试后恢复。Seam B = SidebarWorkspaceActivityTime 的渲染文本：同一缺失 API 条件下，zh-CN 的 5 分钟 workspace 显示“5分钟前”而非触发错误边界。首个 Red/Green 纵向切片为 Seam A 的 5 分钟输入；其后再逐片接入 Seam B 与其他单位。`
- seam 确认：`User；2026-08-05 14:32 用户回复“确认 Seam A/B，并批准按 0048 执行”。`
- Execution Approval / Source：`Approved / User；2026-08-05 14:32 用户回复“确认 Seam A/B，并批准按 0048 执行”。`

## 5. 执行与变更记录

- 实际改动：`formatRelativeTime` 在计算既有 bucket 后检测 `Intl.RelativeTimeFormat`；缺失时调用必填的资源化 fallback，存在时继续使用原 `numeric: "always" / style: "narrow"` 路径。
- 实际改动：侧边栏用 `Intl.NumberFormat(locale)` 格式化数值，并接入 `minuteAgo/hourAgo/dayAgo/weekAgo`；八种 locale 使用一致的 `{{value}}` 占位符。
- 实际改动：Seam A 遮蔽全局构造器验证 helper fallback；Seam B 逐片验证中文分钟、小时、天、周可见文本，并在每个测试后恢复全局描述符。
- 偏差与用户决策：组件测试除已知 `__DEV__` 外还被 Reanimated 的 `window.matchMedia` 前提阻断；仅在目标测试内复用项目现有 shim，未修改全局测试基础设施或产品行为。
- 提交偏差：正常 pre-commit hook 因 Lefthook 子进程在 Windows 中找不到 `npm`/`node` 而失败；通过 `rtk` 手工运行目标格式检查、目标 lint 和所有 workspace typecheck 均通过后，按项目既有同类处理使用 `--no-verify` 创建本次提交。
- Change Log：`2026-08-05 13:53` 用户选择首选资源化 fallback 并要求进入 Light fast；完成任务登记、范围收敛、TDD seam 提案和执行前 checkpoint。`2026-08-05 14:32` 用户确认 Seam A/B 并批准按 `0048` 执行。Seam A 首个 RED 为 `TypeError: Intl.RelativeTimeFormat is not a constructor`，最小 GREEN 后 `19/19`。Seam B 首个业务 RED 为 `TypeError: options.formatFallback is not a function`，随后分钟、小时、天、周逐片 RED/GREEN，最终 `9/9`。`2026-08-05 16:02` 用户确认修正后的静态审查结论为 PASS，并授权提交本任务代码和文档；此前两项 P2 已澄清为已批准的既有 JSDOM seam 局部例外与可选多语言测试加固，不构成生产缺陷或 spec 偏差。

## 6. 验证与完成判断

| 验收项              | 命令或步骤                                                                                                 | 结果     | 证据                                    |
| ------------------- | ---------------------------------------------------------------------------------------------------------- | -------- | --------------------------------------- |
| 纯函数 fallback     | `rtk npx vitest run packages/app/src/utils/time.test.ts --bail=1`                                          | PASS     | `19/19`；缺失构造器 RED 后 GREEN        |
| 侧边栏可见行为      | `rtk npx vitest run packages/app/src/components/sidebar/sidebar-workspace-activity-time.test.tsx --bail=1` | PASS     | `9/9`；四种 fallback bucket 均覆盖      |
| 八语种资源          | `rtk npx vitest run packages/app/src/i18n/resources.test.ts --bail=1`                                      | PASS     | `32/32`；key parity 与 placeholder 通过 |
| App 类型检查        | `rtk npm run typecheck --workspace @getpaseo/app`                                                          | PASS     | 输出 `ok`                               |
| 根 lint             | `rtk npm run lint`                                                                                         | PASS     | `0 warnings / 0 errors`                 |
| 差异检查            | `rtk git diff --check`                                                                                     | PASS     | 全局工作区检查通过                      |
| 静态代码审查        | 对照 `HEAD` 审查 0048 代码、测试、资源与本 spec                                                            | PASS     | 无确定生产缺陷、行为回归或未批准扩范围  |
| Pre-commit 等价检查 | 目标 `format:check:files`、目标 `lint`、`typecheck --workspaces --if-present`                              | PASS     | Lefthook PATH 失败后通过 `rtk` 手工完成 |
| Android smoke       | 下一测试版 production APK 打开含超过 1 分钟活动记录的侧边栏                                                | Deferred | 用户决定发布测试版后手工测试            |

- 未验证项与原因：Android 实机/模拟器 production smoke 未运行；当前机器无 `adb`，用户明确将该项调整为下一测试版发布后的手工验收。
- 剩余风险：自动回归模拟的是 API 缺失条件；真实 Hermes 包仍需最终 smoke 证明 `Intl.NumberFormat(locale)` 与资源插值链路一致工作。
- Done Contract 是否由证据满足：`代码实现、自动验证和静态审查满足本次提交条件；Android production smoke 已获用户批准延期，任务在手工结果回写前保持待验证。`

## 7. 恢复与同步

- 状态说明：`待验证 / Active / Review`。
- 当前卡点：`代码与提交无卡点；Android smoke 等待下一测试版发布。`
- 下一步唯一动作：下一测试版发布后，在真实 Android production APK 上验证超过 1 分钟的侧边栏活动时间并回写结果。
- Resume / Handoff：代码、定向测试、静态检查和静态代码审查已完成；恢复时先读本文件第 6 节，仅补发布后 Android smoke，失败时再回到 Seam B 反馈循环。
- Project Sync Candidates：`候选：Native runtime 的 Intl 能力不能由 Node/jsdom 测试推断；Android 验证完成后再评估同步到 docs/testing.md 或 docs/android.md。`
- 长期文档同步：`未同步；当前尚无经过真实 Android smoke 验证的稳定长期事实。`

### 提交记录

| 提交信息（Commit Message）                                   | 提交脚注（Commit Footer） | 关联改动或阶段                        | 文档同步状态 | 备注                                                           |
| ------------------------------------------------------------ | ------------------------- | ------------------------------------- | ------------ | -------------------------------------------------------------- |
| `fix(app): support relative time without RelativeTimeFormat` | `N/A`                     | `0048` 实现、测试、资源与 review 回写 | `已同步`     | 等价检查通过后使用 `--no-verify`；最终 SHA 以 Git 提交结果为准 |
