# 业务流量分类与 terminal/file hint Micro Spec

## 0. 状态与索引

| 字段               | 值                                                            |
| ------------------ | ------------------------------------------------------------- |
| task_id            | `0092`                                                        |
| spec layer         | `Feature Spec`                                                |
| task status        | `已批准`                                                      |
| document status    | `Active`                                                      |
| depth              | `standard`                                                    |
| phase              | `Plan`                                                        |
| Execution Approval | `Approved`                                                    |
| Approval Source    | `User / 2026-08-19；按依赖顺序逐票实施并本地提交`             |
| file path          | `mydocs/micro_specs/0092_业务流量分类与terminal_file_hint.md` |
| parent spec        | `mydocs/specs/0084_跨端中继二进制加密与状态追平压缩.md`       |
| superseded by      | `N/A`                                                         |
| created / updated  | `2026-08-19`                                                  |

## 1. 目标与完成契约

- 当前理解：E2EE transport 不应解析业务 JSON；分类必须在结构化消息边界产生，terminal/file binary 需要把语义 hint 送到 relay。
- 核心目标：建立统一 `RelayTrafficHint` 生成链路，严格区分 realtime、state-sync、bulk、bulk-live。
- Done Contract：
  - 新增 `outbound-traffic.ts` 映射：未知/控制/assistant 增量/运行中或失败 tool_call 均 realtime；完成态 tool_call 仅成为 bulk-live 候选。
  - `fetch_* snapshot/timeline`、terminal Snapshot/Restore 为 state-sync；UTF-8 FileChunk 为 compressible bulk；binary FileChunk、Begin/End 保持 identity。
  - 序列化后大小、收益和槽位门禁由 0089 prepare 执行；分类函数不自行压缩、不读取加密 payload。
  - relay path 消费 hint，direct WebSocket 忽略 hint；client→daemon v1 仍 identity。
  - 既有 session/websocket/terminal/file 业务消息内容和顺序不变。

## 2. 范围与事实

- 范围内：新增 `packages/server/src/server/websocket/outbound-traffic.ts` 及 tests；`websocket-server.ts`、`session.ts`、`terminal-session-controller.ts`、`workspace-files-session.ts` hint 透传。
- 范围外：压缩算法、E2EE parser、UI、metrics。
- 当前任务单元：结构化 outbound 与 binary session hint。
- 轻量评估：`standard`；跨 server websocket/session/terminal/file，但不改变业务 schema。
- 已确认事实：`websocket-server.ts` 已有 `onBinaryMessage`/`onBinaryMessageToSource`；FileBegin 带 encoding/MIME；terminal Output 与 Snapshot/Restore 入口不同。
- 风险与未知：实际序列化大小需由 0089 prepare 计算，不在 hint 层猜测。

## 3. 涉及文件与计划

| 文件                                                                  | 计划变化                                | 事实源                 |
| --------------------------------------------------------------------- | --------------------------------------- | ---------------------- |
| `packages/server/src/server/websocket/outbound-traffic.ts`            | 新增纯分类函数和 hint 类型              | Spec 附录 A            |
| `packages/server/src/server/websocket-server.ts`                      | relay `sendClassified`，direct 忽略     | websocket boundary     |
| `packages/server/src/server/session.ts`                               | binary callback 透传 hint               | session callback types |
| `packages/server/src/terminal/terminal-session-controller.ts`         | Output/Input/Resize vs Snapshot/Restore | terminal behavior docs |
| `packages/server/src/server/session/files/workspace-files-session.ts` | FileChunk UTF-8 compressible hint       | FileBegin encoding     |

1. 先为分类矩阵写纯函数和路由 RED。
2. 接入结构化 JSON 与 binary callback，保留 direct path。
3. 运行 session/terminal/file 回归。

## 4. 执行前检查点

- 当前目标：只产生语义 hint，不在业务层压缩或修改协议 schema。
- 当前进度：hint 类型在父 Spec 中定义，生产入口尚未接入。
- 当前动作是否仍服务核心目标：是；实时不压缩和 bulk-live 门禁依赖分类准确性。
- 下一步：0091 policy types 稳定后执行。
- 风险与回退：无法识别时默认 realtime；direct WebSocket 必须保持既有字节发送。
- 验证方式：outbound classifier、websocket-server、terminal/file 定向测试和静态检查。
- TDD 判定、测试 seam 与验收行为：`TDD；结构化消息边界、session callback、业务现有测试 seam`。
- seam 确认：`User；父 Spec A 已明确四类和 bulk-live 门禁`。
- Execution Approval / Source：`Approved / User / 2026-08-19`。

## 5. 执行与变更记录

- 实际改动：本轮未修改生产代码。
- 偏差与用户决策：无。
- Change Log：`2026-08-19` 从父 Spec 执行清单 8/9 拆出。

## 6. 验证与完成判断

| 验收项               | 命令或步骤                          | 结果   | 证据                   |
| -------------------- | ----------------------------------- | ------ | ---------------------- |
| classifier           | message matrix and unknown fallback | 待执行 | Spec 附录 A            |
| binary hints         | terminal/file frame matrix          | 待执行 | existing session tests |
| direct compatibility | direct socket ignores hint          | 待执行 | websocket tests        |

- 未验证项与原因：尚未授权实现。
- 剩余风险：序列化大小/收益由 0089，端到端 p95 由 0095/0097。
- Done Contract 是否由证据满足：`No；待 Execute`。

## 7. 恢复与同步

- 状态说明：ticket 已登记，依赖 0091。
- 当前卡点：无设计卡点，仅缺执行授权。
- 下一步唯一动作：接入四类 traffic hint 和 terminal/file 语义。
- Resume / Handoff：从父 Spec 附录 A、session binary callbacks 和 terminal/file tests 接续。
- Project Sync Candidates：分类与实时门禁回写 `docs/terminal-performance.md`。
- 长期文档同步：待 0097。

### 提交记录

| 提交信息（Commit Message） | 提交脚注（Commit Footer） | 关联改动或阶段 | 文档同步状态 | 备注     |
| -------------------------- | ------------------------- | -------------- | ------------ | -------- |
| `<待提交>`                 | `N/A`                     | `paseo / 0092` | `待填写`     | 未获授权 |
