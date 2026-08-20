# Desktop 中继传输配置 Micro Spec

## 0. 状态与索引

| 字段               | 值                                                      |
| ------------------ | ------------------------------------------------------- |
| task_id            | `0094`                                                  |
| spec layer         | `Feature Spec`                                          |
| task status        | `已收口`                                                |
| document status    | `Completed`                                             |
| depth              | `standard`                                              |
| phase              | `Review`                                                |
| Execution Approval | `Approved`                                              |
| Approval Source    | `User / 2026-08-19；按依赖顺序逐票实施并本地提交`       |
| file path          | `mydocs/micro_specs/0094_Desktop中继传输配置.md`        |
| parent spec        | `mydocs/specs/0084_跨端中继二进制加密与状态追平压缩.md` |
| superseded by      | `N/A`                                                   |
| created / updated  | `2026-08-19`                                            |

## 1. 目标与完成契约

- 当前理解：现有 Desktop 配对页面只识别 `features.relayConfig`；新 transport policy capability 已由 server/protocol GREEN-1 暴露，但 UI 尚未接入。
- 核心目标：在 capability gate 下提供 ciphertext encoding 和 compression enabled 两个设置，保持旧 daemon 安全兼容。
- Done Contract：
  - 仅当 `server_info.features.relayTransportPolicy === true` 时显示和读写 transport 控件；旧 daemon 不显示、不发送未知 patch。
  - UI 只提供 `auto/base64/binary` segmented control 与 compression toggle，不暴露 algorithm/strategy/level。
  - encoding 变更提示“后续新连接生效”；compression enabled 按父 Spec 对尚未开始的出站帧即时生效。
  - config RPC 成功/失败、旧 daemon、launch override 和重启回填状态可观察且不覆盖已有 relay enabled。
  - 多语言资源、desktop/compact 布局和现有 pairing/relay 设置回归通过。

## 2. 范围与事实

- 范围内：`packages/app/src/desktop/components/pair-device-section.tsx`、相关 settings/config hooks、i18n resources 和 tests；必要时 website config schema 已由父 ticket 处理。
- 范围外：relay wire、server resolver、外部 QR/pairing offer、algorithm/level 控件。
- 当前任务单元：Desktop UI 与 capability-gated config patch。
- 轻量评估：`standard`；跨平台 UI 但沿用现有配对入口。
- 已确认事实：`pair-device-section.tsx` 已有 `canConfigureRelay` 和 `relayConfig` gate；新 gate 需独立判断，不能由旧 capability 推断。
- 风险与未知：UI 真机/桌面截图按项目常规定向验证，最终集成由 0097 汇总。

## 3. 涉及文件与计划

| 文件                                                          | 计划变化                          | 事实源                           |
| ------------------------------------------------------------- | --------------------------------- | -------------------------------- |
| `packages/app/src/desktop/components/pair-device-section.tsx` | 新控件、capability gate、状态文案 | current relay config UI          |
| `packages/app/src/...` settings/config tests                  | patch/reload/legacy assertions    | protocol/server config contracts |
| `packages/app/src/i18n/resources/*.ts`                        | encoding/compression 文案         | app i18n convention              |

1. 先为新/旧 daemon 和 hot/new-connection semantics 写 RED。
2. 实现最小控件和 RPC patch。
3. 运行 app 定向测试、typecheck/lint/format。

## 4. 执行前检查点

- 当前目标：只增加两个批准的配置项，绝不引入 level/strategy/algorithm。
- 当前进度：capability gate、两个 transport 控件、局部 patch、回填/失败状态和多语言资源均已完成 RED→GREEN。
- 当前动作是否仍服务核心目标：是；没有 gate 会向旧 daemon 产生假成功 patch。
- 下一步：`N/A；0094 已完成，按依赖进入 0095 metrics 与 benchmark。`
- 风险与回退：capability 缺失时保留现有 relay enabled UI；patch 失败不改变本地显示的 persisted value。
- 验证方式：component/unit tests、app typecheck/lint/format，必要时 desktop smoke 由 0097。
- TDD 判定、测试 seam 与验收行为：`TDD；server_info、config RPC、UI visible controls`。
- seam 确认：`User；已确认配置只保留开关与 encoding，level 彻底移除`。
- Execution Approval / Source：`Approved / User / 2026-08-19`。

## 5. 执行与变更记录

- 实际改动：`PairDeviceSection` 在 `relayTransportPolicy === true` 时读取 daemon config，并显示 `auto/base64/binary` segmented control 与 catch-up compression switch。两个控件通过同一 capability-guarded mutation 发送最小嵌套 patch；encoding 只写 `ciphertextEncoding`，compression 只写 `compression.enabled`。写入期间禁用两个控件，成功后由 RPC 返回 config 回填 query cache，失败显示错误且继续呈现原 persisted value。旧 daemon 不显示控件、不发送 transport patch；原 relay enable 流程继续只写 `relay.enabled`。
- 偏差与用户决策：配置入口位于 relay 已启用且 pairing offer 可用的现有页面区段；未新增 algorithm/strategy/level，也未修改 QR/pairing offer。窄 Desktop 宽度下设置行允许换行，encoding 文案明确新连接生效，compression 文案明确尚未开始发送的合格追平数据即时生效。
- Change Log：`2026-08-19` 从父 Spec 执行清单 11 拆出。
- Change Log：`2026-08-20` 完成 Desktop transport controls、兼容/回填合同与九语言资源，进入 Review/已收口。

## 6. 验证与完成判断

| 验收项          | 命令或步骤                              | 结果 | 证据                                                                             |
| --------------- | --------------------------------------- | ---- | -------------------------------------------------------------------------------- |
| capability gate | old/new daemon visible and patch matrix | PASS | component 8/8；旧 daemon 隐藏且 0 transport patch                                |
| settings        | encoding/toggle/new-connection status   | PASS | exact partial patch、defaults、RPC success/failure 回填                          |
| regression      | pairing/relay enabled and i18n          | PASS | 原 enabled patch 保持独立；resources 35/35；app typecheck、目标 lint/format 通过 |

- 未验证项与原因：真实 Desktop 窗口和 compact screenshot、重启后的真实 UI smoke 留给 0097；未运行完整本地套件。
- 剩余风险：真实 relay 连接切换、launch override 和重启持久化由 0091 server tests 提供自动证据，最终跨进程 UI 证据仍由 0097 验收。
- Done Contract 是否由证据满足：`是；0094 scoped contract 已满足，父 Spec 仍在 Execute。`

## 7. 恢复与同步

- 状态说明：`Review / 已收口 / Completed`；Desktop transport policy 可供 0097 真实环境验收。
- 当前卡点：`N/A`。
- 下一步唯一动作：实现无内容 runtime metrics 与可复现 relay codec benchmark。
- Resume / Handoff：先读本文件第 5、6 节；0095 从 0089/0090 prepared frame 与 0093 decode seam 接续。
- Project Sync Candidates：配置说明回写 `public-docs/configuration.md`。
- 长期文档同步：待 0097。

### 提交记录

| 提交信息（Commit Message）                        | 提交脚注（Commit Footer） | 关联改动或阶段 | 文档同步状态 | 备注                   |
| ------------------------------------------------- | ------------------------- | -------------- | ------------ | ---------------------- |
| `feat(desktop): configure relay transport policy` | `N/A`                     | `paseo / 0094` | `待 0097`    | 用户已授权逐票本地提交 |
