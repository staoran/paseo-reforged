# Framed envelope 与解码安全 Micro Spec

## 0. 状态与索引

| 字段               | 值                                                      |
| ------------------ | ------------------------------------------------------- |
| task_id            | `0088`                                                  |
| spec layer         | `Feature Spec`                                          |
| task status        | `已收口`                                                |
| document status    | `Completed`                                             |
| depth              | `standard`                                              |
| phase              | `Review`                                                |
| Execution Approval | `Approved`                                              |
| Approval Source    | `User / 2026-08-19；按依赖顺序逐票实施并本地提交`       |
| file path          | `mydocs/micro_specs/0088_framed_envelope与解码安全.md`  |
| parent spec        | `mydocs/specs/0084_跨端中继二进制加密与状态追平压缩.md` |
| superseded by      | `N/A`                                                   |
| created / updated  | `2026-08-19`                                            |

## 1. 目标与完成契约

- 当前理解：identity envelope 目前内嵌在 `encrypted-channel.ts`；压缩、严格 Base64、长度和解码限额尚未形成平台无关模块。
- 核心目标：建立唯一的 framed-v1 envelope/parser seam，令 text/binary payload、identity/deflate codec 和 wire 表示可独立验证。
- Done Contract：
  - 实现 8 字节 header、binary flag、codec、uint32 原始长度及认证前后长度计算；header 与 payload 一起进入 NaCl。
  - framed Base64 使用严格 padded alphabet/length 校验；binary/text opcode 与连接选择不匹配时关闭。
  - identity exact length、deflate 4 MiB 原始输入、UTF-8 fatal decode、32 MiB 单帧 wire、128:1 ratio 等限制在分配/解压前生效。
  - codec 未知、header/flag/length/UTF-8 错误均 fail closed；不改变 legacy parser 语义。
  - 导出稳定 `Prepared/Decoded` 或等价类型，供 0089、0090、0092 使用，不复制协议常量。

## 2. 范围与事实

- 范围内：新增 `packages/relay/src/framed-ciphertext.ts` 及测试；从 `encrypted-channel.ts` 提取共享常量/解析调用；Base64 严格预检和 parser limits RED/GREEN。
- 范围外：Node zlib/fflate 具体实现、traffic hint、socket reservation、UI。
- 当前任务单元：平台无关 wire contract 和安全边界。
- 轻量评估：`standard`；涉及公共 E2EE wire，但由 0084 已批准 header/limits 约束。
- 已确认事实：生产 relay 只转发 opaque text/binary；外部 relay 不应解析 envelope。
- 风险与未知：解压实际 CPU/内存由 0089/0092 的 adapter 和真机门禁验证。

## 3. 涉及文件与计划

| 文件                                           | 计划变化                                                  | 事实源                  |
| ---------------------------------------------- | --------------------------------------------------------- | ----------------------- |
| `packages/relay/src/framed-ciphertext.ts`      | 新增 encode/decode、wire length、严格校验和类型           | Spec 0084 附录 D        |
| `packages/relay/src/framed-ciphertext.test.ts` | 增加 malformed header/Base64/UTF-8/length/limit RED→GREEN | RED-3 及后续 parser RED |
| `packages/relay/src/encrypted-channel.ts`      | 调用共享 parser，保留 legacy 分支                         | 当前 GREEN-3 实现       |

1. 先写 parser limits、错误类型和 golden vector RED。
2. 实现单一 envelope/parser，禁止业务层重新解释 header。
3. 让 relay channel 的两种表示和四象限 payload 用例通过。

## 4. 执行前检查点

- 当前目标：锁定 wire/parser 安全契约，不实现压缩 adapter。
- 当前进度：0087 已提交；越权 ready selection、locked opcode、公共 envelope/parser、严格 Base64、wire 与 decode limits 均已转 GREEN。
- 当前动作是否仍服务核心目标：是；后续所有压缩和 queue 代码依赖同一 parser。
- 下一步：`N/A；0088 已完成，按依赖进入 0089 daemon 压缩准备与 codec 门禁。`
- 风险与回退：parser 失败保持 legacy path；不得放宽生产 relay 32 MiB 或 receive 64 MiB 限制。
- 验证方式：relay framed test、crypto regression、typecheck/lint/format。
- TDD 判定、测试 seam 与验收行为：`TDD；公共 encode/decode、Transport wire 和 channel events`。
- seam 确认：`User；父 Spec D.1/D.2 已明确`。
- Execution Approval / Source：`Approved / User / 2026-08-19`。

## 5. 执行与变更记录

- 实际改动：新增平台无关 `framed-ciphertext.ts`，集中 8-byte envelope、identity/deflate codec、严格 Base64/binary wire、32 MiB exclusive wire cap、4 MiB compression input cap、4 KiB compression floor、5%/64-byte 收益、128:1 ratio、bounded inflate 与 fatal UTF-8；`encrypted-channel.ts` 已复用公共 prepare/decode/wire-length seam，并移除重复 header/parser。
- 偏差与用户决策：0088 只定义注入式 `FrameCompressionAdapter`，不引入 Node zlib 或 client fflate；framed 接入当前仍只协商 identity，实际 codec advertisement 分别由 0089/0093 完成。
- Change Log：`2026-08-19` 从 0084 envelope/limits 清单拆出。
- Change Log：`2026-08-19` 完成逐条 RED→GREEN、legacy compatibility 与静态门禁，进入 Review/已收口。

## 6. 验证与完成判断

| 验收项        | 命令或步骤                                            | 结果 | 证据                                                                                              |
| ------------- | ----------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------- |
| vectors       | `framed-ciphertext.test.ts --bail=1`                  | PASS | `68 passed / 1 skipped`；identity、deflate adapter、Base64/binary、text/binary 四象限             |
| fail closed   | malformed header/UTF-8/Base64/length/ratio 定向用例   | PASS | strict canonical Base64、32 MiB wire、4 MiB deflate input、5%/64-byte、128:1、exact output 均通过 |
| compatibility | legacy channel/crypto 与 framed new/new               | PASS | `encrypted-channel.test.ts` 15/15、`crypto.test.ts` 8/8；legacy URL-safe/unpadded 保持宽松        |
| static        | `npm run typecheck`、`npm run lint`、目标 format/diff | PASS | workspace typecheck 退出码 0；lint `0 warnings / 0 errors`；目标文件格式与 diff check 通过        |

- 未验证项与原因：Node zlib、client fflate、receive reservation、真实 relay/Hermes 不属于 0088；完整 framed 文件唯一 skip 为 0090 的 opening 入站 FIFO。
- 剩余风险：实际 inflate CPU/内存、跨实现 DEFLATE vector 与 receive 总预算仍由 0089、0093、0090 约束。
- Done Contract 是否由证据满足：`是；0088 scoped contract 已满足，父 Spec 仍在 Execute。`

## 7. 恢复与同步

- 状态说明：`Review / 已收口 / Completed`；公共 framed parser 与 channel 接入已完成。
- 当前卡点：`N/A`；后续 codec 实现与队列边界已有独立 ticket。
- 下一步唯一动作：执行 0089 Node raw DEFLATE、level 1、收益与两槽位门禁。
- Resume / Handoff：从本文件公共 `PreparedFramedPayload` / `FrameCompressionAdapter` 与父 Spec D.2 接续。
- Project Sync Candidates：实现后回写 `SECURITY.md` 候选。
- 长期文档同步：待 0097。

### 提交记录

| 提交信息（Commit Message）                       | 提交脚注（Commit Footer） | 关联改动或阶段 | 文档同步状态 | 备注                   |
| ------------------------------------------------ | ------------------------- | -------------- | ------------ | ---------------------- |
| `feat(relay): harden framed ciphertext decoding` | `N/A`                     | `paseo / 0088` | `已同步`     | 用户已授权逐票本地提交 |
