# .skills 模块索引

此目录是项目内规则和可选技能的装配层，不是所有文档都必须在每轮会话加载。先读 `project/PROJECT_RULES.md`，再用 `core/operating-model.md` 分类并由 `core/skill-coordination.md` 加载所选全局 SDD Skill，最后按任务选择最少模块。查询使用 SDD 的只读分支，止于 Restate、Research、证据说明与收口，不进入 Execute。

## 固定模块

| 模块 | 读取时机 | 结果 |
| --- | --- | --- |
| `core/operating-model.md` | 任何工程任务 | 任务分类、优先级、门禁与完成定义 |
| `core/development-discipline.md` | 写代码、配置、脚本、测试或迁移 | 最小改动、风险、验证与 Git 边界 |
| `core/skill-coordination.md` | 需要选择或组合技能 | 技能加载、override、缺失动作与运行时中立性 |
| `core/durable-context.md` | 长任务、收尾、交接或发现稳定知识 | spec、上下文、知识与同步边界 |

## 工作流模块

| 模块 | 触发条件 |
| --- | --- |
| `workflows/grill-me.md` | 复杂需求存在影响方案的歧义、冲突或验收缺口 |
| `workflows/task-tracking.md` | 长任务、跨会话恢复、两个以上可独立验收的交付阶段或需要可见进度；RIPER 内部步骤、`observe-only` 和 `cross-lite` 不自动触发 |
| `workflows/task-decomposition.md` | 会实施的大任务、独立工作流、并行协作或依赖排序 |
| `workflows/cross-task-collaboration.md` | 会实施的多任务、多人/多会话协作、交接、共享事实或合并冲突 |
| `workflows/cross-project.md` | 多仓库、多子项目、Provider/Consumer 契约变更；内部选择 `observe-only`、`cross-lite` 或 `cross-full` |
| `workflows/project-customization.md` | 新增或维护项目 Skill、规则/语言/文档布局、依赖能力、override、长期知识、关键上下文或 Codemap |

SDD 核心闭环是所有工程任务不可关闭的主 Harness；查询/`zero` 是否跳过外部 SDD Skill 只由 `core/skill-coordination.md` 判断。`cross-project.md` 是 `cross` 的不可关闭安全流程。`enabled_workflows` 只能关闭或替换可选增强模块，并且替换必须在项目规则中登记等价回退。

## 包内 Skill 适配器

包内 adapter 只为 skills-aware runtime 加载规则包内既有规范；不能增加触发条件或流程。包内 adapter 不可发现时可直接读取其指向的同一 bundled workflow。此规则不适用于登记为必需依赖的全局 Skills；必需全局 Skill 缺失时必须停止并提示安装。

| Skill | 触发 | 规范与入口 |
| --- | --- | --- |
| `skills/refine-sdd-requirements/SKILL.md` | `complex/cross` 且 bridge 判定存在会改变方案或验收的决策歧义 | `customizations/sdd-grill-bridge.md`；直接读取 bridge 与其指向的 workflow |
| `skills/manage-project-customizations/SKILL.md` | 新增、迁移或维护项目级长期自定义内容 | `workflows/project-customization.md`；直接读取 workflow 与命中的单个分流规范 |

## 阶段能力桥接

| 模块 | 读取时机 | 边界 |
| --- | --- | --- |
| `customizations/matt-pocock-bridge.md` | 命中 `core/skill-coordination.md` 登记的 Matt 窄阶段能力，或用户显式调用架构体检 | 只补当前 SDD 阶段的专用算法和证据；依赖缺失时停止，不建立本地替代或平行 Harness |

## 项目类型模块

从 `PROJECT_RULES.md` 的 `enabled_type_modules` 读取并加载对应文件。多个类型可以组合，但只为实际存在的代码层启用：

- `types/backend.md`
- `types/frontend.md`
- `types/miniprogram.md`
- `types/desktop.md`

桌面 GUI 工具使用 `desktop`；只有同时存在嵌入式 Web UI 或独立本地 HTTP/RPC 服务时，才追加 `frontend` 或 `backend`，普通后台 worker 不单独触发 `backend`。纯 CLI 工具暂时使用 `other` 并在项目规则中记录其约束。

多个类型同时启用时，按当前修改的目标文件选择；跨端任务由 `workflows/cross-project.md` 协调，不把某一端的约束默认扩散到所有端。

## 项目事实与自定义扩展

| 文件 | 职责 |
| --- | --- |
| `project/PROJECT_RULES.md` | 技术栈、命令、路径、文档布局、执行门禁和类型模块 |
| `project/PROJECT_KNOWLEDGE.md` | 已验证、稳定、跨任务复用的项目知识 |
| `project/CODEMAP_INDEX.md` | 项目总图与特性 codemap 的索引和新鲜度 |
| `project/CRITICAL_CONTEXT.md` | 关键业务链路、状态机、历史兼容和高风险事实 |
| `project/DEPENDENCY_SKILLS.md` | 核心依赖、官方文档入口、项目私有技能与缺失动作 |
| `project/CUSTOM_SKILL_OVERRIDES.md` | 对通用或外部技能的项目级调整 |
| `customizations/` | 可复用的技能路由补丁和本地扩展示例 |
| `project-skills/` | 项目私有技能；只通过 `DEPENDENCY_SKILLS.md` 发现 |

## 模板

`templates/` 是可复制的任务和工作区文件，不是运行中的权威记录。实际路径由 `PROJECT_RULES.md` 的 `documentation_layout` 指定。`micro_spec_persistence` 决定明确小任务可否只做内联记录；`task_index_mode=required` 时使用 `task-index.md` 建立唯一任务总表，`disabled` 时路径必须为 `N/A`。任务索引只保存编号、候选、导航和带来源的生命周期摘要，不替代 spec、task plan 或 progress。

安装或维护规则包时使用 `audits/quality-checklist.md`；运行工程任务时不加载审计材料。
