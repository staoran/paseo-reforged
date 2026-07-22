# 规则包质量检查表

本文件用于安装、发布或修改规则包后的只读验收，不参与普通工程任务路由。检查结果应引用实际文件和命令证据，不把历史评分当作当前结论。

## 可移植性

- [ ] 运行包不包含来源项目名称、绝对路径、业务术语、框架版本、环境地址或命令。
- [ ] 项目事实只出现在 `.skills/project/` 的 Project Setup 文件、模板或目标项目填写内容中。
- [ ] 运行规则不绑定单一 Agent、IDE、插件市场或技能安装目录。
- [ ] 运行时特定能力在 `DEPENDENCY_SKILLS.md` 登记 required dependency、source scope、version policy、missing action、evidence 和 last verified。
- [ ] 安装/修复/升级目标记录 `PROJECT_RULES.md` 的 `kit_revision` 字段；源根开发 `AGENTS.md`/`.skills`、`runtime-src/` 物理目录名、manifest、`maintenance/` 与根安装资料不进入目标 runtime。
- [ ] source 工作树 clean 且有 commit 时记录 commit；clean 无 commit 时才使用 release tag；dirty 或两者都不可用时记录规范化 content hash，不把 dirty `HEAD` 伪称完整 revision。
- [ ] source new/base 只由 `loadRuntimeTree(revision)` 产生；manifest 存在但无效时停止，不静默回退 legacy；历史 revision 只有 manifest 缺失时才使用已登记 adapter；无缓存的 `content-sha256:` 按 unknown-base 处理。

## 路由一致性

- [ ] `AGENTS.md`、`INDEX.md`、`operating-model.md` 与工作流对任务深度和触发条件的定义一致。
- [ ] 会话入口先完成任务分类，再选择 `project-setup-lite` 或 Full Project Setup；规则包 install/merge/repair/upgrade 使用独立安装 checkpoint。
- [ ] 四种安装 mode：`fresh`、`repair-partial`、`upgrade-existing-kit`、`merge-existing-agents` 按明确优先级互斥选择；“可识别本包残留”有入口文件证据，同名但不可识别为本包的规则目录不误判 partial，已有根 `AGENTS.md` 不掩盖更具体的 partial/upgrade 状态。
- [ ] 用户只要求多分支 Installation 判断时，用一张紧凑表逐项给出唯一 mode、`new`/`base` 来源和第一轮 checkpoint。`repair-partial` 的 revision 格式有效且 base 可取得时使用 `base/target/new` 只修复三方证据可证明的缺失或断链；revision 缺失、无效或 base 不可得时进入 unknown-base，不自动替换或删除。题目把“可识别残留/断链”和“无效/缺失 revision”合在同一分支时，该行必须在同一个 `repair-partial` mode 内同时列出上述可解析 base 与 unknown-base 两种处理，不能因后一条件而吞掉前一条件。第一轮保持只读并列出 source/new/base、manifest ownership、逐文件动作、冲突、回退、验证和拟记录 revision；install-only 逐项标记“并行工程任务=`N/A`、operating-model 工程任务分类/任务深度=`N/A`、Project Setup=`N/A`、项目类型/事实=`N/A`、capability/依赖注册快照=`N/A`”。
- [ ] 仅部署规则包时将工程任务分类与 Project Setup 明确记为 `N/A`，不伪造 operating-model 任务深度，不收集项目类型、项目事实或 capability 快照；`install-only` 只能作范围说明。
- [ ] 内部分类、依赖、初始化、spec、checkpoint 和恢复门禁照常执行；默认用户响应只给当前决定、下一步、真实阻塞和必要证据，不主动展开 Harness 名称、完整阶段链、持久文件清单或未命中能力枚举。
- [ ] 核心能力语义只在 `core/skill-coordination.md` 维护；注册表模板只保存 canonical route 解析后的项目快照，冲突时同步 route 而不作为 override。
- [ ] 全局 Skill 的 frontmatter description/关键词只用于发现候选，不得绕过 `core/skill-coordination.md` 的 canonical route；description 更宽或运行时无法执行排除条件时标记 route-incompatible 并停止配置。
- [ ] 查询、`zero`、`micro`、`standard`、`complex`、`cross` 全部进入 SDD 核心 Harness；深度只裁剪产物和门禁，没有旁路关闭 Restate、证据、Review 或收口。
- [ ] 所有工程任务保留 SDD 核心闭环；只有分类证据、目标/边界、适用规则、事实源和验证入口均明确且无重型信号的查询/`zero` 可跳过外部 SDD Skill，`micro` 及以上、重型信号和绕过条件失效时分别加载 canonical light/one。
- [ ] SDD 外部 Skill 的已加载、user-invoked 未附加、确认缺失和安装状态不可核验场景均符合 canonical 恢复合同；不可见未被断言为未安装，heavy 未降级为 light 或 bundled 替代。
- [ ] 编码、重构和代码 Review 显式调用 `$karpathy-guidelines`；缺失时停止并提示安装，`core/development-discipline.md` 只作同时生效的项目基线且未复制 Skill 全文。
- [ ] `$prototype`、`$tdd`、`$diagnosing-bugs` 与 `$resolving-merge-conflicts` 只在精确信号命中时接入 SDD 阶段；四者不重建 idea-to-ship Harness，不复制全局 Skill 正文。
- [ ] 原型受 execution gate 约束；TDD 先确认公共 seam，只有用户明确要求 TDD、test-first 或 red-green 才算显式触发，新增、维护或运行测试（包括集成测试）本身不算；未显式要求时只有稳定行为 seam、非平凡逻辑/明显回归风险和低成本最小 red-green slice 同时成立才自主触发；困难缺陷先建立 red-capable 反馈循环；冲突解决先追溯双方意图；外部 Skill 的 Git 动作不越过项目授权。
- [ ] branch/PR/WIP/fixed-point Review 全部选择 `$sdd-riper-one` 的三轴 Review 并调用 Karpathy，不自动调用 Matt `$code-review` 或建立第二套 Review 状态。
- [ ] 巨大且仍有决策迷雾的任务继续使用 `$sdd-riper-one`、bundled Grill、tracking 与 decomposition，不自动调用 `$wayfinder` 或建立 tracker 状态机。
- [ ] 深模块/interface/seam 定向设计调用 `$codebase-design`；术语冲突或满足三项门槛的 ADR 调用 `$domain-modeling`，且只写登记落点；体检只在用户显式调用 `$improve-codebase-architecture` 后运行；自然语言架构分析使用 SDD Research，只有 Codemap 信号成立时才追加 `$codemap`；临时报告不自动授权重构。
- [ ] Project Setup、后续项目配置与 handoff 分别由本规则包 Project Setup/project customization 和 `$new-chat-ready` 负责，不自动调用 Matt Setup 或 Matt handoff。
- [ ] Matt main flow 的 grilling、research、wayfinder、to-spec、to-tickets、implement、code-review、handoff、setup 与 triage 均不进入自动路由；用户显式调用时仍服从 SDD 真相源和授权边界。
- [ ] 用户显式调用 `$codemap` 或要求创建/更新/检查项目总图、功能地形图、CodeMap/MAP、drift-check 时直接命中；其他情况只由 SDD Research/Pre-Research 或 Review drift 信号调用。查询任务只返回响应内源码证据、地形或 drift 结论，持久任务获授权且落点明确后才更新 CodeMap 与 `CODEMAP_INDEX.md`。
- [ ] 普通局部任务不全量加载项目长期知识；new chat 恢复、debug/重复故障、关键链路和跨任务共享决策按登记落点读取相关项目知识，并以当前源码与验证为最终事实源。
- [ ] 委派不转移主任务对范围/方案裁决、冲突处理、结果整合和最终验证的责任；共享写入点有唯一负责人，子任务自报完成不直接成为最终结论。
- [ ] 第三方文档的触发和工具步骤只由当前生效的上级/全局 policy 持有；项目层只登记锁定版本、内部封装、允许来源、missing action 和 evidence，依赖缺失时停止且包内不存在重复查询 workflow。
- [ ] `PROJECT_RULES` 类型枚举、`AGENTS.md` 类型路由、`INDEX.md` 和 `types/` 实际文件一致；组合类型只为真实存在的代码层启用。
- [ ] 包内 Grill 只处理 `complex/cross` 中会改变方案、范围、契约或验收的歧义；`standard` 不启动完整 Grill，存在此类歧义时先升级为 `complex`；可调查事实先调查，且不被面向无代码库的全局 `$grill-me` 替代。
- [ ] `micro`、`standard`、`complex`、`observe-only`、`cross-lite`、`cross-full` 的最小产物和门禁没有冲突。
- [ ] `sdd-riper` 与 `cross-project` 不可被配置静默关闭；替代流程有等价输入、门禁、验证和回写。
- [ ] canonical route 命中但注册表缺少快照时标记 registry drift 并停止该 capability，不把缺行当作可用。

## 资源与模板

- [ ] runtime 包中的所有显式 Markdown 路径均能解析到现存文件；`maintenance/` 历史报告属于源目录证据，不纳入 runtime 路径扫描。
- [ ] `runtime-manifest.json#ownership` 唯一定义 bundled、mixed、project-owned 和 conflict 路径；`ASSEMBLY_GUIDE.md` 只解释类别动作，未命中规则的 target-only 路径保守标记 conflict，上游删除只对未本地修改的 bundled 文件执行。
- [ ] 上游删除 mixed 路径时保留 target 并等待替代契约裁决；新增 bundled 路径只有在 target 不存在时才 create，同路径碰撞标记 conflict。
- [ ] `.skills/audits/` 不包含带分支、commit、模型或环境细节的历史发布报告；此类证据只放在 `maintenance/`。
- [ ] 全包不存在对已删除本地 Context7 查询 workflow 的路径引用。
- [ ] Markdown 表格的表头、分隔行和样例行列数一致。
- [ ] 未填写的项目事实占位符只存在于模板或 Project Setup 文件，不会被误认为真实事实。通用规则仅允许 `<name>`、`<type>`、`<path>`、`<id>` 及其明确命名变体作为路径/schema 元变量，且同一段必须说明其含义；其他未解释的尖括号占位符视为失败。
- [ ] 工作流直接引用其首选模板；模板命名与 `PROJECT_RULES.md` schema 一致。
- [ ] 任务模板遵守单一事实源：tracked Spec 无执行结果，task plan 无合同或下一步正文，findings 无普通执行时间线，progress 独占执行/验证/实际同步，task index 无权威操作状态且派生生命周期摘要带来源锚点，handoff 只有身份与恢复锚点。
- [ ] `task_index_mode=required` 时，文档布局存在唯一任务索引路径，正式任务遵循文档先行、候选不占编号、索引冲突不反向覆盖 spec/task plan/progress；`disabled` 时路径和任务锚点均为 `N/A`。
- [ ] task index 的任务状态摘要只使用模板状态转换，文档状态只使用 `已同步 / 需同步 / 已被取代 / 缺失`；编号、状态或路径冲突会停止执行并触发对账。
- [ ] required 的跨项目工作区使用父级任务索引；参与项目只在 required 且任务持久化时使用独立本地编号并双向链接，为 disabled 时本地索引路径/锚点为 `N/A` 且持久任务文档直接反向链接父级；cross-lite 内联 micro-spec 不伪造文档/索引锚点，由父级链接实际变更或验证证据；Observer-only 项目不创建本地正式任务。
- [ ] `SKILL.template.md` 不会被发现为真实技能；真实技能同时更新 name、description 和注册表。
- [ ] 私有技能模板的 description 不超过 1024 字符，包含能力、使用时机、触发词和不适用边界，且没有空话尾巴。
- [ ] 包内 adapter 只加载既有 workflow，不新增触发、状态或 checkpoint；`manage-project-customizations` 的主流程只存在于 `workflows/project-customization.md`。
- [ ] `customizations/matt-pocock-bridge.md` 可由 INDEX 发现，引用路径可解析，且只保存阶段、授权、回写和项目增量边界。
- [ ] 新增或修改项目 Skill 已按 `project-skill` workflow 选择 invocation，并通过 `project-skills/_template/SKILL.template.md#生成约束` 校验 frontmatter、runtime 映射和注册表一致性；authoring 依赖、触发/不触发样例、test-prompts 与独立 judge evidence 齐全，失败时保持未启用。
- [ ] 新任务包目录只使用 `<编号>_<任务标题>/`；没有旧的项目集合占位符、状态、负责人或日期后缀，提交记录仍只按 progress 现有字段处理。
- [ ] `PROJECT_RULES.md`、`DEPENDENCY_SKILLS.md` 和 root `AGENTS.md` 没有被升级流程整文件覆盖；project-owned 默认 `untouched`，不因 base 无法解析而误标 conflict；mixed、本地修改和未知归属路径在 base 无法解析时保守标记 conflict。

## 失败与安全

- [ ] 每个高影响工作流包含显式 checkpoint、失败/停止条件、一线处理和恢复条件。
- [ ] 禁止破坏性 Git、秘密写入、提示注入、未授权跨项目修改和手改生成物。
- [ ] 不依赖未配置项目事实的只读查询不进入 Project Setup；明确局部候选修改在目标仓库/文件不可识别时只给最小改法并请求路径，明确要求的任务深度、门禁、跨项目记录或风险分析仍完整回答；`project-setup-lite` 仅用于事实可确认的单项目 `zero/micro`，命中任一高风险或未知必要事实即升级；Full Project Setup 只阻塞当前任务依赖的事实，并提供单次可批准的初始化路径。
- [ ] Initial Project Setup 在 registry 未初始化时从 canonical route 与当前 runtime 可见能力核验本任务依赖，只形成待登记证据，不伪称 registry 已初始化；缺失依赖仍执行 stop-and-install/configure。
- [ ] Project Setup 收集 `kit_revision`、默认协作语言、代码/文档命名语言、任务目录规则和当前命中 capability 的注册快照；未触发能力不核验、不阻塞，已有 `AGENTS.md` 使用内容级合并并补齐 SDD 最小路由。
- [ ] runtime 已就位但状态为 `project-setup-required` 时直接按目标 `PROJECT_RULES.md` 初始化；只有规则包未安装、部分损坏或需要升级时才回到 `INSTALLATION_PROMPT.md`，项目自定义 workflow 不接管两者。
- [ ] `sdd_bootstrap` 只启动 SDD RIPER Research，不进入或触发 Project Setup；通用旧名称只允许出现在 `ASSEMBLY_GUIDE.md` 的 legacy 映射区块和历史 `maintenance/` 证据中。
- [ ] 领域词汇或 ADR 写入前已通过 project customization 登记唯一落点；两者不覆盖 SDD 路由、spec、project knowledge、critical context 或既有项目事实源。
- [ ] 项目自定义第一轮只读，提案包含唯一 mode、权威落点、精确动作、冲突、必需依赖、missing action、evidence 和 checkpoint；未批准不写长期文件。
- [ ] 分别验证：lite 任一前置条件无法证明、执行中升级为 standard/cross、后置发现契约/权限/数据/迁移风险时，都会停止并切换 Full Project Setup。
- [ ] 无法验证时记录阻塞、替代证据和残余风险，不伪称通过。

## 情景回归

- [ ] 评测分层保持独立：静态/安装门禁验证规则包完整性，package behavior paired regression 验证整个 Kit 的 with-kit/no-kit 行为，Darwin 九维只评价单个 `SKILL.md`；三层分数不合并为一个总分。
- [ ] 按 `installation-scenarios.json` 覆盖 fresh、已有独立规则合并、未知 base 的部分修复、带新增/修改/删除/路径碰撞/本地冲突的 `upgrade-existing-kit`、revision 来源矩阵和安装后 Project Setup 分流。
- [ ] 安装场景证明源根开发规则不会被复制或当作目标事实；WORKTREE manifest 产生 new，历史 manifest/legacy adapter 产生 base，materialize 后只出现逻辑 `AGENTS.md` 与 `.skills/**`。
- [ ] 按 `paired-baseline-prompts.json` 用 fresh with-kit/no-kit 上下文运行十三组 Prompt；每组至少两轮，必要时第三轮；由两名 fresh 盲评者交换候选顺序评分；分别记录 core、installation-initialization、routing-context、overall package score、paired preference、negative transfer、无效样本和重试，不复用历史 transcript。
- [ ] Package behavior paired 作为正式发布门禁时，要求 13 个 Prompt 按重复策略完整执行、有效 with-kit 候选由两名 Judge 完整覆盖、任一 Judge 报告的 with-kit hard-gate failure 为 0、core with-kit package score >7.65、installation-initialization >=9.70、routing-context >=9.65、无 unanimous no-kit preference；no-kit hard-gate failure 只记录为 baseline 诊断。
- [ ] 只有编码损坏、进程/基础设施失败、空输出或不可解析输出可标记为无效样本；遗漏必需分支、违反 read-only 或其他行为 hard gate 是有效失败，必须保留并进入发布门禁，不能通过重跑消除。
- [ ] 五维权重 `25/25/25/15/10` 只用于加权比较和诊断；installation/routing 阈值分别由两个已接受状态的低值向下取整到 `0.05` 得到 `9.70/9.65`，overall 和 aggregate delta 不设发布阈值。
- [ ] CI 使用 `node maintenance/tasks/20260720_global-agents-alignment/aggregate-evals.mjs --release-verdict`；GO 必须退出 `0`，缺场景/轮次、需 r3 未补、阈值失败、任一 with-kit hard gate 或 unanimous no-kit 必须输出 `NO-GO` 并非零退出；Judge 分歧不自动豁免。
- [ ] 明确单文件修复走 `micro`；满足条件时使用 `project-setup-lite`，不等待 Full Project Setup，不启动 Grill，也不强制独立 spec 文件或任务四件套。空值 guard 回归区分目标空值、正常值和合法 falsy 值。
- [ ] 含关键歧义的高风险重构判为 `complex` 并启用 tracking，在 SDD 内走 `Research -> Grill -> Plan`；未决决策前不进入 Execute。
- [ ] 零参与项目的纯调查走 `observe-only`；一至两个参与项目只有稳定与低风险证据齐全时走 `cross-lite`，风险未知或 breaking、迁移、多阶段、并行时走 `cross-full`；三个以上参与项目直接走 `cross-full`。
- [ ] 多项目父级在读取 bundled cross workflow 前完整加载全局 `$sdd-riper-one`；缺失时停止并提示安装，不把父级模板或 bundled 文件当成本地 Harness。
- [ ] 未受影响 Observer 只记录证据，不创建施工 spec 或默认修改。
- [ ] Observer 证明记录检查基线 commit/tag、只读命令/查询、结果/退出码，以及版本控制可用时的前后工作树状态；证据不可定位时不得标记 `validated`。
- [ ] 只读观察项目不计入 `cross-lite/full` 的参与项目数量；观察中确认受影响时升级为参与项目并重新判定深度。
- [ ] 长任务、交接和并行任务分别命中 tracking、handoff 和 cross-task collaboration。
- [ ] task index 场景覆盖 required/disabled、持久化与内联 micro-spec、候选不占编号、正式任务文档先行、索引漂移以 spec/task plan/progress 为准，以及跨项目父 required/子 disabled、独立编号、文档或证据链接和 Observer-only 边界。
- [ ] 桌面 GUI 工具命中 `desktop`；嵌入式 Web UI 或独立本地 HTTP/RPC 服务按证据追加 `frontend`/`backend`；普通后台 worker 不误触发 `backend`，纯 CLI 不误用 `desktop`。
- [ ] 项目 Skill 创建场景走 `project-skill` 并完成创建/登记/验证；一次性任务事实不误触发项目自定义。
- [ ] 语言/命名/任务模板走 `project-rules`；依赖能力和 override 分别落到注册表与增量文件；项目知识、关键上下文和 Codemap 各自只有一个权威落点。
- [ ] Codemap 场景分别覆盖“显式项目总图请求直接命中”“陌生跨模块需创建/读取”“无显式意图且小范围地形清楚不生成”“存在相关地图且结构变化后 drift-check”“无既有地图时不执行 drift-check、重新选择 feature/project 或跳过”五条分支。
- [ ] 项目知识场景覆盖“普通局部不全量加载”“new chat 恢复活动任务后按需补长期知识”“debug/重复故障读取相关关键上下文”“跨任务共享决策读取主合同与相关知识”。
- [ ] 委派场景确认主任务保留范围/方案裁决、结果整合和最终验证，执行者可以实施但不能替代完成裁决。
- [ ] 需要可运行设计证据且已获写入批准时命中 `$prototype`；纸面可回答的问题、生产实现请求和普通小改不误触发。
- [ ] TDD 边界依次覆盖：明确要求 TDD/test-first/red-green 时命中并先确认公共 seam；三项自主条件齐全时自主命中并先确认 seam；机械修改、原型、无可靠 seam 或测试成本高于风险时不命中；只新增、维护或运行现有集成测试且未要求 test-first 时不因“集成测试”一词误触发。评分不得因省略必需 seam 门禁而奖励更短答案。
- [ ] 困难/间歇性缺陷、性能回归或首轮定位失败命中 `$diagnosing-bugs`；没有 red-capable 信号时停止推测，明确简单修复不强制升级。
- [ ] 只有已存在 merge/rebase 冲突且用户要求解决时命中 `$resolving-merge-conflicts`；普通 Git 操作不误触发，未授权 stage/commit/continue 不执行。
- [ ] 分别模拟 Prototype、TDD、Diagnosing Bugs 与 Resolving Merge Conflicts 缺失；每条均停止当前任务、点名依赖并提示安装，没有生成本地替代文件。
- [ ] 用户要求从 fixed point、branch、PR 或 WIP 审查非空 diff 时选择 `$sdd-riper-one` 并由其三轴 Review 裁决；不自动调用 `$code-review`，fixed point 仅作为 SDD Review 输入。
- [ ] 巨大多会话且路径不可见时命中 `$sdd-riper-one`、Grill、tracking/decomposition；不自动调用 `$wayfinder`，也不创建 Matt map/ticket/frontier。
- [ ] 用户请求 interface/seam 定向设计时命中 `$codebase-design`，查询只在响应内给候选、持久任务才写 findings；术语冲突或满足三项门槛的 ADR 命中 `$domain-modeling`；自然语言架构分析走 SDD Research，只在 Codemap 信号成立时追加 `$codemap`；只有用户显式调用 `$improve-codebase-architecture` 才生成临时体检报告，普通 Codemap、重构或 Review 不自动生成 HTML/启动重构。
- [ ] Initial Project Setup、已有 AGENTS 合并、依赖登记和文档布局只使用本规则包 Project Setup/project customization；不自动调用 `$setup-matt-pocock-skills`，领域词汇/ADR 未配置时只阻塞对应长期写入，不阻塞普通 Codemap。
- [ ] Matt `$grilling`、`$research`、`$wayfinder`、`$to-spec`、`$to-tickets`、`$implement`、`$code-review`、`$handoff`、`$setup-matt-pocock-skills` 与 `$triage` 均不进入自动路由；分别由 SDD/bundled owner 持有唯一职责。
- [ ] 分别模拟 Codebase Design、Domain Modeling、Improve Codebase Architecture 及其直接依赖缺失；命中的必需能力会停止并点名安装/配置要求，不生成本地替代。
- [ ] 分别模拟 SDD、Karpathy、Codemap、第三方文档、Skill Creator、Writing Great Skills、Darwin、new-chat-ready 缺失；命中的必需依赖均停止并提示安装/配置，没有生成本地替代。外部 SDD Skill 缺失不阻塞满足全部绕过条件的查询/`zero`，但绕过条件失效后必须停止并加载 canonical light/one。

## 结果记录

记录检查日期、运行范围、失败项、证据、未执行项和剩余风险；将证据标记为 `executed`、`static-contract`、`N/A` 或 `not-executed`。评分工具的权重、归一化方式、重复策略、无效样本和测试模式必须显式说明。
