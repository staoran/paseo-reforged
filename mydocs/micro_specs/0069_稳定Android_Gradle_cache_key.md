# 稳定 Android Gradle Cache Key Micro Spec

## 0. 状态与索引

| 字段               | 值                                                        |
| ------------------ | --------------------------------------------------------- |
| task_id            | `0069`                                                    |
| spec layer         | `Feature Spec`                                            |
| task status        | `已收口`                                                  |
| document status    | `Completed`                                               |
| depth              | `fast`                                                    |
| phase              | `Review`                                                  |
| Execution Approval | `Approved`                                                |
| Approval Source    | `User；2026-08-15 当前消息明确要求优化 key、提交并发布`   |
| file path          | `mydocs/micro_specs/0069_稳定Android_Gradle_cache_key.md` |
| parent spec        | `N/A`                                                     |
| superseded by      | `N/A`                                                     |
| created / updated  | `2026-08-15`                                              |

## 1. 目标与完成契约

- 当前理解：当前 primary key 追加 `${{ github.run_id }}`，因此每次成功 run 都是 partial restore，并上传约 2.17 GB 新 cache
- 核心目标：改为稳定的内容寻址 key，在 Android 构建输入未变化时 exact hit 且不再上传新 cache；输入变化时仍可创建新 seed
- Done Contract：workflow 不含 run-specific cache key；key 覆盖 runner/Java 与 Android 构建内容；静态合同通过；同一不可变 tag 连续两次运行中，第一次最多保存一个新 key，第二次 exact hit 且不保存新 cache

## 2. 范围与事实

- 范围内：`.github/workflows/android-apk-release.yml`、`scripts/ci-workflow.test.mjs`、本任务记录
- 范围外：cache 路径拆分、Gradle/JVM/Node 参数、ABI、Hermes、EAS profile、APK 内容、0068 切片 3-4
- 当前任务单元：实现、静态合同、不可变 release tag 的 hosted exact-hit 闭环与运行手册同步均已完成
- 轻量评估：`足够小`
- 已确认事实：runs `31864116282`、`31866295866` 分别保存约 2.15 GB、2.17 GB；`actions/cache@v5.0.3` 仅 exact primary-key match 输出 `cache-hit=true` 并跳过保存，partial restore 后成功 job 会保存 primary key
- 风险与未知：GitHub Actions cache 受 event ref 隔离；tag-push seed 必须由 `--ref <tag>` 的手工重跑复用，错误使用 `--ref main` 会在 main scope 创建同 key 副本

## 3. 涉及文件与计划

| 文件                                        | 计划变化                                                               | 事实源                                     |
| ------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------ |
| `.github/workflows/android-apk-release.yml` | 用 Android 构建内容 hash 替代 `github.run_id`，保留兼容 restore prefix | `actions/cache@v5.0.3` 文档与现有 workflow |
| `scripts/ci-workflow.test.mjs`              | 固化稳定主键、输入集合、exact-hit save 条件                            | 既有 CI workflow 静态合同                  |
| `mydocs/todolist.md`、本 micro-spec         | 回写执行与 hosted-runner 证据                                          | 项目任务记录规则                           |

1. 先把现有静态断言改为稳定 key 合同并确认旧 workflow 为 Red
2. 最小修改 workflow，运行目标静态测试、格式与 diff 检查
3. [完成] 推送精确 main 后对同一不可变 tag 连续运行并核对 restore/save 日志与 cache 列表

## 4. 执行前检查点

- 当前目标：同内容 run 不再新增约 2.17 GB cache
- 当前进度：commit-addressed key 已由提交 `7cd4e4f50` 推送到 main；静态合同、精确 main CI 和 tag-ref exact-hit 均 Green
- 当前动作是否仍服务核心目标：是
- 下一步：无；当前任务进入收口
- 风险与回退：未来手工重跑必须使用 immutable tag 作为 workflow ref；不删除现有远端 cache，不改变构建参数
- 验证方式：目标 Node test、format、diff check、两次 hosted-runner restore/save 日志与 GitHub cache 元数据
- TDD 判定、测试 seam 与验收行为：`N/A；workflow 静态合同先 Red/Green，但 hosted cache 行为只能由真实 Actions run 验收`
- seam 确认：`N/A`
- Execution Approval / Source：`Approved / User`

## 5. 执行与变更记录

- 实际改动：为 immutable tag checkout step 增加 `release-source` id 并输出已核验的 commit；Gradle primary key 改为 `android-gradle-v2-<os>-<arch>-java21-<commit>`；restore 先查 v2 同平台前缀，再回退现有 v1 cache；保存条件和 cache 路径不变
- 偏差与用户决策：首次手工复跑误用 `--ref main`，因 GitHub cache event-ref scope 无法读取 tag-push cache，run `31884989238` 在 main scope 额外保存同 key cache；按不删除远端 cache 的约束保留，并改用 `--ref v0.4.0-beta.3` 完成精确复验
- Change Log：
  - `2026-08-15`：建立独立任务并确认执行授权
  - `2026-08-15`：静态合同在旧 `${{ github.run_id }}` key 上按预期 Red；实现 commit-addressed key 后 Green
  - `2026-08-15`：提交 `7cd4e4f50 perf: stabilize Android Gradle cache key` 推送到 main；精确 CI run `31880050156` 全绿
  - `2026-08-15`：tag-push run `31883980526` 从 v1 fallback 恢复并保存 tag-scope v2 seed `2212556802 B`；EAS build `988s`
  - `2026-08-15`：main-ref run `31884989238` 证明 cache scope 不兼容并额外保存 main-scope 副本 `2212873167 B`；APK 仍通过校验
  - `2026-08-15`：tag-ref run `31885791889` exact hit 同一 primary key，Save step skipped，tag-scope cache ID/大小不变；运行手册补充正确重跑命令

## 6. 验证与完成判断

| 验收项             | 命令或步骤                                                                                       | 结果              | 证据                                                                                                                                    |
| ------------------ | ------------------------------------------------------------------------------------------------ | ----------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| 静态合同           | `node --test --test-name-pattern="Android APK build observability" scripts/ci-workflow.test.mjs` | 通过              | `1/1`；commit output、v2 key、v2/v1 restore 顺序、无 `github.run_id` 与 exact-hit save 条件成立                                         |
| 完整 workflow 合同 | `node --test scripts/ci-workflow.test.mjs`                                                       | 既有 Windows 阻塞 | `8/9`；唯一失败仍是 `filesUnder` 返回反斜杠，目标 Android 合同通过                                                                      |
| tag-push seed      | Android run `31883980526`                                                                        | 通过              | primary key `android-gradle-v2-Linux-X64-java21-dd51d861...`；从 v1 fallback 恢复，保存 tag-scope cache ID `6668619615`、`2212556802 B` |
| cache scope 诊断   | main-ref run `31884989238`                                                                       | 发现并记录偏差    | tag cache 对 main event ref 不可见；保存 main-scope ID `6668871294`、`2212873167 B`，未删除                                             |
| hosted exact hit   | tag-ref run `31885791889`                                                                        | 通过              | exact primary-key hit；Save skipped；tag-scope cache ID/大小不变，`last_accessed_at=2026-08-15T12:54:46Z`                               |
| exact-hit APK      | run `31885791889` 的 build、签名与 badging                                                       | 通过              | EAS `937s`；`368 executed / 320 from cache`；APK v2 签名、`sh.paseo.reforged`、`0.4.0`、`arm64-v8a` 通过                                |

- 未验证项与原因：`无；静态合同、精确 CI、真实 seed/exact-hit、cache API 与 APK 均已验证`
- 剩余风险：每个新 commit/event ref 的首次运行仍会保存一个约 2.17 GB seed；手工 tag 重跑若错误使用 `--ref main` 会再创建一个 main-scope 副本
- Done Contract 是否由证据满足：`是；同 tag-ref scope 的 seed/exact-hit 已闭环，main-ref 额外副本作为 scope 偏差单独记录`

## 7. 恢复与同步

- 状态说明：实现、静态合同、提交、推送、精确 main CI、tag-scope seed/exact-hit 与 APK 回归均已完成
- 当前卡点：无
- 下一步唯一动作：无；如需继续优化 Android 冷构建，回到 0068 的切片 3-4 并重新取得批准
- Resume / Handoff：任务已收口；未来 Android release tag 重跑使用 `--ref <tag> -f tag=<tag>`
- Project Sync Candidates：`docs/release.md 已同步 Android tag-ref 重跑与 cache scope 约束`
- 长期文档同步：`已完成`

### 提交记录

| 提交信息（Commit Message）                 | 提交脚注（Commit Footer） | 关联改动或阶段 | 文档同步状态 | 备注        |
| ------------------------------------------ | ------------------------- | -------------- | ------------ | ----------- |
| `perf: stabilize Android Gradle cache key` | `N/A`                     | `0069`         | `已同步`     | `7cd4e4f50` |
