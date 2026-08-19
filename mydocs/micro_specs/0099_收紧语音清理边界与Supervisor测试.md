# 收紧语音清理边界与 Supervisor 测试 Micro Spec

## 0. 状态与索引

| 字段               | 值                                                            |
| ------------------ | ------------------------------------------------------------- |
| task_id            | `0099`                                                        |
| spec layer         | `Feature Spec`                                                |
| task status        | `已收口`                                                      |
| document status    | `Completed`                                                   |
| depth              | `standard`                                                    |
| phase              | `Review`                                                      |
| Execution Approval | `Approved`                                                    |
| Approval Source    | `User`                                                        |
| file path          | `mydocs/micro_specs/0099_收紧语音清理边界与Supervisor测试.md` |
| follow-up of       | `mydocs/micro_specs/0096_Supervisor日志容错与语音下载清理.md` |
| parent spec        | `N/A`                                                         |
| superseded by      | `N/A`                                                         |
| created / updated  | `2026-08-19 16:20 / 2026-08-19 21:00`                         |

## 1. 目标与完成契约

- 当前理解：0096 的提交后静态审查发现，语音启动清理会递归进入任意可配置模型目录并随每次 reconcile 重复执行；Supervisor 的故障回归还依赖固定等待且 fixture 会遗留临时目录。
- 核心目标：把 0096 的语音清理收紧为一次性、Paseo-owned 的启动维护，并让真实 Supervisor 子进程测试通过显式握手稳定证明日志故障后的存活与正常退出。
- Done Contract：`createSpeechService().start()` 只清理 `.downloads` 和 catalog 已知模型目录内超过 7 天的 downloader 临时文件，不删除模型根或未知模型目录中的同名文件，不跟随目录链接；后续 reconcile 不再次扫描；Supervisor 测试在捕获真实 stderr 故障标记后才释放 worker，且所有成功、失败、超时路径都等待 fixture-owned 子进程关闭并回收临时目录；提交前静态审查中的 Standards P2/P3 全部消除；逐个 `RED -> GREEN`、目标 Vitest、根级 typecheck/lint、目标格式与 diff 检查完成；不重启或连接 `127.0.0.1:6767`，本地提交不推送或发布。

## 2. 范围与事实

- 范围内：0096 清理根目录的所有权边界、speech runtime 一次性启动边界、真实文件系统行为测试、Supervisor fixture 的显式同步和资源回收。
- 范围外：改变 7 天阈值、清理完整模型/正式归档、自动清理 `.codex` 或系统 Temp、重构语音 provider、改变 Supervisor 产品日志降级策略、重启 daemon、推送或发布。
- 当前任务单元：在既有四项修复之上，继续处理正式静态审查确认的两个 Spec P2 与五个 Standards P2/P3，不扩展到新的维护能力。
- 轻量评估：`standard`；目标清晰且局限于 server，但跨真实文件系统、runtime 生命周期和真实子进程两个 seam。
- 已确认事实：0096 提交为 `20072b6bf`；当前 `HEAD` 为其后继，目标代码文件相对工作区无未提交改动，`mydocs/todolist.md` 含其他任务的既有改动，必须增量编辑。
- 已确认事实：当前清理由 `initializeLocalSpeechServices()` 调用并递归扫描 `modelsDir`；该初始化也由 monitor/reconcile 重复调用。
- 已确认事实：downloader 当前只在 `<modelsDir>/.downloads` 写归档临时文件，并在 catalog `extractedDir` 内存在旧版单文件临时残留；其他根目录和未知模型目录不属于可删除范围。
- 风险与未知：目录链接必须作为叶节点跳过；一次性清理失败仍应 best-effort 降级，不能阻止 speech runtime 启动；Windows 超时清理需等待被 kill 的子进程真正关闭，避免文件占用竞态。
- 审查追加事实：POSIX 回归会启动一个比 supervisor 存活更久的 detached descendant；当前 `finally` 在 supervisor 已退出时不会再清理该后代，因而“等待进程树关闭”的既有记录不成立。
- 审查追加事实：Node 的可移植 `fs` API 没有 `openat` / `unlinkat`，无法对同一用户恶意并发替换目录提供完全 race-free 的递归删除；本任务把“不跟随目录链接”约束为清理开始时与遍历中观察到的链接均作为叶节点跳过，并用真实 symlink fixture 固化。若要求抵御同权限恶意 TOCTOU，需要原生目录句柄能力，属于本任务外的安全架构升级。

## 3. 涉及文件与计划

| 文件                                                                                                                  | 计划变化                                                                     | 事实源                              |
| --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ----------------------------------- |
| `packages/server/src/server/speech/providers/local/sherpa/model-downloader.ts`                                        | 只扫描 `.downloads` 与 catalog 已知 `extractedDir`，跳过目录链接             | downloader 写入位置与 model catalog |
| `packages/server/src/server/speech/providers/local/runtime.ts`、`packages/server/src/server/speech/speech-runtime.ts` | 从可重复 initialize 移除清理，挂到 `start()` 一次性边界                      | runtime 调用链                      |
| `packages/server/src/server/speech/providers/local/runtime.test.ts`                                                   | 用真实临时文件系统约束 owned roots、未知目录保留和 reconcile 不重复清理      | 已确认 speech runtime seam          |
| `packages/server/scripts/supervisor.logging.test.ts`                                                                  | stderr 故障标记与 stdin 释放握手；fixture `try/finally` 回收并等待 kill 完成 | 已确认真实子进程 seam               |
| `mydocs/micro_specs/0099_收紧语音清理边界与Supervisor测试.md`、`mydocs/todolist.md`                                   | 记录批准、TDD 证据、验证和收口                                               | 项目工作流参数                      |

1. RED：通过 speech runtime 启动和真实临时文件系统证明未知目录旧临时文件会被误删；GREEN：清理只遍历 owned roots。
2. RED：首次启动后创建第二个过期临时文件并触发 reconcile，证明当前会重复清理；GREEN：把清理移到 `start()` 的一次性启动边界。
3. 加固 Supervisor fixture：捕获故障标记后显式释放 worker，所有路径等待退出并回收临时目录；运行该真实子进程文件回归。
4. 运行根级 typecheck/lint、目标 format check 与 `git diff --check`，回写本 spec 和任务总表。
5. RED-3：让 worker descendant 长时间存活并在 fixture 返回后探测 PID，证明当前成功路径会泄漏后代；GREEN-3：由 fixture 向 worker 提供临时 PID registry，返回前逐个清理登记的后代并等待 PID 退出。
6. 增加真实目录链接 fixture，证明静态链接和遍历中观察到的链接保持为叶节点；记录 Node 可移植 API 下无法完全关闭的同权限恶意 TOCTOU 边界。
7. 按正式审查逐项消除错误类型断言、内联对象签名、多位置参数、多子句条件、模糊命名和 aged-file fixture 重复，再运行目标验证。

## 4. 执行前检查点

- 当前目标：语音清理仅在 speech runtime 启动时触碰 Paseo 明确拥有的临时下载位置，Supervisor 故障测试不再依赖计时或泄漏资源。
- 当前进度：0099 第一轮实现与正式静态审查已完成；审查发现两个 Spec P2 与五个 Standards P2/P3，用户已明确授权在同一 follow-up 中全部处理，任务重新进入 Execute。
- 当前动作是否仍服务核心目标：`是；只修复 0096 审查项。`
- 下一步：先完成 descendant 泄漏 RED -> GREEN，再固化目录链接契约，最后逐项消除 Standards findings。
- 风险与回退：不跟随目录链接，不把 best-effort 清理变为启动硬依赖；若真实 `createSpeechRuntime().start()` seam 需要扩大公共接口或引入 mock，暂停并重评测试设计。
- 验证方式：逐个运行受影响的单个 Vitest 文件并带 `--bail=1`；完成后运行根级 `npm run typecheck`、`npm run lint`、目标格式检查和 `git diff --check`。
- TDD 判定、测试 seam 与验收行为：`TDD；seam 1 为 createSpeechRuntime().start() + 真实临时文件系统，验收 owned roots、未知目录保留及 reconcile 不重复清理；seam 2 为 runSupervisor() 真实子进程，验收真实日志故障后继续输出并正常退出。`
- seam 确认：`User；用户此前已明确确认 0096 的两个 TDD seam，本 follow-up 保持相同公开边界。`
- Execution Approval / Source：`Approved / User`

## 5. 执行与变更记录

- 实际改动：`cleanupStaleSherpaOnnxModelDownloads()` 只枚举 `.downloads` 与 catalog `extractedDir`，逐组件 `lstat` 并把目录/文件链接作为叶节点跳过；清理调用从可重复的 `initializeLocalSpeechServices()` 移到 `createSpeechService().start()` 首次 reconcile 前。真实文件系统测试覆盖根目录/未知模型保留、linked root/catalog 子目录不跟随及模型补齐后的 reconcile 不重复清理。Supervisor fixture 以 stderr 故障标记 -> stdin release 显式握手替代固定等待，并通过 fixture-owned PID registry 在返回前 tree-kill、等待所有登记后代退出，再删除临时目录。正式审查命中的类型断言、内联多属性签名、多位置参数、多子句条件、模糊命名和重复 aged-file helper 已逐项消除。`
- 偏差与用户决策：`7 天阈值沿用用户对 0096 的明确决定；本轮按提交后静态审查结果创建独立 follow-up。`
- Change Log：`2026-08-19 16:20` 核实 0096 提交、四项审查问题和工作区并行改动；创建 0099，进入已批准 Execute。
- Change Log：`2026-08-19 16:45` RED-1 通过公开 speech runtime 与真实文件系统复现根目录旧临时文件被误删；目标测试在 staleRootFile 保留断言处按预期失败。
- Change Log：`2026-08-19 16:47` GREEN-1 通过；清理只进入 `.downloads` 与三个 catalog 模型目录，根目录和未知模型目录保留。
- Change Log：`2026-08-19 16:52` RED-2 通过 readiness 事件驱动真实模型补齐与后续 reconcile；第二个 8 天旧临时文件被重复删除，目标测试按预期失败。
- Change Log：`2026-08-19 16:55` GREEN-2 通过；清理移到 `createSpeechService().start()` 一次性边界，目标文件 `2/2` 通过。
- Change Log：`2026-08-19 17:06` Supervisor fixture 完成显式握手、进程树等待和 `try/finally` 回收；全文件 `8 passed / 3 skipped`，两轮新回归均未留下临时目录。
- Change Log：`2026-08-19 17:17` 目标回归、typecheck、目标 lint、格式和 diff 门禁完成；根 lint 仅受范围外 Relay 新文件的一个嵌套三元错误阻塞，按验证例外收口。
- Change Log：`2026-08-19 18:23` 正式静态审查报告两个 Spec P2 与五个 Standards P2/P3；用户授权在同一 0099 follow-up 中一并处理，任务重新进入 Execute。
- Change Log：`2026-08-19 18:32` RED-3 通过跨平台真实子进程 seam 复现：supervisor code 0 正常退出后，worker 登记的长驻 descendant PID 仍存活；测试 `finally` 已强制回收该 PID。原定 POSIX 进程组方案调整为跨平台 PID registry，不改变验收行为。
- Change Log：`2026-08-19 20:34` GREEN-3 与目录链接回归通过；fixture 在返回前回收登记后代，真实文件系统覆盖 linked root 与 linked catalog 子目录，实现同时把观察到的 file link 作为叶节点跳过。五项 Standards findings 完成逐项核对；四个目标 Vitest 文件、根级 typecheck/lint、0099-owned 格式与 diff 检查全绿，任务进入 Review / 待提交。
- Change Log：`2026-08-19 21:00` 用户授权只暂存 0099 对应改动并创建本地提交、不推送；提交前按路径与总表 0099 hunk 精确核对 staged diff，任务收口。

## 6. 验证与完成判断

| 验收项                      | 命令或步骤                                                        | 结果 | 证据                                                                                                                          |
| --------------------------- | ----------------------------------------------------------------- | ---- | ----------------------------------------------------------------------------------------------------------------------------- |
| 任务与编号一致性            | 扫描总表、`mydocs/specs/`、`mydocs/micro_specs/`                  | PASS | `0098` 已占用，首个空闲编号为 `0099`                                                                                          |
| Owned roots RED-1           | `runtime.test.ts -t "removes stale downloader files..." --bail=1` | RED  | 期望根目录旧临时文件保留，实际已删除；`1 failed`                                                                              |
| Owned roots GREEN-1         | `runtime.test.ts --bail=1`                                        | PASS | 当时目标用例 `1/1` 通过；根目录与未知模型目录保留，owned roots 过期文件删除                                                   |
| One-shot reconcile RED-2    | `runtime.test.ts --bail=1`                                        | RED  | 模型补齐后的 reconcile 删除第二个旧临时文件；`1 failed / 1 passed`                                                            |
| One-shot reconcile GREEN-2  | `runtime.test.ts --bail=1`                                        | PASS | 当时 `2/2`；首次旧文件删除，readiness 驱动的真实后续 reconcile 保留第二个旧文件                                               |
| Descendant cleanup RED-3    | `supervisor.logging.test.ts -t "reaps registered..." --bail=1`    | RED  | supervisor 正常退出并返回后，fixture worker 创建并登记的长驻 descendant PID 仍存活                                            |
| Supervisor / GREEN-3        | `supervisor.logging.test.ts --bail=1`                             | PASS | `9 passed / 3 skipped`；日志故障握手、正常退出及 fixture-owned descendant 返回前回收均成立                                    |
| 目录链接边界                | `runtime.test.ts --bail=1`                                        | PASS | `3/3`；只清理 owned roots，保留未知目录和 linked root/catalog 子目录指向的外部旧文件，reconcile 不重复清理                    |
| Downloader 回归             | `model-downloader.test.ts --bail=1`                               | PASS | `2/2`                                                                                                                         |
| Speech runtime 回归         | `speech-runtime.test.ts --bail=1`                                 | PASS | `2/2`                                                                                                                         |
| Standards P2/P3 对账        | 正式 finding 逐项核对；根级 `npm run lint`                        | PASS | 类型守卫、命名 interface、options object、具名条件、`supervisorRun` 与统一 aged-file helper 均已落地；`0 warnings / 0 errors` |
| 根级类型检查                | `npm run typecheck`                                               | PASS | 退出码 `0`；未留下生成物改动                                                                                                  |
| 0099-owned 格式与差异检查   | `format:check:files` 七个独占文件；`git diff --check`             | PASS | 七个文件格式正确；whitespace 检查退出码 `0`                                                                                   |
| 共享总表格式核对            | 总表全文件 formatter 对比                                         | PASS | 0099 第 153 行与 formatter 输出一致；全文件唯一差异是并行 0090 第 143 行既有尾随空格，未越权修改                              |
| Supervisor fixture 资源回收 | 回归后扫描 `%TEMP%/paseo-supervisor-log-*`                        | PASS | `2026-08-19 19:45` 后无遗留目录                                                                                               |
| 主 daemon 保护              | 执行过程审计                                                      | PASS | 未启停或连接 `127.0.0.1:6767`                                                                                                 |

- 未验证项与原因：`按项目规则未运行完整本地测试套件，也未对生产 daemon 注入日志流故障；两个既有真实 seam 和受影响单文件已覆盖。POSIX-only 的 3 个 Supervisor 用例在 Windows 按既有平台门禁跳过。`
- 剩余风险：`历史 0096 Supervisor fixture 目录仍保留且本轮未越权删除。Node 可移植 fs API 没有 openat/unlinkat：当前实现会在遍历和删除前重复 lstat 每个目录组件并拒绝观察到的链接，但不能从理论上消除同权限外部进程在最后一次 lstat 与 rm 之间恶意替换目录的 TOCTOU；完全抵御需要原生目录句柄能力，属于另一个安全架构任务。`
- Done Contract 是否由证据满足：`是；三个 RED -> GREEN、四个目标测试文件、正式 finding 逐项核对、根级 typecheck/lint、0099-owned 格式与 diff 检查均通过；剩余恶意 TOCTOU 已按 Node 可移植 API 的能力边界明确记录。`

## 7. 恢复与同步

- 状态说明：`Review / 已收口 / Completed`
- 当前卡点：`无。`
- 下一步唯一动作：`0099 无剩余代码动作；本地提交保持未推送。`
- Resume / Handoff：`0099 已通过精确 staged diff 创建本地提交；共享 mydocs/todolist.md 的其他任务改动保持未暂存。生产 6767 daemon 未触碰。`
- Project Sync Candidates：`无；当前均为 0096 实现和测试修正。`
- 长期文档同步：`无需新增；0096 已在 docs/development.md 记录 durable logging 降级行为，本 follow-up 的所有权与生命周期细节由实现、测试和本 Feature Spec 维护。`

### 提交记录

| 提交信息（Commit Message）                                   | 提交脚注（Commit Footer） | 关联改动或阶段 | 文档同步状态 | 备注             |
| ------------------------------------------------------------ | ------------------------- | -------------- | ------------ | ---------------- |
| `fix(server): harden speech cleanup and supervisor fixtures` | `N/A`                     | `0099`         | `已同步`     | 本地提交；未推送 |
