# <跨项目任务名称> 跨项目 Spec

本文件是父级跨项目合同。`cross-full` 时：父级 task plan 持当前阶段和项目操作状态，父级 progress 持实际变更、验证、发布/回退时间线、残余风险、下一步、实际同步和提交关联；本文件不复制这些内容。`cross-lite` 或 `observe-only` 未启用 tracking 时可在本文件直接记录结论。

## 合同索引

| 字段 | 值 |
| --- | --- |
| task_id | `<workspace id>` |
| workspace_root | `<path>` |
| 记录根 | `<workspace task record root>` |
| 工作区规则 | `<workspace AGENTS/project rules path and anchor>` |
| 任务索引 | `<workspace task-index path and anchor or N/A>` |
| 授权范围 | `<user-approved scope>` |
| 持久化深度 | `observe-only / cross-lite / cross-full` |

## 目标、范围与完成契约

- 背景/问题：
- 核心目标：
- 非目标：
- Done Contract：

## 项目注册与范围判断

本表是参与项目与观察项目集合的唯一来源；按“身份/角色”列计算参与项目数量，不在其他章节另建项目清单。

| 项目 | 身份/角色 | 影响判断 | 本地记录 | 契约责任 | 范围判断锚点 | 授权动作 |
| --- | --- | --- | --- | --- | --- | --- |
|  | 参与：Provider/Consumer/Shared；或观察：Observer | 受影响/不受影响/待调查 |  |  |  | 只读/修改/禁止修改 |

`observe-only` 仅登记 Observer，并将本地施工、契约责任和发布字段标为 `N/A`；只填写授权范围、影响判断、证据、结论和升级条件。

## Observer 证明

字段口径、证据地址和状态转移只见 `.skills/workflows/cross-project.md#证据与观察证明`；证明状态是父级合同中的证据状态，不是 task plan 操作状态。

| Observer | 非影响依据 | 最窄相关检查 | 证据引用 | 子任务路径 | 证明状态 | 取代的旧证据 |
| --- | --- | --- | --- | --- | --- | --- |
|  |  |  |  |  |  |  |

## Contract Interfaces 与计划门禁

| Provider | Interface / Contract | Consumer | Breaking | Migration | 验收要求 | Owner |
| --- | --- | --- | --- | --- | --- | --- |
|  |  |  | 是/否 |  |  |  |

| 计划顺序 | 项目/阶段 | 前置条件 | 验收条件 | 发布/回退门禁 |
| --- | --- | --- | --- | --- |
| 1 |  |  |  |  |

## 轻量结论或追踪锚点

`observe-only` / `cross-lite` 可直接填写结论；`cross-full` 只填写 progress/findings 锚点，不在本表复制实际结果。

| 验收项 | 预期证据 | 轻量结论或 cross-full 锚点 |
| --- | --- | --- |
| Provider/Consumer 契约一致 |  |  |
| 受影响 Consumer 范围正确 |  |  |
| 本地项目验证完成 |  |  |
| 集成/端到端验证完成 |  |  |
| 配置、迁移和回退可执行 |  |  |

## 恢复锚点

- task plan：`<path and anchor or N/A>`
- progress：`<path and anchor or N/A>`
- findings：`<path and anchor or N/A>`
