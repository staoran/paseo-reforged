# 更新Universal_Agents_Kit Spec

> 历史迁移说明：本文于 2026-08-02 从 `mydocs/tasks/0003_更新Universal_Agents_Kit/` 迁移为当前规则集的单文件 Heavy Spec。第 0-9 章是当前权威摘要；第 10 章按源文件保存完整历史原文和 SHA-256，仅用于追溯，不构成新的执行授权。

## 0. 状态与索引

| 字段              | 值                                              |
| ----------------- | ----------------------------------------------- |
| task_id           | `0003`                                          |
| spec layer        | `Feature Spec`                                  |
| task status       | `已收口`                                        |
| mode              | `single_project`                                |
| phase             | `Review`                                        |
| approval status   | `Plan Approved`                                 |
| approval source   | `User`                                          |
| spec path         | `mydocs/specs/0003_更新Universal_Agents_Kit.md` |
| parent spec       | `N/A`                                           |
| supersedes        | `N/A`                                           |
| current task unit | `历史任务记录迁移与归档`                        |
| created / updated | `2026-07-22 / 2026-08-02`                       |

## 1. 目标、范围与完成契约

- 背景/问题：该任务使用旧规则集的多文件任务包记录，现需迁移为当前单文件 Spec。
- 最终目标：将 Paseo 安装的 Universal Agents Kit 升级到冻结 runtime，并保留项目定制。
- 当前任务单元：无损迁移历史记录并关闭旧路径。
- 范围内：bundled runtime、项目定制合并、Project Setup 复核、kit revision 与静态验证。
- 范围外：修改源仓库、扩张包地图、处理 Reforged 身份迁移、运行全量测试或发布。
- Done Contract：当前摘要覆盖任务状态、关键事实、方案、执行、验证、风险和提交；全部旧 Markdown 原文及内容哈希保存在第 10 章；旧目录仅在迁移验证通过后删除。
- 失败或回炉方式：任一源文件未被完整嵌入、哈希不符或格式检查失败时，保留旧目录并重新生成，不以不完整的新 Spec 替代源记录。

### 1.1 最小任务单元判断

- 为什么当前任务单元足够小：单个 task_id 只生成一份对应 Spec，不合并不同任务的事实或授权。
- 验证证据：源文件清单、SHA-256、完整内容包含检查和 Markdown 格式检查。
- 模型可自主决定的范围：章节重组、历史摘要和附录顺序；不得改写历史授权或扩大任务结论。
- 拆分决定：`Accepted`

## 2. 上下文与调研

### 2.1 上下文来源

- 需求来源：用户要求将历史文档转为新规则集格式后删除旧文档。
- 项目事实源：`PROJECT.md`、Git 历史、当前源码以及第 10 章保存的旧任务包。
- Codemap：`N/A`
- Codemap Mode：`N/A`
- Context Bundle：`N/A`
- Context Bundle Level：`N/A`
- 关联任务记录：`N/A`

### 2.2 调研结论

已确认事实：

- 50 个 bundled 文件与冻结 loader tree 一致，项目事实和 AGENTS 符号链接得到保留。
- 最终 revision 使用内容哈希，未把 dirty source 误报为 clean commit。
- 旧 .skills runtime 后续已退出当前规则集的活动路由。

- 未知与开放问题：无影响本次历史迁移的开放问题；动态 refs、外部服务和旧基线只按历史快照理解。
- 风险与约束：旧 runtime 仅作为历史兼容资料，不能覆盖当前 AGENTS/PROJECT 路由。
- `grilling` 结论（如使用）：未使用；迁移目标与删除范围已由用户明确。

### 2.3 方案与决策

- 备选方案：保留旧任务包、只写摘要后删除、或在新 Spec 中同时保存摘要和完整原文。
- 已选方案：使用当前模板的 0-9 章保存权威摘要，并在第 10 章无损嵌入全部旧文件。
- 选择理由：消除并行真相源，同时避免删除未提交历史记录造成证据丢失。

历史任务关键决策：

- 对 bundled 文件做精确替换，对 project-owned/mixed 文件做内容合并。
- 源仓库出现 source-only WIP 时使用 runtime content hash 记录 provenance。

### 2.4 下一步动作

- 下一步唯一动作：N/A；后续规则集升级建立新任务。

## 3. 计划与执行前检查点

### 3.1 文件变化

| 项目/子项    | 文件或子 Spec                                   | 计划变化                     | 原因                     |
| ------------ | ----------------------------------------------- | ---------------------------- | ------------------------ |
| 历史任务记录 | `mydocs/tasks/0003_更新Universal_Agents_Kit/`   | 合并到当前单文件 Spec 后删除 | 消除旧规则集多文件真相源 |
| 当前 Spec    | `mydocs/specs/0003_更新Universal_Agents_Kit.md` | 新建                         | 使用当前 Heavy Spec 模板 |

### 3.2 签名与契约

| 项目/子项 | 接口、类型或签名     | 计划变化 | 兼容性         |
| --------- | -------------------- | -------- | -------------- |
| 文档迁移  | 运行时接口与数据契约 | 无变化   | 仅迁移历史记录 |

### 3.3 子 Spec 索引

N/A；该历史 task_id 迁移为单个 Spec。

### 3.4 执行清单

- [x] 1. 读取并归档旧任务包全部 Markdown 文件。
- [x] 2. 建立当前模板要求的状态、目标、上下文、执行、验证和提交摘要。
- [x] 3. 记录源文件 SHA-256 并验证完整内容已嵌入。
- [x] 4. 在新 Spec 验证通过后删除旧目录。

### 3.5 执行前检查点

- 当前目标与任务单元：历史任务单文件迁移。
- 当前 phase：`Review`
- approval status / source：`Plan Approved / User`；用户已明确授权转换并删除旧文档。
- 下一步：验证格式、内容哈希和旧路径引用。
- 风险与回退：验证失败时不删除旧目录；Git 可恢复原 tracked 文件，未跟踪源内容已完整嵌入第 10 章。
- 验证方式：生成器内容包含检查、格式检查、旧路径检索和 Git 范围审查。
- TDD 判定、测试 seam 与验收行为：`N/A`；当前改动只迁移历史文档，不改变运行时行为。
- seam 确认：`N/A`

## 4. 跨项目扩展

N/A；单项目历史文档迁移。

## 5. 执行记录

| 步骤/子项 | 实际变化或子 Spec 锚点                        | 状态   | 偏差与处理                   |
| --------- | --------------------------------------------- | ------ | ---------------------------- |
| 1         | 替换 21 个 bundled 文件并保留 29 个不变文件。 | 已记录 | 详细时间线见第 10 章原始记录 |
| 2         | 合并项目规则、依赖路由与 Project Setup 内容。 | 已记录 | 详细时间线见第 10 章原始记录 |
| 3         | 完成 runtime、格式、链接和项目静态门禁。      | 已记录 | 详细时间线见第 10 章原始记录 |
| 文档迁移  | 旧任务包完整原文进入第 10 章                  | 已完成 | 不改写原始记录               |

## 6. 验证

| 项目/验收项 | 命令或步骤                               | 结果   | 证据           | 未验证原因 |
| ----------- | ---------------------------------------- | ------ | -------------- | ---------- |
| Kit 合同    | 上游静态合同 89/89 与 loader 回归        | `PASS` | 历史任务记录   | `N/A`      |
| 项目结构    | runtime 路径、JSON、Markdown、表格与链接 | `PASS` | 历史任务记录   | `N/A`      |
| 仓库门禁    | format、diff check、typecheck、lint      | `PASS` | 历史任务记录   | `N/A`      |
| 迁移完整性  | 源文件 SHA-256 与完整内容包含检查        | `PASS` | 第 10.1 节清单 | `N/A`      |

- 集成验证：当前迁移不改变产品代码；历史产品验证结果按上表和第 10 章保留。
- 剩余风险：旧 runtime 仅作为历史兼容资料，不能覆盖当前 AGENTS/PROJECT 路由。
- Done Contract 是否由证据满足：是

## 7. 评审（Review）

| 评审轴             | 结论   | 证据或阻塞问题                                                    |
| ------------------ | ------ | ----------------------------------------------------------------- |
| 目标与 Spec 完成度 | `PASS` | 历史结论和完整原文已迁移                                          |
| Spec 与执行一致性  | `PASS` | 新摘要不扩大旧授权，原文无损保留                                  |
| 实现质量与风险     | `PASS` | 旧 runtime 仅作为历史兼容资料，不能覆盖当前 AGENTS/PROJECT 路由。 |

- Overall Verdict：`PASS`
- Blocking Issues：None
- Cross-project consistency：`N/A`

### 7.1 回归风险

| project_id | Regression risk | 依据                              |
| ---------- | --------------- | --------------------------------- |
| `paseo`    | `Low`           | 当前只迁移 Markdown，不改变运行时 |

### 7.2 Touched Projects

N/A。

- Orphan changes：`None`

## 8. 偏差、变更与反向同步

- Plan-Execution Diff：历史任务的计划与执行偏差按第 10 章原记录保存；本迁移不重新裁决。
- Change Log：2026-08-02 将旧多文件任务包迁移为当前单文件 Heavy Spec。
- 用户决策：转换历史文档，验证后删除旧目录；0031 由其他会话处理，不在本迁移范围。
- Spec 反向同步结果：第 0-9 章成为当前权威摘要，第 10 章保存只读历史原文。

## 9. 恢复、长期知识与提交关联

- 状态说明：`已收口`
- 当前卡点：`N/A`
- 下一步唯一动作：N/A；后续规则集升级建立新任务。
- Resume / Handoff 锚点：本文第 0 章；详细历史见第 10 章。
- Project Sync Candidates：无；本迁移不从一次性历史记录推导新的长期规则。
- 长期文档同步：仅更新旧任务路径登记，不改变产品知识。

### 提交记录

| 提交信息（Commit Message）                                                                  | 提交脚注（Commit Footer） | 关联项目 / 改动或阶段        | 文档同步状态 | 备注           |
| ------------------------------------------------------------------------------------------- | ------------------------- | ---------------------------- | ------------ | -------------- |
| `chore(agents): upgrade Universal Agents Kit`（`cff02de1c62b49d96ee7872bdb1f727998f4797d`） | `N/A`                     | `paseo / Kit 升级与任务记录` | 已同步       | 历史提交已存在 |

## 10. 历史原始记录

### 10.1 源文件完整性清单

以下哈希按 LF 规范化且去除文件尾空白后计算。

| 源文件        | 规范化字节数 | SHA-256                                                            |
| ------------- | -----------: | ------------------------------------------------------------------ |
| `SPEC.md`     |         2284 | `3d7dda0ebcbb980f9d621e50f858012533ced159260cae8c875748b7f8da4224` |
| `progress.md` |         1966 | `c916bc6408dc2f964d2c63717a8002327d0b4ec94447a9c0a592423efb176a1e` |

### 10.2 原 `SPEC.md`

```text
# 更新 Universal Agents Kit Spec

## 状态

`completed`

## 目标

将 Paseo 安装的 Universal Agents Kit 升级到源仓库冻结提交
`10b25cbae3dc83cf39643bd2f66154728866f345`，保留项目事实和工作树中的既有修改，
并完成一次最小 Project Setup 复核。

## 基线

- 目标提交：`679d7131f7afcf4b11fba7a927dd579ac014f83c`
- 已安装 revision：`content-sha256:e3dc4a9c4da5d7a9a9dc0eb2c0d52251dfb2efde1104d97d4c9c0aa395782119`
- 源 runtime hash：`content-sha256:b14275faea99b84bef3a771422992fda5a2085f5ea508fd29aa9a8b67ff9bc18`
- 目标 Kit 路径在执行前无未提交修改；仓库其他未提交修改不属于本任务。
- 执行末尾源仓库新增 source-only 未跟踪任务目录；runtime hash 未变化，因此最终
  revision 按 dirty-source 规则记录 content hash，而不伪称 clean commit。

## 范围

- 替换 21 个未被项目修改的 bundled 文件，保留 29 个未变化 bundled 文件。
- 内容合并 `CLAUDE.md`、`PROJECT_RULES.md` 和 `DEPENDENCY_SKILLS.md`。
- 将三个空 project-owned 文件标题中的 `Bootstrap` 迁移为 `Project Setup`；保持
  `CODEMAP_INDEX.md` 不变。
- 保持 `task_index_mode=disabled`，补齐四个已确认的 `docs/` 入口。
- 验证通过后最后更新 `kit_revision` 与本次命中的 capability evidence。

## 非范围

- 不修改 Universal Agents Kit 源仓库。
- 不扩张 repository package map，不同步尚在活动任务中的 Paseo Reforged 身份迁移。
- 不运行完整测试套件，不重启 daemon，不 stage、commit 或 push。

## Done Contract

1. 21 个 bundled 文件与冻结 loader tree 一致，mixed/project-owned 内容保留 Paseo 事实。
2. Project Setup 状态仍为 initialized，`task_index_mode=disabled`，四个文档入口可解析。
3. Kit 静态检查、目标路径检查、格式检查、typecheck 和 lint 均已运行并记录结果。
4. 只有前三项满足后，`kit_revision` 才更新为冻结 runtime revision；失败时保留旧 revision 并记录恢复入口。

## 批准与回退

- 用户于 `2026-07-22` 明确批准 checkpoint 中的完整更新和 Project Setup 复核。
- scoped preimage 可从目标提交恢复；任何回退只处理本任务路径，不触碰其他工作树修改。
```

### 10.3 原 `progress.md`

```text
# 更新 Universal Agents Kit Progress

## 2026-07-22 执行基线

- 源仓库 clean，提交为 `10b25cbae3dc83cf39643bd2f66154728866f345`。
- loader 输出 57 个逻辑文件，runtime hash 为
  `content-sha256:b14275faea99b84bef3a771422992fda5a2085f5ea508fd29aa9a8b67ff9bc18`。
- 上游 loader、89/89 静态合同、release-verdict 7 项回归、Node 语法和 diff 检查通过。
- 目标 `CLAUDE.md`、`AGENTS.md` 与 `.skills/` 在执行前无未提交修改。
- 下一步：替换 bundled 文件，完成内容级合并，再运行目标验证。

## 2026-07-22 完成

- 替换 21 个 bundled 文件；其余 29 个 bundled 文件保持不变。最终 50/50 bundled
  文件均与冻结 loader tree 一致，57 个逻辑 runtime 路径完整。
- 内容合并 `CLAUDE.md`、`PROJECT_RULES.md` 和 `DEPENDENCY_SKILLS.md`，保留
  `AGENTS.md -> CLAUDE.md` 符号链接及全部 Paseo 项目事实。
- `task_index_mode=disabled`；补入 Hub、i18n、timeline sync 和 OpenCode global event
  四个文档入口。三个空 project-owned 文件只迁移标题术语，`CODEMAP_INDEX.md` 未修改。
- 验证：上游静态合同 `89/89`、loader 与 release-verdict 回归通过；目标 runtime
  路径、bundled hash、4 个 JSON、53 个 Markdown/102 个表格/43 个链接、格式和
  `git diff --check` 通过；`npm run typecheck` 与 `npm run lint` 通过。
- 未运行完整测试套件或构建，未重启 daemon，未 stage、commit 或 push。
- 最终复核时源仓库新增未跟踪的 source-only 维护任务目录；57 个 runtime 文件和
  `content-sha256:b14275faea99b84bef3a771422992fda5a2085f5ea508fd29aa9a8b67ff9bc18`
  均未变化。按 dirty-source 规则记录 content hash，不使用不完整的 HEAD provenance。
- 最终 `kit_revision`：`content-sha256:b14275faea99b84bef3a771422992fda5a2085f5ea508fd29aa9a8b67ff9bc18`。
- Paseo Reforged 身份同步仍由既有重命名任务处理，不在本任务扩张。
```
