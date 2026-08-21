# 中继压缩指标与 benchmark Micro Spec

## 0. 状态与索引

| 字段               | 值                                                      |
| ------------------ | ------------------------------------------------------- |
| task_id            | `0095`                                                  |
| spec layer         | `Feature Spec`                                          |
| task status        | `已收口`                                                |
| document status    | `Completed`                                             |
| depth              | `standard`                                              |
| phase              | `Review`                                                |
| Execution Approval | `Approved`                                              |
| Approval Source    | `User / 2026-08-19；按依赖顺序逐票实施并本地提交`       |
| file path          | `mydocs/micro_specs/0095_中继压缩指标与benchmark.md`    |
| parent spec        | `mydocs/specs/0084_跨端中继二进制加密与状态追平压缩.md` |
| superseded by      | `N/A`                                                   |
| created / updated  | `2026-08-19 / 2026-08-21`                               |

## 1. 目标与完成契约

- 当前理解：server/client 无内容 runtime metrics、diagnostics snapshot 和显式输入 benchmark 已实现；弱网、live relay、Hermes 与真实交互 p95 仍由 0097 验收。
- 核心目标：提供不泄露内容的 server/client 聚合指标和可重复 benchmark，验证带宽、CPU、延迟与 skip reason。
- Done Contract：
  - server/client 只记录 class/codec/encoding、原始/编码/wire bytes、prepare/decode 时长、encrypted-socket send FIFO wait、codec callback wall time、错误和 skip reason，不记录 payload、路径、文件名、正文或 secret。
  - benchmark 能用显式输入复现 legacy、framed Base64/binary、deflate level 1/3/6 研究对比，并输出聚合比率/吞吐/延迟。
  - 指标区分 configured/negotiated/effective reason、实时压缩尝试为 0、bulk-live 门禁和 receive errors。
  - 为 event-loop p99、send FIFO wait、codec callback wall time、inboundDecodeMs 和 wire high-water 提供可核验样本；不把 zlib callback wall time 误称为可独立分离的 worker-pool queue。

## 2. 范围与事实

- 范围内：server/client relay metrics、`EncryptedChannel` content-free observer、daemon diagnostics 接线、对应 tests 和 `scripts/benchmark-relay-frame-codec.ts`。
- 范围外：业务分类本身、Hermes 真机执行、生产 relay 修改。
- 当前任务单元：聚合观测与离线 benchmark。
- 轻量评估：`standard`；涉及性能/隐私指标，但不改变 wire。
- 已确认事实：指标复用现有 server diagnostics/client rolling log；所有 label 为有界 enum，每个百分位序列最多保留 2,048 个近期样本，帧数与字节数仍完整累计。
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
- 当前进度：runtime metrics、observer、diagnostics、benchmark、真实 corpus 测量和定向门禁均已完成。
- 当前动作是否仍服务核心目标：是；没有证据不能判断压缩是否值得上线。
- 下一步：提交 0095 后进入 0097 的 mixed-version、live relay、弱网、Hermes 与长期文档验收。
- 风险与回退：任何敏感字段出现即阻塞并回到设计；研究 level 3/6 不进入 runtime。
- 验证方式：metric unit tests、benchmark smoke、lint/typecheck/format；真实环境由 0097。
- TDD 判定、测试 seam 与验收行为：`TDD；metrics snapshot/benchmark stdout`。
- seam 确认：`User；父 Spec 已批准聚合指标和真实数据门禁`。
- Execution Approval / Source：`Approved / User / 2026-08-19`。

## 5. 执行与变更记录

- 实际改动：server 聚合 configured/negotiated/effective、出入站 class/codec/encoding/bytes、skip reason、prepare/send FIFO wait/codec callback wall/decode 时长、protocol error 和双向 pending bytes；活动连接 reason 随 compression 热更新即时重算。`compressionQueueMs` 从 send 调用计到其有序 FIFO operation 开始；`compressionCodecMs` 包围异步 zlib callback，包含可能的 libuv worker-pool 等待，当前实现不能将 worker queue 与纯 codec 执行独立拆分。
- 实际改动：client rolling metrics 聚合 negotiated mode、入站 framed bytes/decode、protocol error 和 pending receive bytes；`EncryptedChannel` observer 只接收有界 label 与数值，observer 异常不影响握手或应用消息交付。
- 实际改动：daemon diagnostics 输出相同的 content-free relay snapshot；所有百分位样本使用固定容量窗口，避免密集流量导致常驻内存无界增长。
- 实际改动：benchmark 要求显式传入 JSON、terminal、file、tool-call；支持 raw、`codex-session-jsonl` 与 `paseo-timeline-segment`，完整测量 legacy、framed Base64/binary identity 和 level 1/3/6 deflate 的 original/encoded/encrypted/wire bytes、采用率、frame 分位数、CPU、prepare/decode/wall、吞吐和 event-loop p99。
- 偏差与用户决策：completed tool-call 从真实 timeline 边界重建 `agent_stream`，使用固定匿名 `agentId`，不是原始 WebSocket 抓包；terminal 从真实 Codex session 中显式提取 `exec` 输出并重分帧；报告不保留输入路径、原文或逐帧内容。
- 测量修正：初版 event-loop sampler 为 10 ms，无法核验 5 ms 门禁；提交前改为 1 ms 并在环境行显式报告分辨率，再用同类真实输入复测。
- Change Log：`2026-08-19` 从父 Spec 执行清单 12 拆出；`2026-08-20` 完成指标、benchmark、真实测量与静态门禁，进入 Review/已收口。
- Change Log：`2026-08-21` 统一审查澄清 send FIFO 与 zlib callback wall 指标语义，移除“可独立观测 worker-pool queue”的错误表述。

### 真实 corpus 聚合结果

环境为 Windows x64、Intel i7-4790、Node `v26.7.0`，每个 variant 预热 1 次并测量 5 次。下表的 wire 百分比均相对同 corpus 的 legacy；路径和内容未写入仓库。

| Corpus                          | Legacy wire                     | Framed binary level 1                                      | Level 3 / level 6 wire          | CPU 与采用结论                                                                                |
| ------------------------------- | ------------------------------- | ---------------------------------------------------------- | ------------------------------- | --------------------------------------------------------------------------------------------- |
| 真实 timeline JSON，27 帧       | `9,156,620`                     | `1,742,311 / 19.03%`，`27/27` 采用                         | `17.83% / 15.45%`               | prepare p50 `211.148 ms`、`31.013 MiB/s`；decode p50 `174.206 ms`；event-loop p99 `10.633 ms` |
| 真实终端输出，256 B/1 KiB/4 KiB | `1,101,214 / 989,614 / 961,694` | identity wire `102.70% / 100.75% / 100.19%`，全部 `0` 采用 | 候选更小但实际 wire 仍 identity | level 1 候选 prepare 吞吐仅 `1.322 / 5.083 / 15.612 MiB/s`；支持实时流不进入 compressor       |
| 真实 UTF-8 文件，6 个 chunk     | `1,519,121`                     | `379,618 / 24.99%`，`6/6` 采用                             | `23.82% / 22.01%`               | prepare p50 `18.740 ms`、`77.297 MiB/s`；decode p50 `13.631 ms`；event-loop p99 `3.613 ms`    |
| completed tool-call，9 个事件   | `120,176`                       | `65,298 / 54.34%`，仅越过 16 KiB 门禁的 `1/9` 采用         | `54.27% / 53.73%`               | prepare p50 `3.157 ms`、`27.115 MiB/s`；decode p50 `1.107 ms`；event-loop p99 `1.750 ms`      |

- JSON、文件和大型 tool-call 的 level 1 wire 收益达到父 Spec 的本地 corpus 门禁；framed Base64 的 exact wire 同样由脚本测量，不使用 4/3 估算。
- 终端候选压缩率不等于运行时行为：三种 frame size 均为 `runtimeEligible=false / adoptedFrames=0`，实际 encoded/wire 保持 identity，只额外承担 8 字节 envelope。
- level 3/6 继续节省少量 wire，但 file/tool-call prepare 成本上升且 JSON/event-loop tail 对系统负载敏感；这些研究行不足以推翻 v1 固定 level 1，也不进入配置或 wire。
- JSON level 1 的本机 event-loop p99 信号超过父 Spec 的 5 ms 暂定门禁；0095 只证明测量入口与本地吞吐，0097 必须结合真实并发交互和弱网 profile 决定是否可上线，不能据此宣称端到端门禁通过。

## 6. 验证与完成判断

| 验收项              | 命令或步骤                                                 | 结果 | 证据                                                        |
| ------------------- | ---------------------------------------------------------- | ---- | ----------------------------------------------------------- |
| server/client 指标  | 两个 runtime metrics 单文件                                | 通过 | server `8/8`、client `2/2`，含 2,048 样本有界性             |
| observer/relay 接线 | framed/channel/transport/runtime/socket/client 定向文件    | 通过 | `87 + 17 + 18 + 8 + 3 + 11 + 2` tests                       |
| diagnostics         | daemon diagnostics 定向用例                                | 通过 | `1/1`，content-free snapshot 可格式化                       |
| benchmark           | benchmark 单文件与四类真实输入 level 1/3/6                 | 通过 | `3/3`；两种表示、字节、采用率、CPU/延迟字段完整且无路径内容 |
| 静态门禁            | relay/client/server typecheck、benchmark 定向 tsgo、oxlint | 通过 | 全部退出码 0，目标 lint `0 warning / 0 error`               |

- 未验证项与原因：2 Mbps/150 ms、10 Mbps/80 ms、production relay 和 Hermes 设备需要 0097 的外部/真机环境；本票未启动或重启主 daemon `6767`。
- 剩余风险：JSON event-loop p99 信号、真实 terminal echo/agent-stream p95、Hermes GC/OOM、外部 relay 32 MiB 边界和物理 `bufferedAmount` 仍由 0097 验证。
- Done Contract 是否由证据满足：`是；0095 scoped metrics/benchmark contract 已满足，父 Spec 仍在 Execute。`

## 7. 恢复与同步

- 状态说明：`Review / 已收口 / Completed`；无内容指标与可复现 benchmark 已完成。
- 当前卡点：`N/A`；真实环境门禁明确归属 0097。
- 下一步唯一动作：执行 0097 mixed-version、live relay、弱网、Hermes 与长期文档收口。
- Resume / Handoff：从父 Spec 第 6.2 节、0097 和本票真实 corpus 表接续，优先复核 JSON event-loop p99 与 `bufferedAmount` 实际边界。
- Project Sync Candidates：只把聚合性能结论与观测字段写入长期文档，不写入 corpus 路径或正文。
- 长期文档同步：待 0097。

### 提交记录

| 提交信息（Commit Message）                           | 提交脚注（Commit Footer） | 关联改动或阶段 | 文档同步状态 | 备注                   |
| ---------------------------------------------------- | ------------------------- | -------------- | ------------ | ---------------------- |
| `feat(relay): add compression metrics and benchmark` | `N/A`                     | `paseo / 0095` | `待 0097`    | 用户已授权逐票本地提交 |
