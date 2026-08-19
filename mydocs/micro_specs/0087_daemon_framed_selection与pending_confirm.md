# Daemon framed selection 与 pending confirm Micro Spec

## 0. 状态与索引

| 字段               | 值                                                                    |
| ------------------ | --------------------------------------------------------------------- |
| task_id            | `0087`                                                                |
| spec layer         | `Feature Spec`                                                        |
| task status        | `已收口`                                                              |
| document status    | `Completed`                                                           |
| depth              | `standard`                                                            |
| phase              | `Review`                                                              |
| Execution Approval | `Approved`                                                            |
| Approval Source    | `User / 2026-08-19`                                                   |
| file path          | `mydocs/micro_specs/0087_daemon_framed_selection与pending_confirm.md` |
| parent spec        | `mydocs/specs/0084_跨端中继二进制加密与状态追平压缩.md`               |
| superseded by      | `N/A`                                                                 |
| created / updated  | `2026-08-19 / 2026-08-19`                                             |

## 1. 目标与完成契约

- 当前理解：RED-3 锁定的 daemon `auto/base64/binary` 选择、pending exact confirm、重复 hello/ready 和错误关闭行为已转 GREEN；生产 factory 现已提供正式 policy option，并阻止 ready write 期间 transport close 后的晚 attach。
- 核心目标：让 daemon 通过 hello/ready/legacy Base64 confirm 完成一次可认证、可回退、连接级锁定的 framed-v1 握手。
- Done Contract：
  - `createDaemonChannel` 接受正式 optional `ciphertextEncoding: "auto" | "base64" | "binary"`，测试不再使用 cast。
  - 合法 offer 按配置和能力选择 framed binary/Base64；无共同 framed 表示时按既有 legacy hybrid/Base64 回退。
  - ready 写出后 channel Promise 保持 pending；首个加密帧必须是 exact legacy Base64 `e2ee_mode_confirm`，确认前不 attach、不交付应用帧。
  - confirm 的 mode、encoding、codec 列表逐项匹配；重复同 key hello/ready 幂等，不重 key、不重复 attach；错误、transport timeout 经 close/error 或 send reject 时 fail closed。
  - ready transport write 未完成时收到 close/error，后续异步续体不得重新进入 pending/open，不触发晚到 attach 或 `onopen`。
  - 既有 legacy channel 与 GREEN-3 回归保持通过。

## 2. 范围与事实

- 范围内：`packages/relay/src/encrypted-channel.ts`、`e2ee.ts`/`index.ts` 导出、framed-ciphertext 定向测试和旧 channel 回归。
- 范围外：deflate 实际编解码、业务 traffic classification、server config/runtime 注入、receive reservation。
- 当前任务单元：把 RED-3 的 selection/pending/mismatch/重复握手子集转为最小 GREEN。
- 轻量评估：`standard`；公共 E2EE 握手契约但仅单一 relay workspace，沿用父 Spec 的 wire 决策。
- 已确认事实：daemon 现在只在无 framed selection 时写 legacy ready 并立即 attach；有 selection 时保存 exact ready 并等待认证 confirm，测试通过 public `Transport` 和真实 crypto wire 验证。
- 风险与未知：pending confirm 后的首个应用帧已在本 ticket 的握手 FIFO 中验证；通用 receive FIFO、reservation 与高水位仍需 0090 完成；当前 ticket 不引入压缩或异步准备。

## 3. 涉及文件与计划

| 文件                                                        | 计划变化                                                            | 事实源                   |
| ----------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------ |
| `packages/relay/src/encrypted-channel.ts`                   | daemon selection、pending 状态、exact confirm 和正式 factory option | RED-3 tests、父 Spec C.2 |
| `packages/relay/src/e2ee.ts`、`packages/relay/src/index.ts` | 导出稳定 option/selection 类型（如需要）                            | relay public API         |
| `packages/relay/src/framed-ciphertext.test.ts`              | 让 selection/pending/mismatch RED 转 GREEN                          | 47-case RED-3 基线       |
| `packages/relay/src/encrypted-channel.test.ts`              | 旧 legacy/hybrid 回归                                               | 15/15 基线               |

1. 先将 test-only daemon policy cast 替换为正式 optional option。
2. 实现选择、ready、confirm、attach 的严格状态转换并保留 legacy fallback。
3. 逐条运行目标测试与旧 channel/crypto 回归。

## 4. 执行前检查点

- 当前目标：只关闭 daemon selection/pending confirm 的 RED，不提前实现压缩。
- 当前进度：0087 归属的 selection/pending/replay/close-race 28 个用例已 GREEN；完整文件为 `43 GREEN / 5 RED / 0 unmatched`，剩余 5 条分别归属 0088（client selection/opcode）和 0090（opening 入站 FIFO）。
- 当前动作是否仍服务核心目标：是；这是所有 framed payload 和 runtime policy 的前置握手契约。
- 下一步：`N/A；0087 已完成，等待 0088 独立执行批准。`
- 风险与回退：任一 confirm/legacy 回归失败时关闭 framed advertisement，保持旧 wire。
- 验证方式：目标测试按完整名称运行，`encrypted-channel.test.ts`、`crypto.test.ts`、relay typecheck/lint/format。
- TDD 判定、测试 seam 与验收行为：`TDD；只经过 factory、Transport、channel events 和 crypto wire`。
- seam 确认：`User；父 Spec 已批准 wire/兼容矩阵，本轮只登记执行单元`。
- Execution Approval / Source：`Approved / User / 2026-08-19`。

## 5. 执行与变更记录

- 实际改动：`createDaemonChannel` 增加正式可选 `DaemonChannelOptions`；实现 offer 解析、`auto/base64/binary` 确定性 selection、保存并重发 ready、pending exact legacy Base64 confirm、同 key hello 重放、fail-closed 与连接级 framed 锁定；公开导出 encoding/option 类型；修复协议错误后的 `isOpen()` 状态，并在 ready write await 后重新检查 closed phase，禁止关闭后的异步续体晚 attach。
- 偏差与用户决策：未增加独立本地 confirm timeout timer；父 Spec 未定义 timeout 时长，transport `close/error` 会在 pending 阶段 reject 并 fail closed，避免引入未批准的时序常量。通用 opening 入站 FIFO 与 reservation 保留给 0090。
- Change Log：`2026-08-19` 从 0084 RED-3 拆出；用户批准进入最小 GREEN。
- Change Log：`2026-08-19` 完成 selection、pending exact confirm、saved ready replay、payload/opcode 兼容回归；0087 进入 Review/已收口。
- Change Log：`2026-08-19` 收口复审补入 ready write close 竞态 RED，并以 await 后 closed phase 门禁完成最小 GREEN。

## 6. 验证与完成判断

| 验收项     | 命令或步骤                                                    | 结果 | 证据                                                                                                 |
| ---------- | ------------------------------------------------------------- | ---- | ---------------------------------------------------------------------------------------------------- |
| selection  | `framed-ciphertext.test.ts` selection/fallback 定向名称       | PASS | 11 个 selection/fallback 用例；覆盖 `auto/base64/binary`、malformed/unknown offer 与 legacy fallback |
| 0087 scope | `framed-ciphertext.test.ts` selection/pending/replay 定向名称 | PASS | 28 个 0087 归属用例；覆盖 selection、exact confirm、FIFO、saved ready、close race 与 fail closed     |
| regression | relay channel/crypto/server relay 定向测试                    | PASS | `encrypted-channel.test.ts` 15/15、`crypto.test.ts` 8/8、server relay transport 6/6                  |
| static     | relay/server typecheck、目标 lint/format/diff                 | PASS | relay/server typecheck 退出码 0；4 个目标文件 lint/format/diff 通过                                  |

- 未验证项与原因：完整 framed parser limits、严格 Base64/opcode enforcement、opening 入站 FIFO/reservation、压缩和 runtime policy 尚未实现，分别由 0088–0095 负责；本 ticket 未运行 live relay 或真机门禁。
- 剩余风险：完整 48-case 基线为 `43 GREEN / 5 RED / 0 unmatched`；5 条可归因 RED 保持失败：client 越权 selection 2 条、锁定 opcode 2 条、opening 入站 FIFO 1 条；不阻塞 0087 的 daemon selection/pending confirm 合同，但阻塞父 Spec 收口。
- Done Contract 是否由证据满足：`是；0087 scoped contract 已满足，父 Spec 整体仍未完成。`

## 7. 恢复与同步

- 状态说明：`Review / 已收口 / Completed`；用户批准的 0087 daemon framed selection/pending confirm 最小 GREEN 已完成。
- 当前卡点：`N/A`；后续 0088/0090 仍有明确、独立的 RED。
- 下一步唯一动作：按依赖启动 0088 framed envelope/parser limits；随后处理 0090 通用 receive FIFO/reservation。
- Resume / Handoff：先读父 Spec 0084 第 7.11 节和本文件第 5、6 节；保留工作树中其他任务的并行改动。
- Project Sync Candidates：实现完成后回写父 Spec 和 relay 安全文档。
- 长期文档同步：待 0097 统一处理。

### 提交记录

| 提交信息（Commit Message）                             | 提交脚注（Commit Footer） | 关联改动或阶段 | 文档同步状态 | 备注                                     |
| ------------------------------------------------------ | ------------------------- | -------------- | ------------ | ---------------------------------------- |
| `feat(relay): negotiate daemon framed ciphertext mode` | `N/A`                     | `paseo / 0087` | `已同步`     | 用户已授权本地提交；SHA 在后续汇总中补录 |
