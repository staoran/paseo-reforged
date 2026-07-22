# 项目层文档组

本目录已经包含同名 Project Setup 文件。首次任务先按 `PROJECT_RULES.md` 判断：满足全部低风险条件的 `zero/micro` 使用内联 `project-setup-lite`；其他任务提交 Full Project Setup checkpoint。Full Project Setup 获批后，用相应 `.template.md` 的结构初始化所需字段，不要直接重命名模板并与同名文件冲突。这里只是项目的权威导航层，不是通用规则的副本。

安装到已有项目时，目标根现存 `AGENTS.md` 必须先保留并做内容级合并，不能由规则包整文件覆盖；本目录也不能覆盖更高优先级的根或子目录规则。目标已有同名 `.skills` 文件时逐文件确定唯一事实源，并保留项目私有能力和用户改动。

| 文件 | 何时维护 | 内容边界 |
| --- | --- | --- |
| `PROJECT_RULES.md` | 初始化、命令/结构/门禁变化 | 项目运行方式、路径、类型模块、文档布局、规则包 revision |
| `PROJECT_KNOWLEDGE.md` | 形成稳定可复用事实时 | 已验证且脱敏的项目知识 |
| `CODEMAP_INDEX.md` | 总图或功能地图变化时 | codemap 索引、新鲜度与事实源 |
| `CRITICAL_CONTEXT.md` | 关键链路或历史风险被确认时 | 状态机、兼容、风险、回退和证据 |
| `DEPENDENCY_SKILLS.md` | 核心依赖或项目 Skill 变化时 | required dependency、来源、版本策略、缺失动作与 evidence |
| `CUSTOM_SKILL_OVERRIDES.md` | 需要调整通用/外部技能时 | 只记录增量约束与触发，不复制技能全文 |

只需先初始化当前任务依赖的字段；无关领域可以明确保留 `UNCONFIGURED`。规则包模板和工作流属于 bundled 文件，默认保留；若确需最小化，必须先完成引用审计并同步改写所有入口和索引，不得只删除文件。不要让空占位符被误认为项目事实。

## 初始化后的自定义

Project Setup 完成后，不需要手工猜测应该改哪个文件。向 Agent 明确要新增或调整的长期内容，并让它使用 `.skills/workflows/project-customization.md`；skills-aware runtime 可调用 `$manage-project-customizations`。规则包自身的升级不走项目自定义 mode，而由规则包源目录的 `ASSEMBLY_GUIDE.md` 中 `upgrade-existing-kit` 流程处理。项目自定义统一由 workflow 选择唯一落点：`project-skill`、`project-rules`、`dependency-capability`、`skill-override`、`project-knowledge`、`critical-context`、`codemap`。

第一轮必须只读调查并给出精确文件动作与 checkpoint；批准后才写入、登记、验证和 Reverse Sync。一次性任务事实、临时失败和未验证假设仍留在当前 Spec Record，不进入本目录的长期文件。
