# Relay transport policy 运行时接入 Micro Spec

## 0. 状态与索引

| 字段               | 值                                                            |
| ------------------ | ------------------------------------------------------------- |
| task_id            | `0091`                                                        |
| spec layer         | `Feature Spec`                                                |
| task status        | `已批准`                                                      |
| document status    | `Active`                                                      |
| depth              | `standard`                                                    |
| phase              | `Plan`                                                        |
| Execution Approval | `Approved`                                                    |
| Approval Source    | `User / 2026-08-19；按依赖顺序逐票实施并本地提交`             |
| file path          | `mydocs/micro_specs/0091_relay_transport_policy运行时接入.md` |
| parent spec        | `mydocs/specs/0084_跨端中继二进制加密与状态追平压缩.md`       |
| superseded by      | `N/A`                                                         |
| created / updated  | `2026-08-19`                                                  |

## 1. 目标与完成契约

- 当前理解：config schema/persistence/capability gate 已 GREEN，但 configured/negotiated/effective policy 尚未集中 resolver，也未注入 daemon relay data socket。
- 核心目标：让 server runtime 只通过一个 resolver 解释 transport policy，并正确处理热更新与连接级锁定。
- Done Contract：
  - 新增 `ConfiguredRelayTransportPolicy`、`NegotiatedRelayTransportPolicy`、`EffectiveRelayTransportPolicy` 和单点 resolver；运行时没有 algorithm/strategy/level 配置字段。
  - bootstrap/relay-runtime/relay-transport 注入 policy；`compression.enabled` 影响尚未开始的出站帧，ciphertext encoding 只对后续 data socket 生效。
  - legacy/旧 peer/无 framed capability 明确记录 reason 并保持旧 wire；旧 daemon 不因新字段写入而假成功。
  - launch override 只锁 `relay.enabled`，不冻结 transport policy；重启回填使用已有 GREEN-1 语义。
  - 为 capability gate、热更新、连接锁定和旧配置补齐定向测试。

## 2. 范围与事实

- 范围内：新增 `packages/server/src/server/relay-transport-policy.ts`、bootstrap/config/runtime/relay-transport 接入和对应测试。
- 范围外：Desktop UI、业务分类、压缩算法实现本身、外部 relay。
- 当前任务单元：从 persisted/RPC config 到 daemon data socket 的 policy 生命周期。
- 轻量评估：`standard`；跨 config/runtime/relay，需保持单一真相源。
- 已确认事实：`relayTransportPolicy` server feature 已存在；`startRelayTransport` 当前调用 `createDaemonChannel` 未传 policy option。
- 风险与未知：活动连接热更新边界需与 0090 prepared queue 一起验证。

## 3. 涉及文件与计划

| 文件                                                          | 计划变化                                      | 事实源                 |
| ------------------------------------------------------------- | --------------------------------------------- | ---------------------- |
| `packages/server/src/server/relay-transport-policy.ts`        | 新增 resolver/types/reasons                   | 父 Spec B.2            |
| `packages/server/src/server/bootstrap.ts`、`relay-runtime.ts` | 注入和订阅 config changes                     | GREEN-1 restart tests  |
| `packages/server/src/server/relay-transport.ts`               | 每 data socket 使用快照 policy                | current attach path    |
| 对应 tests                                                    | lifecycle/legacy/capability/hot-update matrix | config and relay tests |

1. 先写 configured/negotiated/effective RED。
2. 接入 startup/reload/new-socket，保持活动 encoding 不变。
3. 验证旧 config、launch override 和 legacy peer。

## 4. 执行前检查点

- 当前目标：贯通已有配置，不新增配置字段或第二份 resolver。
- 当前进度：schema/persistence/server feature 已 GREEN，runtime 尚未接入。
- 当前动作是否仍服务核心目标：是；没有 resolver，UI 和发送点会各自解释策略。
- 下一步：0087 handshake option 与 0089 prepared frame type 稳定后执行。
- 风险与回退：runtime 注入失败时保持 legacy mode，不能静默发 framed。
- 验证方式：server config/restart/relay transport 定向测试、typecheck/lint/format。
- TDD 判定、测试 seam 与验收行为：`TDD；config RPC、runtime controller、data socket public seams`。
- seam 确认：`User；父 Spec B.1–B.3 已确认即时/重启语义`。
- Execution Approval / Source：`Approved / User / 2026-08-19`。

## 5. 执行与变更记录

- 实际改动：本轮未修改生产代码。
- 偏差与用户决策：无。
- Change Log：`2026-08-19` 从父 Spec 执行清单 7 拆出。

## 6. 验证与完成判断

| 验收项        | 命令或步骤                             | 结果   | 证据          |
| ------------- | -------------------------------------- | ------ | ------------- |
| resolver      | configured/negotiated/effective matrix | 待执行 | 父 Spec B.2   |
| lifecycle     | hot compression/new encoding socket    | 待执行 | 父 Spec B.3   |
| compatibility | old config/old daemon/launch override  | 待执行 | GREEN-1 tests |

- 未验证项与原因：尚未授权实现。
- 剩余风险：UI 和业务 hint 依赖本 ticket 的稳定 types。
- Done Contract 是否由证据满足：`No；待 Execute`。

## 7. 恢复与同步

- 状态说明：ticket 已登记，依赖 0087、0089/0090。
- 当前卡点：无设计卡点，仅缺执行授权。
- 下一步唯一动作：实现 resolver 和 relay runtime 注入。
- Resume / Handoff：从父 Spec B.1–B.3、GREEN-1 tests 和 0087 option 接续。
- Project Sync Candidates：配置行为回写 `public-docs/configuration.md`。
- 长期文档同步：待 0097。

### 提交记录

| 提交信息（Commit Message） | 提交脚注（Commit Footer） | 关联改动或阶段 | 文档同步状态 | 备注     |
| -------------------------- | ------------------------- | -------------- | ------------ | -------- |
| `<待提交>`                 | `N/A`                     | `paseo / 0091` | `待填写`     | 未获授权 |
