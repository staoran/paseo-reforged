# 修复 Windows 升级安装后启动 Micro Spec

## 0. 状态与索引

| 字段               | 值                                                     |
| ------------------ | ------------------------------------------------------ |
| task_id            | `0082`                                                 |
| spec layer         | `Feature Spec`                                         |
| task status        | `已收口`                                               |
| document status    | `Completed`                                            |
| depth              | `standard`                                             |
| phase              | `Review`                                               |
| Execution Approval | `Approved`                                             |
| Approval Source    | `User`                                                 |
| file path          | `mydocs/micro_specs/0082_修复Windows升级安装后启动.md` |
| parent spec        | `N/A`                                                  |
| superseded by      | `N/A`                                                  |
| created / updated  | `2026-08-18 00:44 / 2026-08-28 23:05`                  |

## 1. 目标与完成契约

- 当前理解：Windows assisted NSIS 安装器首次安装后能按完成页选项打开软件，但由应用更新链触发的覆盖升级在完成后没有可见窗口。
- 核心目标：让 electron-builder 以 `--updated` 启动升级后的可执行文件时进入桌面 GUI，同时保持直接桌面 CLI、深链和其他平台启动参数的既有行为。
- Done Contract：`--updated` 作为安装器内部 GUI 参数不再触发 CLI passthrough；首次安装与升级启动都能到达 GUI bootstrap；普通 CLI 参数仍完整透传；精确 RED→GREEN、受影响单测、Desktop typecheck、全仓 lint、目标格式检查和真实隔离安装器覆盖升级均通过。系统现有安装未改写，交互式完成页点击保留为发布环境的补充验收。

## 2. 范围与事实

- 范围内：Desktop 启动参数分类、针对 electron-builder Windows 更新参数的回归测试、任务记录与验证。
- 范围外：NSIS UI/安装目录/快捷方式、更新检查与灰度策略、退出时静默安装是否重启、版本发布、签名和对当前已安装应用执行覆盖安装。
- 当前任务单元：修正一个安装器内部参数与桌面 CLI passthrough 的分类冲突。
- 轻量评估：`升级 standard`；实现仅涉及一个源文件和一个测试文件，但需要跨 NSIS、electron-updater 与 Desktop 启动链建立证据。
- 已确认事实：
  - `packages/desktop/electron-builder.yml` 使用 `oneClick: false`；pinned electron-builder `26.8.1` 的 assisted installer 默认展示运行选项。
  - pinned electron-updater `6.8.3` 的 `NsisUpdater` 在升级时传入 `--updated`，NSIS 完成页的 `StartApp` 也会把 `--updated` 传给新可执行文件。
  - 修复前 `parsePassthroughCliArgs` 只过滤 macOS/Linux/Electron wrapper 参数，因而把唯一的 `--updated` 解析成 CLI 参数；`runDesktopStartup` 随后不执行 GUI bootstrap。
  - inline 启动链复现输出为 `{"args":["--updated"],"cliStarted":true,"guiStarted":false}`，连续三次解析结果一致；同一 argv 不会被项目或 Agent 深链解析器消费。
- `grilling` 结论（如使用）：`N/A`。
- 风险与未知：实现已用 exact match 限定 `--updated`，且强制 CLI 模式不忽略该参数；真实隔离 NSIS 覆盖升级和安装后 relaunch 已通过，正式签名包在用户环境的交互式完成页仍需发布验收。

## 3. 涉及文件与计划

| 文件                                                         | 计划变化                                         | 事实源                                        |
| ------------------------------------------------------------ | ------------------------------------------------ | --------------------------------------------- |
| `packages/desktop/src/daemon/cli/passthrough.ts`             | 将 exact `--updated` 分类为安装器注入的 GUI 参数 | electron-builder/electron-updater pinned 源码 |
| `packages/desktop/src/daemon/cli/passthrough.test.ts`        | 增加升级启动参数不会进入 CLI 的精确回归          | Phase 1 inline RED                            |
| `mydocs/micro_specs/0082_修复Windows升级安装后启动.md`、总表 | 记录批准、RED→GREEN、验证与真实隔离覆盖升级验收  | 项目工作流参数                                |

1. 先在 passthrough 测试中固化 `Paseo Reforged.exe --updated` 应返回 `null`，确认精确 RED。
2. 以 exact-match 方式过滤安装器内部参数，不更改普通 CLI 参数和既有 wrapper 前缀规则。
3. 重跑原始 inline 启动链、目标测试、Desktop typecheck、lint 与格式检查，再回写证据。

## 4. 执行前检查点

- 当前目标：修复 Windows 升级安装完成后新可执行文件被错误路由到 CLI、未启动 GUI 的问题。
- 当前进度：已完成 NSIS → electron-updater → `process.argv` → CLI passthrough → Desktop startup 的只读链路核对，并取得稳定 RED。
- 当前动作是否仍服务核心目标：`是；修复点位于首次安装与升级路径唯一不同的 --updated 参数分类。`
- 下一步：获批后先补精确失败测试，再做 exact-match 最小修复并执行验证。
- 风险与回退：不修改安装器/更新器配置；若过滤后 inline 链仍不进入 GUI，立即回退实现并转查旧进程锁或 `launchLink`。
- 验证方式：目标 Vitest RED→GREEN；原始 inline 启动链 GREEN；`npm run typecheck --workspace=@getpaseo/desktop`、`npm run lint`、目标 format check；新安装包的真实隔离覆盖升级与 `--updated` GUI/CDP relaunch 已验收。
- TDD 判定、测试 seam 与验收行为：`TDD；seam = parsePassthroughCliArgs 的真实 packaged argv 分类，验收为唯一 --updated 返回 null、普通 --version/daemon 参数仍透传；runDesktopStartup 既有测试证明 null 分类继续 GUI bootstrap。`
- seam 确认：`User；用户批准包含 packaged argv 分类 seam 的 0082 checkpoint。`
- Execution Approval / Source：`Approved / User；用户于 2026-08-18 00:53 明确批准执行 0082。`

## 5. 执行与变更记录

- 实际改动：在 Desktop CLI passthrough 分类器中登记 exact `--updated` GUI 参数，仅在非强制 CLI 启动时过滤；新增 Windows packaged executable argv 回归，证明升级重启不会进入 CLI。
- 偏差与用户决策：根 `npm run typecheck` 被既有 `packages/app/e2e/browser/workspace-navigation-regression.spec.ts:231` 类型错误阻塞；该文件不在 0082 范围且在执行前已由其他工作修改，因此不越界修复。Desktop 自身 typecheck 通过。
- Change Log：`2026-08-18 00:44` 完成根因定位与稳定 inline RED，建立 standard micro-spec，等待执行批准；`2026-08-18 00:53` 用户批准执行、精确回归测试、修复和静态检查，任务进入 Execute；`2026-08-18 00:59` 精确单测完成 RED→GREEN，原始启动链、Desktop typecheck、全仓 lint、格式和差异检查通过；`2026-08-28 23:05` 生成 `0.4.0-beta.4` Windows x64 NSIS 包，在隔离 Temp 目录完成 `0.2.0-beta.1` → `0.4.0-beta.4` 覆盖安装，并从覆盖后的真实安装目录以 `--updated` 启动 GUI/CDP，通过 packaged desktop smoke，任务收口。

## 6. 验证与完成判断

| 验收项                 | 命令或步骤                                                                           | 结果   | 证据                                                                                        |
| ---------------------- | ------------------------------------------------------------------------------------ | ------ | ------------------------------------------------------------------------------------------- |
| 升级 argv 启动链基线   | inline `tsx`：解析 `Paseo Reforged.exe --updated` 后运行 startup                     | `RED`  | `args=["--updated"]`、`cliStarted=true`、`guiStarted=false`                                 |
| 重复性                 | inline `tsx` 连续解析三次                                                            | `RED`  | 三次均为 `["--updated"]`                                                                    |
| 深链排除               | inline `tsx` 调用 project/agent argv parser                                          | `PASS` | 两者均为 `null`                                                                             |
| 精确回归 RED           | `npx vitest run src/daemon/cli/passthrough.test.ts --bail=1`                         | `RED`  | 新用例收到 `["--updated"]` 而非 `null`；`1 failed`                                          |
| 精确回归 GREEN         | 同上                                                                                 | `PASS` | `1 file / 12 tests`                                                                         |
| 原始启动链 GREEN       | 原 inline `tsx` startup harness                                                      | `PASS` | `args=null`、`cliStarted=false`、`guiStarted=true`                                          |
| Desktop typecheck      | `npm run typecheck --workspace=@getpaseo/desktop`                                    | `PASS` | exit `0`                                                                                    |
| 全仓 lint              | `npm run lint`                                                                       | `PASS` | `0 warnings / 0 errors`，`3520 files`                                                       |
| 目标格式与差异检查     | `npm run format:check:files -- <4 个任务文件>`；`git diff --check -- <4 个任务文件>` | `PASS` | 格式正确；无 whitespace error                                                               |
| Windows x64 构建       | `npm.cmd run build:desktop -- --publish never --win --x64`                           | `PASS` | 生成 `Paseo-Reforged-Setup-0.4.0-beta.4-x64.exe` 及解包目录                                 |
| 隔离 NSIS 覆盖升级     | 临时目录内运行旧版与新版安装器 `/S /D=<temp>`                                        | `PASS` | 旧版文件版本 `0.2.0-beta.1`，新版覆盖后为 `0.4.0-beta.4`，两次退出码均为 `0`                |
| 覆盖后 `--updated` GUI | 覆盖后的真实安装目录运行 `Paseo Reforged.exe --updated`，注入隔离 CDP 端口           | `PASS` | 进程保持 running、CDP TCP listener 就绪，版本 `0.4.0-beta.4`，进程已回收                    |
| Packaged desktop smoke | `node packages/desktop/e2e/packaged-app-smoke.js --app <win-unpacked>`               | `PASS` | renderer/preload、desktop daemon、bundled CLI status/terminal 全部通过                      |
| 根 workspace typecheck | `npm run typecheck`                                                                  | `FAIL` | 既有 App 测试 `workspace-navigation-regression.spec.ts:231`：1 元素 tuple 不满足 2 元素类型 |

- 未验证项与原因：未通过 UI 自动化点击 assisted NSIS 完成页的“运行”复选框；该页与 electron-updater 都向新 exe 传递同一个 exact `--updated` 参数，参数路径已在覆盖后的真实安装目录验证。系统现有安装目录未触碰。
- 剩余风险：正式签名包在用户环境的完成页交互和安全软件策略仍需发布验收；不影响本次参数分类修复的自动化与真实安装目录证据。
- Done Contract 是否由证据满足：`是；精确回归、真实隔离 NSIS 覆盖安装、覆盖后 --updated GUI/CDP 与 packaged smoke 均通过，任务已收口。`

## 7. 恢复与同步

- 状态说明：`Review / 已收口`。
- 当前卡点：无；系统现有安装未触碰，正式签名包完成页交互属于发布验收。
- 下一步唯一动作：发布前在干净 Windows 环境用正式签名包复核 assisted NSIS 完成页运行选项。
- Resume / Handoff：代码与自动验证已完成；恢复时只需读本 micro-spec，并按上述双版本步骤完成 Windows 人工验收。
- Project Sync Candidates：`无；根因与修复合同由回归测试长期承载。`
- 长期文档同步：`N/A`。

### 提交记录

| 提交信息（Commit Message）                         | 提交脚注（Commit Footer） | 关联改动或阶段          | 文档同步状态 | 备注                                      |
| -------------------------------------------------- | ------------------------- | ----------------------- | ------------ | ----------------------------------------- |
| `fix(desktop): relaunch GUI after Windows updates` | `N/A`                     | `0082 Execute / Review` | `随提交同步` | 真实隔离覆盖升级与 `--updated` GUI 已验收 |
