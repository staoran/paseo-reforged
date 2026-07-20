# 项目私有 Skill 创建与维护

## 适用判断

只有同时满足以下条件才创建项目 Skill：流程会跨任务重复使用；包含项目特有且不适合常驻根入口的知识或步骤；有可识别的触发与不触发边界；输出可验证。一次性任务事实留在 spec/findings，通用外部能力优先登记为 dependency capability，只有项目增量时使用 skill override。

## 创建前调查

1. 读取 `PROJECT_RULES.md` 的 `skill_registry`、`DEPENDENCY_SKILLS.md`、`.skills/project-skills/` 和项目登记的其他 Skill 目录。
2. 按 `name` 与 capability 检查重名、同义重复和路由遮蔽；模板、`_template/` 和未登记目录不算可用 Skill。
3. 至少收集一个应触发样例、一个不应触发样例，以及成功输出/证据。高风险或相邻能力易混淆时增加边界样例。
4. 选择 invocation：Agent 必须按任务信号自动发现或被其他 Skill 路由时使用 `model-invoked`；只应由用户点名启动时使用 `user-invoked`。无法说明自动发现价值时保留提案，不默认增加 context load。
5. 决定是否真正需要 `scripts/`、`references/`、`assets/` 或 `agents/openai.yaml`；没有重复执行价值的资源不创建。
6. 从技能注册表确认 `$skill-creator` 与 `$darwin-skill` 可加载，并完整读取其主说明；确认 user-invoked 的 `$writing-great-skills` 已由用户显式调用并进入当前上下文。任一 Skill 缺失时停止并提示安装；Writing 未被调用时停止并请求用户调用。

## 提案与写入

- 名称使用 64 字符以内的小写连字符格式，目录名与 frontmatter `name` 一致。
- 选择 invocation 后，按 `.skills/project-skills/_template/SKILL.template.md#生成约束` 生成 frontmatter、description 和 runtime 映射；本工作流不维护第二份 schema。
- 创建或修改项目 Skill 必须使用已登记的 `$skill-creator` 初始化和基础验证，以 `$writing-great-skills` 约束 invocation、information hierarchy、completion criterion、single source of truth 与 pruning，再以 `$darwin-skill` 完成九维审查和对照实测。任一依赖缺失时停止当前任务并提示安装；`.skills/project-skills/_template/SKILL.template.md` 只提供项目 schema 参考，不替代这些全局 Skills。
- 正文只保留另一名 Agent 执行时真正需要的非显然步骤；步骤有可检查的完成条件，条件参考按分支放到一级 `references/`。删除重复、沉积、无效指令和无必要资源，不创建 Skill 内 README、安装指南或 changelog。
- 创建或修改后，在 `DEPENDENCY_SKILLS.md` 同一工作单元登记 invocation、用途、边界、路径、触发或显式调用方式、输入、输出/验收、test-prompts 和 missing action。
- 只有每个工程任务都必须读取、且仅靠注册表触发会失效的 always-on 安全/路由 Skill，才在根 `AGENTS.md` 加最小路由；普通项目 Skill 只通过注册表发现。

## 验证

1. 用 `$skill-creator` 校验 frontmatter、目录名、相对引用和可选 runtime metadata。
2. 用 `$writing-great-skills` 检查 invocation 选择、frontmatter 与注册记录一致性、description、信息层级、完成条件、单一事实源、渐进披露、重复、沉积、sprawl 和 no-op。
3. 用 `$darwin-skill` 做九维静态评分，并运行 2 至 3 个正向、负向或边界 Prompt：新 Skill 对比无 Skill baseline，修改 Skill 对比修改前版本；效果评分使用独立 judge，记录 `full_test` / `dry_run`。没有至少一次可信 full test 或改进不成立时保持未启用。
4. 验证依赖或项目 Skill 缺失时会停止并给出明确安装/修复提示，不会把“未加载”伪装成成功。
5. 检查新增 Skill 没有复制项目规则、外部 Skill 全文、密钥、生产连接或一次性任务记录。
6. 更新注册表 evidence 和当前 Spec Record 的实际结果；修改后未严格优于原版本时不保留变更。

## 失败边界

- 名称或 capability 冲突时优先扩展现有 Skill 或登记 override，不创建第二个竞争入口。
- invocation 无法确定，或 user-invoked Skill 仍依赖自动路由时，只保留提案并请求裁决，不生成含糊 frontmatter。
- 无明确触发/不触发样例、无验收或无法确定长期复用价值时，只保留提案，不创建。
- Skill 验证失败时保持未启用；不得只登记路径后宣称能力可用。
- `$skill-creator`、`$writing-great-skills` 或 `$darwin-skill` 任一未安装、不可加载或版本策略不满足时立即停止；Writing 已安装但未显式调用时请求用户调用。安装、更新或调用并重新核验后才能恢复创建流程，不创建本地替代。
