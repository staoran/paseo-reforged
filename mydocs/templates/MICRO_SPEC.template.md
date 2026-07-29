# <任务名称> Micro Spec

本模板用于 `sdd-riper-one-light` 的 `fast`、`standard` 和 `deep` 任务；`zero` 不创建文件

- 本地章节可重组或增加项目字段；安装时必须映射当前 `sdd-riper-one-light` 的必填语义、阶段和批准门禁，缺项即阻塞
- Light 深度变化继续更新同一活跃文档
- 切换 `sdd-riper-one` 时，仅在非 Goal 模式由用户显式启动 Heavy Spec，并沿用同一 `task_id`；两份文档互链
- 将本文件标为 `Superseded` 后停止更新，Heavy Spec 成为唯一活跃真相源

## 0. 状态与索引

| 字段               | 值                                                                                      |
| ------------------ | --------------------------------------------------------------------------------------- |
| task_id            | `<项目规则生成的编号>`                                                                  |
| spec layer         | `Feature Spec`                                                                          |
| task status        | `待办 / 规划中 / 待批准 / 执行中 / 待验证 / 待手工验收 / 待提交 / 已收口 / 暂停 / 取消` |
| document status    | `Active / Superseded / Completed`                                                       |
| depth              | `fast / standard / deep`                                                                |
| phase              | `Plan / Execute / Review`                                                               |
| Execution Approval | `Pending / Approved`                                                                    |
| Approval Source    | `User / Goal / N/A`                                                                     |
| file path          | `<当前文件路径>`                                                                        |
| parent spec        | `<父子拆分时填写 / N/A>`                                                                |
| superseded by      | `<切换 Heavy 后的 Spec 路径 / N/A>`                                                     |
| created / updated  | `<时间>`                                                                                |

## 1. 目标与完成契约

- 当前理解：
- 核心目标：
- Done Contract：

## 2. 范围与事实

- 范围内：
- 范围外：
- 当前任务单元：
- 轻量评估：`足够小 / 升级 standard / 升级 deep / 切换 sdd-riper-one`
- 已确认事实：
- `grilling` 结论（如使用）：
- 风险与未知：

## 3. 涉及文件与计划

| 文件 | 计划变化 | 事实源 |
| ---- | -------- | ------ |
|      |          |        |

1. `<动作>`
2. `<动作>`

## 4. 执行前检查点

- 当前目标：
- 当前进度：
- 当前动作是否仍服务核心目标：
- 下一步：
- 风险与回退：
- 验证方式：
- TDD 判定、测试 seam 与验收行为：`TDD / N/A；<内容或原因>`
- seam 确认：`User / N/A；<确认依据>`
- Execution Approval / Source：

## 5. 执行与变更记录

- 实际改动：
- 偏差与用户决策：
- Change Log：

## 6. 验证与完成判断

| 验收项 | 命令或步骤 | 结果 | 证据 |
| ------ | ---------- | ---- | ---- |
|        |            |      |      |

- 未验证项与原因：
- 剩余风险：
- Done Contract 是否由证据满足：

## 7. 恢复与同步

- 状态说明：
- 当前卡点：
- 下一步唯一动作：
- Resume / Handoff：
- Project Sync Candidates：`无 / <候选、证据、建议落点>`
- 长期文档同步：

### 提交记录

一个 micro-spec 可对应多个提交；每次提交追加一行。

| 提交信息（Commit Message） | 提交脚注（Commit Footer） | 关联改动或阶段 | 文档同步状态 | 备注 |
| -------------------------- | ------------------------- | -------------- | ------------ | ---- |
| `<待提交>`                 | `<按项目参数 / N/A>`      | `<范围或阶段>` | `<待填写>`   |      |
