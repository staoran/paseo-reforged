# F07 Activity 整轮过程折叠 Micro Spec

## 0. 状态

| 字段               | 值                                      |
| ------------------ | --------------------------------------- |
| task_id            | `0121`                                  |
| 0118 项目          | `F07`，重做                             |
| task status        | `已完成`                                |
| document status    | `Implemented`                           |
| depth              | `deep`                                  |
| Execution Approval | `Approved`，按第 4 节实施               |
| created            | `2026-09-26`                            |
| code baseline      | `work/0118-priority-features@507e66ffb` |

## 1. 目标与完成契约

- 当前理解：把一次 Agent 回复中最终回答前的过程收成一条可展开的 Activity 完成记录，让长对话优先呈现用户输入和最终回答
- 核心目标：恢复 Codex 显式 final answer 前的整段 Activity 折叠，同时保留 Timeline 消息身份和用户操作入口
- Done Contract：Codex 的 live/history phase 可用；每个显式 final 结束一段 Activity；Web/Native 默认收起并可展开，搜索、跳转、复制和后台恢复可达；通过定向测试、typecheck 和 lint

## 2. 历史实现

| 来源                   | 已实现的行为                                                                                                                            |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `d330db760`、旧 `0016` | Codex assistant message 保留可选 `commentary/final_answer` phase；按用户轮次将 final 前的过程聚合，final answer 和待用户操作始终可见    |
| 旧 `0016`、`0033`      | 活动中的过程强制展开；出现显式 final 后按 `autoExpandActivity` 决定默认状态；手动开合仅作用于当前视图；后台完成后重新打开也应用默认折叠 |
| 旧 `0016`              | 完成头显示本地化“已处理 + 时长”；推理、工具组、单项工具详情各自保留独立展开状态；没有 final 的失败或中断轮次不自动折叠                  |
| `f17b00fab`、旧 `0040` | 顶层列表只保留一条 Activity row，展开时才物化成员；稳定 host id 承担滚动锚点与历史行身份，历史和实时跨 lane 时不重复                    |

旧实现并非通用的“隐藏推理”：成员还包含过程文本、工具调用、计划、todo 和状态消息。旧 `0040` 依赖当时的 Timeline 投影结构，其按需网络读取方案不能直接移植。

## 3. 当前代码与差异

- `packages/protocol/src/agent-types.ts` 的 `assistant_message` 没有 phase；`packages/server/src/server/agent/providers/codex-app-server-agent.ts` 的 `threadItemToTimeline()` 未保留 Codex final/commentary 边界。当前 App `agent-stream/model.ts` 仍是普通 `StreamItem[]`，没有 Activity row
- 当前 `agent-stream/presentation.ts` 会把 assistant message 拆成 Markdown block 行；`docs/agent-stream-performance.md` 要求消息身份、行身份和虚拟列表锚点分开处理
- 当前工具调用摘要已有独立投影；F07 可先复用现有投影，F08 若获批再替换内部工具呈现，不把分类分组状态和整轮展开状态绑在一起
- 当前 `agent-stream/turn-membership.ts` 和 `docs/timeline-sync.md` 区分 canonical turn 与可见回复：系统注入 prompt 可使一个可见回复跨多个 canonical turn。旧“遇到 user message 才切轮”的规则需要按此事实复核

## 4. 已确认行为与验收

1. 只支持带可靠 phase 的 Codex；无 phase 的旧消息保持原样，旧 daemon 可继续解析新字段
2. 以可见回复为范围，遇到每个显式 `final_answer` 就结束一段 Activity；同一段允许跨多个 canonical `turnId`，同一可见回复允许多段 Activity。下一个用户消息开始新的可见回复
3. 活动中过程保持展开；显式 final 后默认收起。独立持久化 `autoExpandActivity` 设置控制完成段的默认开合，手动开合只作用于当前视图。final answer、权限请求和待用户操作保持可见；无 final 的失败或取消过程保持展开
4. 完成行显示本地化“已处理 + 时长”。展开成员保持原顺序，推理、当前工具组和单项工具详情仍独立开合。F07 复用当前工具呈现；F08 不重写
5. 一段 Activity 在 Web/Native 顶层列表占一个稳定 row；搜索、跳转、复制、滚动锚点、后台完成恢复可找到原消息。定向测试覆盖 live/history、跨 tail/head、多个 final、无 final 和旧 daemon 解析；执行 typecheck、lint

## 5. 决策

- 2026-09-26：用户批准第 4 节合同并授权实现
- 2026-09-26：F08 已有相关实现，放弃重写；F07 沿用当前工具投影

## 6. 实施边界与恢复

- 可能涉及：`packages/protocol/src/agent-types.ts`、`messages.ts`，Codex adapter、Timeline 投影、App stream/presentation/render model、settings、i18n 和目标测试。动协议前读 `docs/protocol-compatibility.md`
- 当前状态：合同已实现；F08 复用原有工具投影，不做重写
- 实现证据：Codex live/history 保留可选 phase，App 在展示层按显式 final 建立稳定 Activity host；完成后默认收起，独立设置控制默认展开，搜索和跳转先展开成员再定位
- 验证：根目录 `npm run typecheck`、`npm run lint`、`git diff --check` 均通过；App `model.test.ts`、`presentation.test.ts`、`stream.test.ts` 共 106 项通过，服务端 coalescer/projection 共 49 项通过，Codex adapter 定向 5 项通过，协议兼容 2 项通过；缓存与 i18n 定向测试此前亦通过
- 未验证：未运行真实 Codex 会话及 Web/Native 人工视觉验收；本轮依照项目规则未运行全量测试
- Project Sync Candidates：无；行为决策保留在本规格
