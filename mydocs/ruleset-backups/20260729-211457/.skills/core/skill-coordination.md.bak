# 核心技能协作规范

## 能力选择

SDD-RIPER 核心闭环是所有工程任务的主 Harness；外部 light/one 是按 canonical route 加载的实现能力，不等于核心闭环本身。其他能力只在对应阶段提供输入、约束或输出，不建立平行状态机。登记为全局必需依赖的 Skill 只在命中触发时检查，但一旦命中便不可降级为本地替代。

| 任务信号 | SDD 阶段 | 必需依赖或 bundled 入口 | 输出 / 缺失处理 |
| --- | --- | --- | --- |
| 查询/`zero` 且 SDD 绕过条件全部成立 | 全程 | bundled SDD 核心合同 | 不加载外部 light/one；仍完成对应 Restate、证据/目标检查、验证和收口；任一条件失效立即结束绕过 |
| `micro` / `standard` / `complex` / `cross`，或任何分类命中重型信号 | 全程 | branch/PR/WIP/fixed-point Review 等重型信号必须使用 `$sdd-riper-one`；其余目标边界清楚且风险中低的任务使用 `$sdd-riper-one-light` | 完整加载所选全局 Skill；未加载时停止并按 SDD-RIPER 恢复合同处理 |
| 用户显式要求 Codemap，或出现陌生项目、跨模块链路、架构影响、跨项目定位、地图漂移 | Research / Review | `$codemap` | 只读查询在响应内返回源码证据、地形或 drift 结论；持久任务获写入授权后产出/更新 CodeMap 并登记 `CODEMAP_INDEX.md`；缺失时停止并提示安装 |
| 编码、重构或代码 Review | Plan / Execute / Review | `$karpathy-guidelines` | 与 `development-discipline.md` 项目基线共同生效；全局 Skill 缺失时停止并提示安装 |
| 逻辑/状态模型或 UI 需要可运行证据 | Research / optional Innovate | `$prototype` | 按 `customizations/matt-pocock-bridge.md` 产出 throwaway 证据；缺失时停止并提示安装 |
| 用户明确要求 TDD、test-first 或 red-green；或 Agent 能证明稳定行为 seam、非平凡逻辑/明显回归风险和低成本最小 red-green slice 同时成立 | Execute | `$tdd` | 新增、维护或运行测试（包括集成测试）本身不构成显式触发；自主触发必须同时满足三项条件，先确认 seam 再逐个 red/green slice；缺失时停止并提示安装 |
| 困难/间歇性缺陷、性能回归或首轮定位失败 | Research / Execute / Review | `$diagnosing-bugs` | 先建立 red-capable 反馈循环；缺失时停止并提示安装 |
| 已存在 merge/rebase 冲突且用户要求解决 | Execute / Review | `$resolving-merge-conflicts` | 保留双方意图并服从项目 Git/授权规则；缺失时停止并提示安装 |
| 自然语言模块/架构边界分析 | Research | 常规 Research；陌生度或跨模块信号成立时再追加 `$codemap` | 只交付基于源码证据的文字判断；显式体检和重构实施保持为独立、需另行触发的分支 |
| 用户明确要求设计或改善深模块、interface 或 seam | Research / optional Innovate / Plan | `$codebase-design` | 只提供设计词汇与候选接口；已采纳决定回写 spec，不自动实施重构 |
| 领域术语含糊/冲突，或需要记录满足 ADR 三条件的长期决策 | Research / optional Innovate / Reverse Sync | `$domain-modeling` | 只更新已登记的领域词汇或 ADR 落点；缺失时停止并提示安装，落点未登记时进入 project customization |
| 用户显式调用 `$improve-codebase-architecture` | Research / optional Innovate | `$improve-codebase-architecture` 及其直接依赖 | 临时体检报告只作为 findings 证据；不自动设计接口或实施重构 |
| 复杂、冲突或含糊需求 | Research / optional Innovate | bundled `workflows/grill-me.md` | 已确认需求、假设、未决项、验收；bundled 文件缺失时停止并修复规则包 |
| 第三方技术知识 | Research | 当前生效的上级/全局官方文档 policy 与其所需 Skill/工具 | 用 `DEPENDENCY_SKILLS.md` + `CUSTOM_SKILL_OVERRIDES.md` 核对项目版本/封装；全局依赖缺失时停止并提示安装或配置 |
| 长任务、恢复或进度可见性 | 全程持久化 | bundled `workflows/task-tracking.md` | plan、findings、progress；bundled 文件缺失时停止并修复规则包 |
| 可拆分的大任务 | Plan | bundled `workflows/task-decomposition.md` | 依赖图与最小工作单元 |
| 跨项目契约 | 全程安全边界 | bundled `workflows/cross-project.md` | Provider/Consumer 契约与发布门禁 |
| 项目级自定义内容 | Research / Plan / Reverse Sync | bundled `manage-project-customizations` adapter / workflow | 提案、精确写入、注册、验证与同步 |
| 交接、换会话、上下文压缩 | Reverse Sync | `$new-chat-ready` | 生成可恢复交接包；缺失时停止并提示安装 |

## 加载协议

1. 按根入口先读取 `PROJECT_RULES.md` 的 `skill_registry` 和 `enabled_workflows`，再按 `operating-model.md` 分类，并用本文件判断是记录外部 SDD 绕过证据还是选择全局 light/one。`skill_registry` 必须指向 `DEPENDENCY_SKILLS.md` 或等价的唯一可发现性注册表。
2. 注册表已初始化时，从中解析当前阶段命中的 `required_dependency`、`source_scope`、`version_policy`、`missing_action`、`evidence` 和 `last_verified`。若 canonical route 已命中但注册表没有对应快照，标记 registry drift，停止该 capability 的执行并通过 `dependency-capability` 提交登记 checkpoint；不得把缺行解释为能力可用或不需要。Initial Project Setup 中注册表尚未初始化时，按本文件的核心能力路由和当前 runtime 可见能力核验本任务依赖；只把依赖、来源、版本策略与核验证据列入 Project Setup 待登记项，不把当前可见性伪装成已初始化注册表。命中根入口的局部候选条件时返回其轻量分支，不展开 Project Setup。
3. 命中全局必需依赖时先确认 Skill/policy/tool 可用；缺失立即停止当前任务，列出依赖名称、触发原因和安装/配置要求。不得创建、读取或生成本地等价替代。
4. 依赖可用后读取命中 Skill 的完整主说明，再读取 `CUSTOM_SKILL_OVERRIDES.md` 中与该 capability 同名的项目 override。
5. 仅加载 Skill 直接引用且当前任务必需的资源；不要递归读取整个 Skill 或 `.skills/` 目录。
6. 将能力产生的事实和结论写到当前逻辑 Spec Record 的权威文件；不要只留在聊天，也不要把加载成功当作执行成功。

包内通用 adapter 只通过 `.skills/INDEX.md` 发现，并且只能加载已登记的 bundled workflow；不得新增触发条件、流程、状态或检查点。运行时不支持 adapter 自动发现时，可直接读取同一 bundled workflow，因为它是相同规范的入口差异，不是对缺失全局 Skill 的替代。项目私有 Skill 使用独立注册表，且不得与包内 adapter 同名遮蔽。

项目私有 Skill 默认放在 `.skills/project-skills/<name>/SKILL.md` 或项目登记的既有目录。`SKILL.template.md`、`_template/` 和未在注册表登记的目录都不可作为可用 Skill 自动加载。

`enabled_workflows` 只能筛选可选的 bundled 增强能力：`grill-me`、`task-tracking`、`task-decomposition`、`cross-task-collaboration`。SDD-RIPER 核心闭环与 `cross` 的 cross-project 安全流程不能被项目配置关闭；外部 light/one 是否加载仍按本文件判断。bundled 合同文件缺失时停止并修复规则包，不临时创建替代流程。

### Canonical route 优先级

- 全局 Skill 的 frontmatter `description`、关键词和运行时发现结果只用于产生候选，不是执行授权，也不能新增触发分支。
- 实际是否加载或调用能力，只由本文件的 canonical route、项目 override 和当前任务证据共同决定；description 更宽时按 canonical route 收窄。
- 同一请求含多个编号或分支时逐项独立路由；某一分支的显式 Skill 调用只授权该分支，不传播到兄弟分支。例如显式架构体检不改变另一分支的深模块 interface/seam 路由，后者仍使用 `$codebase-design`。
- 例如全局 `$tdd` description 提到 integration tests，只表示可能相关；仅新增、维护或运行集成测试仍不触发 `$tdd`，除非用户明确要求 TDD/test-first/red-green，或三项自主条件同时成立。
- 运行时若只能按 description 自动调用、无法执行 canonical route 的排除条件，标记为 route-incompatible，停止并提示配置；不得把自动调用计为路由通过，也不得创建本地替代。

## 核心能力路由

### SDD-RIPER

- 先判断重型信号：branch/PR/WIP/fixed-point 代码 Review、全库架构审计、`complex` / `cross`、目标/任务单元不清、上下文分散、陌生大型代码库、高风险、迁移、长链路审计或频繁失败命中任一项时，必须使用 `$sdd-riper-one`。
- 未命中重型信号时，只有任务实际分类为查询或 `zero`，目标与边界明确，适用规则、事实源和验证入口均可确认，且用户未显式要求 light/one，才可跳过外部 SDD Skill。用户给出的 `zero` 标签不能替代分类证据。
- 绕过只裁剪外部 Skill 加载：查询仍保留 Restate、Research、来源证据、不确定性和只读收口；`zero` 仍保留 Restate、目标检查、最窄变更、验证和最终摘要。其他命中能力仍独立核验，外部 SDD Skill 缺失不阻塞有效绕过分支。
- 未命中重型信号但不满足绕过条件时，必须使用 `$sdd-riper-one-light`。绕过期间一旦出现范围升级、必要事实不清、行为/契约风险、跨项目影响、恢复/交接需要或其他重型信号，立即停止并加载对应 light/one。
- canonical route 已选择外部 Skill 时，只有该 Skill 的主说明已进入当前上下文才算可用。当前上下文未加载时停止当前任务：已知 Skill 为 user-invoked 或已安装但未附加时，请用户通过当前运行时的 Skill 入口显式调用；确认未安装、未启用或版本策略不满足时，提示安装、启用或更新；安装状态不可核验时同时给出这两条恢复路径，不把不可见断言为未安装。恢复前不得用 light、项目运行模型或持久化规则替代已命中的 Harness Skill。
- `sdd_bootstrap` 是 `$sdd-riper-one` 的原生命令，必须加载 `$sdd-riper-one`，不能改用 light；它只表示关闭 Pre-Research 并启动 RIPER Research，不等于也不触发 Project Setup。项目事实仍只按 `PROJECT_RULES.md` 配置。
- 用户只要求多分支 SDD 外部 Skill 路由判断时，用紧凑表给出每个分支的跳过、light 或 one 结论，以及即使绕过仍保留的核心动作；表后用一句共享门禁收口：任何新重型信号、范围升级或必要事实不清都会结束查询/`zero` 绕过，并按实际分类加载 canonical light/one。需要 Skill 的分支同时按上一条给出未加载时的停止/恢复动作；这些字段齐全后不附来源链接、已加载状态或完整工作流。

### Codemap

- 用户显式调用 `$codemap`，或明确要求创建、更新、检查项目总图、功能地形图、CodeMap/MAP 或 drift-check 时直接触发；该显式意图不因项目小或入口清楚而被排除。
- 没有显式意图时，只由 SDD Research/Pre-Research 的陌生度、跨模块链路、影响面、跨项目定位和既有地图漂移信号触发。
- 无显式意图且小范围任务的入口、依赖与事实源已经清楚时不触发 Codemap，直接读取源码和测试即可。
- `drift-check` 只在存在相关既有 CodeMap 时选择。没有相关地图时只排除 `drift-check`，不得据此跳过已经命中的 Codemap；显式创建/检查意图或架构地形信号仍成立时，重新选择 feature/project，只有全部触发信号都不成立时才跳过。
- 若重构已经改变入口或模块边界，即使没有既有 CodeMap、用户也没有要求持久化地图，仍必须调用 `$codemap` 的 feature/project 路由；只读任务只交付响应内地形结论，不创建地图。
- 用户明确只做路由判断时，只返回调用决定、直接动作和必要停止条件；不扫描项目、不执行 drift-check，也不把未来交付物表述为当前已产出的地形或漂移结论。
- 一旦触发，必须使用 `$codemap`；只读查询把源码证据、地形或 drift 结论保留在响应内，不创建或更新持久 CodeMap；持久任务在写入授权和项目落点明确后产出/更新 CodeMap 并登记 `CODEMAP_INDEX.md`。Skill 缺失时停止并提示安装，源码搜索与 `CODEMAP_INDEX.md` 不是替代实现。
- `$codemap` 拥有 feature/project/drift-check/update-existing 的工作流和输出格式；项目规则只决定 scope、批准、索引和回写。
- 项目已登记的领域词汇和 ADR 可作为 SDD Research/Codemap 的命名与决策上下文，但 CodeMap 中的代码地形仍须由源码证据确认并标记可信度。缺少这些可选上下文不阻塞 `$codemap`。

### Karpathy Guidelines

- 在 Plan 用于显式假设、选择最小可行方案和定义成功证据；在 Execute 约束外科式改动；在 Review 检查范围膨胀、投机抽象和未验证声明。
- 编码、重构或代码 Review 一旦触发，必须使用 `$karpathy-guidelines`；缺失时停止并提示安装。
- `development-discipline.md` 始终作为项目基线共同生效，但不是全局 Skill 的副本、同步镜像或缺失替代。

### Matt Pocock 阶段能力

- Matt 能力只在表中精确信号命中时加载，并按 `customizations/matt-pocock-bridge.md` 接入当前 SDD 阶段；它们不接管任务分类、spec、批准、Review、Project Setup、handoff 或 Reverse Sync。
- 原型写入必须先获 execution gate 批准；TDD 必须先确认公共测试 seam。只有用户明确要求 TDD、test-first 或 red-green 才算显式触发；新增、维护或运行测试本身不算。未显式要求时，只有稳定行为 seam、非平凡逻辑或明显回归风险、低成本最小 red-green slice 三项同时成立才自主触发；机械修改、原型、无可靠 seam 或测试成本高于风险时使用 SDD 常规验证。
- 困难缺陷必须先形成已运行的 red-capable 反馈循环；冲突解决必须先确认当前 Git 状态与双方意图。
- `$codebase-design` 只补深模块、interface 和 seam 设计；`$domain-modeling` 只补领域词汇与满足其三项门槛的 ADR，并写入项目已登记落点。两者的已采纳合同仍回写 spec，不能建立第二套计划。
- user-invoked 的 `$improve-codebase-architecture` 只有用户显式调用后才生成临时体检证据。
- 分支/PR/固定点 Review、巨大模糊任务、任务拆解、Project Setup、后续项目配置和交接分别由 SDD 原生 Review、Research/Grill/tracking/decomposition、Project Setup/project customization 与 `$new-chat-ready` 负责，不路由到 Matt 同类流程。
- 纯诊断不自动授权修复。外部 Skill 提出的 stage、commit、rebase continue 或 throwaway 分支提交动作继续服从用户授权、项目 Git 规则和隐私提交边界。
- `$grilling`、`$grill-with-docs`、`$research`、`$wayfinder`、`$to-spec`、`$to-tickets`、`$implement`、`$code-review`、`$handoff`、`$setup-matt-pocock-skills` 与 `$triage` 不进入本规则包的自动路由。用户显式调用外部 Skill 时仍不得绕过项目真相源和授权边界。
- 任一命中的全局 Skill 缺失、不可加载或版本不满足时，停止当前任务并提示安装/更新，不用包内桥接或本地摘要继续模拟该能力。

## 项目 Skill 与自定义内容

新增或调整项目 Skill、项目规则、dependency capability、Skill override、项目知识、关键上下文或 Codemap 时，读取 `workflows/project-customization.md`。skills-aware runtime 可通过 bundled `skills/manage-project-customizations/SKILL.md` 加载；该 adapter 不持有另一份流程。

项目 Skill 创建必须先判断是否稳定复用、检查名称与 capability 冲突、收集触发/不触发样例，再使用必需的 `$skill-creator`、user-invoked `$writing-great-skills` 与 `$darwin-skill`：分别负责初始化/基础校验、可预测性/裁剪、九维对照实测/棘轮。invocation 决策只以 `workflows/project-customization/project-skill.md` 为准；frontmatter schema 与 runtime invocation 映射只以 `project-skills/_template/SKILL.template.md#生成约束` 为准，结果写入项目 Skill 注册记录。任一依赖缺失时停止并提示安装；Writing 未进入当前上下文时停止并请求用户显式调用，不用本地模板或摘要代替。普通项目 Skill 只通过 `DEPENDENCY_SKILLS.md` 发现；仅 always-on 安全或路由能力在根 `AGENTS.md` 留最小入口。

## 项目 override 协议

项目 override 只能补充：

- 项目事实源、路径、版本、命令和验收命令
- 适用条件、排除条件、风险检查和文档落点
- 输出语言、命名、格式和隐私边界
- 运行时差异、必需依赖和缺失时的停止/安装提示

override 不应复制或重写外部 Skill 的核心目标，也不能以“项目惯例”为理由降低安全、授权、验证、必需依赖或用户范围边界。

## 运行时中立性

技能路由必须描述 capability，不绑定单一 Agent、IDE、插件市场或安装路径。运行时相关能力在项目注册表中至少包含：

| 字段 | 内容 |
| --- | --- |
| required_dependency | 必需 Skill/policy/tool，例如 `$codemap` |
| source_scope | `global` / `global-agent` / `bundled` / `project` |
| version_policy | `floating-installed` / `pinned-revision` / `managed-global` / `kit-version` |
| missing_action | 全局依赖默认 `stop-and-install` 或 `stop-and-configure` |
| evidence | 如何证明依赖与能力真正运行 |
| last_verified | 最近核对日期与证据 |

`kit-version` 只用于 `source_scope=bundled`，表示能力随当前规则包的来源 revision 固定；策略名本身不是 revision 证据。登记时，源规则包工作树 clean 且有可解析 commit 才记录 commit；clean 且无 commit 时记录 release tag；dirty 或两者都不可用时按安装/修复/升级指南的规范算法记录可复算内容 SHA-256，并让 bundled capability 的 evidence 引用 `PROJECT_RULES.md` 的 `kit_revision` 字段。三者都不可得时，`last_verified` 必须保持 `UNVERIFIED`，该 bundled capability 不得标记为已验证。`evidence` 还必须包含实际 adapter/workflow 路径和场景验证证据。

用户只要求规则包来源 revision 判断时，用 A-E 紧凑矩阵逐项给出 `kit_revision` 与 `loadRuntimeTree(revision)` 动作：clean commit 记录 commit；clean 且 commit 不可用时记录 release tag；dirty 或 commit/tag 不可用时记录 `loadRuntimeTree(WORKTREE)` 逻辑树的规范化 `content-sha256:`；事务任一步失败保留旧 revision；内容缓存缺失的 `content-sha256:` 由 `loadRuntimeTree(revision)` 返回 `REVISION_UNRESOLVABLE`，安装流程进入 unknown-base 且不可伪造 base。表后只说明 revision 在全部写入与验证成功后更新，并用一条 hash 边界收口：只包含 manifest/legacy adapter 发出的逻辑 `AGENTS.md` 与 `.skills/**`，target 路径使用 `/` 并按 ordinal 排序；`manifest.hash.textExtensions` 命中的文本按 UTF-8 解码、去 BOM 并统一为 LF，其他文件保留原始字节；每个文件写成 `<file_sha256>  <target>\n` 记录，连接后再计算整体 SHA-256；`runtime-src/`、源根开发规则、manifest 和其他 source-only 文件不进入。完成标准不要求另造 revision 前缀、缓存/原子发布实现或无关证据清单。

不要把缺失 Skill 伪装成已执行，也不要用临时本地文件补齐。必需全局依赖无法加载时，记录事实、终止当前任务并告诉用户安装/配置后再恢复。

## 组合边界

- Grill 只提纯决策歧义，不替代 SDD 的 Spec、执行门禁或验证闭环。
- task tracking 记录持久状态，不替代 Spec 的合同真相源。
- task decomposition 定义子任务，不替代跨项目契约。
- `$codemap` 提供代码地形能力，不替代源码和验证；本地索引不替代 `$codemap`。
- `$karpathy-guidelines` 约束编码判断，不替代 SDD 阶段或项目事实；项目开发纪律不替代该 Skill。
- Matt 阶段能力只提供原型证据、条件 test-first 循环、困难缺陷诊断、冲突解决、深模块设计或领域建模，不组合成平行的 idea-to-ship Harness。
- 分支/PR Review、巨大模糊任务、任务拆解、Project Setup 和 handoff 继续使用 SDD 原生能力；显式架构体检的临时报告不能取代逻辑 Spec Record、CodeMap 或 task plan。
- 包内 `workflows/grill-me.md` 是现有代码库中的 SDD 需求提纯流程；全局 `$grill-me` 是无代码库的独立入口，不是其替代。
- project customization 维护长期项目配置，不接收一次性任务流水。
- `$new-chat-ready` 提供交接包，不替代项目长期知识库。
- 上级/全局官方文档 policy 提供第三方 API 证据，不替代项目锁定版本、内部封装、集成代码和项目 override。

## 失败处理

| 触发条件 | 必须动作 | 恢复条件 |
| --- | --- | --- |
| 必需全局 Skill 未安装、不可加载或版本不满足 | 立即停止当前任务，记录依赖名与触发原因，提示用户安装/更新 | 用户完成安装/更新并重新核对可用性 |
| 必需全局 policy/tool 未配置 | 立即停止当前任务，说明缺少的 policy/tool | 用户完成配置并提供可验证入口 |
| bundled workflow/adapter 路径不存在 | 停止写入并报告规则包损坏 | 修复或重新安装规则包；不临时创建替代 |
| Skill 说明与项目事实冲突 | 以项目事实源为准记录差异，不继续高影响执行 | 更新项目 override 或由用户裁决 |
| 多个 Skill 要求相互矛盾 | 按 `AGENTS.md` 优先级比较规则并停止高影响执行 | 用户或高优先级规则完成裁决 |
| Skill 输出过度扩张任务 | 回到当前 spec 的范围与验收，删除未授权子目标 | 输出重新收敛且通过 checkpoint |
| 项目 Skill 名称/capability 冲突 | 优先扩展现有 Skill 或使用 override | 冲突被唯一裁决后再创建/登记 |
