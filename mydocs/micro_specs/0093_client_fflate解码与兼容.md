# Client fflate 解码与 framed 兼容 Micro Spec

## 0. 状态与索引

| 字段               | 值                                                      |
| ------------------ | ------------------------------------------------------- |
| task_id            | `0093`                                                  |
| spec layer         | `Feature Spec`                                          |
| task status        | `已收口`                                                |
| document status    | `Completed`                                             |
| depth              | `standard`                                              |
| phase              | `Review`                                                |
| Execution Approval | `Approved`                                              |
| Approval Source    | `User / 2026-08-19；按依赖顺序逐票实施并本地提交`       |
| file path          | `mydocs/micro_specs/0093_client_fflate解码与兼容.md`    |
| parent spec        | `mydocs/specs/0084_跨端中继二进制加密与状态追平压缩.md` |
| superseded by      | `N/A`                                                   |
| created / updated  | `2026-08-19`                                            |

## 1. 目标与完成契约

- 当前理解：client 当前只 advertisement framed identity，`compressionAlgorithms` 为空；Web/Hermes 需要 direct `fflate` raw inflate，v1 client 出站保持 identity。
- 核心目标：接入 fflate decoder，使 client 能安全接收 daemon `deflate-raw`，并按真机能力决定是否 advertisement。
- Done Contract：
  - `packages/relay` 对 `fflate` 建立 direct dependency；实现 bounded raw inflate、fatal UTF-8、expected length/ratio/byte budget。
  - client hello 在 runtime capability 通过门禁时才包含 `deflate-raw`；不支持时仍可 framed identity，失败不降级到错误 codec。
  - framed Base64/binary 与 text/ArrayBuffer 四象限 byte-for-byte；多帧顺序不变；client→daemon v1 出站 identity。
  - Hermes/浏览器环境不引入 Node-only API；旧 daemon 缺 framed selection 时保持 legacy wire。
  - 解码错误、超限、wrong opcode 均关闭连接并不上交应用层。

## 2. 范围与事实

- 范围内：`packages/relay/package.json`、lockfile、`packages/relay/src/fflate-frame-compression.ts`、`packages/client/src/daemon-client-relay-e2ee-transport.ts`、对应 tests。
- 范围外：daemon zlib adapter、UI、traffic classification、真实 Hermes 门禁执行。
- 当前任务单元：client decoder 和 capability advertisement。
- 轻量评估：`standard`；跨 Web/Hermes runtime，需单独验证内存和错误边界。
- 已确认事实：client transport API 只暴露 string/ArrayBuffer，`createClientChannel` 是能力广告入口。
- 风险与未知：真实 Hermes p95/OOM 只能在 0097 结论，不能用 Node 测试替代。

## 3. 涉及文件与计划

| 文件                                                        | 计划变化                          | 事实源                   |
| ----------------------------------------------------------- | --------------------------------- | ------------------------ |
| `packages/relay/package.json`、`package-lock.json`          | direct `fflate` dependency        | 父 Spec 3.1              |
| `packages/relay/src/fflate-frame-compression.ts`            | bounded raw inflate adapter       | Web/Hermes constraints   |
| `packages/client/src/daemon-client-relay-e2ee-transport.ts` | 注入 decoder，保持 API            | current client transport |
| relay/client tests                                          | vectors、能力降级、顺序和错误关闭 | RED-3/父 Spec            |

1. 先写 Node↔fflate golden vectors 与 capability fallback RED。
2. 实现 bounded inflate 和 client integration。
3. 运行 relay/client 定向回归，记录真机门禁为未验证项。

## 4. 执行前检查点

- 当前目标：只增加 daemon→client 解码能力，不开启 client 上传压缩。
- 当前进度：identity framed 已 GREEN，compression capability 为空。
- 当前动作是否仍服务核心目标：是；否则 daemon 压缩无法被移动端消费。
- 下一步：0088 parser GREEN 后执行，可与 0089/0091 并行。
- 风险与回退：fflate 或真机门禁失败时移除 `deflate-raw` advertisement，保留 framed identity/legacy。
- 验证方式：relay/client tests、typecheck/lint/format；Hermes 留 0097。
- TDD 判定、测试 seam 与验收行为：`TDD；codec adapter、createClientChannel capability、transport events`。
- seam 确认：`User；父 Spec 明确 client 出站 identity 与 Hermes 失败回退`。
- Execution Approval / Source：`Approved / User / 2026-08-19`。

## 5. 执行与变更记录

- 实际改动：新增 `fflate@0.8.2` direct runtime dependency 与 portable raw DEFLATE adapter；使用 `expectedLength + 1` 哨兵缓冲，严格拒绝 overflow/underflow，并保留对称 deflate 仅供 vectors/跨实现验证。
- 实际改动：`createClientChannel` 增加可选 decoder capability gate；只有注入 decoder 才 advertisement `deflate-raw`，selection/confirm 精确回显；framed 入站将 adapter 交给唯一 envelope parser。
- 实际改动：client relay transport 默认注入共享 fflate adapter；v1 client 出站继续固定 identity；补齐 Node↔fflate vectors、Base64/binary × text/ArrayBuffer 四象限和真实 transport events 测试。
- 偏差与用户决策：无；未引入 Node-only API，daemon encoder 仍由 0089/后续 server adapter 负责。
- Change Log：`2026-08-19` 从父 Spec 执行清单 10 拆出。
- Change Log：`2026-08-19` 完成 adapter、capability gate、framed decode、跨实现 vectors 和 client transport GREEN，进入 Review/已收口。

## 6. 验证与完成判断

| 验收项        | 命令或步骤                                                      | 结果 | 证据                                                                                 |
| ------------- | --------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------ |
| vectors       | `fflate-frame-compression.test.ts --bail=1`                     | PASS | 5/5；Node→fflate、fflate→Node、4 MiB sentinel、exact overflow/underflow              |
| capability    | `framed-ciphertext.test.ts --bail=1`                            | PASS | 75 passed / 1 skipped；decoder gate、selection/confirm、四象限、client identity 出站 |
| compatibility | `daemon-client-relay-e2ee-transport.test.ts --bail=1`           | PASS | 2/2；真实 base transport advertisement 与 daemon compressed text event               |
| static        | relay/client build、typecheck、target oxlint、format/diff check | PASS | relay/client typecheck 通过；目标 oxlint 0/0；格式和 diff check 通过                 |

- 未验证项与原因：Hermes 真机尚未可用；根 workspace typecheck 仍被范围外 `packages/server/src/server/agent/file-agent-timeline-store.ts` 缺失方法阻塞。
- 剩余风险：移动端 p95、GC、OOM 和耗电由 0097 验证。
- Done Contract 是否由证据满足：`是；0093 scoped contract 已满足，Hermes p95/OOM 和 mixed-version 仍留 0097`。

## 7. 恢复与同步

- 状态说明：`Review / 已收口 / Completed`；client decoder 与 capability advertisement 可供 0090/0091 消费。
- 当前卡点：`N/A`；真机环境验证保留到 0097。
- 下一步唯一动作：实现 0090 加密帧 FIFO、reservation 与最终 wire high-water。
- Resume / Handoff：从 0088 decoded frame 类型和 client transport 入口接续。
- Project Sync Candidates：Hermes capability 结论回写 `SECURITY.md` 和父 Spec。
- 长期文档同步：待 0097。

### 提交记录

| 提交信息（Commit Message）                      | 提交脚注（Commit Footer） | 关联改动或阶段 | 文档同步状态 | 备注                   |
| ----------------------------------------------- | ------------------------- | -------------- | ------------ | ---------------------- |
| `feat(relay): add client fflate framed decoder` | `N/A`                     | `paseo / 0093` | `已同步`     | 用户已授权逐票本地提交 |
