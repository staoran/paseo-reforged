# Desktop 中继传输配置 Micro Spec

## 0. 状态与索引

| 字段               | 值                                                      |
| ------------------ | ------------------------------------------------------- |
| task_id            | `0094`                                                  |
| spec layer         | `Feature Spec`                                          |
| task status        | `已批准`                                                |
| document status    | `Active`                                                |
| depth              | `standard`                                              |
| phase              | `Plan`                                                  |
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
- 当前进度：协议、持久化和 server feature 已 GREEN，UI 未接入。
- 当前动作是否仍服务核心目标：是；没有 gate 会向旧 daemon 产生假成功 patch。
- 下一步：0091 runtime policy stable 后执行。
- 风险与回退：capability 缺失时保留现有 relay enabled UI；patch 失败不改变本地显示的 persisted value。
- 验证方式：component/unit tests、app typecheck/lint/format，必要时 desktop smoke 由 0097。
- TDD 判定、测试 seam 与验收行为：`TDD；server_info、config RPC、UI visible controls`。
- seam 确认：`User；已确认配置只保留开关与 encoding，level 彻底移除`。
- Execution Approval / Source：`Approved / User / 2026-08-19`。

## 5. 执行与变更记录

- 实际改动：本轮未修改生产代码。
- 偏差与用户决策：无。
- Change Log：`2026-08-19` 从父 Spec 执行清单 11 拆出。

## 6. 验证与完成判断

| 验收项          | 命令或步骤                              | 结果   | 证据                  |
| --------------- | --------------------------------------- | ------ | --------------------- |
| capability gate | old/new daemon visible and patch matrix | 待执行 | GREEN-1 feature tests |
| settings        | encoding/toggle/new-connection status   | 待执行 | 待新增 app tests      |
| regression      | pairing/relay enabled and i18n          | 待执行 | existing app tests    |

- 未验证项与原因：尚未授权实现。
- 剩余风险：真实 desktop smoke 和多平台布局由 0097。
- Done Contract 是否由证据满足：`No；待 Execute`。

## 7. 恢复与同步

- 状态说明：ticket 已登记，依赖 0091。
- 当前卡点：无设计卡点，仅缺执行授权。
- 下一步唯一动作：接入 capability-gated Desktop transport settings。
- Resume / Handoff：从 pair-device-section 现有 relayConfig gate 和 0091 RPC policy 接续。
- Project Sync Candidates：配置说明回写 `public-docs/configuration.md`。
- 长期文档同步：待 0097。

### 提交记录

| 提交信息（Commit Message） | 提交脚注（Commit Footer） | 关联改动或阶段 | 文档同步状态 | 备注     |
| -------------------------- | ------------------------- | -------------- | ------------ | -------- |
| `<待提交>`                 | `N/A`                     | `paseo / 0094` | `待填写`     | 未获授权 |
