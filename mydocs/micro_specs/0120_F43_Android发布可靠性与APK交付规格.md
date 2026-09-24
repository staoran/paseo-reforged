# F43 Android 发布可靠性与 APK 交付规格

本任务承接 0118 的 F43 讨论结论和 0119 的 Reforged 身份决策。普通 APK 在 GitHub runner 上通过 `eas build --local` 编译；EAS 提供托管签名凭据，云端不承担 APK 编译。

## 0. 状态与索引

| 字段               | 值                                                              |
| ------------------ | --------------------------------------------------------------- |
| task_id            | `0120`                                                          |
| spec layer         | `Feature Spec`                                                  |
| task status        | `实施中`                                                        |
| document status    | `Active`                                                        |
| depth              | `deep`                                                          |
| phase              | `Implement`                                                     |
| Execution Approval | `Approved`                                                      |
| Approval Source    | `User`                                                          |
| file path          | `mydocs/micro_specs/0120_F43_Android发布可靠性与APK交付规格.md` |
| parent spec        | `mydocs/micro_specs/0118_自定义功能重做与迁移分析.md`           |
| related spec       | `mydocs/micro_specs/0119_F42_Reforged产品身份与发布规格.md`     |
| created / updated  | `2026-09-23`                                                    |

## 1. 目标与完成契约

- 当前理解：F43 需要在 `upstream/main@90737e1de` 基线上重新确定 Android APK 发布链，重点解决历史版本反复出现的构建内存超限和发布失败
- 核心目标：把历史优化拆成可验证的构建资源、产物架构、发布路径和诊断门禁，明确哪些保留、哪些丢弃、哪些必须按当前基线重做
- Done Contract：本规格包含历史优化审查表、F42/F43 分工、Android 产物边界、OOM 验收门禁、实施顺序和外部资源前置条件；普通 GitHub APK 由 GitHub Actions 执行 EAS local build 并使用托管签名，fallback 暂不启用，source map 必须保持开启并在构建中验证

## 2. 基线与现状

| 项目              | 当前事实                                                                                                                           | 对 F43 的影响                                                        |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| 代码基线          | `upstream/main@90737e1de`                                                                                                          | 历史实现只能作为证据和候选方案，不能整体 cherry-pick                 |
| EAS profiles      | `production-apk` 供 GitHub runner 使用 EAS local build；`production` 保留给 AAB/商店并使用 `resourceClass: large`                  | APK 不使用 EAS 云构建资源；`large` 不代表 APK 的构建资源             |
| 当前 app config   | F42 已改为 Reforged 包名和 owner，并通过 `EAS_PROJECT_ID` 注入 project                                                             | project 归属和证书仍需实际构建验证                                   |
| 当前 APK workflow | `.github/workflows/android-apk-release.yml` 在 GitHub Actions 执行 `eas build --local`，从 EAS 获取托管 Android 签名凭据           | 使用 arm64-only、串行 Gradle、资源校验和稳定缓存；fallback 暂不启用  |
| 当前 Gradle 内存  | APK profile 将 `expo-gradle-jvmargs` 设为 `3072m/768m`；其他构建维持 `4096m/1024m`                                                 | JVM heap 不是整机内存上限，仍需约束 Node、Kotlin、Hermes 和并发      |
| 历史 OOM 背景     | release 同时执行原生 ABI 编译和 Hermes bundling；历史发布文档记录过 worker 内存耗尽和 Hermes exit code 137                         | F43 必须以 cgroup 峰值和 OOM 事件验收，不能只看 Gradle exit code     |
| 历史资源基线      | 0068 run `31862057595` 的 `hermesc` RSS 峰值约 `12.9 GiB`、cgroup 峰值 `14957 MiB`、最低 `SwapFree=37 MiB`；`memory.events` 无 OOM | 这是高压力成功基线，不是 OOM run；新基线要固定 runner、commit 和输入 |
| 历史 cache 对照   | seed/hit cgroup peak 分别约 `14957 MiB` / `14862 MiB`，hit run 由约 `1041s` 降至 `697s`                                            | cache 有耗时收益，但旧数据未证明它能明显降低峰值                     |
| 历史成功证据      | arm64-only APK、Gradle cache seed/hit、资源观测和 source map 关闭均曾在旧发布链验证                                                | 可保留目标和验收方法，但实现要重新适配当前基线                       |

## 3. F42 与 F43 的边界

| 领域       | F42：产品身份与发布归属                                             | F43：Android 发布可靠性与 APK 交付                                          |
| ---------- | ------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| 应用身份   | `Paseo Reforged`、`sh.paseo.reforged`、debug ID、Expo owner/project | 消费 F42 已锁定的身份，不重新决定包名                                       |
| 签名和商店 | Google Play application、签名主体、EAS project 归属                 | 校验 APK 是否使用 F42 提供的签名，不创建或轮换签名                          |
| 更新源     | Reforged EAS Update project 和 channel                              | 验证 APK 与 channel/project 一致，不设计 OTA 迁移                           |
| APK 产物   | 确认属于 Reforged 产品                                              | 确定 APK 是否 arm64-only、是否提供多 ABI、命名和 badging 校验               |
| 构建资源   | 不负责 OOM 调参                                                     | 负责 Gradle、Kotlin、Node、Hermes、swap、并发和缓存策略                     |
| 发布路径   | 确认 GitHub Release 和 EAS project 归属                             | 普通 APK 由 GitHub runner 执行 EAS local build，失败即停，fallback 暂不启用 |
| 验收       | 身份、资源隔离和发布账号可用                                        | OOM 证据、重复构建、签名、包名、版本和 ABI 校验                             |

F43 不得通过复用上游 EAS project、`ascAppId`、不匹配的 keystore 或旧 GitHub 仓库来绕过 F42 的身份门禁。历史 Reforged 签名指纹是验收目标，EAS 托管证书必须与它一致。

## 4. 历史优化审查

结论使用四种处理方式：`保留`表示可作为当前方案的直接原则；`丢弃`表示不进入 F43；`重做`表示目标仍有价值，但不能直接移植历史实现；`额外优化`表示必须在当前基线重新取得数据后再决定。

| 历史方案                                     | 解决的具体失败模式和目的                                                                                      | 当前上游状态                                                             | 结论           | 当前实施原则和证据门禁                                                                                                                                                         |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| EAS `large` resource class                   | 提高云构建 worker 的可用内存，避免 ABI 编译和 Hermes 同时运行时被杀                                           | 普通 APK 使用 EAS local；AAB/商店链仍可使用 EAS 云构建                   | 保留           | 仅作为 AAB/商店流程资源事实保留，不作为普通 APK OOM 方案；APK 以 GitHub runner 的资源预算和实际峰值为准                                                                        |
| `--max-workers=1`、关闭 Gradle parallel      | 限制 Java/Kotlin/native 编译并发，降低多个 worker 与 Hermes 叠加的峰值                                        | EAS local profile 的 Gradle command 已传入该限制                         | 重做           | 作为 GitHub runner 的默认资源约束；继续用构建峰值、耗时和成功率复核，不把串行本身视为 OOM 已解决证据                                                                           |
| Gradle/JVM/Node/Kotlin 内存上限              | 让构建过程不把 hosted runner 的整机内存耗尽                                                                   | APK 已设 Gradle `3g/768m`、Node `3g`，Kotlin/Hermes 仍需实测             | 重做           | 将 Gradle heap、Metaspace、Kotlin daemon、Node heap 和并发作为一组预算；任何单值必须低于 worker 可用内存并用 OOM 复跑验证，不能同时沿用默认 `4g` 与 APK `3g` 上限而无总预算    |
| 运行时创建 2 GiB swap                        | 在 hosted runner 物理内存不足时延缓 OOM，给 Hermes/Gradle 峰值留出虚拟内存                                    | 当前 GitHub APK workflow 暂未启用 swap                                   | 额外优化       | 先用当前 runner 资源基线验证；只有复现 OOM 且 swap 有明确收益时再单独启用，并保留临时目录、启用确认和清理门禁                                                                  |
| build resource monitor                       | 记录 RSS、cgroup memory、swap、临时盘和阶段耗时，定位真正的峰值进程                                           | workflow 已按 15 秒采样并检查 OOM kill                                   | 保留           | 作为发布门禁和故障诊断的一部分；采样只记录白名单进程名和资源数值，不记录命令行、环境变量或 secret                                                                              |
| Gradle task build cache                      | 减少重复构建的执行任务和时间，降低重复发布的失败暴露次数                                                      | workflow 已添加 cache restore/save，尚无 runner 实测                     | 保留           | 使用稳定的 commit/Java/runner 输入 key，区分 exact hit 与 partial restore；历史 seed/hit 只证明耗时下降，峰值差异很小，仍需保留资源观测                                        |
| commit-addressed Gradle cache key            | 避免以 `github.run_id` 产生大量重复 cache，并让同一不可变 tag 能 exact hit                                    | key 绑定 Reforged、Java 21、arm64 和 commit，尚无 runner 实测            | 保留           | 只恢复与构建输入相容的 key；不得把不同 Reforged 身份、ABI 或 Java 版本混在一个 key 中                                                                                          |
| arm64-only APK                               | 减少 native ABI 编译和 APK 体积，降低单次构建输入与产物体积；历史还避免云端与 fallback ABI 不一致             | GitHub APK workflow 已通过 Gradle property 锁定 `arm64-v8a`              | 重做           | 普通 GitHub APK 只构建 arm64；由 `aapt` 校验唯一 native ABI；F-Droid 多 ABI 仍是独立产品边界                                                                                   |
| F-Droid ABI 分片                             | 为 F-Droid 分别生成 `armeabi-v7a`、`arm64-v8a`、`x86`、`x86_64`，降低每个下载包体积并满足 source build 元数据 | 当前 `docs/android.md` 已记录 F-Droid 单 ABI 和 version code suffix 规则 | 保留为独立边界 | 不把 F-Droid 四架构要求带入普通 GitHub APK；F-Droid 每个 ABI 仍须串行构建并分别验收，必要时复用 F43 的资源观测 seam                                                            |
| `hermesFlags = ["-O"]`                       | 保持 release Hermes 优化，同时避免引入更高或不受控的编译开销                                                  | 当前 RN Gradle plugin 默认 `-O -output-source-map`                       | 丢弃           | 旧 flag 会关闭 Hermes source map；维持当前默认值并以非空 map 验收，除非后续实验能同时保留 map 且证明收益                                                                       |
| 远端关闭 Metro release source map            | 减少约 `62 MB` source map 的生成和合并中间物，可能降低远端 Hermes/Metro 的内存与磁盘压力；本地保留诊断 map    | 当前 GitHub APK workflow 明确保持 source map 开启                        | 丢弃           | 不以关闭 source map 换取构建成功；APK 构建必须保留 source map，并在 workflow 中检查生成结果                                                                                    |
| AOT outbound validator 分片                  | 降低单个 Hermes factory 的编译峰值，保留移动端收包校验性能                                                    | 当前 F36 仍为讨论项，F43 不应复制该协议改造                              | 额外优化       | 0104 旧实验报告移除 AOT validator 後 Hermes 可编译、仅移除 WebView HTML 仍失败；先在当前 bundle 和工具链复测，若仍是主因则作为 F36 前置任务或独立重做，不在 F43 内绕过协议校验 |
| EAS cloud 优先、GitHub local fallback        | 云端优先利用更大资源；云端失败时保留自主构建路径，减少单点失败                                                | 当前决策为 GitHub runner 上的 EAS local build，fallback 暂不启用         | 丢弃           | 不把 EAS 云构建作为 APK 编译前置；本地构建失败即失败，不上传旧 artifact，也不自动切换第二条构建路径                                                                            |
| GitHub runner 直接 Gradle、local credentials | 避免 EAS quota/费用或 signing secret 进入 EAS local payload                                                   | workflow 使用 EAS local build 和 EAS 托管签名                            | 调整           | 保留 GitHub runner 编译；放弃本地签名 secret 方案，EAS 临时凭据只在 runner 工作目录使用，构建结束后清理，不写入仓库或 artifact                                                 |
| 禁止重复 APK workflow run                    | 避免同一 tag 同时占用 runner，放大资源压力                                                                    | workflow 已按 tag 设置 concurrency，尚无 runner 实测                     | 保留           | 同一不可变来源只允许一个有效构建，取消旧 run 不得破坏发布状态；需与 release tag 和手工重跑规则一起验收                                                                         |
| APK signature/package/version/ABI 校验       | 防止错误 project、错误签名、错误版本或多 ABI artifact 被上传                                                  | workflow 已加入校验，尚无产物实测                                        | 保留           | 上传前必须校验签名证书、`applicationId`、version name/version code、目标 ABI、APK 非空和可安装性                                                                               |
| 关闭 lint task                               | 减少非核心发布任务，缩短构建并减少并行内存压力                                                                | APK 的 EAS local Gradle command 排除多个 lint task                       | 保留但限界     | 只用于普通 APK 交付；AAB/store 仍按正式发布质量门禁，不把 lint 省略扩展到全部 Android 构建                                                                                     |
| clean prebuild                               | 避免生成 Android 项目残留配置和旧 plugin 结果污染构建                                                         | EAS local 自有构建工作目录，当前不单独调用 `expo prebuild --clean`       | 额外优化       | 保留为输入确定性措施，不把清理本身误判成内存优化；后续按实际构建稳定性决定是否需要调整                                                                                         |

### 4.1 直接结论

- **保留**：大资源类、资源观测、稳定 Gradle cache、同一来源的重复运行互斥、APK 完整校验、APK profile 的 lint 边界，以及 F-Droid 的独立 ABI 规则
- **丢弃**：把费用节省、EAS quota、本地签名 secret 处理当作 OOM 修复的默认方案；旧方案中的品牌、project、签名和商店归属由 F42 负责。旧 `hermesFlags = ["-O"]` 与 source map 要求冲突
- **重做**：串行 Gradle、完整 JVM/Node/Kotlin 预算、arm64-only 普通 APK、GitHub runner 资源边界和 Hermes 预算
- **额外优化**：swap、AOT validator 分片、clean prebuild；它们必须由当前基线的峰值证据触发

## 5. Android 发布边界

用户已确认：普通 GitHub APK 固定为 `arm64-v8a` 单架构；F-Droid ABI 分片是独立发布面，继续按各 ABI 单独构建和验收。

### 5.1 普通 GitHub APK

F43 的默认交付对象是供测试和手工安装的 Reforged Android APK，候选合同如下：

| 项目       | 边界                                                                                |
| ---------- | ----------------------------------------------------------------------------------- |
| 来源       | F42 Reforged project 对应的不可变 tag/commit                                        |
| 包名       | `sh.paseo.reforged`；debug 包不得进入发布 artifact                                  |
| 签名       | F42 核验后的 Reforged production keystore；不可复用上游签名                         |
| 版本       | 使用仓库 `native-release-version.js` 生成的 version name/version code               |
| ABI        | `arm64-v8a` 单架构，已锁定；EAS local profile 固定该 ABI                            |
| 构建路径   | GitHub Actions 执行 `eas build --local`，由 EAS 提供托管签名；fallback 暂不启用     |
| source map | 保持开启；workflow 检查 release source map 已生成并作为 Actions artifact 保留 90 天 |
| 上传前     | 校验 APK 非空、签名、包名、版本、version code、唯一 ABI、安装解析和 artifact 名称   |
| 发布位置   | F42 指定的 Reforged GitHub Release；不得上传到上游仓库                              |

### 5.2 Google Play AAB

F43 不改变 Play Store AAB 的产品身份和提交归属。AAB 使用 F42 的 Reforged application/signing/EAS project，沿用正式 store release 的 lint、测试和提交门禁。GitHub APK 仅用于测试和手工安装，不作为商店 AAB 的替代品。

### 5.3 F-Droid ABI 分片

F-Droid 继续作为独立 source build 发布面：每个 ABI 单独构建、单独 version code suffix、单独校验。它可以复用 F43 的观测、串行 Gradle 和构建失败诊断，但不改变普通 GitHub APK 的 arm64-only 合同，也不要求 GitHub APK 提供四个下载包。

### 5.4 OOM 失败边界

- GitHub Actions 的 EAS local build 失败、超时、没有有效 APK 或 source map 缺失时，发布流程必须进入失败状态；不能凭旧 artifact 继续上传
- fallback 暂不启用；当前失败不自动切换到 EAS 云构建、旧构建或第二条本地构建路径
- 出现 exit code 137、cgroup `oom`/`oom_kill` 增长、Hermes/Gradle 进程被系统杀死或 APK 校验不完整时，构建不得发布
- swap 被使用不能直接判定成功；必须同时记录构建完成、swap 峰值、耗时和无 OOM kill
- 任何“通过增加 heap 到超过 worker 可用内存”换取的成功不视为合格成功
- 同一 source 的重试要能区分资源超限、构建失败和 artifact validation failure，便于决定是重试、升配还是修改构建输入

## 6. 实施前门禁

F43 当前进入实施，普通 GitHub APK 仍需满足以下门禁后才允许上传 Release：

| 门禁            | 必须拿到的证据                                                                                           |
| --------------- | -------------------------------------------------------------------------------------------------------- |
| F42 身份        | `sh.paseo.reforged` application、EAS project 归属、托管签名、Firebase 配置、GitHub Release 归属均已核验  |
| 当前基线 bundle | 在 `90737e1de` 的 app 依赖和 Expo/RN 版本上取得 production Android bundle、模块体积和 Hermes 编译峰值    |
| OOM 基线        | 至少一次 GitHub runner 构建记录资源峰值、阶段耗时、`memory.events`、exit code 和产物结果                 |
| 构建输入        | 普通 APK `arm64-v8a` 已锁定；GitHub workflow 使用同一 ABI 输入并校验产物                                 |
| 内存预算        | 为 Gradle、Metaspace、Kotlin、Node、Hermes、native worker 和 swap 建立总预算，不能只记录单个 `-Xmx`      |
| fallback        | 当前明确关闭；不配置、不调用、不以旧 artifact 兜底                                                       |
| cache           | 证明 cache key 绑定 commit、Java、ABI 和构建 profile，并分别记录 exact hit / partial restore             |
| source map      | 保持开启；确认当前 RN 参数链路可验证，并检查 GitHub runner 生成非空 map                                  |
| GitHub/EAS      | 已有 `EXPO_TOKEN` 和 `EAS_PROJECT_ID`；EAS 托管证书须与历史 Reforged APK 指纹匹配，Firebase 配置另行核验 |
| AOT 体积        | 若当前 bundle 仍由单体 validator 主导 Hermes 峰值，先给 F36 单独立项，不在 F43 内临时拆分                |

## 7. 建议实施顺序

1. **先锁 F42 外部资源**：完成 Reforged package/application、EAS project 归属、托管签名和 GitHub Release 归属核验
2. **取得 GitHub OOM 基线**：在固定 commit 上跑一次 EAS local build，记录 cgroup、进程 RSS、swap、阶段耗时、source map 和 APK 结果
3. **落实产物合同**：固定 arm64-only ABI、版本、签名、source map 和上传前校验脚本
4. **重做低风险资源控制**：维持串行 Gradle、明确 JVM/Node/Kotlin 总预算和稳定 cache key；每次只改变一个资源变量
5. **验证失败即停**：确认构建失败、签名失败、source map 缺失或 APK 校验失败都不会上传 artifact，也不会自动 fallback
6. **按数据触发额外优化**：只有复现峰值后才加入 swap、Hermes plugin、AOT 分片或 clean prebuild；每项单独记录收益和代价
7. **完成发布演练**：用不可变 beta tag 验证重复运行互斥、cache exact hit、失败重试、APK 安装和 GitHub Release 上传；远端发布另行授权
8. **再更新长期文档和 F43 状态**：把已验证事实同步到 `docs/android.md`、`docs/release.md`，将 F43 从讨论改为已批准或冻结

## 8. 历史代码回看范围

本次不整体迁移旧分支。实施前只回看与当前证据直接相关的文件和提交：

| 对照对象                                  | 用途                                                                   |
| ----------------------------------------- | ---------------------------------------------------------------------- |
| `17ff99b4c`、`583b3ccaf`                  | 复核 swap 创建、路径限制、启用确认和清理边界                           |
| `ec1d7e130`、`2e2262776`                  | 复核资源预算、cgroup/RSS/swap 观测和退出码保存                         |
| `790aca541`、`7cd4e4f50`                  | 复核 Gradle cache restore/save 和 stable key                           |
| `4d82d7d79`、`32c0b2443`                  | 复核 Hermes 配置和远端 source map 的当前兼容性                         |
| `c711c993f`、`eaac5ecf9`、`0b820d729`     | 复核历史双路径失败语义；当前只启用 EAS local APK 路径，不启用 fallback |
| `fc4731f66`、`fd0deea1c`                  | 复核普通 APK ABI 合同与 F-Droid ABI 分片边界                           |
| `5e8eec44c`                               | 复核 signing secret 不进入日志和 artifact 校验边界                     |
| `mydocs/micro_specs/0068`、`0069`、`0104` | 使用真实 hosted run、cache exact hit、source map 和 APK 失败/修复证据  |

## 9. 验收矩阵

| 验收面     | 最低标准                                                                    |
| ---------- | --------------------------------------------------------------------------- |
| 身份       | 包名、EAS project、托管签名证书和 GitHub Release 归属全部一致               |
| OOM        | 成功构建无 `oom_kill`、无 exit 137，资源峰值和阶段日志完整                  |
| 重复构建   | 同一 immutable source 能复用稳定 cache；exact hit 和 partial restore 可区分 |
| ABI        | 普通 APK 仅包含 `arm64-v8a`                                                 |
| APK        | `apksigner`、badging、version code/name、唯一 ABI 和安装解析均通过          |
| fallback   | 明确关闭；EAS local build 或校验失败不上传                                  |
| source map | release source map 已生成、非空并保留为 Actions artifact 90 天              |
| secret     | signing secret 不出现在日志、工作区 artifact 或 workflow 输出中             |
| 回滚       | 可关闭额外优化并保留 GitHub runner 本地构建路径，不需要重写发布历史         |

## 10. 当前判断

F43 已按本次决策进入实施。普通 GitHub APK 固定为 `arm64-v8a`，由 GitHub Actions 执行 EAS local build，EAS 提供托管签名；fallback 暂不启用，source map 保持开启并作为发布门禁。F-Droid ABI 分片保持独立。剩余验证集中在 EAS project 归属及证书指纹、GitHub runner 的资源峰值、Firebase 配置、APK 身份校验、source map 产出和 GitHub Release 写权限。
