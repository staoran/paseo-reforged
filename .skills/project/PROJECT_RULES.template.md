# 项目规则

## 项目身份

| 字段 | 值 |
| --- | --- |
| project_id | `<唯一项目标识>` |
| kit_revision | `commit` / `release tag` / `content-sha256:HEX` |
| 项目类型 | `<backend / frontend / miniprogram / desktop / monorepo / other>` |
| 根目录 | `<相对或绝对路径>` |
| 默认协作语言 | `<例如：中文>` |
| 代码与文档命名语言 | `<规则>` |
| 任务目录格式 | `<编号>_<任务标题>（填写编号来源、标题语言、允许字符与清理规则；不追加项目集合/状态/负责人/日期）` |
| enabled_type_modules | `<backend, frontend, miniprogram, desktop 的子集>` |
| enabled_workflows | `<可选增强模块：grill-me, task-tracking, task-decomposition, cross-task-collaboration 的子集；SDD 核心闭环与 cross 安全流程不可关闭>` |
| execution_gate | `checkpoint` |
| 文档是否需审批 | `<yes/no/按类型>` |
| skill_registry | `<DEPENDENCY_SKILLS.md / 项目现有 skills 索引路径>` |
| documentation_layout | `见下方“文档布局”表` |
| task_index_mode | `<required / disabled>` |
| micro_spec_persistence | `<inline-allowed / file-required>` |

`项目类型` 描述主要交付形态，`enabled_type_modules` 只启用实际存在的代码层。桌面 GUI 至少启用 `desktop`；嵌入式 Web UI 或独立本地 HTTP/RPC 服务按证据追加 `frontend`/`backend`。普通后台 worker 不单独触发 `backend`。纯 CLI 暂用 `other`，并在本文件登记 CLI 专属约束。

`kit_revision` 记录本次成功安装、修复或升级的规则包来源 revision。只有规则包文件合并、路径检查和场景验证全部通过后才更新；失败或部分完成时保留旧值并记录阻塞。

## 运行与验证命令

仅登记已经在当前项目验证过的命令。不要从其他项目复制。

| 场景 | 命令 | 适用条件 | 证据或输出 |
| --- | --- | --- | --- |
| 安装 | `<command>` | `<condition>` | `<expected>` |
| 本地开发 | `<command>` | `<condition>` | `<expected>` |
| 类型检查 | `<command>` | `<condition>` | `<expected>` |
| Lint/格式 | `<command>` | `<condition>` | `<expected>` |
| 单元测试 | `<command>` | `<condition>` | `<expected>` |
| 集成/契约测试 | `<command>` | `<condition>` | `<expected>` |
| 构建/启动 smoke | `<command>` | `<condition>` | `<expected>` |
| 生成代码 | `<command>` | `<condition>` | `<expected>` |

## 项目事实源

| 领域 | 权威路径或工具 | 修改前必须回读 | 禁止绕过 |
| --- | --- | --- | --- |
| 依赖与包管理 | `<path>` | `<path>` | `<rule>` |
| 配置与环境 | `<path>` | `<path>` | `<rule>` |
| 路由/页面入口 | `<path>` | `<path>` | `<rule>` |
| 请求/API/客户端 | `<path>` | `<path>` | `<rule>` |
| 数据/持久化 | `<path>` | `<path>` | `<rule>` |
| 认证/授权 | `<path>` | `<path>` | `<rule>` |
| 生成物 | `<path or command>` | `<path>` | `<rule>` |
| 测试入口 | `<path>` | `<path>` | `<rule>` |

## 文档布局

本节是 `documentation_layout` 的权威映射。`micro_spec_persistence=inline-allowed` 时，明确、低风险、同会话任务可把最小 spec 放在执行前复述与最终回写中；需要恢复、影响公共行为或项目政策要求时仍须使用下表路径落盘。

`task_index_mode=required` 时，所有持久化 spec/micro-spec 必须登记到唯一任务索引，候选待办不占正式编号，正式任务先创建文档再分配编号并登记；内联 query、`zero` 和内联 micro-spec 不登记。`task_index_mode=disabled` 时，任务索引路径必须为 `N/A`，其他规则不得继续引用任务索引。

任务包目录只使用 `<编号>_<任务标题>/`。编号来源、标题语言、允许字符和清理规则以“项目身份”表为准；跨项目参与者、状态、负责人和日期写入 Spec Record，不写进目录名。历史目录默认不批量重命名，除非用户明确批准迁移。

领域词汇只记录项目特有术语，不保存实现细节或任务合同；ADR 只记录难逆转、无上下文会意外且存在真实取舍的长期决策。两者均为可选项目上下文，不替代 spec、project knowledge 或 critical context。

| 文档 | 路径 | 命名规则 | 何时更新 |
| --- | --- | --- | --- |
| 任务索引 | `<path or N/A>` | `<编号、状态投影与候选规则>` | `<required 时持续同步；disabled 时 N/A>` |
| spec | `<path>` | `<rule>` | `<when>` |
| micro-spec | `<path or inline>` | `<rule>` | `<when>` |
| task plan | `<path>` | `<rule>` | `<when>` |
| findings | `<path>` | `<rule>` | `<when>` |
| progress | `<path>` | `<rule>` | `<when>` |
| codemap | `<path>` | `<rule>` | `<when>` |
| 领域词汇 | `<path or N/A>` | `<rule>` | `<when>` |
| ADR | `<path or N/A>` | `<rule>` | `<when>` |
| critical context | `.skills/project/CRITICAL_CONTEXT.md` 或 `<path>` | `<rule>` | `<when>` |
| project knowledge | `.skills/project/PROJECT_KNOWLEDGE.md` 或 `<path>` | `<rule>` | `<when>` |

## 工作区与跨项目配置

| 字段 | 值 |
| --- | --- |
| workspace_mode | `single-project` / `multi-project-child` / `workspace-parent` |
| workspace_root | `<path or N/A>` |
| project_registry | `<path or N/A>` |
| cross_project_tracking_dir | `<path or N/A>` |
| cross_project_authorization | `<explicit-user-scope / project-policy>` |
| provider_consumer_order | `<rule or N/A>` |

## Git 与提交

| 项目规则 | 值 |
| --- | --- |
| commit_format | `<format or N/A>` |
| spec_footer | `<format or N/A>` |
| commit_hash_in_spec | `<yes/no>` |
| generated_files_policy | `<rule>` |
| local_or_secret_files | `<rule>` |

## 私有技能注册表

项目私有技能只在 `DEPENDENCY_SKILLS.md` 登记；本文件的 `skill_registry` 必须指向该注册表或项目现有的等价唯一注册表。不要在本文件重复维护技能表。

注册表中的全局 Skill/policy/tool 是按触发生效的必需依赖，必须登记 source scope、version policy、missing action、evidence 和 last verified。命中触发且依赖缺失时停止任务并提示安装/配置；不得把 bundled workflow、项目纪律、源码搜索、索引或模板登记为全局 Skill 的等价替代。

`enabled_workflows` 只能控制可选增强模块：`grill-me`、`task-tracking`、`task-decomposition`、`cross-task-collaboration`。所有工程任务的 SDD 核心闭环不能关闭；查询/`zero` 是否跳过外部 SDD Skill 只由 `skill-coordination.md` 判断；`cross` 任务的 `cross-project` 不能关闭。若项目未启用某个可选模块但任务触发其能力，必须在本文件或 `CUSTOM_SKILL_OVERRIDES.md` 指定等价回退流程；没有等价回退时升级为阻塞，不得静默跳过。

任务索引只保存编号、候选待办、导航和带来源锚点的生命周期状态摘要；spec、task plan 和 progress 仍分别持有合同、权威操作状态与执行/验证/下一步。跨项目父级与子项目各自服从本级 `task_index_mode`：`required` 只登记本级持久化任务并使用独立编号空间，父级与子项目都为 `required` 时通过各自索引双向链接；`disabled` 时本级索引路径和锚点为 `N/A`，持久化任务文档直接链接父级 spec。`cross-lite` 使用内联 micro-spec 时不创建文档或索引锚点，由父级 spec 记录实际变更或验证证据。

项目新增 Skill、规则/语言/文档布局、依赖能力、Skill override、长期知识、关键上下文或 Codemap 时，使用 `.skills/workflows/project-customization.md`；普通项目 Skill 只登记在 skill registry，不重复写入根 `AGENTS.md`。

## 高风险与不可变约束

- `<安全、数据、兼容、法规、发布或业务边界>`

## 已知缺口

- `<尚未验证的命令、缺少的总图、需要补充的技能或文档>`
