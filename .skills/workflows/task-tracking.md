# 长任务进度跟踪工作流

本模块用于需要跨独立交付阶段、跨会话或超过一次连续实现的任务。它通过持久文件保存状态，不将临时对话当作项目记忆。

## 启用条件

满足任一条件时建立任务包：

- `complex` 任务，或需要多个独立交付阶段、跨会话、发布协调的 `cross-full` 任务
- 调查、实现、验证或发布形成两个以上可独立验收的交付阶段；RIPER 的内部步骤名称本身不计为多个阶段
- 预计跨会话、需交接或需要持续可见进度
- 用户明确要求计划、任务拆分、进度跟踪或恢复

`standard` 只有命中上述条件时才选择轻量 task plan，不能因为会经历 Restate、Research、Plan、Execute、Review 就自动启用 tracking。未启用 tracking 的单阶段 `standard` 使用 spec 加独立 progress，且 task plan 为 `N/A`；`micro` 通常只需要内联或落盘 micro-spec 的执行记录。`observe-only` 只维护调查记录；边界清楚、单阶段的 `cross-lite` 可以只维护父级跨项目 spec，不因 `cross` 分类自动创建四件套。

任何轻量路径一旦出现第二个执行者的实施、共享写入、跨会话继续、交接、两个以上可独立验收阶段或需要持久当前状态，先停止轻量执行，建立完整任务包及 task plan，再继续写入或委派。只读同会话查询不触发本模块。

## 任务包

实际根目录、编号来源、标题语言和字符清理规则由 `PROJECT_RULES.md` 定义；任务文件夹名称只使用 `<编号>_<任务标题>/`，不追加项目集合、状态、负责人或日期。推荐结构：

```text
<任务文档根>/<编号>_<任务标题>/
├── SPEC.md 或 <project-spec-path>
├── task_plan.md
├── findings.md
├── progress.md
└── handoff.md             # 仅交接或长暂停时创建
```

职责以 `.skills/core/durable-context.md#单一事实源` 为准：spec 持有共享范围、已采纳决策、验收与计划风险/回退；findings 持有调查和未验证假设；task plan 持有索引、依赖、负责人、阻塞与当前操作状态；subtask 持有单元合同；progress 持有执行、验证、残余风险、下一步、实际同步与提交关联；handoff 只持有身份和恢复锚点。使用对应模板，且不要在技能目录创建运行中任务文件。

跨项目参与者集合保存在父级 Spec 的唯一项目注册表，不编码进目录名。历史任务目录默认保持不变；只有项目规则和用户明确批准迁移时才批量重命名并同步所有锚点。

## 更新协议

| 时机 | 必须更新 |
| --- | --- |
| 建立任务 | spec 的合同；task plan 的 spec 与 Done Contract 锚点、当前阶段快照 |
| 获得待调查事实、未验证假设或不确定根因 | findings，包含来源、可信度、影响和 progress 锚点（如有） |
| 完成一个阶段 | task plan 的当前状态；progress 的阶段结果、验证与下一步 |
| 重大决策前 | 回读 task plan、findings、spec |
| 验证失败且需查根因 | progress 先记录失败；findings 仅记录调查问题、来源、未验证假设、结论和 progress 锚点 |
| 暂停或交接 | progress 与 handoff，留下恢复锚点 |
| 收尾 | spec、progress、任务索引和 Project Sync Scan |

## 进度质量要求

每条 progress 记录回答：做了什么、为什么做、结果和证据在哪里、什么在阻塞、残余风险和下一步是什么；收尾时再记录实际文档同步与项目要求的提交关联。task plan 只保留当前状态与最近 progress 锚点，不能重写结果、下一步或验收正文。

## 错误与恢复

| 触发条件 | 一线处理 | 兜底 |
| --- | --- | --- |
| 找不到任务文件 | 根据项目索引定位既有任务 | 不存在时建立新任务包，不覆盖同名目录 |
| plan 与 progress 不一致 | 以 spec/subtask 合同和 progress 证据锚点对齐 | 在 progress 记录修订原因；task plan 只修当前状态、索引、依赖或负责人 |
| 多轮未更新进度 | 暂停新增范围，写 recap | 恢复前重新读取任务包 |
| 任务变成另一项工作 | 记录边界变化并创建新 spec | 不篡改原任务目标来伪装完成 |

## 反模式

- 在 task plan 重写目标、决策、范围、验收或完整 subtask 合同
- 把普通测试失败同时写成 findings 调查和 progress 时间线
- 在 subtask、handoff 或 spec 复制实际变更、验证结果、失败、残余风险或下一步
- 只在最终补进度，导致无法恢复
