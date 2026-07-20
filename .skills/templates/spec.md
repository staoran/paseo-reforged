# <任务名称> Spec

本文件保存任务合同与已采纳决策。未验证假设只在 findings；启用 tracking 后当前操作状态只在 task plan；执行、验证、残余风险、下一步、实际同步和提交关联只在 progress。单阶段未跟踪 `standard` 使用独立 progress 记录，task plan 填 `N/A`；明确低风险 micro 可按项目政策使用内联最终回写。

## 任务索引

| 字段 | 值 |
| --- | --- |
| task_id | `<项目规则定义的编号>` |
| 任务深度 | `standard / complex / cross` |
| 项目规则 | `<PROJECT_RULES path and anchor>` |
| 任务索引 | `<task-index path and anchor or N/A>` |
| 创建时间 | `<YYYY-MM-DD>` |
| 最近更新 | `<YYYY-MM-DD>` |
| 批准状态 | `<按项目 execution_gate>` |
| 关联 codemap | `<path or N/A>` |
| 关联关键上下文 | `<path or N/A>` |

## 目标、范围与完成契约

- 背景/问题：
- 目标：
- 非目标：
- 范围内：
- 范围外：
- Done Contract：

## 跨项目关联

仅 `cross` 的子项目施工 spec 保留本节；单项目任务删除本节。父级合同正文仍只保存在父级跨项目 Spec，本节只记录反向锚点和本项目责任。

| 字段 | 值 |
| --- | --- |
| 父级跨项目 Spec | `<path and anchor or N/A>` |
| 父级合同章节 | `<Contract Interfaces or decision anchor or N/A>` |
| 本项目角色与责任 | `<Provider / Consumer / Shared responsibility or N/A>` |
| 父级反向链接 | `<related-project-records anchor or N/A>` |

## 已采纳事实与决策

| 类别 | 内容 | 来源/决策者 | 判定 |
| --- | --- | --- | --- |
| 已采纳事实 |  | `findings 锚点或其他事实源` | 已确认 |
| 已采纳决策/取舍 |  |  | 已确认 |

未验证假设、待查事实和未决根因只写 findings；它们被验证并采纳后，才在本表写结论和 findings 锚点。

## 方案与影响

| 模块/文件 | 计划变化 | 原因 |
| --- | --- | --- |
|  |  |  |

### 风险与回退

| 风险 | 触发条件 | 防护 | 计划回退 | 负责人/决策 |
| --- | --- | --- | --- | --- |
|  |  |  |  |  |

## 验收条件

| 验收项 | 预期证据 | 命令/步骤 | 未满足时处理 |
| --- | --- | --- | --- |
|  |  |  |  |

## 追踪与同步锚点

- task plan：`<path and anchor or N/A；单阶段未跟踪 standard 填 N/A>`
- 最近 progress：`<path and anchor or N/A；单阶段 standard 的独立记录也填此处>`
- findings：`<path and anchor or N/A>`
- subtask 索引：`<task-plan path#subtasks or N/A>`
- 文档同步决定：`<asset / decision / target anchor or N/A>`

执行、验证、失败、残余风险、下一步、实际同步结果和提交关联只写入 progress；单阶段未跟踪 standard 使用独立 progress，micro 可按项目政策内联最终回写；handoff 只链接上述锚点。
