---
name: project-custom-skill-template
description: "Schema reference for $skill-creator when generating a project-specific Agent Skill under $writing-great-skills and $darwin-skill quality gates. Do not register, execute, or manually copy this template as a usable Skill."
---

# 项目私有技能模板

本模板仅作为 `$skill-creator` 的项目 schema 输入。使用 `.skills/workflows/project-customization.md` 的 `project-skill` mode，加载 `$skill-creator` 与 `$darwin-skill`，并确保 user-invoked 的 `$writing-great-skills` 已由用户显式调用后，由 `$skill-creator` 基于本模板生成 `<skill-name>/SKILL.md`；不得手工复制模板绕过依赖和质量检查。任一必需 Skill 缺失时停止并提示安装；Writing 未进入当前上下文时停止并请求用户调用，不创建本地替代。以下创建说明不进入生成后的 Skill 正文。

## 生成约束

本节是生成后 frontmatter schema 与 runtime invocation 映射的唯一事实源；`project-skill` workflow 只负责选择 invocation。

- 按 `$writing-great-skills` 设计可预测的执行：步骤有可检查完成条件，条件参考渐进披露，每个含义只有一个事实源，并删除 duplication、sediment、sprawl 与 no-op。
- 按 `$darwin-skill` 编码失败分支、显式 checkpoint、反例/黑名单和 runtime 中立性；用 2 至 3 个典型 Prompt 对新 Skill 与无 Skill baseline、或修改前后版本做独立实测，只保留可验证改进。
- 先选择 invocation。model-invoked 省略 `disable-model-invocation`，用 1024 字符以内的模型可发现 description 表达能力与真实触发分支；user-invoked 添加 `disable-model-invocation: true`，description 只写面向用户的一行摘要，不写触发词列表，也不允许其他 Skill 自动路由。runtime 不识别该字段时必须使用等价显式调用配置并登记映射证据；无法证明自动发现已关闭时保持未启用。
- `name` 必须唯一、全小写、连字符分隔且不超过 64 字符；生成后的 frontmatter 只保留 `name`、`description` 和 user-invoked 所需的 `disable-model-invocation: true`。禁止以“灵活应用”“根据情况判断”“视情况而定”等空话收尾。
- 注册前在 `DEPENDENCY_SKILLS.md` 检查不存在重复名称或 capability，并记录 invocation、三个全局 Skill 的加载证据、结构校验、测试模式和独立 judge 结果。`SKILL.template.md` 本身不是可执行项目技能，也不得登记为可用技能。

## 触发条件

- `<用户表达或任务信号>`
- `<代码或目录特征>`

## 不触发条件

- `<不应加载的相邻场景>`

## 输入

- `<需要先读取的项目规则、源码路径、spec 或配置>`

## 工作流

1. `<可执行步骤和输入>`
2. `<可执行步骤和输出>`
3. `<验证步骤与证据>`

## 输出

- `<应产生的代码、文档、验证或决策记录>`

## 验证样例

- 验证样例或 `test-prompts` 路径：`<path or N/A>`
- 至少包含：`<一个应触发样例>`、`<一个不应触发样例>`；相邻能力易混淆时追加边界样例。
- 成功标准：`<可观察的输出或证据>`
- 无法自动验证时的人工验证：`<步骤和边界>`

## 🔴 CHECKPOINT

在 `<高影响决定>` 前确认：`<必须明确的目标、范围、风险或批准>`。

## 失败处理

| 触发条件 | 一线处理 | 兜底 |
| --- | --- | --- |
| `<failure>` | `<action>` | `<fallback>` |

## 项目 override

- `<指向 CUSTOM_SKILL_OVERRIDES.md 的增量规则>`

## 不要做

- `<反模式一>`
- `<反模式二>`
- 不创建 Skill 内 README、安装指南或 changelog；详细材料只在确有需要时放入一级 `references/`。
