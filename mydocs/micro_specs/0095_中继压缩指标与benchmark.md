# 中继压缩指标与 benchmark Micro Spec

## 0. 状态与索引

| 字段               | 值                                                      |
| ------------------ | ------------------------------------------------------- |
| task_id            | `0095`                                                  |
| spec layer         | `Feature Spec`                                          |
| task status        | `已批准`                                                |
| document status    | `Active`                                                |
| depth              | `standard`                                              |
| phase              | `Plan`                                                  |
| Execution Approval | `Approved`                                              |
| Approval Source    | `User / 2026-08-19；按依赖顺序逐票实施并本地提交`       |
| file path          | `mydocs/micro_specs/0095_中继压缩指标与benchmark.md`    |
| parent spec        | `mydocs/specs/0084_跨端中继二进制加密与状态追平压缩.md` |
| superseded by      | `N/A`                                                   |
| created / updated  | `2026-08-19`                                            |

## 1. 目标与完成契约

- 当前理解：前序真实样本只做过一次性研究测量；runtime metrics、可复现 benchmark、Hermes 解码和全链路 prepare/decode 尚未实现。
- 核心目标：提供不泄露内容的 server/client 聚合指标和可重复 benchmark，验证带宽、CPU、延迟与 skip reason。
- Done Contract：
  - server/client 只记录 class/codec/encoding、原始/编码/wire bytes、prepare/decode/queue 时长、错误和 skip reason，不记录 payload、路径、文件名、正文或 secret。
  - benchmark 能用显式输入复现 legacy、framed Base64/binary、deflate level 1/3/6 研究对比，并输出聚合比率/吞吐/延迟。
  - 指标区分 configured/negotiated/effective reason、实时压缩尝试为 0、bulk-live 门禁和 receive errors。
  - 为 event-loop p99、worker-pool queue、inboundDecodeMs 和 wire high-water 提供可核验样本。

## 2. 范围与事实

- 范围内：`packages/server/src/server/websocket/runtime-metrics.ts`、`packages/client/src/daemon-client-runtime-metrics.ts`、对应 tests、新增 `scripts/benchmark-relay-frame-codec.ts`。
- 范围外：业务分类本身、Hermes 真机执行、生产 relay 修改。
- 当前任务单元：聚合观测与离线 benchmark。
- 轻量评估：`standard`；涉及性能/隐私指标，但不改变 wire。
- 已确认事实：Spec 已定义指标字段和真实样本阈值；当前 daemon diagnostics 已有 websocket metrics 入口可复用。
- 风险与未知：benchmark 结果受机器/输入影响，不能替代 0097 的弱网和真机门禁。

## 3. 涉及文件与计划

| 文件                                                      | 计划变化                                   | 事实源               |
| --------------------------------------------------------- | ------------------------------------------ | -------------------- |
| `packages/server/src/server/websocket/runtime-metrics.ts` | framed prepare/decode/skip 聚合            | current diagnostics  |
| `packages/client/src/daemon-client-runtime-metrics.ts`    | client decode metrics                      | client transport     |
| `scripts/benchmark-relay-frame-codec.ts`                  | 显式输入、聚合输出、level 对照             | Spec 2.2/6.2         |
| 对应 tests                                                | no-plaintext/no-secret and metric contract | security constraints |

1. 先锁定 metric shape 和 redaction tests。
2. 接入 prepare/decode/queue timing。
3. 实现 benchmark 并用真实 JSON/terminal/file/tool-call 样本复测。

## 4. 执行前检查点

- 当前目标：只观测和测量，不根据 benchmark 自动修改固定 level 或门禁。
- 当前进度：前序研究数值已记录，runtime metrics/benchmark 尚未落盘。
- 当前动作是否仍服务核心目标：是；没有证据不能判断压缩是否值得上线。
- 下一步：0089/0090/0092/0093 稳定后执行。
- 风险与回退：任何敏感字段出现即阻塞并回到设计；研究 level 3/6 不进入 runtime。
- 验证方式：metric unit tests、benchmark smoke、lint/typecheck/format；真实环境由 0097。
- TDD 判定、测试 seam 与验收行为：`TDD；metrics snapshot/benchmark stdout`。
- seam 确认：`User；父 Spec 已批准聚合指标和真实数据门禁`。
- Execution Approval / Source：`Approved / User / 2026-08-19`。

## 5. 执行与变更记录

- 实际改动：本轮未修改生产代码。
- 偏差与用户决策：无。
- Change Log：`2026-08-19` 从父 Spec 执行清单 12 拆出。

## 6. 验证与完成判断

| 验收项    | 命令或步骤                                     | 结果   | 证据            |
| --------- | ---------------------------------------------- | ------ | --------------- |
| redaction | metrics never contain payload/path/secret      | 待执行 | 待新增 tests    |
| benchmark | corpus aggregate and level research comparison | 待执行 | 前序一次性样本  |
| runtime   | queue/decode/skip reason counters              | 待执行 | 0089/0090 hooks |

- 未验证项与原因：实现尚未授权，真实样本路径需用户明确提供/本地存在。
- 剩余风险：弱网、Hermes、live relay 由 0097。
- Done Contract 是否由证据满足：`No；待 Execute`。

## 7. 恢复与同步

- 状态说明：ticket 已登记，依赖 0089、0090、0092、0093。
- 当前卡点：无设计卡点，仅缺执行授权和稳定 runtime hooks。
- 下一步唯一动作：实现聚合 metrics 和 benchmark。
- Resume / Handoff：从 prepared frame/result type 与 websocket diagnostics 接续。
- Project Sync Candidates：benchmark 结果只回写父 Spec，不写入隐私内容。
- 长期文档同步：待 0097。

### 提交记录

| 提交信息（Commit Message） | 提交脚注（Commit Footer） | 关联改动或阶段 | 文档同步状态 | 备注     |
| -------------------------- | ------------------------- | -------------- | ------------ | -------- |
| `<待提交>`                 | `N/A`                     | `paseo / 0095` | `待填写`     | 未获授权 |
