# Android release source map 优化

## 0. 状态与索引

| 字段               | 值                                                          |
| ------------------ | ----------------------------------------------------------- |
| task_id            | 0104                                                        |
| spec layer         | Feature Spec                                                |
| task status        | 执行中                                                      |
| document status    | Active                                                      |
| depth              | fast                                                        |
| phase              | Execute                                                     |
| Execution Approval | Approved                                                    |
| Approval Source    | User                                                        |
| file path          | `mydocs/micro_specs/0104_Android release source map优化.md` |
| parent spec        | N/A                                                         |
| superseded by      | N/A                                                         |
| created / updated  | 2026-09-10                                                  |

## 1. 目标与完成契约

- 当前理解：EAS 和 GitHub runner 的 Android release Hermes 编译偶发因内存峰值退出 137；远端构建仍生成 Metro packager source map
- 核心目标：远端 EAS 与 GitHub workflow 不生成 release source map，本地 release 构建保留；先用 production bundle 数据决定并实施不降低运行时性能的瘦身
- Done Contract：source map 开关可由构建环境验证；bundle 分析结果记录；目标验证通过；下一 beta tag 与 APK workflow 已触发并记录结果

## 2. 范围与事实

- 范围内：`packages/app` Android bundling 配置、EAS profile、Android APK workflow、production bundle 分析和必要的模块瘦身
- 范围外：降低 Hermes 优化级别、删除未证实无用依赖、改变应用功能或运行时性能策略
- 当前任务单元：分析、配置、AOT 分片、验证、beta 发布
- 轻量评估：`standard`（构建链路和发布验证跨文件）
- 已确认事实：React Native Gradle task 总是传 `--sourcemap-output`；Hermes flags 不会关闭 Metro packager map
- 风险与未知：关闭 source map 会降低线上 JS 堆栈还原能力；bundle 拆分在当前 native export 中由 Expo 设为 `splitChunks: false`

## 3. 涉及文件与计划

| 文件                                                | 计划变化                                         | 事实源                           |
| --------------------------------------------------- | ------------------------------------------------ | -------------------------------- |
| `packages/app/plugins/with-hermes-memory-budget.js` | 按环境覆盖 packager source map 参数，保留 `-O`   | React Native `BundleHermesCTask` |
| `packages/app/eas.json`                             | 为远端 production profile 关闭 source map        | EAS profile env                  |
| `.github/workflows/android-apk-release.yml`         | 确保云/runner 环境关闭 source map并保留 fallback | workflow 日志                    |
| `packages/app/src/**`                               | 仅在 bundle 分析证据充分时做瘦身                 | production bundle report         |

1. 运行 Android production bundle 分析并记录模块规模与主要来源
2. 实施 source map 开关和证据支持的最小瘦身
3. 将单一 outbound AOT factory 按稳定消息类型分片，避免 Hermes 峰值 OOM
4. 运行目标检查，提交并发布下一 beta，验证 APK workflow

## 4. 执行前检查点

- 当前目标：降低远端 Hermes 峰值并保留本地诊断能力
- 当前进度：已确认 Gradle/Expo source map 参数链路，待 bundle 分析
- 当前动作是否仍服务核心目标：是
- 下一步：运行可复现的 Android production export
- 风险与回退：保留 `-O`；若瘦身影响功能则只回退瘦身，source map 开关独立回退
- 验证方式：bundle 输出统计、静态检查、受影响测试、GitHub APK workflow
- TDD 判定、测试 seam 与验收行为：N/A；构建配置由静态产物和 CI 日志验收
- seam 确认：N/A；构建任务参数和输出文件是可观察 seam
- Execution Approval / Source：Approved / User

## 5. 执行与变更记录

- production export：`5,874` 个模块，JS bundle `23,280,616` bytes，Metro source map `62,406,506` bytes
- 最大来源：outbound zod-aot validator `11,121,323` bytes、Mermaid WebView HTML 约 `3.5 MB`、terminal WebView HTML 约 `1.2 MB`、`lucide-react-native` 约 `1.36 MB`
- 分片实验：移除 AOT validator 后 Hermes 可完成；仅移除 WebView HTML 仍 OOM，确认峰值主要由单一 outbound AOT factory 触发
- 依赖链确认：`packages/client/src/daemon-client.ts` 在移动端收包热路径调用 `validateWSOutboundMessage`，不能把 generated validator 当作 server-only 残留删除
- 性能决策：不以 runtime Zod 取代 AOT validator。`docs/protocol-validation.md` 的 Hermes 基准显示相同 `353 KB` provider snapshot 会从约 `2.5 ms / 1.2 MB` 分配退化为约 `10.9 ms / 5.9 MB` 分配
- 实际改动：plugin 在 `PASEO_RELEASE_SOURCEMAPS=0` 时向 React Native Gradle `react` block 追加空的 `--sourcemap-output`，覆盖默认 Metro map 输出；始终保留 `hermesFlags = ["-O"]`。EAS production profile 和 GitHub cloud/local build 均显式关闭该 map
- 实际改动：将 213 个 session outbound 类型按稳定哈希拆为 16 个非空 AOT shard，`ws-outbound.ts` 按 `message.type` 路由；未知或畸形帧回退完整 Zod schema，生成 index 和模块均由 protocol 生命周期脚本重建
- 偏差与用户决策：用户明确允许 Metro packager source map 完全关闭，要求先分析再决定 bundle 瘦身。本版不做会降低客户端校验性能的 bundle 瘦身；native export 当前 `splitChunks: false`，简单 dynamic import 也不会减少 APK 主 bundle
- Change Log：新增 plugin 回归测试，覆盖本地保留 map、远端覆盖 map 和策略切换不重复注入
- Change Log：新增 shard 完整性和未知类型回退测试；已用 `hermesc -O` 对分片后的完整 bundle 做本地编译验证

## 6. 验证与完成判断

| 验收项                 | 命令或步骤                                                                                                                                                         | 结果   | 证据                                                                                                                                          |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| production bundle 分析 | `npx expo export --platform android --no-bytecode --dump-assetmap --source-maps --max-workers 1`                                                                   | 通过   | `23,280,616` bytes JS、`62,406,506` bytes map、`5,874` modules                                                                                |
| source map 配置        | plugin unit test 与 React Native `BundleHermesCTask` 参数链路审查                                                                                                  | 通过   | local 默认无 override；remote 使用 `extraPackagerArgs = ["--sourcemap-output", ""]`，Expo 仅在非空 `sourcemapOutput` 时 serializerIncludeMaps |
| 定向测试               | `npx vitest run packages/app/plugins/with-hermes-memory-budget.test.ts --bail=1`、`npx vitest run packages/protocol/tests/validation/ws-outbound.test.ts --bail=1` | 通过   | app `3/3`；protocol `15/15`                                                                                                                   |
| 静态检查               | `npm run typecheck`、protocol/client workspace typecheck、`npm run lint`                                                                                           | 通过   | protocol/client exit `0`；root typecheck 无诊断输出；lint `0 warnings / 0 errors`                                                             |
| 格式检查               | `npm run format:check:files -- ...`                                                                                                                                | 通过   | 所有改动源码和文档均已格式化                                                                                                                  |
| Hermes 编译            | `hermesc -w -emit-binary ... -O`                                                                                                                                   | 通过   | 23,438,434 bytes bundle；Windows hermesc 工作集峰值约 2.56 GiB；输出 bytecode `38,620,247` bytes                                              |
| Android Gradle         | `:app:createBundleReleaseJsAndAssets`                                                                                                                              | 未执行 | 本机未安装 Android SDK，无法进入 Gradle 配置后的 Metro/Hermes task                                                                            |
| APK 发布               | GitHub Actions Android workflow                                                                                                                                    | 待执行 | 待填写                                                                                                                                        |

- 未验证项与原因：Linux EAS/GitHub runner 的实际 beta APK 仍待新 tag 验证；本机无 Android SDK
- 剩余风险：关闭 Metro map 会降低远端 release 的 JS 栈映射能力；Windows hermesc 峰值不能完全替代 Linux runner 内存曲线；AOT shard 总体代码量未减少，收益来自降低单个 factory 峰值
- Done Contract 是否由证据满足：否

## 7. 恢复与同步

- 状态说明：执行中
- 当前卡点：无
- 下一步唯一动作：提交 AOT 分片并发布 `v0.7.2-beta.5`
- Resume / Handoff：从本文件第 6 节的 APK 发布验证继续
- Project Sync Candidates：保留本任务的 AOT validator 性能结论，不新增长期文档
- 长期文档同步：仅同步已验证的构建流程事实

### 提交记录

| 提交信息（Commit Message） | 提交脚注（Commit Footer） | 关联改动或阶段               | 文档同步状态 | 备注 |
| -------------------------- | ------------------------- | ---------------------------- | ------------ | ---- |
| `<待提交>`                 | `N/A`                     | `AOT 分片与 Hermes 峰值验证` | `待同步`     |      |
