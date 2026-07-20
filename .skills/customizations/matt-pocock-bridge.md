# Matt Pocock 阶段能力桥接

本模块只把命中的 Matt Pocock 全局能力接入已加载的 SDD Harness，不建立第二套 idea-to-ship 流程。触发与必需依赖以 `../core/skill-coordination.md` 为准；命中后读取对应全局 Skill 全文，本文件只补充阶段、授权、回写和项目边界。

包内 `../workflows/grill-me.md` 是面向现有代码库的 SDD 需求提纯工作流。全局 `$grill-me` 是无代码库的独立访谈入口，不属于本桥接，也不能替代包内工作流。

## SDD 职责边界

- SDD 保持 Restate、Research 主线、Spec、任务拆解与状态、批准、Execute、三轴 Review、Bootstrap、handoff 编排和 Reverse Sync 的主流程所有权。
- 本桥接命中的 Matt 能力只补当前 SDD 阶段的专用算法、约束和证据；持久化仍服从已登记落点，不能覆盖逻辑 Spec Record、execution gate、Review 或项目 Git 边界。

## 阶段输入与输出

| capability | SDD 阶段 | 输入 | 输出与回写 |
| --- | --- | --- | --- |
| `prototype-evidence` | Research / optional Innovate | 单一待回答问题、现有代码约定、运行入口 | 原型运行证据写入 findings；获采纳结论写入 spec；原型保持 throwaway |
| `test-first` | Execute | 已批准行为、公共测试 seam、项目测试入口 | 每轮 red/green 证据与保留测试写入 progress；行为契约仍以 spec 为准 |
| `hard-bug-diagnosis` | Research；获准修复后进入 Execute / Review | 用户症状、环境证据、可运行复现入口 | red-capable 反馈循环、根因、回归证据和残余风险写入 findings/progress |
| `merge-conflict-resolution` | Execute / Review | Git 状态、双方原始意图、合并目标、项目验证命令 | 逐冲突裁决、验证结果和尚待授权的 Git 动作写入 progress |
| `deep-module-design` | Research / optional Innovate / Plan | CodeMap/源码、指定模块、调用方与现有接口 | 查询只在响应内给出候选 interface/seam 与取舍；持久任务写入 findings，获采纳决定进入 spec；不自动实施 |
| `domain-language` | Research / optional Innovate / Reverse Sync | 已登记领域词汇/ADR 路径、现有术语、代码证据与决策上下文 | 已确认术语或满足三项门槛的 ADR 写入登记落点；任务合同仍在 spec |
| `architecture-audit` | Research / optional Innovate | 用户显式调用、CodeMap/源码、热点、领域词汇和 ADR | 临时体检报告链接写入 findings；选中候选后仍回到 SDD Spec/Plan |

## 阶段边界

- `$prototype` 只回答一个设计问题。创建前必须通过项目 execution gate；捕获或提交 throwaway 分支仍服从项目 Git 与授权规则，验证结论进入正式 spec 后才能影响生产实现。
- `$tdd` 先确认公共测试 seam，再按“一项行为测试 -> 最小实现”推进。只有用户明确要求 TDD、test-first 或 red-green 才算显式触发；新增、维护或运行测试（包括集成测试）本身不算。未显式要求时，只有稳定行为 seam、非平凡逻辑或明显回归风险、低成本最小 red-green slice 三项同时成立才自主触发。机械修改、原型、无可靠 seam 或测试成本高于风险时使用 SDD 常规验证。
- `$diagnosing-bugs` 先建立已经运行且能命中用户症状的紧反馈循环，再提出和验证假设。纯诊断请求不自动授权修复；无法形成 red-capable 信号时停止推测并请求环境或捕获物。
- `$resolving-merge-conflicts` 先追溯双方意图，再保留兼容部分并裁决冲突。不得用破坏性重置代替解决；stage、commit、rebase continue 等状态变更只有在项目规则和用户授权允许时执行。
- `$codebase-design` 只在用户要设计或改善深模块、interface 或 seam 时加载；普通重构、Codemap 或 Review 不自动触发。查询任务只在响应内给出候选设计；持久任务先写 findings，获采纳后才进入 spec。
- `$domain-modeling` 只在术语含糊/冲突，或长期决策同时满足难逆转、无上下文会意外、存在真实取舍三项条件时加载。领域词汇只存术语，ADR 只存长期决策；两者都不能复制任务 spec、实现细节或执行时间线。落点未登记时先进入 project customization。
- `$improve-codebase-architecture` 只有用户显式调用后才加载。自然语言架构分析由 SDD Research 完成，只有 `../core/skill-coordination.md#codemap` 的触发信号成立时才追加 `$codemap`；不因未显式调用体检 Skill 而阻塞。临时报告只供选择候选，用户选定且 spec/门禁通过前不开始重构。

命中能力的持久任务结论回到当前 Spec Record：已验证事实进入 findings，已采纳合同进入 spec，执行与验证进入 progress；查询任务只在响应内保留证据、不确定性和候选结论。存在 implementation notes 时，偏差、取舍和未决问题同时按其规则记录。外部 Skill 不能覆盖 SDD 的阶段、spec、checkpoint、execution gate、Review、Reverse Sync 或项目 Git 边界。

## CHECKPOINT：调用阶段能力

调用前确认：触发信号和当前 SDD 阶段明确；对应全局 Skill 已登记、可加载且完整读取；项目 override 已核对；写入和 Git 动作已获所需授权；查询的响应内证据或持久任务的回写文件已确定。TDD 还必须确认测试 seam，自主触发时确认三项必要条件；诊断必须确认反馈循环目标；原型必须确认单一问题；冲突解决必须确认当前确有 merge/rebase 冲突；领域建模必须确认登记落点；架构体检必须确认用户已显式调用。

## 失败处理

| 触发条件 | 必须动作 | 恢复条件 |
| --- | --- | --- |
| 对应全局 Skill 缺失、不可加载或版本不满足 | 停止当前任务，点名依赖并提示安装/更新；不创建本地替代 | 依赖重新核验可用 |
| 原型问题不能收敛为单一可运行问题，或测试 seam 未确认 | 返回 Research/Plan 收紧问题或请求确认 | 问题或 seam 已明确 |
| 无法建立 red-capable 诊断循环 | 记录已尝试入口并请求环境、日志、trace 或授权的临时观测 | 获得可运行反馈信号 |
| 冲突双方意图无法兼容或来源不足 | 保留冲突状态，列出差异与影响并请求裁决 | 用户或权威事实源完成裁决 |
| 深模块问题或当前调用面不清 | 留在 Research，补源码/CodeMap 证据 | 模块、interface、seam 和调用方已定位 |
| 领域词汇/ADR 落点未登记或与现有事实源冲突 | 停止长期写入，进入 project customization | 唯一落点获批并登记 |
| 用户显式调用架构体检但 Skill 或其直接依赖缺失 | 停止体检，点名缺失项 | 依赖重新核验可用 |
| 外部 Skill 要求的自动 Git 动作超出项目授权 | 在状态变更前停止，只报告待执行动作 | 用户明确授权且项目规则允许 |

## 项目 override

项目专属的原型位置/运行入口、测试 seam、诊断环境、架构范围和冲突验证命令写入 `.skills/project/CUSTOM_SKILL_OVERRIDES.md`；领域词汇/ADR 的权威路径写入 `PROJECT_RULES.md#文档布局`，额外触发或格式才写 override；依赖状态写入 `.skills/project/DEPENDENCY_SKILLS.md`。override 不能复制外部 Skill 正文、放宽必需依赖、跳过 SDD 门禁或扩张 Git 授权。

## 反模式

- 把 Matt 能力串成每个任务都要执行的固定流水线
- 用原型直接替代生产实现，或把未验证观察写成 spec 事实
- 把“新增、维护或运行集成测试”当作显式 TDD，或在三项自主条件不齐时强制 TDD
- 没有 red-capable 反馈循环就开始猜测根因
- 把普通 Git 操作当作冲突解决，或让外部 Skill 自动提交越过授权
- Codemap 一结束就自动运行架构体检/重构，或把临时 HTML 当成已采纳方案
- 把领域词汇、ADR、架构报告或外部 issue 当作第二份 Spec/Plan 真相源
- 自动转入 Matt Review、Wayfinder、Setup、handoff、`$implement` 或 `$to-spec`
- 用全局 `$grill-me` 替换包内 `workflows/grill-me.md`
