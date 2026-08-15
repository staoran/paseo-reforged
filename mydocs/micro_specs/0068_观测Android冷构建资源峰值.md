# 观测 Android 冷构建资源峰值 Micro Spec

## 0. 状态与索引

| 字段               | 值                                                     |
| ------------------ | ------------------------------------------------------ |
| task_id            | `0068`                                                 |
| spec layer         | `Feature Spec`                                         |
| task status        | `执行中（切片 1-2 完成，切片 3-4 待批准）`             |
| document status    | `Active`                                               |
| depth              | `standard`                                             |
| phase              | `Review`                                               |
| Execution Approval | `Approved`                                             |
| Approval Source    | `User / 当前消息明确批准集成、推送、dispatch 和切片 2` |
| file path          | `mydocs/micro_specs/0068_观测Android冷构建资源峰值.md` |
| parent spec        | `N/A`                                                  |
| superseded by      | `N/A`                                                  |
| created / updated  | `2026-08-15 08:54 / 2026-08-15 13:40`                  |

## 1. 目标与完成契约

- 当前理解：把 Android 冷构建优化拆成四个单变量实验，本轮只建立可重复的资源观测基线，不把缓存、编译器或产物调整混入同一次运行
- 核心目标：让下一次 GitHub-hosted Ubuntu runner 的 Android APK 构建日志能定位进程 RSS 峰值、cgroup 内存/交换区压力和 EAS local build 总耗时，同时不改变 APK 的构建输入与输出
- Done Contract：先在合并后的精确 main commit 上取得切片 1 hosted-runner 基线，再只打开 Gradle task build cache 并闭合 cache restore/save；两次相同 tag 的 Android workflow run 能用 `[ANDROID-PERF]` 和 Gradle `FROM-CACHE` 证据比较耗时、执行任务数与峰值内存；EAS 参数、ABI、Hermes、ccache 和 APK 内容不改变

## 2. 范围与事实

- 范围内：Android APK workflow 中 EAS local build 的进程 RSS、系统内存、cgroup v2 内存/交换区事件、临时盘可用量、阶段起止与耗时日志；监控生命周期；Gradle local task build cache 的启用和恢复/保存闭环；静态合同测试；将已提交本地代码与远端 beta CI 线合并后推送 main 并 dispatch 既有 immutable tag
- 范围外：Gradle/JVM/Node 内存上限、swap 配置、ABI、ccache、Hermes/source map、EAS profile、APK 内容、版本和移动商店发布；不携带 0065 未提交合并工作或 `packages/desktop/scripts/dev.ps1`
- 当前任务单元：切片 1 基线与切片 2 seed/hit 对照已完成；切片 3-4 等待新的执行批准
- 轻量评估：`升级 standard`；改动跨 workflow、静态合同和任务记录，且必须兼容失败/取消与缺失 cgroup 文件
- 已确认事实：成功 run `31827931781` / job `94856442163` 总计约 29 分钟，Gradle 约 22 分钟且 `688 actionable tasks: 688 executed`；`:app:createBundleReleaseJsAndAssets` 约从 `18:37:24` 到 `18:41:16`，Metro 约 16 秒后存在约 3.5 分钟静默区间；该区间同时出现最低 `MemAvailable=625 MiB`，最低 `SwapFree=648 MiB`；native CMake 约 5 分钟；产物仅含 `arm64-v8a`
- 已确认事实：当前本地 `main=f21eba8e9`，相对 `origin/main=dfb48da30` 为 ahead 4 / behind 8；远端 8 个提交包含 beta 发布及 swap/cache/arm64/内存 heartbeat 改动，当前工作树另有 0065 与 `packages/desktop/scripts/dev.ps1` 用户改动，本任务不合并、覆盖或提交这些内容
- `grilling` 结论（如使用）：`N/A；用户已明确给出四切片和首个实施单元`
- 风险与未知：本地无法复现 GitHub-hosted runner 的 cgroup 层级和真实性能；`memory.peak` 或 `memory.swap.current` 可能在 runner 内核上缺失；进程参数可能包含密钥，因此只记录 `comm`，不记录 args、环境变量或完整命令行；15 秒采样仍可能错过极短峰值

### 四个单变量切片

| 切片 | 唯一变量                                             | 本轮状态      | 验收信号                                             |
| ---- | ---------------------------------------------------- | ------------- | ---------------------------------------------------- |
| 1    | 增加进程 RSS、cgroup v2、系统内存和 EAS 阶段耗时观测 | 集成/待实跑   | 下一次冷构建产出连续样本与退出摘要，APK 构建合同不变 |
| 2    | 启用并闭合 Gradle task build cache 的恢复/保存链路   | 已批准/待基线 | 对比 cache hit、executed task 数量、耗时和峰值内存   |
| 3    | 仅为 native CMake/Ninja 编译启用 ccache              | 待后续批准    | 对比 ccache hit/miss、native 阶段耗时和峰值内存      |
| 4    | 仅关闭未被发布流程消费的 Hermes source map 生成/合并 | 待后续批准    | 对比 JS bundle 静默区间、Hermes RSS 和产物校验       |

## 3. 涉及文件与计划

| 文件                                        | 计划变化                                                | 事实源                                |
| ------------------------------------------- | ------------------------------------------------------- | ------------------------------------- |
| `.github/workflows/android-apk-release.yml` | 在既有 EAS 命令外包裹非阻塞资源监控、阶段计时和清理逻辑 | 当前 workflow、run `31827931781` 日志 |
| `scripts/ci-workflow.test.mjs`              | 固化观测字段、隐私边界、清理路径与 EAS 参数不变合同     | 既有 Android workflow 静态合同        |
| `mydocs/todolist.md`、本 micro-spec         | 登记四切片、执行范围、验证证据和恢复锚点                | 项目任务记录规则                      |

1. [完成] 在隔离 worktree 合并已提交代码与 `origin/main`，只加入切片 1 workflow/test，推送精确 commit 并 dispatch `v0.3.1-beta.1`
2. [完成] 回收基线日志后，只加入 `-Dorg.gradle.caching=true` 和基于 `cache-hit` 的 save 合同，推送切片 2 并运行 seed/hit 对照
3. 运行目标 Node 静态合同、workflow 格式/差异检查和 Bash 语法；把远端 run、Gradle cache 命中、任务执行数、阶段耗时和峰值内存回写本文件

## 4. 执行前检查点

- 当前目标：在不带入 0065 WIP 的前提下，把切片 1 放到精确远端 main commit 取得真实基线，然后只改变 Gradle task cache 变量
- 当前进度：本地静态验证已通过；已确认 `origin/main` 的已有 Gradle User Home cache save 条件使用 `cache-matched-key`，切片 2 将按官方 `cache-hit` 合同修正；远端凭证可用
- 当前动作是否仍服务核心目标：是；合并只整合已提交代码与远端 beta CI，切片 2 不改变 JVM/Node/ABI/Hermes
- 下一步：创建隔离 worktree、完成合并和切片 1 commit，推送后 dispatch 基线
- 风险与回退：不改写历史、不移动 immutable tag；远端 workflow dispatch 只重建 `v0.3.1-beta.1`，不把新 main 代码伪装进 tag；监控和 cache 保存均必须 best-effort 且不能吞掉 EAS 退出码
- 验证方式：merge 冲突审查、目标静态合同、formatter、Bash 语法、精确 push ref、GitHub run 状态和 `[ANDROID-PERF]`/`FROM-CACHE` 日志
- TDD 判定、测试 seam 与验收行为：`N/A；hosted runner 性能没有秒级本地 Red seam；结构合同验证 workflow，真实验收用 immutable tag 的 baseline/seed/hit runs`
- seam 确认：`N/A；不进入 TDD 循环`
- Execution Approval / Source：`Approved / User；当前消息明确批准集成精确 commit、推送、dispatch，并基于基线继续实施切片 2`

## 5. 执行与变更记录

- 实际改动：在 Android APK build step 中加入 15 秒采样器，记录系统内存、临时盘、cgroup v2 指标和最多 10 个白名单构建进程的 PID/PPID/RSS/elapsed/comm；为 EAS local build 增加 start/finish/elapsed/exit code；用 `EXIT` 与 monitor `TERM/INT` trap 回收后台进程并输出 cgroup/process peak 摘要；静态合同固定指标、隐私边界、清理路径和原 EAS 参数
- 切片 2 改动：在既有 `GRADLE_OPTS` 中启用 `-Dorg.gradle.caching=true`，并将 Save Gradle cache 条件改为 `always() && steps.gradle-cache.outputs.cache-hit != 'true'`；cache key、路径、restore prefix、EAS 参数和 APK 合同保持不变
- 偏差与用户决策：当前分支未包含 `origin/main` 的 8 个发布/Android CI 提交；按单变量边界不顺带移植
- Change Log：
  - `2026-08-15 08:54`：登记四个单变量切片并固定本轮仅实施观测；用户已批准执行
  - `2026-08-15 09:47`：切片 1 实现完成；采样指标缺失时统一输出 `unavailable`，进程日志只输出白名单 `comm` 而不输出 args、环境变量或完整命令行
  - `2026-08-15 09:47`：审查并修复 `pipefail` 下进程数超过 10 时 `awk exit` 可能触发 `ps` SIGPIPE、导致整批快照丢失的边界
  - `2026-08-15 10:02`：用户批准将切片 1 集成到精确 commit、推送并 dispatch；基线完成后继续切片 2
  - `2026-08-15 12:00`：切片 1 hosted-runner 基线 run `31862057595` / job `94957051858` 成功；`headSha=2e2262776b3721c932b35405fe7737a04343abca`，EAS `1148s`，Gradle `14m51s`，`688 actionable tasks: 688 executed`
  - `2026-08-15 12:00`：77 个观测样本中进程 RSS 峰值 `13548944 KiB`（`hermesc`），cgroup 峰值 `14957 MiB`，cgroup swap current 峰值 `5082 MiB`，最低 `MemAvailable=819 MiB`、`SwapFree=37 MiB`，`memory.events` 无 OOM；APK 校验为 `sh.paseo.reforged`、`arm64-v8a`
  - `2026-08-15 12:00`：基线 restore 命中上一 run 的 Gradle User Home key，但旧 `cache-matched-key` 条件使 Save step skipped；切片 2 仅启用 `-Dorg.gradle.caching=true` 并改用 `cache-hit != 'true'`
  - `2026-08-15 13:27`：切片 2 commit `790aca54140dcf77a0057122a283fcd7dea30b9d` 已推送到 `main`；seed run `31864116282` 成功保存 `2.15 GB` Gradle cache，`564 executed / 124 from cache`，EAS `1041s`
  - `2026-08-15 13:27`：hit run `31866295866` 从 seed key 恢复并成功保存新 key，`368 executed / 320 from cache`，Gradle `8m45s`，EAS `697s`；RSS `13499480 KiB`、cgroup peak `14862 MiB`、无 OOM，APK 校验为 `arm64-v8a`

## 6. 验证与完成判断

| 验收项             | 命令或步骤                                                                                                               | 结果         | 证据                                                                                                                                             |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------ | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| 目标静态合同       | `node --test --test-name-pattern="Android APK build observability" scripts/ci-workflow.test.mjs`                         | 通过         | `1/1`；观测字段、隐私边界、trap 和原 EAS 参数合同通过                                                                                            |
| 完整静态合同文件   | `node --test scripts/ci-workflow.test.mjs`                                                                               | 既有阻塞     | `8/9`；唯一失败为 Windows 下 `filesUnder` 路径归一化断言（第 250 行），与本次 Android 改动无关                                                   |
| shell 语法         | 提取 build step 到 GUID 临时文件后以 Git for Windows Bash 执行 `bash -n`，`finally` 删除临时文件                         | 通过         | 退出码 `0`；复查 `$env:TEMP/paseo-android-build-*.sh` 无残留                                                                                     |
| 格式               | `npx --no-install oxfmt --check <workflow> <test> <micro-spec>`                                                          | 通过         | 3 个目标文件格式正确                                                                                                                             |
| 差异完整性         | `git diff --check`；`git diff --exit-code -- packages/app/eas.json packages/app/app.config.js packages/app/package.json` | 通过         | 无 whitespace 错误；EAS profile、App 配置与依赖文件未改                                                                                          |
| hosted runner 基线 | 切片 1 精确 commit 上的 Android APK workflow dispatch                                                                    | 通过         | run `31862057595`；77 个样本，EAS `1148s`，Gradle `14m51s`，RSS `13548944 KiB`，cgroup peak `14957 MiB`，无 OOM                                  |
| Gradle seed/hit    | 切片 2 commit 上对同一 immutable tag 的两次 Android APK workflow dispatch                                                | 通过         | seed `31864116282`: `564 executed / 124 from cache`, EAS `1041s`; hit `31866295866`: `368 executed / 320 from cache`, EAS `697s`; 两次 Save 成功 |
| beta 发布清单      | 复核 immutable tag 的 Desktop、Android、Release Notes 与 GitHub prerelease                                               | 通过         | Desktop `31764185857`、Release Notes `31764185948`、最终 Android `31866295866` 成功；prerelease 非 draft，共 24 个资产，含 macOS 未签名说明      |
| 当前 main CI 归因  | 对比切片 2 commit `790aca5414...` 与父提交 `2e2262776b...` 的 CI                                                         | 非本切片回归 | 两者均仅 Playwright shard 1 失败并包含同一 `appearance-reasoning`；切片 2 的 format/lint/typecheck 与其余 CI jobs 通过                           |

- 未验证项与原因：当前批准范围的 hosted runner、Gradle seed/hit、APK 校验、cache save 与 beta 发布清单均已验证；未为单次实验追加更多重复运行
- 剩余风险：单次 seed/hit 仍受 hosted runner 噪声影响；15 秒采样可能错过极短峰值；run-specific cache key 会持续产生约 2 GB 新 cache，需关注仓库 cache 配额；当前 main 仍有父提交已存在的 Playwright shard 1 红项；切片 3-4 尚未实施
- Done Contract 是否由证据满足：是（切片 1 基线与切片 2 seed/hit 已完成）；切片 3-4 属于后续批准范围

## 7. 恢复与同步

- 状态说明：切片 1 commit `2e2262776b...` 与切片 2 commit `790aca5414...` 均已 fast-forward 到 `main`；baseline/seed/hit 三次 Android run 均成功
- 当前卡点：当前批准范围已完成；原工作树仍保留 0065、`dev.ps1` 等用户改动，未被触碰或提交
- 下一步唯一动作：切片 3-4 需新的明确执行批准；Playwright shard 1 红项应在独立任务中处理
- Resume / Handoff：从第 2 节切片 3-4 和第 6 节发布清单继续；严格排除 0065 WIP
- Project Sync Candidates：`无；当前 run 数据和实验设计属于一次性任务事实，留在本 micro-spec`
- 长期文档同步：不需要

### 提交记录

| 提交信息（Commit Message）                                  | 提交脚注（Commit Footer） | 关联改动或阶段    | 文档同步状态 | 备注                             |
| ----------------------------------------------------------- | ------------------------- | ----------------- | ------------ | -------------------------------- |
| `perf: observe Android build resources` (`2e2262776b...`)   | `N/A`                     | 切片 1 观测       | 已回写       | 已推送到 `main`                  |
| `perf: enable Android Gradle build cache` (`790aca5414...`) | `N/A`                     | 切片 2 cache 闭环 | 已回写       | 已推送到 `main`；seed/hit 已验证 |
