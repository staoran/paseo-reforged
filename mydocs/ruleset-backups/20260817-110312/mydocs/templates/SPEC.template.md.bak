# <任务名称> Spec

本模板用于 `sdd-riper-one` 的单项目 Spec、跨项目父 Spec 和 Heavy 子 Spec；仅在非 Goal 模式使用

- 文件路径、编号、命名、语言和 footer 以对应 `PROJECT.md` 或父级 `AGENTS.md` 为准
- 本地章节可重组或增加项目字段；安装时必须映射当前 `sdd-riper-one` 的必填语义、RIPER 阶段和批准门禁，缺项即阻塞

父子 Spec 拆分时，父 Spec 保留全部章节。详细文件、签名、执行和局部验证可填写子 Spec 路径与摘要，不复制子文档正文。

## 0. 状态与索引

| 字段              | 值                                                                                      |
| ----------------- | --------------------------------------------------------------------------------------- |
| task_id           | `<项目或父工作区规则生成的编号；由 Light 升级时沿用原 task_id>`                         |
| spec layer        | `Feature Spec`                                                                          |
| task status       | `待办 / 规划中 / 待批准 / 执行中 / 待验证 / 待手工验收 / 待提交 / 已收口 / 暂停 / 取消` |
| mode              | `single_project / multi_project`                                                        |
| phase             | `Research / Innovate / Plan / Execute / Review`                                         |
| approval status   | `Pending / Plan Approved`                                                               |
| approval source   | `User / N/A`                                                                            |
| spec path         | `<当前文件路径>`                                                                        |
| parent spec       | `<父 Spec 路径 / N/A>`                                                                  |
| supersedes        | `<切换 Heavy 前的 Light 文档路径 / N/A>`                                                |
| current task unit | `<当前最小任务单元>`                                                                    |
| created / updated | `<时间>`                                                                                |

`mode` 只表示任务作用域；`parent spec` 非 `N/A` 时，当前文档是子 Spec。

## 1. 目标、范围与完成契约

- 背景/问题：
- 最终目标：
- 当前任务单元：
- 范围内：
- 范围外：
- Done Contract：
- 失败或回炉方式：

### 1.1 最小任务单元判断

- 为什么当前任务单元足够小：
- 验证证据：
- 模型可自主决定的范围：
- 拆分决定：`Accepted / Revise / Split Further`

## 2. 上下文与调研

### 2.1 上下文来源

- 需求来源：
- 项目事实源：
- Codemap：`<path / N/A>`
- Codemap Mode：`feature / project / N/A`
- Context Bundle：`<path / N/A>`
- Context Bundle Level：`Lite / Standard / N/A`
- 关联任务记录：

### 2.2 调研结论

- 已确认事实：
- 未知与开放问题：
- 风险与约束：
- `grilling` 结论（如使用）：

### 2.3 方案与决策

- 备选方案：
- 已选方案：
- 选择理由：
- 不需要方案比较时：`N/A - <原因>`

### 2.4 下一步动作

- 下一步动作 1：
- 下一步动作 2：

## 3. 计划与执行前检查点

### 3.1 文件变化

| 项目/子项 | 文件或子 Spec | 计划变化 | 原因 |
| --------- | ------------- | -------- | ---- |
|           |               |          |      |

### 3.2 签名与契约

| 项目/子项 | 接口、类型或签名 | 计划变化 | 兼容性 |
| --------- | ---------------- | -------- | ------ |
|           |                  |          |        |

### 3.3 子 Spec 索引

没有拆分时填写 `N/A`。

| 子项 | project_id | local_task_id | 模式 | 路径 | 范围 | 依赖 | phase / approval | 状态 | 验证摘要 |
| ---- | ---------- | ------------- | ---- | ---- | ---- | ---- | ---------------- | ---- | -------- |
|      |            |               |      |      |      |      |                  |      |          |

### 3.4 执行清单

- [ ] 1. `<原子步骤>`
- [ ] 2. `<原子步骤>`

### 3.5 执行前检查点

- 当前目标与任务单元：
- 当前 phase：
- approval status / source：
- 下一步：
- 风险与回退：
- 验证方式：
- TDD 判定、测试 seam 与验收行为：`TDD / N/A；<内容或原因>`
- seam 确认：`User / N/A；<确认依据>`

## 4. 跨项目扩展

- 普通项目根 Spec 和本地子 Spec 可把本节压缩为标题下一行 `N/A`，并删除 4.1 至 4.3
- 父工作区 `single_project`（workspace-only）和 `multi_project` Spec 必须完整保留本节
- workspace-only 任务的项目范围表、`related_projects` 和 Registry 确认填 `N/A`，但必须记录 `workdir`、`active_project=workspace`、`active_workdir` 和 `change_scope=local`
- `multi_project` 只登记父级 Registry 中显式选择的项目

### 4.1 项目范围

| project_id | project_path | project_type | marker_file | 本次角色 | 允许动作                   | 本地规则入口 |
| ---------- | ------------ | ------------ | ----------- | -------- | -------------------------- | ------------ |
|            |              |              |             |          | `read / write / forbidden` |              |

- workdir：
- active_project / active_workdir：
- change_scope：`local / cross`
- related_projects：`<除 active_project 外的参与项目 ID / N/A>`
- Registry Confirmation / Source：

### 4.2 Contract Interfaces

存在接口、数据或 schema 依赖时填写真实契约；不存在时保留一行 `N/A`，写明“无跨项目契约，仅按实际依赖顺序执行”，不得虚构 Provider/Consumer。

| Provider | Interface / Contract | Consumer | Breaking | Migration                | 验收要求 |
| -------- | -------------------- | -------- | -------- | ------------------------ | -------- |
| `N/A`    | `N/A`                | `N/A`    | `N/A`    | `<无契约原因或迁移方案>` |          |

### 4.3 依赖与集成顺序

顺序必须与兼容性和 Migration 一致，不默认采用 Provider-first。

| 顺序 | 项目/子项 | 前置条件 | 完成证据 |
| ---- | --------- | -------- | -------- |
| 1    |           |          |          |

## 5. 执行记录

| 步骤/子项 | 实际变化或子 Spec 锚点 | 状态 | 偏差与处理 |
| --------- | ---------------------- | ---- | ---------- |
|           |                        |      |            |

## 6. 验证

| 项目/验收项 | 命令或步骤 | 结果 | 证据 | 未验证原因 |
| ----------- | ---------- | ---- | ---- | ---------- |
|             |            |      |      |            |

- 集成验证：
- 剩余风险：
- Done Contract 是否由证据满足：

## 7. 评审（Review）

| 评审轴             | 结论                    | 证据或阻塞问题 |
| ------------------ | ----------------------- | -------------- |
| 目标与 Spec 完成度 | `PASS / PARTIAL / FAIL` |                |
| Spec 与执行一致性  | `PASS / PARTIAL / FAIL` |                |
| 实现质量与风险     | `PASS / PARTIAL / FAIL` |                |

- Overall Verdict：`PASS / FAIL`
- Blocking Issues：`None / <阻塞问题>`
- Cross-project consistency：`PASS / FAIL / N/A`

### 7.1 回归风险

| project_id        | Regression risk             | 依据 |
| ----------------- | --------------------------- | ---- |
| `<项目 ID / N/A>` | `Low / Medium / High / N/A` |      |

### 7.2 Touched Projects

普通项目任务、workspace-only 任务和子 Spec 填写 `N/A`。`multi_project` 父 Spec 只登记实际修改的注册项目；父级任务记录不计入。

| project_id | Files Changed | Reason |
| ---------- | ------------- | ------ |
| `N/A`      | `N/A`         |        |

- Orphan changes：`None / <注册项目外的改动及处理>`

## 8. 偏差、变更与反向同步

- Plan-Execution Diff：
- Change Log：
- 用户决策：
- Spec 反向同步结果：

## 9. 恢复、长期知识与提交关联

- 状态说明：
- 当前卡点：
- 下一步唯一动作：
- Resume / Handoff 锚点：
- Project Sync Candidates：`无 / <候选、证据、建议落点>`
- 长期文档同步：

### 提交记录

一个 Spec 可对应多个提交；每次提交追加一行。

| 提交信息（Commit Message） | 提交脚注（Commit Footer） | 关联项目 / 改动或阶段       | 文档同步状态 | 备注 |
| -------------------------- | ------------------------- | --------------------------- | ------------ | ---- |
| `<待提交>`                 | `<按项目参数 / N/A>`      | `<project_id / 范围或阶段>` | `<待填写>`   |      |
