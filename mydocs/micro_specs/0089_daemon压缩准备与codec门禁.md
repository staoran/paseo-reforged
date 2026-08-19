# Daemon 压缩准备与 codec 门禁 Micro Spec

## 0. 状态与索引

| 字段               | 值                                                      |
| ------------------ | ------------------------------------------------------- |
| task_id            | `0089`                                                  |
| spec layer         | `Feature Spec`                                          |
| task status        | `已收口`                                                |
| document status    | `Completed`                                             |
| depth              | `standard`                                              |
| phase              | `Review`                                                |
| Execution Approval | `Approved`                                              |
| Approval Source    | `User / 2026-08-19；按依赖顺序逐票实施并本地提交`       |
| file path          | `mydocs/micro_specs/0089_daemon压缩准备与codec门禁.md`  |
| parent spec        | `mydocs/specs/0084_跨端中继二进制加密与状态追平压缩.md` |
| superseded by      | `N/A`                                                   |
| created / updated  | `2026-08-19`                                            |

## 1. 目标与完成契约

- 当前理解：v1 只允许 daemon 出站对 `state-sync`、UTF-8 `bulk` 和完成态大型 `bulk-live` 尝试 raw DEFLATE；level 固定 1，不向 config/wire 暴露。
- 核心目标：实现 Node daemon 的异步压缩 adapter 与一次性 prepared-frame 决策。
- Done Contract：
  - 使用 `node:zlib` raw `deflateRaw`/`inflateRaw`，encoder 固定 level 1；不引入 gzip、context takeover 或共享字典。
  - 统一执行 4 KiB–4 MiB（`bulk-live` 16 KiB–4 MiB）、至少 64 bytes/5% 收益、128:1 ratio、两槽位并发门禁。
  - 不合资格、busy、无收益、超限或 adapter error 立即 identity 进入原 FIFO，不等待、不关闭连接。
  - prepared frame 返回最终 encoded/original/wire bytes、codec、encoding、class 和 skip reason，供 0090 高水位检查使用。
  - inflate 受 expected length/max output 限制，错误不把半成品交给应用层。

## 2. 范围与事实

- 范围内：`packages/server/src/server/relay-frame-compression.ts`、对应 tests、relay prepare adapter 接口实现；研究用 level 3/6 仅 benchmark 直接调用。
- 范围外：配置 resolver、业务分类来源、client Hermes decoder、socket reservation。
- 当前任务单元：固定策略的 daemon codec 和 prepared frame。
- 轻量评估：`standard`；涉及 CPU/内存和 E2EE 出站行为，沿用父 Spec 门禁。
- 已确认事实：当前 `encrypted-relay-socket.ts` 只接受同步 `outboundWireByteLength()` 估算；0090 将消费本 ticket 的 prepared frame。
- 风险与未知：libuv worker pool 争用和端到端 p95 由 0095/0097 验证。

## 3. 涉及文件与计划

| 文件                                                    | 计划变化                                        | 事实源                 |
| ------------------------------------------------------- | ----------------------------------------------- | ---------------------- |
| `packages/server/src/server/relay-frame-compression.ts` | Node async codec、门禁和 skip reason            | Spec D.2、真实样本结论 |
| 对应 relay/server tests                                 | 固定 level、阈值、busy/error identity fallback  | TDD seam               |
| `packages/relay/src/framed-ciphertext.ts`               | 使用 0088 的 prepared/envelope 类型，不复制常量 | 0088 contract          |

1. 先写 codec adapter 和门禁 RED，包括 `bulk-live` 16 KiB 下限。
2. 实现压缩尝试、收益判定、槽位和错误回退。
3. 产出一次性 prepared frame，禁止发送层重复压缩或重复加密。

## 4. 执行前检查点

- 当前目标：只实现 daemon codec/prepare，不把 hint 分类散落到发送点。
- 当前进度：0088 公共 envelope/parser 已由 `98a110a3f` 收口；Node codec、prepared payload 与全部固定门禁已完成 RED→GREEN。
- 当前动作是否仍服务核心目标：是；状态追平带宽收益的核心实现。
- 下一步：`N/A；0089 已完成，按依赖进入 0093 client fflate 解码与兼容。`
- 风险与回退：codec 失败回退 identity；实时流压缩尝试计数必须为 0。
- 验证方式：codec golden vectors、门禁矩阵、typecheck/lint/format；端到端门禁留 0095/0097。
- TDD 判定、测试 seam 与验收行为：`TDD；FrameCompressionAdapter 与 prepared-frame public contract`。
- seam 确认：`User；已批准固定 level 1、无 level 配置和 bulk-live 门禁`。
- Execution Approval / Source：`Approved / User / 2026-08-19`。

## 5. 执行与变更记录

- 实际改动：新增异步 `node:zlib` raw DEFLATE adapter，encoder 由 coordinator 固定 level 1，inflate 使用 `maxOutputLength` 并要求 exact expected length；新增进程级两个非等待槽、traffic/size/peer/config 前置门禁、收益/ratio/error 后置门禁，以及带 authenticated plaintext、original/encoded/wire bytes、encoding、class 和 skip reason 的 prepared payload。
- 偏差与用户决策：prepared 产物止于 envelope plaintext，不在本 ticket 加密或发送；0090 将对该产物执行一次 NaCl、一次表示编码、FIFO reservation 与最终 high-water。复核父 Spec 后把 4 MiB 恢复为 `MAX_COMPRESSION_INPUT_BYTES`，identity 仍由原业务边界和 `<32 MiB` 最终 wire 限制，修正了 0088 Micro Spec 的过度表述。
- Change Log：`2026-08-19` 从 0084 执行清单 3/6 拆出。
- Change Log：`2026-08-19` 完成 Node codec、固定 level、class/size/gain/ratio/busy/error RED→GREEN，进入 Review/已收口。

## 6. 验证与完成判断

| 验收项   | 命令或步骤                                           | 结果 | 证据                                                                                       |
| -------- | ---------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------ |
| codec    | `relay-frame-compression.test.ts --bail=1`           | PASS | 18/18；真实 raw roundtrip、fixed level 1、bounded short/oversized output                   |
| policy   | class/size/gain/ratio/busy/error matrix              | PASS | realtime 零调用、4/16 KiB exact floors、4 MiB cap、64 bytes/5%、128:1、进程级双槽均通过    |
| fallback | identity byte-for-byte 与 prepared metadata          | PASS | configured/peer/traffic/size/no-gain/ratio/busy/error 全部返回 identity，不传播 codec 错误 |
| parser   | `framed-ciphertext.test.ts --bail=1`                 | PASS | `68 passed / 1 skipped`；skip 仅归属 0090 opening 入站 FIFO                                |
| static   | relay rebuild、workspace typecheck、lint/format/diff | PASS | typecheck 退出码 0；目标 oxlint `0/0`；格式与 diff check 通过                              |

- 未验证项与原因：根 lint 仅被范围外 `mock-load-test-agent.ts` constructor complexity 阻塞；本票 5 个 TS 文件定向 oxlint 通过。prepared frame 尚未接入 FIFO/physical send，按依赖属于 0090。
- 剩余风险：真实 CPU、网络 break-even、跨实现 vector 和 Hermes decode 分别留给 0095/0097 与 0093。
- Done Contract 是否由证据满足：`是；0089 scoped contract 已满足，父 Spec 仍在 Execute。`

## 7. 恢复与同步

- 状态说明：`Review / 已收口 / Completed`；daemon codec/prepared payload 可供 0090 消费。
- 当前卡点：`N/A`；client decoder 与 FIFO 已有独立 ticket。
- 下一步唯一动作：实现 0093 client fflate bounded decoder 和 Node↔fflate golden vectors。
- Resume / Handoff：先读本文件第 5、6 节；0090 从 `PreparedDaemonFramedPayload` 与进程级 coordinator 接续。
- Project Sync Candidates：指标字段交给 0095，架构文档交给 0097。
- 长期文档同步：待 0097。

### 提交记录

| 提交信息（Commit Message）                      | 提交脚注（Commit Footer） | 关联改动或阶段 | 文档同步状态 | 备注                   |
| ----------------------------------------------- | ------------------------- | -------------- | ------------ | ---------------------- |
| `feat(relay): prepare daemon compressed frames` | `N/A`                     | `paseo / 0089` | `已同步`     | 用户已授权逐票本地提交 |
