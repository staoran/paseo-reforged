# Supervisor 日志容错与语音下载清理 Micro Spec

## 0. 状态与索引

| 字段               | 值                                                            |
| ------------------ | ------------------------------------------------------------- |
| task_id            | `0096`                                                        |
| spec layer         | `Feature Spec`                                                |
| task status        | `已收口`                                                      |
| document status    | `Completed`                                                   |
| depth              | `standard`                                                    |
| phase              | `Review`                                                      |
| Execution Approval | `Approved`                                                    |
| Approval Source    | `User`                                                        |
| file path          | `mydocs/micro_specs/0096_Supervisor日志容错与语音下载清理.md` |
| parent spec        | `N/A`                                                         |
| superseded by      | `N/A`                                                         |
| created / updated  | `2026-08-19 10:26 / 2026-08-19 14:04`                         |

## 1. 目标与完成契约

- 当前理解：daemon 的 durable log stream 发生错误时，supervisor 不应因无人监听的 `error` 事件直接退出；daemon 启动时还应 best-effort 清理语音模型目录内由 downloader 遗留的过期临时下载文件。本任务同时继续只读审计 `.codex` 与系统 Temp 的约 24 GiB 占用，不直接删除。
- 核心目标：把日志持久化和临时文件清理都降级为不会拖垮 daemon 的辅助能力，并用真实进程/真实文件系统的行为测试约束。
- Done Contract：日志目标发生真实 stream error 后，supervisor 仍保持运行、继续转发 worker 输出并可正常关闭；语音 runtime 启动会删除超过 7 天且匹配 downloader 临时命名的文件，同时保留新鲜临时文件、正式模型、正式下载归档和未知文件；两个 seam 均完成逐个 `RED -> GREEN`；目标 Vitest、根级 typecheck、lint、目标格式和 diff 检查通过；`.codex`/Temp 形成按风险分级的只读清理报告；不重启或干扰 `127.0.0.1:6767`。

## 2. 范围与事实

- 范围内：supervisor rotating log stream 的错误处理与 stderr 降级；语音模型 downloader 所有权范围内的 `*.tmp-<timestamp>` 启动清理；相应单元/进程测试；`.codex` 和用户系统 Temp 的只读空间审计。
- 范围外：自动重启 supervisor、daemon/Agent 生命周期重构、日志后端替换、删除完整模型或正式缓存归档、自动清理 `.codex`/Temp、重启生产 daemon、提交或发布。
- 当前任务单元：先让 durable logging 失败不再成为 supervisor 单点故障，再把 downloader 临时文件的生命周期闭合到语音 runtime 启动边界，最后交付本机空间候选分级。
- 轻量评估：`standard`；行为目标清晰，但跨 supervisor 子进程、语音 runtime/文件系统和本机只读审计，且必须维护两个独立 TDD vertical slices。
- 已确认事实：`packages/server/scripts/supervisor.ts` 创建 `rotating-file-stream` 后没有注册 `error` listener；Node.js 官方文档说明 EventEmitter 的无人监听 `error` 会抛出并退出进程；`rotating-file-stream` 文档把 `error` 定义为关闭 stream 的 fatal event，建议调用方监听处理。
- 已确认事实：worker stdout/stderr 和 supervisor lifecycle 日志都会写入同一个 rotating stream；当前 `writeDurableChunk()` 没有故障降级，`closeLogStream()` 也没有针对已失败 stream 的显式完成路径。
- 已确认事实：`downloadToFile()` 生成 `${outputPath}.tmp-${Date.now()}`；当前归档目标位于 `<modelsDir>/.downloads`；旧版本也曾把单文件模型临时文件写到模型目录内，因此清理只匹配 downloader 专有后缀，不按任意文件名删除。
- 已确认事实：完整模型存在时不会调用 `ensureSherpaOnnxModel()`，所以只在 downloader early return 前清理不足以兑现“启动清理”；清理入口必须挂到实际随 local speech runtime 初始化执行的边界。
- 已确认事实：上一轮已人工删除 6 个超过两周的旧下载临时文件，共 `1,040,981,460` 字节；正式模型完整，`C:\Users\staor\.paseo\models\local-speech\.downloads` 当前为空。
- 已确认事实：`keep-codex-fast` report-only 结果显示 `.codex` 中 sessions `4.606 GiB`、worktrees `3.238 GiB`、active log SQLite `3513 MiB`、archived sessions `0.609 GiB`；有 `3.074 GiB` 旧 session 候选、`3.238 GiB` worktree 候选和明显 thread metadata bloat。Codex 正在运行，因此本轮不能 apply。
- 已确认事实：`.codex/sqlite` 另有 `2.524 GiB` 的旧 SQLite 树，最后写入停在 2026-06-30，而根目录同名数据库仍在当前写入；它是高收益的疑似迁移遗留，只能在 Codex 关闭后先移入可恢复归档验证，不能直接删除。`.codex/.tmp` 还有 `0.675 GiB` marketplace/plugin cache，同样只能关闭 Codex 后处理。
- 已确认事实：两处主要 Codex worktree 各约 `1.619 GiB`，且都仍被源仓库登记；其中一处干净，可在确认不再续接或已有 handoff 后通过维护工具归档；另一处有未提交源码、测试和任务文档，明确禁止清理或移动。
- 已确认事实：系统 Temp 当前共 `6.508 GiB`，其中 Visual Studio Installer 后台下载/解压目录共 `5.712 GiB`；今日安装日志为 `Completed install` 且 error log 为空，当前也没有 setup/install 进程，因此关闭 Visual Studio Installer 后属于高收益条件清理候选。`Temp\1` 与当前 Codex/Node 启动时间重合且持续写入，当前禁止清理。
- 已确认事实：一批 2026-07 至 2026-08 初的研究、probe 和 review 临时目录合计数百 MiB，名称和最后写入均表明是一次性产物，可在单独确认后优先回收；当前 C 盘可用空间约 `12.43 GiB`。
- `grilling` 结论（如使用）：`N/A`；实现边界可由现有源码与用户目标确认。
- 风险与未知：用户已把过期阈值明确改为 7 天；Windows 上应使用真实文件目标触发稳定的 stream error；清理遍历必须限定到 downloader 所有权目录/命名，且清理失败不得阻塞语音 runtime 启动。
- 工作区保护：仓库存在大量其他任务改动；目标 supervisor 两文件当前 blob 与 `HEAD` 相同但被 Git 标为工作区修改，实施时只形成 0096 的语义 diff，不触碰其他改动。

## 3. 涉及文件与计划

| 文件                                                                                                                          | 计划变化                                                                                              | 事实源                                               |
| ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `packages/server/scripts/supervisor.logging.test.ts`                                                                          | 扩展真实子进程 fixture，以不可写日志目标触发 stream error，并从进程外观察存活、输出转发和正常关闭     | `runSupervisor()` 公开进程行为 seam                  |
| `packages/server/scripts/supervisor.ts`                                                                                       | 立即监听 durable stream `error`，单次直写 stderr 后禁用后续 durable writes；关闭时不等待已失败 stream | Node EventEmitter 与 `rotating-file-stream` 错误契约 |
| `packages/server/src/server/speech/providers/local/runtime.test.ts`                                                           | 通过 runtime 初始化和真实临时文件系统证明过期临时文件被清理且正式/新鲜/未知文件保留                   | 已确认的 local speech runtime seam                   |
| `packages/server/src/server/speech/providers/local/sherpa/model-downloader.ts`                                                | 实现有界、best-effort 的过期临时下载清理                                                              | `${outputPath}.tmp-${Date.now()}`                    |
| `packages/server/src/server/speech/providers/local/models.ts`、`packages/server/src/server/speech/providers/local/runtime.ts` | 通过 local speech runtime 初始化边界触发一次清理，不依赖模型是否缺失                                  | daemon 启动的语音初始化链路                          |
| `docs/development.md`                                                                                                         | 记录 durable log stream 故障时降级到 stderr、保持 daemon/Agent 在线的稳定行为                         | 已验证的 supervisor 进程行为                         |
| `mydocs/micro_specs/0096_Supervisor日志容错与语音下载清理.md`、`mydocs/todolist.md`                                           | 记录批准、逐个 TDD cycle、验证和空间审计结论                                                          | 项目工作流参数                                       |

1. RED-1：在真实 supervisor 子进程中令日志 stream 报错；worker 在错误之后输出标记并请求正常 shutdown，证明当前实现会提前退出。
2. GREEN-1：最小增加 stream error listener、stderr fallback 和失败后禁写/安全关闭，再只运行 `supervisor.logging.test.ts --bail=1`。
3. RED-2：在真实临时模型目录中构造过期与新鲜的 downloader 临时文件、正式归档、完整模型和未知文件，通过 local speech 启动路径证明当前不会清理。
4. GREEN-2：实现 7 天阈值、限定命名/目录的 best-effort 清理并接入 local speech 初始化，再只运行受影响的单个 Vitest 文件。
5. 执行根级 `npm run typecheck`、`npm run lint`、目标 format check 与 `git diff --check`；回写验证和 `.codex`/Temp 分级报告。

## 4. 执行前检查点

- 当前目标：日志文件故障不再让 supervisor/全部 Agent 掉线；语音模型下载的过期临时残留在 daemon 启动时自动、安全地回收。
- 当前进度：根因、调用链、两个测试 seam 和本机空间占用均已核实；用户已批准执行并把临时下载过期阈值改为 7 天，尚未写测试或生产代码。
- 当前动作是否仍服务核心目标：`是；所有代码变化都限定在日志容错和 downloader-owned 临时文件生命周期。`
- 下一步：先完成 RED-1 -> GREEN-1；确认 GREEN 后才进入 RED-2 -> GREEN-2。
- 风险与回退：日志降级不能递归写回故障 stream；清理不得跟随未知目录删除或触碰正式文件；任一 seam 暴露范围升级时先回写本 spec 并暂停。生产 `6767` 全程保持不变。
- 验证方式：`npx vitest run <单个受影响文件> --bail=1`；代码完成后根级 `npm run typecheck`、`npm run lint`、`npm run format:check:files -- <目标文件>` 与 `git diff --check`；不运行全量测试。
- TDD 判定、测试 seam 与验收行为：`TDD；seam 1 是 runSupervisor 的真实子进程边界，验收日志 stream error 后进程不提前退出、worker 输出仍透传且正常 shutdown；seam 2 是 local speech runtime 初始化 + 真实临时文件系统，验收只删除超过 7 天且匹配 downloader 临时命名的文件。`
- seam 确认：`User；用户回复“批准按 0096 执行，确认两个 TDD seam，但把临时下载过期阈值改为 7 天”。`
- Execution Approval / Source：`Approved / User`

## 5. 执行与变更记录

- 实际改动：`两个 seam 均完成 RED→GREEN。Supervisor 对 rotating stream 的 fatal error 立即注册监听，单次降级到 stderr 并停止后续 durable writes，worker 输出与正常 shutdown 继续；local speech runtime 初始化递归扫描模型根但不跟随目录链接，只删除 mtime 超过 7 天且精确匹配 .tmp-数字 后缀的普通文件，读取/删除失败仅 warning。`
- 偏差与用户决策：`用户确认两个 TDD seams，并把计划中的 14 天过期阈值改为 7 天；计划中的 downloader 测试文件调整为已确认 seam 对应的 runtime.test.ts，以真实初始化边界覆盖行为。`
- Change Log：`2026-08-19 10:26` 完成 Research/Plan，创建 0096 micro-spec；运行 `.codex` report-only 和系统 Temp 只读统计；未修改代码或本机状态。
- Change Log：`2026-08-19 10:50` 完成空间候选分级；确认一处 dirty Codex worktree 必须保留，VS Installer 临时文件需关闭安装器后再处理，所有扫描保持只读。
- Change Log：`2026-08-19 10:59` 用户批准 0096 与两个 TDD seams，并明确采用 7 天过期阈值；任务进入 Execute。
- Change Log：`2026-08-19 11:06` RED-1 通过真实目录型日志目标稳定触发 stream error；supervisor 以 code 1 提前退出，确认无人监听的日志流错误是直接退出路径。
- Change Log：`2026-08-19 11:09` GREEN-1 通过；目标故障测试与完整 supervisor logging 文件均通过，下一步进入 7 天语音下载临时文件启动清理 RED。
- Change Log：`2026-08-19 11:14` RED-2 通过真实 runtime 初始化与临时文件系统确认 8 天旧 downloader 临时文件仍然存在，目标测试按预期失败。
- Change Log：`2026-08-19 11:17` GREEN-2 通过；8 天旧临时文件被删除，6 天新鲜文件、正式归档、正式模型和未知命名均保留；既有 downloader 回归 `2/2` 通过。
- Change Log：`2026-08-19 11:31` 完成测试 fixture 自清理、静态/格式门禁和长期文档同步；最终全仓 lint 的 9 个范围外 App/Relay 错误如实记录，0096 目标文件 lint 为 `0/0`，任务收口。
- Change Log：`2026-08-19 14:04` 用户授权只暂存 0096 对应改动并创建本地提交，不推送；提交后以该提交父节点为固定基线执行只读静态审查。

## 6. 验证与完成判断

| 验收项                | 命令或步骤                                                  | 结果         | 证据                                                      |
| --------------------- | ----------------------------------------------------------- | ------------ | --------------------------------------------------------- |
| 任务与编号一致性      | 扫描总表、`mydocs/specs/`、`mydocs/micro_specs/`            | PASS         | `0087` 至 `0095` 已占用，首个空闲编号为 `0096`            |
| `.codex` 首次维护报告 | `keep_codex_fast.py` report mode                            | PASS（只读） | `effective_mode report`、`read_only=true`、未执行 apply   |
| 本机空间候选分级      | 文件年龄、类型、活动进程与 Git worktree 状态                | PASS（只读） | dirty worktree 已标为禁止处理；VS 安装日志已正常完成      |
| Supervisor 基线       | `npx vitest run ...supervisor.logging.test.ts --bail=1`     | PASS         | 改动前 `7 passed / 3 skipped`                             |
| Supervisor RED-1      | 目标文件 `-t "continues supervising..." --bail=1`           | RED（预期）  | 期望 code 0，实际 code 1；`1 failed / 10 skipped`         |
| Supervisor GREEN-1    | 同一目标测试                                                | PASS         | `1 passed / 10 skipped`                                   |
| Supervisor 文件回归   | `npx vitest run ...supervisor.logging.test.ts --bail=1`     | PASS         | `8 passed / 3 skipped`                                    |
| Speech RED-2          | `runtime.test.ts --bail=1`（实现前）                        | RED（预期）  | `1 failed`；8 天旧临时文件仍存在                          |
| Speech GREEN-2        | `runtime.test.ts --bail=1`                                  | PASS         | `1 passed`；fixture 增加 finally 回收后复跑仍通过         |
| Downloader 回归       | `model-downloader.test.ts --bail=1`                         | PASS         | `2 passed`                                                |
| 根级类型检查          | `npm run typecheck`                                         | PASS         | 退出码 `0`                                                |
| lint                  | `npm run lint`；`npx oxlint <0096 六个目标文件>`            | 部分通过     | 全仓被 9 个范围外 App/Relay 错误阻塞；目标文件 `0 errors` |
| 格式与差异检查        | `format:check:files <0096 六文件>`；全仓 `git diff --check` | PASS         | 目标格式正确；全仓 whitespace 检查退出码 `0`              |
| 主 daemon 保护        | 执行过程审计                                                | PASS         | 未启停或连接 `127.0.0.1:6767`                             |

- 未验证项与原因：未在正在运行的生产 daemon 上注入日志故障，也未重启生产实例；真实进程 fixture 已覆盖同一 supervisor 边界。全仓 lint 因其他并行任务的 9 个 App/Relay 错误未全绿，0096 目标 lint 已通过。
- 剩余风险：日志流降级后，该 supervisor 进程剩余生命周期不再写 durable file，运维仍可从 stderr 观察单次错误；任何 `.codex`/Temp 实际清理仍需单独授权，并应避开 Codex/Visual Studio Installer 运行期间。
- Done Contract 是否由证据满足：`功能行为、两个 TDD cycle、目标回归、typecheck、格式、diff、空间只读报告和 daemon 保护均由证据满足；根级 lint 仅受范围外并行改动阻塞，目标 lint 通过，按验证例外收口。`

## 7. 恢复与同步

- 状态说明：`Review / 已收口 / Completed`
- 当前卡点：`无。`
- 下一步唯一动作：`如需实际回收约 24 GiB 候选，另行确认维护窗口和分批清理范围；0096 无剩余代码动作。`
- Resume / Handoff：`.codex`/Temp 仍保持只读；不要移动 dirty Codex worktree。关闭 Codex 后可先可恢复归档 `.codex/sqlite` 疑似迁移遗留，关闭 Visual Studio Installer 后再处理其 5.712 GiB 临时目录。
- Project Sync Candidates：`durable logging 故障必须降级而非退出，已同步 docs/development.md。`
- 长期文档同步：`已完成；语音临时文件 7 天阈值属于实现策略，由测试与本 Feature Spec 维护，不扩写用户文档。`

### 提交记录

| 提交信息（Commit Message）                                            | 提交脚注（Commit Footer） | 关联改动或阶段 | 文档同步状态 | 备注             |
| --------------------------------------------------------------------- | ------------------------- | -------------- | ------------ | ---------------- |
| `fix(server): tolerate log failures and clean stale speech downloads` | `N/A`                     | `0096`         | `已同步`     | 本地提交；未推送 |
