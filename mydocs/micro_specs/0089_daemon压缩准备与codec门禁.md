# Daemon 压缩准备与 codec 门禁 Micro Spec

## 0. 状态与索引

| 字段               | 值                                                      |
| ------------------ | ------------------------------------------------------- |
| task_id            | `0089`                                                  |
| spec layer         | `Feature Spec`                                          |
| task status        | `已批准`                                                |
| document status    | `Active`                                                |
| depth              | `standard`                                              |
| phase              | `Plan`                                                  |
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
- 当前进度：固定 level/阈值已在 Spec 决策，代码尚未实现。
- 当前动作是否仍服务核心目标：是；状态追平带宽收益的核心实现。
- 下一步：0088 parser GREEN 后执行。
- 风险与回退：codec 失败回退 identity；实时流压缩尝试计数必须为 0。
- 验证方式：codec golden vectors、门禁矩阵、typecheck/lint/format；端到端门禁留 0095/0097。
- TDD 判定、测试 seam 与验收行为：`TDD；FrameCompressionAdapter 与 prepared-frame public contract`。
- seam 确认：`User；已批准固定 level 1、无 level 配置和 bulk-live 门禁`。
- Execution Approval / Source：`Approved / User / 2026-08-19`。

## 5. 执行与变更记录

- 实际改动：本轮未修改生产代码。
- 偏差与用户决策：无。
- Change Log：`2026-08-19` 从 0084 执行清单 3/6 拆出。

## 6. 验证与完成判断

| 验收项   | 命令或步骤                                | 结果   | 证据             |
| -------- | ----------------------------------------- | ------ | ---------------- |
| codec    | Node deflate/inflate golden vector        | 待执行 | 待新增测试       |
| policy   | class/size/gain/ratio/busy/error matrix   | 待执行 | Spec D.2         |
| fallback | identity byte-for-byte and FIFO admission | 待执行 | 0090 integration |

- 未验证项与原因：尚未授权实现。
- 剩余风险：真实 CPU、网络 break-even 和 Hermes decode 不在本 ticket。
- Done Contract 是否由证据满足：`No；待 Execute`。

## 7. 恢复与同步

- 状态说明：ticket 已登记，依赖 0088。
- 当前卡点：无设计卡点，仅缺执行授权。
- 下一步唯一动作：实现 daemon raw DEFLATE adapter 和 prepared-frame 门禁。
- Resume / Handoff：从 0088 的 codec dispatch 与父 Spec D.2/D.3 接续。
- Project Sync Candidates：指标字段交给 0095，架构文档交给 0097。
- 长期文档同步：待 0097。

### 提交记录

| 提交信息（Commit Message） | 提交脚注（Commit Footer） | 关联改动或阶段 | 文档同步状态 | 备注     |
| -------------------------- | ------------------------- | -------------- | ------------ | -------- |
| `<待提交>`                 | `N/A`                     | `paseo / 0089` | `待填写`     | 未获授权 |
