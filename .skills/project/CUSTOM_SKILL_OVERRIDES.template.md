# 自定义技能调整

本文件只承载当前项目对通用或外部 Skill 的增量调整。不要复制原 Skill 全文，也不要使用它隐藏项目事实、降低必需依赖或绕过缺失停止动作。

## Override 清单

| skill/capability | 触发条件 | 项目额外要求 | 额外输入 | 输出落点 | 缺失/失败处理 | 最后核对 |
| --- | --- | --- | --- | --- | --- | --- |
| `sdd-harness` | `<mode/when>` | `<project requirements>` | `<paths>` | `<spec/progress>` | `stop-and-install required global Skill` | `<date>` |
| `coding-discipline` | `<Plan/Execute/Review condition>` | `<project constraints>` | `<paths/tests>` | `<spec/progress>` | `stop-and-install $karpathy-guidelines` | `<date>` |
| `codemap` | `<Research/drift signal>` | `<scope/freshness rules>` | `<source paths>` | `<map/index>` | `stop-and-install $codemap` | `<date>` |
| `third-party-docs` | `<library/framework/API question>` | `<locked version, internal wrapper, allowed sources>` | `<manifest/lockfile/wrapper paths>` | `<findings/spec/response evidence>` | `stop-and-configure global policy/Skill/tool` | `<date>` |
| `grill-me` | `<when>` | `<requirements>` | `<decision sources>` | `<spec section>` | `<stop / bundled repair action>` | `<date>` |
| `task-tracking` | `<when>` | `<requirements>` | `<task paths>` | `<task files>` | `<stop / bundled repair action>` | `<date>` |
| `cross-project` | `<when>` | `<requirements>` | `<registry/contracts>` | `<parent task>` | `<stop / bundled repair action>` | `<date>` |
| `project-customization` | `<mode/when>` | `<requirements>` | `<authority files>` | `<project file>` | `stop-and-repair-kit` | `<date>` |
| `<other>` | `<when>` | `<requirements>` | `<paths>` | `<path>` | `<missing/failure action>` | `<date>` |

## 变更审查

- override 是否仍只包含增量，而不是复制或篡改上游流程。
- 路径、命令、模板和职责是否真实存在。
- 是否增加了执行门禁、风险检查或验收，而不是移除它们。
- 是否保持必需全局依赖和缺失停止动作，没有引入本地等价替代。
- 是否需要同步更新 `PROJECT_RULES.md`、`DEPENDENCY_SKILLS.md`、codemap 或项目知识。
