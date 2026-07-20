# 项目自定义工作流

本模块为 Agent 创建或维护项目级长期配置提供一个共享事务。它始终运行在 SDD-RIPER 内：SDD 决定当前阶段、Spec Record、批准和 Reverse Sync；本模块只决定项目自定义内容应写到哪里以及如何验证。

## 进入条件与模式

用户明确要求新增、迁移、调整或沉淀以下任一内容时进入；一次任务可选择多个 mode，但每项正文仍只有一个权威落点。

| mode | 权威目标 | 分流规范 |
| --- | --- | --- |
| `project-skill` | `.skills/project-skills/<name>/` 与技能注册表 | `project-customization/project-skill.md` |
| `project-rules` | `PROJECT_RULES.md`、必要的最近目录 `AGENTS.md`、项目任务/文档模板 | `project-customization/project-rules.md` |
| `dependency-capability` | `DEPENDENCY_SKILLS.md` | `project-customization/dependencies-and-overrides.md` |
| `skill-override` | `CUSTOM_SKILL_OVERRIDES.md` | `project-customization/dependencies-and-overrides.md` |
| `project-knowledge` | `PROJECT_KNOWLEDGE.md` | `project-customization/knowledge-and-context.md` |
| `critical-context` | `CRITICAL_CONTEXT.md` | `project-customization/knowledge-and-context.md` |
| `codemap` | Codemap 文件与 `CODEMAP_INDEX.md` | `project-customization/knowledge-and-context.md` |

任务目录命名、文档布局和项目专属任务模板属于 `project-rules`。首次安装、已有 `AGENTS.md` 合并、部分修复和规则包自身升级使用源规则包组装流程；runtime 已就位后的 `bootstrap-required` 配置使用目标项目 `PROJECT_RULES.md`。本模块不建立第二套初始化或规则包升级流程。

## 共享事务

1. **Restate 与归类**：复述用户目标、预期复用范围和非目标，选择 mode；不能唯一归类时先列出候选差异。
2. **只读调查**：读取适用 `AGENTS.md`、`PROJECT_RULES.md`、技能注册表、目标权威文件及仓库证据。检查同名、同 capability、重复事实、冲突、隐私和提交边界。
3. **形成提案**：在当前 Spec Record 写明精确文件动作、内容来源、唯一权威落点、触发/适用边界、required dependency、source scope、version policy、missing action、验证证据与 Reverse Sync 目标。未验证内容留在 findings。
4. **Checkpoint**：项目长期规则与能力变化至少经过一次明确 checkpoint。列出 `create / merge / update / untouched`、删除或替换项、冲突处理和验证；未获批准只输出提案，不写目标文件。
5. **精确写入**：只执行获批动作，保留用户已有内容；不整文件覆盖现有 `AGENTS.md`、注册表、知识文件或 Skill。
6. **验证**：运行对应分流规范的结构、触发、路径、引用、依赖可用性、missing action 和场景检查。验证失败先记录证据，再修订提案或回到 Plan。
7. **Reverse Sync**：实际写入、验证、偏差和剩余风险进入 progress；合同或已采纳决定进入 spec。若新内容改变长期路由，同步 INDEX/入口；若没有 Project Sync Candidate，也在收尾说明。

## 共同门禁

- `bootstrap-required` 且当前修改依赖未配置项目事实时，先走完整 Bootstrap checkpoint。
- 命中必需全局 Skill/policy/tool 而依赖不可用时，必须停止当前任务，记录 evidence 并提示安装/配置；不得创建、读取或生成本地等价替代。
- 项目规则不能关闭 SDD-RIPER 核心闭环或跨项目安全边界；override 不能降低系统、用户、安全或执行授权。
- 默认不 stage 或提交 Feature Spec、handoff、项目记忆、私有知识、用户偏好或本地运行数据；提交边界只由用户和项目规则决定。

## 失败处理

| 触发条件 | 一线处理 | 仍失败时 |
| --- | --- | --- |
| 找不到唯一权威文件 | 读取 INDEX、PROJECT_RULES 和现有项目约定，提出候选落点 | 停止写入并请求用户决定，不并行维护两个真相源 |
| 新内容与现有规则或 capability 冲突 | 保留原文，输出逐项差异和较严格边界 | 回到 Plan；未裁决前不覆盖 |
| 缺少可验证来源 | 保留为 findings 中的候选 | 不进入长期文件或可发现注册表 |
| 验证失败 | 写入 progress，修复本次新增内容或撤销本次未发布引用 | 无法局部修复时保持能力未启用并报告风险 |

## 反模式

- 为每类自定义复制一套调查、批准和回写流程。
- 把一次性任务过程写进项目 Skill、AGENTS 或长期知识。
- 为“以后可能有用”创建没有明确触发、输出或验证的 Skill。
- 修改长期文件后只更新聊天，不更新注册表、索引或 Spec Record。
