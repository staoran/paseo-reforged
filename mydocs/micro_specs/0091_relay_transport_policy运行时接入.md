# Relay transport policy 运行时接入 Micro Spec

## 0. 状态与索引

| 字段               | 值                                                            |
| ------------------ | ------------------------------------------------------------- |
| task_id            | `0091`                                                        |
| spec layer         | `Feature Spec`                                                |
| task status        | `已收口`                                                      |
| document status    | `Completed`                                                   |
| depth              | `standard`                                                    |
| phase              | `Review`                                                      |
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
- 当前进度：schema/persistence/server feature、resolver、runtime provider、connection snapshot 和 framed prepare 注入已完成 RED→GREEN。
- 当前动作是否仍服务核心目标：是；没有 resolver，UI 和发送点会各自解释策略。
- 下一步：`N/A；0091 已完成，按依赖进入 0092 业务流量分类。`
- 风险与回退：runtime 注入失败时保持 legacy mode，不能静默发 framed。
- 验证方式：server config/restart/relay transport 定向测试、typecheck/lint/format。
- TDD 判定、测试 seam 与验收行为：`TDD；config RPC、runtime controller、data socket public seams`。
- seam 确认：`User；父 Spec B.1–B.3 已确认即时/重启语义`。
- Execution Approval / Source：`Approved / User / 2026-08-19`。

## 5. 执行与变更记录

- 实际改动：新增单点 configured/negotiated/effective policy resolver；配置缺省在内存补为 `auto / true`，legacy、显式禁用和 peer 不支持分别输出稳定 reason。relay core 由 daemon 显式提供本地 codec 能力并公开 authenticated negotiated snapshot；runtime 通过 provider 热更新 policy，data socket 握手前锁定 encoding，framed 帧开始 prepare 时重读 compression 开关并使用 Node codec coordinator。
- 偏差与用户决策：审查时发现将 internal policy 放入 `RelayRuntimeConfig` 会无意扩展 `daemon.get_status` relay payload；已先补 RED，再把 policy 移入 runtime 私有状态，公开 status 保持原五字段。0092 尚未提供业务 hint，当前普通 `send()` 明确按 `realtime` 准备并保持 identity。
- Change Log：`2026-08-19` 从父 Spec 执行清单 7 拆出。
- Change Log：`2026-08-20` 完成 config/capability/persistence、policy resolver、热更新、连接锁定和 relay runtime 注入，进入 Review/已收口。

## 6. 验证与完成判断

| 验收项        | 命令或步骤                                     | 结果 | 证据                                                                                      |
| ------------- | ---------------------------------------------- | ---- | ----------------------------------------------------------------------------------------- |
| resolver      | configured/negotiated/effective matrix         | PASS | 7/7；defaults、三类 reason、固定 codec、connection encoding lock                          |
| lifecycle     | runtime provider + two sequential data sockets | PASS | 3/3 runtime；7/7 relay transport，新 connection 读新 encoding、control 不重启             |
| compatibility | protocol/persistence/restart/server_info       | PASS | 19/19、18/18、restart 1/1、server_info 1/1；旧 shape、partial patch、launch override      |
| regression    | relay framed/channel + shared config files     | PASS | framed 86/86、channel 17/17、config 5/5、config-relay 20/20、store 20/20、persisted 41/41 |
| static        | protocol/relay/server typecheck                | PASS | 三个 workspace 均通过；relay 声明已重建                                                   |

- 未验证项与原因：未运行完整本地套件；真实 relay/弱网与 UI 留给 0097/0094。一次四文件并发回归触发 store 测试 5 秒超时，独立重跑 `20/20` 通过，判定为资源争用。
- 剩余风险：UI 和业务 hint 依赖本 ticket 的稳定 types。
- Done Contract 是否由证据满足：`是；0091 scoped contract 已满足，父 Spec 仍在 Execute。`

## 7. 恢复与同步

- 状态说明：`Review / 已收口 / Completed`；三层 policy 和 runtime 生命周期可供 0092/0094 消费。
- 当前卡点：`N/A`。
- 下一步唯一动作：实现 structured JSON、terminal 和 file 的 sender-side traffic hint。
- Resume / Handoff：先读本文件第 5、6 节；0092 从 encrypted socket 当前默认 `realtime` prepare seam 接续。
- Project Sync Candidates：配置行为回写 `public-docs/configuration.md`。
- 长期文档同步：待 0097。

### 提交记录

| 提交信息（Commit Message）                    | 提交脚注（Commit Footer） | 关联改动或阶段 | 文档同步状态 | 备注                   |
| --------------------------------------------- | ------------------------- | -------------- | ------------ | ---------------------- |
| `feat(relay): apply runtime transport policy` | `N/A`                     | `paseo / 0091` | `已同步`     | 用户已授权逐票本地提交 |
