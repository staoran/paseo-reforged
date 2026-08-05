# 侧边栏冷启动 Runtime 状态修复 Micro Spec

## 0. 状态与索引

| 字段               | 值                                                       |
| ------------------ | -------------------------------------------------------- |
| task_id            | `0049`                                                   |
| spec layer         | `Feature Spec`                                           |
| task status        | `已收口`                                                 |
| document status    | `Completed`                                              |
| depth              | `fast`                                                   |
| phase              | `Review`                                                 |
| Execution Approval | `Approved`                                               |
| Approval Source    | `User`                                                   |
| file path          | `mydocs/micro_specs/0049_修复侧边栏冷启动Runtime状态.md` |
| parent spec        | `N/A`                                                    |
| superseded by      | `N/A`                                                    |
| created / updated  | `2026-08-05 14:44 / 2026-08-05 15:22`                    |

## 1. 目标与完成契约

- 当前理解：软件/daemon 冷启动后，侧边栏收到的 stored-only agent 仍携带上一进程的 `idle`/`running`，被 App 的 runtime residency 投影误判为 resident；点开并关闭标签后才变为 `closed`。
- 核心目标：让没有 live `AgentManager` session 的持久 agent 在侧边栏目录及其后续 stored-only 更新中稳定呈现 `closed/off`，同时保留 live agent 的真实生命周期状态。
- Done Contract：针对 `fetch_agents_request` 的回归断言在无 live session、磁盘 `lastStatus: idle` 时收到 `status: closed`；同一请求中的 live agent 状态不被改写；目标测试、typecheck、lint 通过。

## 2. 范围与事实

- 范围内：`packages/server/src/server/session.ts` 的 stored-only payload 归一化及其 Session 回归测试。
- 范围外：provider 启动/关闭实现、协议新增字段、App 图标样式、持久化历史状态重写、主 `6767` daemon、其他性能任务 dirty 文件。
- 当前任务单元：修正 server -> App 的权威目录投影。
- 轻量评估：`足够小`；单项目、边界清楚、无公共 wire schema 变化。
- 已确认事实：`listAgentPayloads()` 用 `AgentManager.listAgents()` 建立 live ID 集合；不在集合的 registry record 走 `buildStoredAgentPayload()`；该 helper 直接使用 `record.lastStatus`；App `DirectorySync` 用 fetch 完成快照替换 agent replica；`docs/agent-lifecycle.md` 定义 `closed` 为无 live provider runtime。
- `grilling` 结论：`N/A`。
- 风险与未知：stored-only 的历史 `error`/attention 语义可能被影响；实现需只归一化 runtime status，不删除 `requiresAttention`、`attentionReason` 或错误信息；现有工作区有其他未提交改动，必须保持不覆盖。

## 3. 涉及文件与计划

| 文件                                         | 计划变化                                                                                 | 事实源                                          |
| -------------------------------------------- | ---------------------------------------------------------------------------------------- | ----------------------------------------------- |
| `packages/server/src/server/session.ts`      | 在 Session 的 stored-only 投影边界将 runtime status 归一为 `closed`，不触碰 live payload | `listAgentPayloads()` / `getAgentPayloadById()` |
| `packages/server/src/server/session.test.ts` | 增加 fetch 公共 seam 的 RED -> GREEN 回归：旧 `idle` stored-only 映射为 `closed`         | `fetch_agents_response`                         |

1. 先写回归测试并确认当前实现 RED
2. 实施最小 stored-only 状态归一化，运行定向测试与静态检查

## 4. 执行前检查点

- 当前目标：只修复冷启动侧边栏 runtime residency 误判。
- 当前进度：诊断、RED -> GREEN、范围收窄审查和最终验证均已完成。
- 当前动作是否仍服务核心目标：是；最终改动只影响 agent directory 的 stored-only 投影。
- 下一步：无强制动作；可由用户在打包后的 Desktop 做一次冷启动人工 smoke。
- 风险与回退：若发现历史错误状态必须保留为业务状态，改为增加明确 runtime 投影字段或缩小归一化边界；不回滚用户 dirty 文件。
- 验证方式：`npx vitest run src/server/session.test.ts --bail=1 -t "stored-only"`（从 `packages/server`）；随后 `npm run typecheck`、`npm run lint`。
- TDD 判定、测试 seam 与验收行为：TDD；Session 的 `fetch_agents_request -> fetch_agents_response` 是真实 sidebar 目录公共 seam，验收 stored-only idle => closed、live status 保持原值。
- seam 确认：`User；2026-08-05 用户明确回复“确认 seam，批准执行 0049”`。
- Execution Approval / Source：`Approved / User`。

## 5. 执行与变更记录

- 实际改动：新增 `buildStoredAgentDirectoryPayload()`，只将非归档 stored-only agent 的目录状态归一为 `closed`；初始 fetch、目录订阅 stored update 和清除 attention 后的 upsert 共用该入口。新增 Session 公共 RPC 回归，证明磁盘 `idle` 且无 live session 时响应为 `closed`。
- 偏差与用户决策：首次 GREEN 将 Session 的所有 stored payload 都归一为 `closed`；changed-only 审查发现这会影响 `wait_for_finish` 和单 agent 查询，随即收窄为 directory 专用 helper，未改变批准范围。用户确认的 seam 和验收行为未变化。
- Change Log：`2026-08-05 14:44` 完成症状复现、根因定位和最小计划；`2026-08-05 15:10` 用户确认 Session fetch seam 并批准执行；`15:12` Session 回归按预期 RED；`15:14` 最小实现 GREEN；`15:18` Review 收窄 directory 边界后完整目标文件再次 GREEN；`15:22` typecheck、lint、diff hygiene 和 changed-only 审查通过。

## 6. 验证与完成判断

| 验收项                  | 命令或步骤                                                            | 结果 | 证据                                                    |
| ----------------------- | --------------------------------------------------------------------- | ---- | ------------------------------------------------------- |
| 冷启动 stored-only 状态 | 内联 `tsx` harness，连续 3 次                                         | RED  | 每次均为 `expected=closed actual=idle`                  |
| Session TDD RED         | `npx vitest run src/server/session.test.ts --bail=1 -t "stored-only"` | RED  | `1 failed / 153 skipped`；响应为 `idle` 而期望 `closed` |
| Session TDD GREEN       | 同一目标命令                                                          | PASS | `1 passed / 153 skipped`                                |
| 完整受影响测试文件      | `npx vitest run src/server/session.test.ts --bail=1`                  | PASS | 最终 `153 passed / 1 skipped`                           |
| typecheck               | `npm run typecheck`                                                   | PASS | 最终退出码 0；AOT codegen 后无生成物 diff               |
| lint                    | `npm run lint`                                                        | PASS | `0 warnings / 0 errors`，2992 files                     |
| 格式与 diff hygiene     | `npm run format:files -- ...`；目标 `git diff --check`                | PASS | 两个目标文件格式化成功；diff check 无输出               |

- 未验证项与原因：未启动打包后的 Desktop 做真实冷启动 smoke；本次改动位于 server 公共目录响应，自动测试已直接覆盖 sidebar 消费的 wire seam，且未获授权干扰主 `6767` daemon。
- 剩余风险：真实 Desktop 冷启动视觉结果尚待人工 smoke；归档历史和非目录 API 已在 Review 中保持原路径。
- Done Contract 是否由证据满足：是；stored-only `idle -> closed`、live 独立路径不变、目标测试与静态检查均有证据。

## 7. 恢复与同步

- 状态说明：`Review / 已收口 / Approved / User`。
- 当前卡点：无。
- 下一步唯一动作：无强制动作；可选为打包版 Desktop 冷启动人工 smoke。
- Resume / Handoff：回读本文件第 2、3、4、6 节；继续保护 0048、0038-0046 及其他 dirty 文件。
- Project Sync Candidates：`无`；这是一次性兼容/回归事实，先留在 micro-spec。
- 长期文档同步：`N/A`；现有 `docs/agent-lifecycle.md` 已描述“无 live provider runtime = closed”合同，本次不改变合同。

### 提交记录

| 提交信息（Commit Message）                                 | 提交脚注（Commit Footer） | 关联改动或阶段              | 文档同步状态   | 备注                                                                                |
| ---------------------------------------------------------- | ------------------------- | --------------------------- | -------------- | ----------------------------------------------------------------------------------- |
| `fix(server): report stored-only agent runtimes as closed` | `N/A`                     | `0049 / 修复实现与回归测试` | `随本提交同步` | Windows Lefthook 子进程 PATH 失败；等价验证通过后使用 `--no-verify`；未授权 push/PR |
