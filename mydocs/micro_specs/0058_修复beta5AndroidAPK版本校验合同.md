# 修复 beta.5 Android APK 版本校验合同 Micro Spec

## 0. 状态与索引

| 字段               | 值                                                           |
| ------------------ | ------------------------------------------------------------ |
| task_id            | `0058`                                                       |
| spec layer         | `Feature Spec`                                               |
| task status        | `已收口`                                                     |
| document status    | `Completed`                                                  |
| depth              | `fast`                                                       |
| phase              | `Review`                                                     |
| Execution Approval | `Approved`                                                   |
| Approval Source    | `User`                                                       |
| file path          | `mydocs/micro_specs/0058_修复beta5AndroidAPK版本校验合同.md` |
| parent spec        | `N/A`                                                        |
| superseded by      | `N/A`                                                        |
| created / updated  | `2026-08-09 / 2026-08-10`                                    |

## 1. 目标与完成契约

- 当前理解：`v0.3.0-beta.5` 的 APK 已构建成功，但发布 workflow 仍把 prerelease 字符串当作 Android `versionName`，在校验阶段拒绝了有效 APK
- 核心目标：让 Android beta 发布校验遵循 native release 合同，同时保留包名、签名和上传校验
- Done Contract：workflow 使用 `RELEASE_BASE_VERSION` 校验 APK `versionName`；静态回归测试在旧合同上失败、修复后通过；修复提交已推送到 `main`；以不可变 `v0.3.0-beta.5` tag 重跑后 Android workflow 成功并上传 APK；三条目标发布 workflow 均成功

## 2. 范围与事实

- 范围内：Android release workflow 的版本校验、对应静态合同测试、任务记录、同一 immutable tag 的 workflow 重跑与发布资产核验
- 范围外：移动应用版本策略本身、release tag 移动/重建、桌面资产、npm/Docker/商店发布、`6767` daemon
- 当前任务单元：修复 prerelease native `versionName` 校验漂移
- 轻量评估：`足够小`
- 已确认事实：`packages/app/native-release-version.js` 将 `0.3.0-beta.5` 的 `appVersion` 设为 `0.3.0`；已有 app 测试覆盖该合同；失败 run `31315592272` 的 APK 行为为 `name='sh.paseo.reforged' versionName='0.3.0'`
- 风险与未知：workflow dispatch 使用 `main` 上的最新 workflow 文件并 checkout 不可变 tag；GitHub API/runner 可能有瞬时延迟

## 3. 涉及文件与计划

| 文件                                                         | 计划变化                                                    | 事实源                                                  |
| ------------------------------------------------------------ | ----------------------------------------------------------- | ------------------------------------------------------- |
| `.github/workflows/android-apk-release.yml`                  | 用 `RELEASE_BASE_VERSION` 验证 native Android `versionName` | `packages/app/native-release-version.js`、失败 run 日志 |
| `scripts/ci-workflow.test.mjs`                               | 增加 Android release 版本合同静态断言                       | workflow 文件与现有 CI 合同测试入口                     |
| `mydocs/todolist.md`                                         | 登记 `0058` 并同步状态                                      | 项目任务工作流参数                                      |
| `mydocs/micro_specs/0058_修复beta5AndroidAPK版本校验合同.md` | 记录批准、执行和验证证据                                    | `MICRO_SPEC.template.md`                                |

1. 先加入静态回归断言并运行 Red
2. 修改 workflow 到 base-version 合同并运行 Green、格式化和静态检查
3. 提交并推送 `main`，用 `v0.3.0-beta.5` dispatch Android workflow
4. 核验三条发布 workflow、APK 资产和 prerelease 说明

## 4. 执行前检查点

- 当前目标：补齐 beta.5 Android 资产并使三条发布 workflow 全绿
- 当前进度：tag 已原子推送；Desktop 与 Release Notes 成功；Android 在校验阶段失败
- 当前动作是否仍服务核心目标：是，修复仅涉及发布校验合同，不改变应用行为或 tag 内容
- 下一步：写入静态 Red 测试，再最小修改 workflow
- 风险与回退：不移动 immutable tag；若 workflow dispatch 失败，保留现有桌面 prerelease 并报告；不 force push
- 验证方式：`node --test scripts/ci-workflow.test.mjs`（Red/Green）、`npm run format`、`npm run lint`、`npm run typecheck`、GitHub workflow run 与 release asset 查询
- TDD 判定、测试 seam 与验收行为：`TDD；以 workflow 源码合同为 seam，断言 prerelease Android 校验使用 base version；该 seam 已由 User 批准`
- seam 确认：`User；批准 0058 全部推荐方案`
- Execution Approval / Source：`Approved / User`

## 5. 执行与变更记录

- 实际改动：Android APK 校验改用 `RELEASE_BASE_VERSION`；CI workflow 合同测试新增对应静态断言
- 偏差与用户决策：Android 失败暴露了上游 native version 策略与旧 workflow 校验的合同漂移；用户明确批准 `0058` 全部推荐方案和 immutable tag 重跑
- Change Log：先运行新增断言得到目标 Red，再修改 workflow 得到隔离 Green；完整测试文件另有既有 Windows 路径断言失败，未扩大范围处理。修复提交 `1ef02da58` 推送后，workflow_dispatch 从 `main` 读取新校验并 checkout 原 tag，Android 构建、校验和上传全部成功。Release Notes Sync 正文保持批准 changelog，并手工追加 macOS unsigned/notarized 警告

## 6. 验证与完成判断

| 验收项             | 命令或步骤                                                                                                                       | 结果     | 证据                                                                                                                                                    |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Red 静态合同测试   | `node --test scripts/ci-workflow.test.mjs`                                                                                       | 目标 Red | 新断言捕获 `$RELEASE_VERSION`；同时暴露一个既有 Windows 路径断言失败                                                                                    |
| Green 静态合同测试 | `node --test --test-name-pattern="Android APK validation follows the native base-version contract" scripts/ci-workflow.test.mjs` | 通过     | 1/1 pass                                                                                                                                                |
| 静态检查           | `npm run format:files -- <4 files>`、`npm run lint`、`npm run typecheck`                                                         | 通过     | lint 0 warnings/0 errors；typecheck exit 0                                                                                                              |
| Android 重跑       | `gh workflow run android-apk-release.yml --ref main -f tag=v0.3.0-beta.5`                                                        | 通过     | run `31321031662`；immutable checkout、build、`versionName=0.3.0` 校验与上传成功                                                                        |
| 三条发布 workflow  | Desktop、Android、Release Notes Sync                                                                                             | 通过     | Desktop `31315592246`、Android `31321031662`、Notes `31315592266` 均 completed/success                                                                  |
| hotfix CI          | GitHub Actions on `1ef02da5856a3b006594461a4bc71f9cda3a41a5`                                                                     | 通过     | CI `31321009710` 与 Docker source-build `31321009748` 成功                                                                                              |
| 远端 refs          | GitHub Git refs API                                                                                                              | 通过     | `origin/main=1ef02da58`；annotated tag `v0.3.0-beta.5` 解引用到 `e9fc71ef7`                                                                             |
| prerelease 与资产  | GitHub Release API                                                                                                               | 通过     | public prerelease、非 draft；24 个 uploaded 资产；APK 180060249 bytes，digest `sha256:c3d86f3554f64ea28215471903597a5fcb65ac3327d4f9cd15493ad6189b8803` |
| release body       | 对照批准 changelog 与完成清单                                                                                                    | 通过     | 标题和 changelog 正文保留；macOS beta unsigned/notarized 警告仅出现一次                                                                                 |
| 禁止发布范围       | npm registry、Docker workflow 与 Actions 清单                                                                                    | 通过     | 7 个公开 workspace 的 beta.5 均 E404；Docker `push:false`；未触发商店、stable 发布                                                                      |

- 未验证项与原因：范围内无未验证项；人工安装 smoke 不属于三条 workflow 完成合同
- 剩余风险：GitHub API 查询期间有瞬时 EOF，但远端 workflow 和产物均完成；actions/checkout、setup-node 与 setup-java 有 Node 20/版本弃用注解，既有候选待办继续跟踪
- Done Contract 是否由证据满足：是；静态合同、main CI、immutable tag 重跑、三条发布 workflow、24 个资产和 release body 均有外部证据

## 7. 恢复与同步

- 状态说明：`v0.3.0-beta.5` 已完成范围内发布验收，Android 校验合同修复和任务记录收口
- 当前卡点：无
- 下一步唯一动作：可从 GitHub prerelease 安装目标平台资产做人工 smoke；如发现源码问题必须发布下一 beta，不得移动本 tag
- Resume / Handoff：以 release commit/tag `e9fc71ef7`、workflow hotfix `1ef02da58`、Android run `31321031662` 和公开 release URL 为锚点
- Project Sync Candidates：`无；长期 native base-version 合同已由 workflow 静态测试固化，Node action 弃用已有候选待办`
- 长期文档同步：无需修改 `PROJECT.md` 或新增平行发布知识

### 提交记录

| 提交信息（Commit Message）                            | 提交脚注（Commit Footer） | 关联改动或阶段              | 文档同步状态 | 备注                                |
| ----------------------------------------------------- | ------------------------- | --------------------------- | ------------ | ----------------------------------- |
| `fix(release): validate Android beta app version`     | `N/A`                     | workflow 合同修复与回归测试 | `已同步`     | `1ef02da58`；不移动 `v0.3.0-beta.5` |
| `docs(release): close beta.5 Android validation task` | `N/A`                     | 最终发布证据与任务收口      | `已同步`     | docs-only 收口，不移动 tag          |
