# 核心依赖与技能登记

## 核心能力实例

本表只登记批准后的项目快照。Project Setup 从 canonical route 解析 capability、依赖和缺失动作；快照与 route 冲突时停止并更新快照，不把项目值当作 override。

`source_scope=bundled` 的记录必须引用 `.skills/project/PROJECT_RULES.md` 的 `kit_revision` 字段；规则包安装、修复或升级成功后，在同一工作单元更新 revision、相关 `last_verified` 和 evidence。

| capability | canonical_route | required_dependency | source_scope | version_policy | missing_action | evidence | last_verified |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `<capability>` | `<../core/skill-coordination.md#anchor>` | `<resolved dependency>` | `<scope>` | `<policy>` | `<resolved stop action>` | `<runtime and output evidence>` | `<date + evidence>` |

## 核心依赖

| 依赖/服务 | 当前版本或来源 | 本项目集成入口 | 官方文档入口 | 变更风险 | 验证 |
| --- | --- | --- | --- | --- | --- |
| `<dependency>` | `<version>` | `<code path>` | `<official docs>` | `<risk>` | `<command/test>` |

## 项目私有技能

| 技能/能力 | 用途 | 边界/不适用场景 | 路径 | invocation | 何时读取 | 关键输入 | 输出/验收 | 验证样例或 test-prompts | missing_action |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `<unique-name>` | `<purpose>` | `<boundary>` | `<path>` | `<model-invoked / user-invoked>` | `<trigger or explicit invocation>` | `<input>` | `<output>` | `<path or N/A>` | `<stop-and-repair / stop-and-install>` |

## 其他外部工具

| 需要的能力 | required_dependency | source_scope / version_policy | missing_action | 证据记录 |
| --- | --- | --- | --- | --- |
| 浏览器测试 | `<required tool/runtime>` | `<global/project / policy>` | `<stop-and-install / stop-and-configure>` | `<test evidence>` |

## 维护规则

- 只登记项目真正依赖且会影响开发决策的库、服务、CLI、全局 Skill/policy 和项目私有 Skill。
- 版本、官方文档、集成入口或全局安装状态变化时，在同一工作单元更新本文件。
- 全局依赖必须登记 required dependency、source scope、version policy、missing action、evidence 和 last verified；不得登记本地等价 fallback。
- `required_dependency` 与 `missing_action` 是 canonical route 在 `last_verified` 时的核验快照；route 变化或冲突时先同步本表，再恢复任务。
- 命中触发且必需依赖缺失时，停止当前任务，报告依赖名称、触发原因和安装/配置要求；安装完成并重新核验后才能恢复。
- 项目私有 Skill 名称和 capability 必须唯一；创建前检查本表，避免重复注册或错误路由。
- 项目私有 Skill 必须登记 `invocation`；model-invoked 由 description 路由，user-invoked 只接受用户显式调用，注册记录必须与 frontmatter 一致。
- 项目私有 Skill 默认位于 `.skills/project-skills/<name>/SKILL.md` 或项目既有 Skill 目录；`SKILL.template.md` 不得登记为可用 Skill。
- 创建或修改项目 Skill 时三个 authoring 依赖全部必需：`$skill-creator` 负责初始化与基础校验，user-invoked 的 `$writing-great-skills` 负责可预测性和裁剪，`$darwin-skill` 负责九维对照实测与棘轮。任一缺失时停止；Writing 未进入上下文时请求用户显式调用，不使用模板或本地摘要替代。
- 由 Agent 新增或调整项目 Skill/能力时，使用 `.skills/workflows/project-customization.md`：先只读提案和 checkpoint，再创建、登记、验证并 Reverse Sync。
- 不复制全局 Skill 全文；Codemap 不得脱离 SDD Research/Review 独立接管任务。已登记的领域词汇和 ADR 只是可选上下文，缺失时不阻塞 Codemap；命中领域建模写入时，必须先登记唯一落点。
