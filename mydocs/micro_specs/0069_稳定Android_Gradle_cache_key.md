# 稳定 Android Gradle Cache Key Micro Spec

## 0. 状态与索引

| 字段               | 值                                                        |
| ------------------ | --------------------------------------------------------- |
| task_id            | `0069`                                                    |
| spec layer         | `Feature Spec`                                            |
| task status        | `待验证`                                                  |
| document status    | `Active`                                                  |
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
- 当前任务单元：实现与静态合同已提交并进入 main；等待不可变 release tag 的 hosted exact-hit 闭环
- 轻量评估：`足够小`
- 已确认事实：runs `31864116282`、`31866295866` 分别保存约 2.15 GB、2.17 GB；`actions/cache@v5.0.3` 仅 exact primary-key match 输出 `cache-hit=true` 并跳过保存，partial restore 后成功 job 会保存 primary key
- 风险与未知：稳定 key 冻结首个 seed；必须把会影响 Gradle/Hermes task outputs 的源码与原生配置纳入内容 hash，避免新源码持续只能 partial miss

## 3. 涉及文件与计划

| 文件                                        | 计划变化                                                               | 事实源                                     |
| ------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------ |
| `.github/workflows/android-apk-release.yml` | 用 Android 构建内容 hash 替代 `github.run_id`，保留兼容 restore prefix | `actions/cache@v5.0.3` 文档与现有 workflow |
| `scripts/ci-workflow.test.mjs`              | 固化稳定主键、输入集合、exact-hit save 条件                            | 既有 CI workflow 静态合同                  |
| `mydocs/todolist.md`、本 micro-spec         | 回写执行与 hosted-runner 证据                                          | 项目任务记录规则                           |

1. 先把现有静态断言改为稳定 key 合同并确认旧 workflow 为 Red
2. 最小修改 workflow，运行目标静态测试、格式与 diff 检查
3. 推送精确 main 后对同一不可变 tag 连续 dispatch 两次并核对 restore/save 日志与 cache 列表

## 4. 执行前检查点

- 当前目标：同内容 run 不再新增约 2.17 GB cache
- 当前进度：commit-addressed key 已由提交 `7cd4e4f50` 推送到 main，静态合同 Green；精确 main CI run `31880050156` 全绿
- 当前动作是否仍服务核心目标：是
- 下一步：发布 `v0.4.0-beta.3`，等待首次 Android run 完成后对同 tag 再 dispatch 一次并核对 restore/save 日志
- 风险与回退：若内容 hash 缺少实际构建输入则回炉补齐；不删除现有远端 cache，不改变构建参数
- 验证方式：目标 Node test、format、diff check、两次 hosted-runner restore/save 日志与 GitHub cache 元数据
- TDD 判定、测试 seam 与验收行为：`N/A；workflow 静态合同先 Red/Green，但 hosted cache 行为只能由真实 Actions run 验收`
- seam 确认：`N/A`
- Execution Approval / Source：`Approved / User`

## 5. 执行与变更记录

- 实际改动：为 immutable tag checkout step 增加 `release-source` id 并输出已核验的 commit；Gradle primary key 改为 `android-gradle-v2-<os>-<arch>-java21-<commit>`；restore 先查 v2 同平台前缀，再回退现有 v1 cache；保存条件和 cache 路径不变
- 偏差与用户决策：`无`
- Change Log：
  - `2026-08-15`：建立独立任务并确认执行授权
  - `2026-08-15`：静态合同在旧 `${{ github.run_id }}` key 上按预期 Red；实现 commit-addressed key 后 Green
  - `2026-08-15`：提交 `7cd4e4f50 perf: stabilize Android Gradle cache key` 推送到 main；精确 CI run `31880050156` 全绿

## 6. 验证与完成判断

| 验收项             | 命令或步骤                                                                                       | 结果              | 证据                                                                                            |
| ------------------ | ------------------------------------------------------------------------------------------------ | ----------------- | ----------------------------------------------------------------------------------------------- |
| 静态合同           | `node --test --test-name-pattern="Android APK build observability" scripts/ci-workflow.test.mjs` | 通过              | `1/1`；commit output、v2 key、v2/v1 restore 顺序、无 `github.run_id` 与 exact-hit save 条件成立 |
| 完整 workflow 合同 | `node --test scripts/ci-workflow.test.mjs`                                                       | 既有 Windows 阻塞 | `8/9`；唯一失败仍是 `filesUnder` 返回反斜杠，目标 Android 合同通过                              |
| hosted exact hit   | 同一 immutable tag 连续两次 Android workflow                                                     | 待执行            |                                                                                                 |

- 未验证项与原因：目标 release tag 尚未创建，无法取得同一不可变 tag 连续两次运行的 cache exact-hit/save 元数据
- 剩余风险：新 commit 第一次运行仍会保存一个约 2.17 GB seed；这是让新源码 Gradle task outputs 可在同 commit 重跑复用的必要更新粒度
- Done Contract 是否由证据满足：`否`

## 7. 恢复与同步

- 状态说明：实现、静态合同、提交、推送与精确 main CI 已完成，等待 release tag hosted cache 验证
- 当前卡点：无
- 下一步唯一动作：发布 `v0.4.0-beta.3` 并等待首次 Android workflow
- Resume / Handoff：从第 3 节动作 3 继续；首次 tag run 完成后对同 tag 再 dispatch
- Project Sync Candidates：`无；运行数据留在本任务记录`
- 长期文档同步：`不需要`

### 提交记录

| 提交信息（Commit Message）                 | 提交脚注（Commit Footer） | 关联改动或阶段 | 文档同步状态 | 备注        |
| ------------------------------------------ | ------------------------- | -------------- | ------------ | ----------- |
| `perf: stabilize Android Gradle cache key` | `N/A`                     | `0069`         | `已同步`     | `7cd4e4f50` |
