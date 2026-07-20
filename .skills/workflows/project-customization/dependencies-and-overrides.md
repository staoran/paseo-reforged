# 依赖能力与 Skill Override 维护

## `dependency-capability`

在 `DEPENDENCY_SKILLS.md` 登记会影响任务决策的库、SDK、CLI、服务、全局 Skill/policy 或运行时能力。全局依赖至少包含 capability、canonical route、required dependency、source scope、version policy、missing action、evidence 和 last verified；项目私有 Skill 另填 invocation、路径、输入、输出与 test-prompts。

核心能力的触发、阶段归属、必需依赖与缺失处理只以 `../../core/skill-coordination.md` 为准；注册表只保存 `last_verified` 时的核验快照。快照与 canonical route 冲突时停止并同步，不作为项目 override。

外部安装名称可以由运行时映射，但 required dependency、source scope、version policy、missing action 和 evidence 不得缺失。规则包不负责拉取远端更新；`floating-installed` 使用当前全局安装版本，`pinned-revision` 要求指定 revision，`managed-global` 由全局 policy/tool 管理。

## `skill-override`

只在 `CUSTOM_SKILL_OVERRIDES.md` 记录项目增量：额外触发或排除条件、项目事实源、版本/路径、额外输入、输出落点、风险检查、语言/格式和缺失/失败处理。不要复制外部 Skill 正文，不改写其核心目标，也不能把必需依赖降级为本地替代。

## 写入与验证

1. 读取现有注册表、override 和 Skill 主说明，确认是新增依赖、版本策略变化还是项目增量。
2. 对每个必需依赖写清 source scope、version policy、missing action 和 evidence；需要版本的能力记录来源与最近核对日期。
3. 获批后更新唯一注册表或 override，不在 `AGENTS.md` 复制完整表格。
4. 用至少一个命中场景和一个缺失依赖场景干跑；后者必须停止并产生明确安装/配置提示。
5. 若替换会改变 SDD、跨项目、安全核心语义或必需依赖，判为冲突并停止，不作为普通 override 接受。
