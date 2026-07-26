# Fork 改进与主线覆盖总控 Spec

## 0. 任务状态

- Task ID: `0002`
- Spec Type: `Project Spec`（改进移植总控，不承载单项实现）
- Lifecycle: `Active Baseline`
- Phase: `Research`
- Approval Status: `LOCKED`
- Baseline Date: `2026-07-22`
- Last Sync Date: `2026-07-26`
- Execution Gate: 父总控默认保持 `LOCKED`；`M-22/0008` 已单独取得 Plan、完成 P1 修复与精确暂存审查。用户明确延后 Linux/CI Playwright，当前 17 条路径在 Windows 主场景证据下可提交；`P-02/0007` 已单独取得 Plan，完成 Codex-only 本地实现、三个提交前 P1 修复与最终 Review，Windows E2E 留给 Linux/CI；commit 与 push 未授权。
- Child Spec Rule: 从总表选择功能后，必须建立独立 Feature Spec，重新核验届时主线，并单独取得精确 `Plan Approved`。
- Spec Record:
  - Contract: `SPEC.md`
  - Evidence: `findings.md`
  - Timeline: `progress.md`
  - Current State: `N/A`（本轮是单阶段文档汇总，不创建伪造的实施 task plan）

## 1. 目标与边界

### 1.1 最终目标

把当前会话中对 fork `E:\Code\paseo-reclaude` 改进与主线 `E:\Code\paseo` 的全部审计结论，归并为一份状态互斥、证据可追溯、建议清晰、可持续复核的总控基准。后续从本表按 ID 选择能力，生成范围更小、可独立批准和验收的 Feature Spec。

### 1.2 当前任务单元

只完成总表、状态词典、路线图、依赖约束和子 Spec 抽取合同；不实施任何功能，不修改现有 CodeMap，不改变 fork 或主线产品代码。

### 1.3 In Scope

- 汇总会话 `019f7591-ff12-7680-8bc7-5746403562b8` 的 15 项 fork 净成果。
- 汇总会话 `019f75a9-6c2a-7b73-b31d-70b114e243da` 的 15 个改进大类及 22 个定向引入功能。
- 吸收本会话后续对比、上游更新复核、P0/P1/P2 路线图和纠错结论。
- 对每项记录当前主线实现、精确状态、剩余差距、最近更新影响、移植建议、优先级、收益、成本、实施边界、验收方向和证据编号。
- 定义后续子 Spec 的抽取、复核和反向同步规则。

### 1.4 Out of Scope

- 不把 fork 的提交数直接当成功能数；重复、回退、merge 和产品化改动按净成果归并。
- 不为任何条目编写实现代码、迁移脚本、协议 schema 或测试。
- 不自动 cherry-pick fork 提交。
- 不更新 `mydocs/codemap/` 或 `.skills/project/CODEMAP_INDEX.md`。
- 不 stage、commit、push、fetch、改 remote 或重启端口 `6767` 的主 daemon。
- 不替用户决定私有 Provider、完整 SSH 客户端、任意 TCP tunnel 或 fork 品牌是否进入 Paseo 产品路线。

## 2. Done Contract

本总 Spec 完成需要同时满足：

1. 每个归并后的能力只属于 `COVERED`、`PARTIAL`、`MISSING`、`STRATEGY/N/A` 四组之一。
2. “当前覆盖状态”和“是否建议移植”是两个独立维度；缺失不自动等于建议移植，已覆盖不再进入实施路线。
3. P0/P1/P2 与既有路线图一致；新发现但未进入既有路线的条目标为候选或条件性，不静默改写优先级。
4. Git 提交历史、面板提交数、同步按钮 ahead/behind 数和 submodule diff 分开记录。
5. HTTP/WebSocket Service Proxy 与任意 TCP tunnel 分开记录，不把相邻能力误判为功能等价。
6. 每个建议项都有收益、成本、实施边界和验收方向，可直接作为子 Spec Research 的输入。
7. 当前主线和 fork 基线、来源会话、报告与源码证据可从 `findings.md` 追溯。
8. 本轮只产生任务文档，不修改产品代码或其他任务记录。

## 3. 基线与统计口径

| 项目                 | 基线                                                             |
| -------------------- | ---------------------------------------------------------------- |
| 全量总表审计 HEAD    | `679d7131f7afcf4b11fba7a927dd579ac014f83c`                       |
| 标题专项复核 HEAD    | `045dd0cc6d06f6deafb3be5b9bd7f92abd8e10fb`                       |
| M-22 专项复核 HEAD   | `084dca00b7bff618b09458082d878decfdd40918`                       |
| 当前 `origin/main`   | `b64f4f35784876021268583b1736ad951495946c`                       |
| 当前 `upstream/main` | `65633004b23d6eeeda9321e04f096ca647694b2b`                       |
| 上次复核上游         | `0c68b26a8ba3f50f44ee4a1406a57ff4e61b1fc1`                       |
| 最近上游窗口         | `0c68b26a..b2139b14`，26 个提交、25 个非 merge                   |
| 当前主线版本         | `0.2.0-beta.5`                                                   |
| fork HEAD            | `6fb48efdf6eb8daef33d9a818b074d75fa61b39d`                       |
| fork 审计版本        | `0.1.128`                                                        |
| 共同历史基线         | `557fc42c890b8badcb60249fd0b30a2396f2b112`                       |
| 当前状态关系         | 本地相对 `origin/main` ahead 1；`084dca00b` 是 M-21 本地实现提交 |

本表采用“用户可感知能力/工程结果”粒度，共归并为 64 行。该数量不能与原始 15 项净成果、15 个大类或提交数直接相加比较。

## 4. 状态与决策词典

| 字段   | 可选值         | 含义                                                                                      |
| ------ | -------------- | ----------------------------------------------------------------------------------------- |
| 主状态 | `COVERED`      | 主线已完整满足目标，允许实现不同                                                          |
| 主状态 | `PARTIAL`      | 主线已有基座或相邻能力，但仍缺明确用户语义                                                |
| 主状态 | `MISSING`      | 目标能力当前不存在或没有可用入口                                                          |
| 主状态 | `STRATEGY/N/A` | fork 产品身份、私有集成、维护动作或策略差异，不视为主线缺陷                               |
| 建议   | `是`           | 当前证据支持进入候选路线                                                                  |
| 建议   | `条件性`       | 仅在复现、API 稳定、用户需求或产品边界成立时进入路线                                      |
| 建议   | `否`           | 已覆盖，无需移植                                                                          |
| 建议   | `不建议`       | 精确能力虽缺，但不符合当前产品边界或维护收益                                              |
| 成本   | `XS/S/M/L/XL`  | `<1 天 / 1-2 天 / 3-5 天 / 1-2 周 / 超过 2 周或产品域级` 的单人粗估；子 Spec 必须重新估算 |

## 5. 总览

| 状态组         | 数量 | 直接建议 | 条件性 | 否/不建议 | 处理原则                               |
| -------------- | ---: | -------: | -----: | --------: | -------------------------------------- |
| `COVERED`      |   23 |        0 |      0 |        23 | 不建迁移任务；只在回归时复核           |
| `PARTIAL`      |   10 |        6 |      3 |         1 | 精确描述缺口，禁止以相邻能力宣称完成   |
| `MISSING`      |   22 |       14 |      7 |         1 | 先按价值和边界筛选，再建立子 Spec      |
| `STRATEGY/N/A` |    9 |        0 |      0 |         9 | 不进入默认路线；产品决策变化后重新分类 |
| 合计           |   64 |       20 |     10 |        34 | 本表是选择池，不是自动执行队列         |

### 5.1 最近上游更新影响

| 上游提交/能力                                       | 相关总表项             | 结论                                                            |
| --------------------------------------------------- | ---------------------- | --------------------------------------------------------------- |
| `4bda2dfea` Web 文件编辑与实时订阅                  | `P-01`、`M-05`、`M-06` | 增强文件基座，但未覆盖首次读取门禁、每回合修改文件或搜索        |
| `07d988488`、`b2139b140` timeline 完整性/catch-up   | `P-03`、`M-04`         | 数据完整性更好，不等于全文搜索或最终答案语义投影                |
| `2ead7e771` 听写快捷键                              | `P-04`                 | 修复交互，不增加 SenseVoice 或模型选择                          |
| `d0456b194` host replica 生命周期                   | `P-05`、`P-06`、`P-07` | 不是 Prompt、草稿、模型偏好或 layout 的 LWW 同步                |
| `9292f5889`、`8aa55db1e` workspace service 端口控制 | `P-10`                 | 常见 HTTP/WebSocket dev service 获得替代方案；任意 TCP 语义仍缺 |
| `aa6384bab` 首个 workspace 前项目重命名             | `C-23`                 | 关闭旧审计中的项目重命名预填缺口                                |

最近 26 个上游提交没有使既有 P0/P1/P2 条目从 `PARTIAL/MISSING` 升级为 `COVERED`，路线优先级不变。

## 6. `COVERED`：已覆盖或等价覆盖

| ID   | fork 改进/目标                                                          | 来源/代表提交                              | 当前主线实现                                                      | 状态细分             | 最近更新              | 对比结论                                                      | 移植建议 | 优先级 | 收益   | 成本 | 实施/验收边界                            | 证据     |
| ---- | ----------------------------------------------------------------------- | ------------------------------------------ | ----------------------------------------------------------------- | -------------------- | --------------------- | ------------------------------------------------------------- | -------- | ------ | ------ | ---- | ---------------------------------------- | -------- |
| C-01 | 官方中文化与多语言 i18n                                                 | yun_er 中文化大类                          | 正式 `zh-CN` 与统一 i18n 资源                                     | `COVERED_NATIVE`     | 无变化                | 主线方案更适合作为长期事实源                                  | 否       | -      | 已实现 | 0    | 仅做回归，不移植 fork 早期迁移层         | E16      |
| C-02 | Fable 5、Sonnet 5、Grok Build 等模型/Provider                           | yun_er Provider 大类                       | 主线模型 manifest 与 ACP Provider 已具备                          | `COVERED_NATIVE`     | 无变化                | 通用能力已存在                                                | 否       | -      | 已实现 | 0    | 新模型按主线 manifest 扩展               | E16      |
| C-03 | 通用 ACP/custom provider command override                               | yun_er Provider 大类                       | 主线自定义 Provider 与 ACP 命令配置                               | `COVERED_EQUIVALENT` | 无变化                | 不需要 fork 同 Provider 切换层                                | 否       | -      | 已实现 | 0    | 保持主线 Provider 边界                   | E16      |
| C-04 | 多 Provider quota/用量面板                                              | yun_er、定向上游功能                       | 主线 quota fetcher 与统一设置 UI                                  | `COVERED_NATIVE`     | 无变化                | 多 Provider 用量目标已覆盖                                    | 否       | -      | 已实现 | 0    | 私有 Provider 另见 `X-04`                | E16      |
| C-05 | 编码、中文、Windows/POSIX、行列号文件路径解析                           | staoran `872c59f1`、`75b2c7e1`             | `assistant-file-links/parse.ts` 等解析链                          | `COVERED_CORE`       | 无变化                | 结构化路径识别已覆盖；裸正文扫描另见 `M-02`                   | 否       | -      | 已实现 | 0    | 不重复实现 parser                        | E03      |
| C-06 | 当前项目范围的 Provider Session 导入                                    | staoran `630936e0`、`159cb94e`、`f78d5159` | `runInImportWorkspace` 与 workspace/cwd 作用域                    | `COVERED_NATIVE`     | 无变化                | 导入所有权和范围已覆盖                                        | 否       | -      | 已实现 | 0    | 保持 `workspaceId` 所有权                | E15      |
| C-07 | 新建/重命名 workspace 的显式标题模型与侧栏呈现                          | staoran 标题系列提交                       | title 持久化、descriptor resolved `name`、重命名与首 prompt 标题  | `COVERED_NATIVE`     | 本轮收窄原误判        | 新建链路已有 server 回归；导入标题不属于本项，见 `M-21`       | 否       | -      | 已实现 | 0    | 保持 Title/Branch 显示偏好与新建标题回归 | E15、E21 |
| C-08 | 空项目在侧栏保持可见和可操作                                            | staoran `d9681469`                         | empty project 聚合与目录同步                                      | `COVERED_NATIVE`     | 无变化                | 用户目标已覆盖                                                | 否       | -      | 已实现 | 0    | 不移植旧 sidebar 分支                    | E15      |
| C-09 | 项目分组直接进入预选 New Workspace                                      | staoran `604fffb0`                         | route 传递 server/source/project                                  | `COVERED_NATIVE`     | 无变化                | 项目上下文已保留                                              | 否       | -      | 已实现 | 0    | 路由变更需遵守 `docs/expo-router.md`     | E15      |
| C-10 | 关闭最后一个 tab 后进入项目级 New Workspace                             | staoran `d6efb73f`                         | 当前 workspace/tab 导航已允许零 tab 后转入新建流程                | `COVERED_NATIVE`     | 上次基线前已补齐      | 早期自动补空草稿的判断已过期                                  | 否       | -      | 已实现 | 0    | 仅做路由回归                             | E15      |
| C-11 | 主机/项目/workspace 分组、图标、pin、Open Project                       | yun_er 侧栏导航大类                        | 当前 sidebar/project/workspace 模型                               | `COVERED_EQUIVALENT` | 无变化                | 主线信息架构已覆盖                                            | 否       | -      | 已实现 | 0    | 不移植 fork 旧侧栏树                     | E15      |
| C-12 | 会话执行 loading 动画与 reduced-motion 行为                             | staoran `a699c4da`                         | `SyncedLoader` 在 no-preference 下动画，并尊重系统 reduced motion | `COVERED_EQUIVALENT` | 2026-07-25 运行时复核 | 动画链路正常；静止来自 Windows 系统偏好，用户确认无需单独处理 | 否       | -      | 已实现 | 0    | 保留系统无障碍偏好，仅做现有行为回归     | E22      |
| C-13 | 工具默认折叠、搜索揭示和 diff 基础呈现                                  | staoran `e1985194`、yun_er 消息流大类      | 主线 tool detail、diff 和 timeline 呈现                           | `COVERED_CORE`       | 无变化                | 结构能力已覆盖；最终答案投影另见 `P-03`                       | 否       | -      | 已实现 | 0    | 不覆盖式移植旧 `view.tsx`                | E06      |
| C-14 | Git staging、branch、remote、stash、diff 等核心工作流                   | yun_er Git 大类                            | 主线 Git/Forge/PR 状态和动作模型                                  | `COVERED_NATIVE`     | 无变化                | 核心 Git 目标已覆盖                                           | 否       | -      | 已实现 | 0    | 增强项按 `M-10/M-11` 单独处理            | E11      |
| C-15 | Git 提交历史与面板内提交数                                              | 定向上游 Git 功能                          | 主线已有 commit history 和面板 count                              | `COVERED_NATIVE`     | 纠错项                | 不能再把 “Git log/count” 整体判缺失                           | 否       | -      | 已实现 | 0    | 同步按钮数字另见 `M-10`                  | E11      |
| C-16 | Todo、Subagent 轨道和正式 timeline                                      | yun_er Agent workflow 大类                 | 主线父子 Agent、subagent track 和 timeline                        | `COVERED_EQUIVALENT` | timeline 完整性增强   | 核心工作流已覆盖                                              | 否       | -      | 已实现 | 0    | 视觉样式差异不单独迁移                   | E06      |
| C-17 | Terminal MCP 基础 list/create/kill/capture/send keys                    | yun_er Terminal 大类                       | `paseo-tools.ts` 基础终端工具                                     | `COVERED_CORE`       | 无变化                | 基础控制已覆盖；命令级工具另见 `M-07`                         | 否       | -      | 已实现 | 0    | 不重复注册工具                           | E10      |
| C-18 | Schedules 与 daemon 自更新                                              | yun_er 定向上游功能                        | 主线正式功能与设置入口                                            | `COVERED_NATIVE`     | 无变化                | 已进入主线                                                    | 否       | -      | 已实现 | 0    | 仅回归                                   | E16      |
| C-19 | 紧凑文件浏览器与移动终端粘贴                                            | yun_er 定向上游功能                        | 当前文件浏览器和终端 paste 支持                                   | `COVERED_NATIVE`     | 上次基线前已补齐      | 早期缺失判断已失效                                            | 否       | -      | 已实现 | 0    | 移动端继续做交互回归                     | E10、E15 |
| C-20 | 原生输入绝对项目路径与 Command Center 项目/workspace 实体搜索           | yun_er 定向上游功能                        | 当前 New Workspace/Command Center 实体索引                        | `COVERED_NATIVE`     | 无变化                | 实体搜索已覆盖；内容搜索另见 `M-06`                           | 否       | -      | 已实现 | 0    | 区分实体筛选与全文搜索                   | E15      |
| C-21 | Composer mode 偏好、Provider diagnostics/model 同步、Forge 工具栏加载态 | yun_er 定向上游功能                        | 当前设置、诊断和 Forge UI                                         | `COVERED_EQUIVALENT` | 无变化                | 三项用户目标已覆盖                                            | 否       | -      | 已实现 | 0    | 不复制 fork UI 外观                      | E16      |
| C-22 | UUID/ID 宽松兼容与打包 hook CLI 路径保护                                | yun_er 稳定性大类                          | 当前主线使用兼容字符串边界并保护不可用 CLI 路径                   | `COVERED_EQUIVALENT` | 上次复核已纠正        | 剩余稳定性差距只保留 route boundary                           | 否       | -      | 已实现 | 0    | 协议收窄仍禁止                           | E12      |
| C-23 | 项目重命名，包括首个 workspace 前场景                                   | yun_er 定向上游功能、`aa6384bab`           | 当前 project settings 与 host project replica                     | `COVERED_NATIVE`     | 本轮关闭缺口          | 旧“输入不预填/首 workspace 前失败”判断已失效                  | 否       | -      | 已实现 | 0    | 保留 rename 回归测试                     | E15、E18 |

## 7. `PARTIAL`：已有基座但语义未闭合

| ID   | fork 改进/目标                          | 来源/代表提交                      | 当前主线实现                                              | 状态细分                                  | 最近更新                                                    | 精确剩余差距                                                                  | 移植建议 | 优先级 | 收益           | 成本 | 实施/验收边界                                                                            | 证据 |
| ---- | --------------------------------------- | ---------------------------------- | --------------------------------------------------------- | ----------------------------------------- | ----------------------------------------------------------- | ----------------------------------------------------------------------------- | -------- | ------ | -------------- | ---- | ---------------------------------------------------------------------------------------- | ---- |
| P-01 | 文件预览首次读取门禁                    | staoran `86e9da05`                 | 文件可见性门禁、实时订阅和 query                          | `PARTIAL_TRANSIENT_STATE`                 | `4bda2dfea` 增强基座                                        | subscription 建立时可能 `enabled=true/data=null/isFetching=false`，仍显示空态 | 是       | P0     | 中高           | XS   | 只补首次读取判定和单个回归测试                                                           | E04  |
| P-02 | Provider 重连/重试实时 footer 状态      | staoran `5b5d6831`、子 Spec `0007` | 上游仍缺；当前工作树已完成 Codex live snapshot/footer     | `PARTIAL_RUNTIME_STATUS_CODEX_LOCAL_PASS` | 0007 三个 P1 已修复，最终 Review PASS；Windows E2E deferred | Codex 子范围已实现；其他 Provider 尚未接入，浏览器用例待 Linux/CI 执行        | 是       | P1     | 中高           | M    | Codex 保持 optional raw message；其他 Provider 必须按原生合同另立范围，不扩展当前 object | E07  |
| P-03 | 最终答案优先 turn projection 与过程折叠 | staoran `6961814c` 等              | server projection 合并 assistant/reasoning/tool lifecycle | `PARTIAL_SEMANTIC_PROJECTION`             | timeline 完整性增强                                         | 没有 turn 级最终答案选择、过程组和尾随过程规则                                | 是       | P1     | 很高           | L    | 在当前 projection/renderer 重做，禁止覆盖旧 `view.tsx`                                   | E06  |
| P-04 | SenseVoice 与听写模型选择               | yun_er 听写大类                    | Sherpa/Parakeet 本地 STT 与现有语音设置                   | `PARTIAL_MODEL_CATALOG`                   | `2ead7e771` 仅修快捷键                                      | 缺 SenseVoice 中文模型、模型目录和切换体验                                    | 是       | P1     | 高             | L    | 接入现有 speech provider，不建第二套语音系统                                             | E09  |
| P-05 | Prompt presets 与全局模型偏好 LWW 同步  | yun_er 同步大类                    | 本机设置/模型偏好持久化                                   | `PARTIAL_LOCAL_ONLY`                      | host replica 修复不等价                                     | 无 daemon store、revision、RPC 和跨客户端收敛                                 | 是       | P1     | 中高           | M    | presets 先于模型偏好；不预建通用同步框架                                                 | E08  |
| P-06 | Composer 草稿跨端同步与冲突处理         | yun_er 同步大类                    | 完整本地 draft store                                      | `PARTIAL_LOCAL_ONLY`                      | 文件冲突 UI 不等价                                          | 无跨端 revision、冲突检测和草稿冲突抽屉                                       | 是       | P1     | 高             | L    | 叠加在现有 draft store；冲突 UI 最后做                                                   | E08  |
| P-07 | Workspace layout 跨客户端同步           | yun_er Terminal/layout 大类        | Zustand + AsyncStorage 本地布局                           | `PARTIAL_LOCAL_ONLY`                      | host replica 修复不等价                                     | 无 daemon LWW store/capability；pane 几何同步风险高                           | 条件性   | P2     | 中             | L    | 只考虑 tab 身份，不同步 pane 几何                                                        | E08  |
| P-08 | 路由/pane 级 ErrorBoundary              | yun_er 稳定性大类                  | 根级 `RootErrorBoundary`                                  | `PARTIAL_FAILURE_ISOLATION`               | 无变化                                                      | 单 route/pane 崩溃仍可能拖垮整个 App shell                                    | 条件性   | P2     | 低到中         | S    | 仅在可复现白屏后增加最窄边界                                                             | E12  |
| P-09 | 通知 deeplink 清理旧响应与连接等待      | yun_er 定向上游功能                | 统一路由 + `getLastNotificationResponseAsync()`           | `PARTIAL_STARTUP_ORDERING`                | 无变化                                                      | 缺消费后清理和 host connection readiness 协调                                 | 条件性   | 未排期 | 中             | S-M  | 先复现重复跳转/冷启动丢转问题                                                            | E15  |
| P-10 | 任意 TCP tunnel/客户端 localhost 绑定   | fork `ef9499c4d`                   | 声明式 HTTP/WebSocket Service Proxy 与端口分配            | `PARTIAL_SUBSTITUTE`                      | `9292f5889`、`8aa55db1e` 增强替代方案                       | 不代理任意 TCP，也不在 Electron 客户端绑定本地端口                            | 不建议   | 排除   | 取决于产品路线 | L    | 仅产品明确扩展为通用远程开发隧道时重开                                                   | E13  |

## 8. `MISSING`：当前主线缺失

| ID   | fork 改进/目标                                                                              | 来源/代表提交                                 | 当前主线实现                                                                                             | 状态细分                            | 最近更新                   | 精确缺口                                                                                                                                    | 移植建议 | 优先级  | 收益           | 成本 | 实施/验收边界                                             | 证据     |
| ---- | ------------------------------------------------------------------------------------------- | --------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ----------------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ------- | -------------- | ---- | --------------------------------------------------------- | -------- |
| M-01 | desktop smoke 的 PID JSON 部分写入重试                                                      | staoran `5ef37c86`                            | `waitForFile` 后直接 `JSON.parse`                                                                        | `MISSING_RELIABILITY_GUARD`         | 无变化                     | 文件已存在但 JSON 未写完时失败                                                                                                              | 是       | P0      | 高             | XS   | 只加 `waitForJsonFile` 和部分写入测试                     | E02      |
| M-02 | 普通文本裸文件路径自动链接                                                                  | staoran 文件链接系列                          | parser 存在，无正文扫描层                                                                                | `MISSING_TEXT_SCANNER`              | 无变化                     | 普通回答中的裸 Windows/POSIX 路径不会完整转链接                                                                                             | 是       | P0      | 高             | S    | 复用现有 parser，只加扫描层                               | E03      |
| M-03 | Prompt history 与上下键导航                                                                 | yun_er、定向上游 prompt history               | Composer 上下键只交给 autocomplete                                                                       | `MISSING_LOCAL_FEATURE`             | 无变化                     | 无历史 store、游标和恢复当前草稿行为                                                                                                        | 是       | P0      | 高             | S    | 第一版仅本机，不引入同步                                  | E05      |
| M-04 | Session 内容全文搜索                                                                        | yun_er 搜索大类                               | timeline fetch/展示，无搜索服务                                                                          | `MISSING_SEARCH`                    | timeline 完整性增强        | 无跨 Session 查询、结果定位和跳转                                                                                                           | 是       | P1      | 很高           | M-L  | 第一版只搜 daemon 已加载 timeline，不建索引               | E06      |
| M-05 | 每回合修改文件面板                                                                          | staoran turn presentation 系列                | 文件编辑器和 diff 能力存在                                                                               | `MISSING_TURN_DERIVATION`           | 文件编辑增强不等价         | 无 turn changed-files 推导、面板和折叠 diff                                                                                                 | 是       | P1      | 高             | M    | 依赖 `P-03`，复用现有 diff/file-open                      | E06      |
| M-06 | 工作区文件内容、项目内容与跨 pane 查找                                                      | yun_er 搜索大类、定向上游功能                 | Command Center 只做实体/动作筛选                                                                         | `MISSING_CONTENT_SEARCH`            | 文件订阅增强不等价         | 无 workspace content RPC、file result、pane find/reveal                                                                                     | 是       | P1      | 高             | L    | 交互可复用，数据源/RPC 与 Session 搜索分开                | E03、E15 |
| M-07 | Terminal MCP `run_terminal_command`、`open_terminal_tab`                                    | yun_er Terminal MCP                           | 只有基础 list/create/kill/capture/send keys                                                              | `MISSING_TOOL_ACTIONS`              | 无变化                     | Agent 无命令级执行和 UI tab 打开工具                                                                                                        | 是       | P2      | 中             | S-M  | 复用现有 terminal service，不重复创建传输层               | E10      |
| M-08 | Windows `pwsh7` 优先与 gsudo 提权                                                           | yun_er Windows terminal                       | 可配置 Terminal Profile                                                                                  | `MISSING_WINDOWS_POLICY`            | 无变化                     | 无默认 shell 探测优先级和显式提权控制                                                                                                       | 是       | P2      | Windows 用户高 | M    | 保留可配置校准，不硬编码单一路径                          | E10      |
| M-09 | Mermaid Markdown 渲染                                                                       | yun_er 定向上游功能                           | 无 Mermaid runtime/组件/lightbox                                                                         | `MISSING_RENDERER`                  | 无变化                     | Markdown 中 Mermaid 不能渲染                                                                                                                | 是       | P2      | 中             | M    | 先确认安全边界和现有 WebView 复用                         | E16      |
| M-10 | Git Pull/Push/Update 按钮 ahead/behind 数字                                                 | fork `99629c270`                              | `GitAction` 有输入 count，无展示字段                                                                     | `MISSING_ACTION_BADGE`              | 纠错项                     | 面板有提交数，但同步动作按钮不显示数量                                                                                                      | 是       | P2      | 中             | S-M  | 只扩展动作呈现，不重做 Git 模型                           | E11      |
| M-11 | Git submodule diff                                                                          | yun_er 定向上游功能                           | 无 mode `160000`/`Subproject commit` 处理                                                                | `MISSING_DIFF_KIND`                 | 无变化                     | submodule 指针变化不能专门解释和呈现                                                                                                        | 是       | P2      | 中             | M    | 在当前 diff parser/model 增量支持                         | E11      |
| M-12 | Codex app-server reset 卡片/动作                                                            | yun_er Provider 用量大类                      | 有 quota 与 reset timestamp                                                                              | `MISSING_PROVIDER_ACTION`           | 无变化                     | 无稳定 reset RPC、卡片和动作反馈                                                                                                            | 条件性   | P2      | 中             | M    | 等上游 API 稳定并确认权限边界                             | E16      |
| M-13 | 工具类别配色与 Shell tool-call ANSI                                                         | yun_er 消息流大类                             | 工具折叠/diff 和文件 editor syntax roles                                                                 | `MISSING_PRESENTATION`              | 新 syntax roles 不等价     | 缺按工具类别的消息配色和 Shell 输出 ANSI 呈现                                                                                               | 是       | P2      | 中低           | M    | 只改消息工具层，不复用 editor roles 硬套                  | E06      |
| M-14 | Terminal 点击定位、选择删除、undo/redo                                                      | yun_er Terminal 大类                          | xterm 输入、粘贴和滚动                                                                                   | `MISSING_EDIT_HISTORY`              | 无变化                     | 无移动编辑手势和输入历史层                                                                                                                  | 条件性   | P2      | 中低           | L    | 仅移动终端需求明确时；先做最小编辑历史                    | E10      |
| M-15 | GPT-5.6 Terra/Luna fallback 目录                                                            | yun_er 模型大类                               | 动态模型发现与当前 manifest                                                                              | `MISSING_FALLBACK`                  | thinking level 更新不等价  | 运行时目录缺失时无 fork 兜底                                                                                                                | 条件性   | P2      | 低             | S-M  | 仅以真实目录缺失复现为入口                                | E16      |
| M-16 | 工具 badge 展开与打开文件按钮成为兄弟控件                                                   | staoran `3bea8435`                            | 当前外层 Pressable 仍包住 label row 内打开文件 Pressable                                                 | `MISSING_WEB_INTERACTION_FIX`       | 无变化                     | 保留 nested interactive/hydration 与事件传播风险                                                                                            | 条件性   | P0 候选 | 中高           | S    | 先复现 Web 点击/hydration，再做最小结构调整               | E14      |
| M-17 | 清理 file explorer 失效展开路径                                                             | yun_er 定向上游功能                           | expanded path 持久化存在                                                                                 | `MISSING_STATE_PRUNING`             | 无变化                     | 文件删除/移动后可能保留陈旧展开状态                                                                                                         | 条件性   | 未排期  | 低到中         | S    | 先构造陈旧路径回归；只在 store 统一清理                   | E15      |
| M-18 | plan 文件建议                                                                               | yun_er 定向上游功能                           | 无对应建议链                                                                                             | `MISSING_SUGGESTION`                | 无变化                     | 未向 Agent/用户呈现计划文件建议                                                                                                             | 条件性   | 未排期  | 中             | S-M  | 先定义触发语义，避免泛化提示噪音                          | E16      |
| M-19 | Android 浅色主题状态栏图标修复                                                              | yun_er 定向上游功能                           | 未发现等价专项处理                                                                                       | `MISSING_PLATFORM_FIX`              | 无变化                     | 特定浅色主题/状态栏组合可能可读性不足                                                                                                       | 条件性   | 未排期  | 低到中         | XS-S | 必须以 Android 实机/模拟器复现为前提                      | E16      |
| M-20 | 完整 SSH 主机、密钥、known-hosts、上传、全局标签和分组                                      | yun_er SSH 大类                               | Hub、Git SSH hostname 和普通终端                                                                         | `MISSING_PRODUCT_AREA`              | 无变化                     | 主线不是完整 SSH 客户端                                                                                                                     | 不建议   | 排除    | 产品路线级     | XL   | 除非产品明确扩边，否则不建立子 Spec                       | E13、E16 |
| M-21 | 导入会话真实标题贯穿 App、client、协议、workspace 存储与侧栏                                | staoran `630936e0`、`581f8137`、`bd3908d3` 等 | `origin/main` 与 `upstream/main` 仍缺失；子 Spec `0005` 已由本地提交 `084dca00b` 完成端到端实现与 Review | `MISSING_REMOTE_LOCAL_COMMIT_PASS`  | 2026-07-25 修正提交状态    | optional nullable 字段、单一 capability gate、workspace/agent 三态和 sidebar raw title 均已覆盖；尚未 push 或合并                           | 是       | P1      | 高             | S    | 用户授权后 push 或同步 upstream；未合并前不标记远端已覆盖 | E21      |
| M-22 | New Workspace 页按当前 project 导入 Provider session，并创建 fresh workspace 打开 agent tab | 用户纠正；子 Spec `0008`                      | 远端仍缺；本地 P1 completion、`96/96`、static、格式、diff 与 staged review PASS；Linux E2E 由用户延后    | `MISSING_REMOTE_LOCAL_STAGED_READY` | 2026-07-26 ready to commit | App 入口、current-project 列表、untargeted import、Home failure sheet 可见性已覆盖；完整 Home 页面与 import/navigation E2E 仍缺默认 fixture | 是       | P1      | 高             | S    | 提交当前 17 条路径；Linux Playwright 作为后续残余验证     | E23      |

## 9. `STRATEGY/N/A`：产品身份、私有集成或维护差异

| ID   | fork 改进/目标                                         | 来源                    | 当前主线状态                                        | 状态细分                    | 对比结论                               | 移植建议 | 优先级 | 收益      | 成本 | 重开条件                             | 证据 |
| ---- | ------------------------------------------------------ | ----------------------- | --------------------------------------------------- | --------------------------- | -------------------------------------- | -------- | ------ | --------- | ---- | ------------------------------------ | ---- |
| X-01 | Paseo Reforged 品牌、包 ID 和独立产品身份              | staoran 发行身份        | 主线保持 Paseo 官方身份                             | `STRATEGY_PRODUCT_IDENTITY` | 不是主线功能缺陷                       | 不建议   | 排除   | fork 专属 | -    | 用户明确要求品牌迁移                 | E19  |
| X-02 | fork EAS Free、Cloudflare、updater/repository 基础设施 | staoran/yun_er 构建部署 | 主线有自己的构建与部署                              | `STRATEGY_INFRA`            | 账号、域名、签名和成本约束不可直接移植 | 不建议   | 排除   | fork 专属 | -    | 建立独立发行目标                     | E19  |
| X-03 | fork 发布流程、changelog 和高频版本记录                | 两份会话发行类别        | 主线有 `docs/release.md` 与官方流程                 | `STRATEGY_RELEASE`          | 维护流程不同，不作为产品能力迁移       | 不建议   | 排除   | fork 专属 | -    | 用户要求替换主线发布制度             | E19  |
| X-04 | ReClaude、NewAPI、Sub2API、CPA、Ultracode 等私有集成   | yun_er Provider 大类    | 主线提供通用 Provider/ACP 架构                      | `STRATEGY_PRIVATE_PROVIDER` | 缺少具体私有服务不等于通用架构缺陷     | 不建议   | 排除   | 私有路线  | -    | 上游正式接纳对应 Provider            | E16  |
| X-05 | fork 完整主题和视觉品牌                                | yun_er 外观大类         | 主线有自己的 design tokens/主题                     | `STRATEGY_VISUAL_IDENTITY`  | 视觉偏好不能当功能缺口                 | 不建议   | 排除   | fork 专属 | -    | 产品设计明确采纳                     | E19  |
| X-06 | 启动时只恢复运行中会话                                 | yun_er 导航策略         | 主线使用自己的恢复语义                              | `STRATEGY_BEHAVIOR_POLICY`  | 属于产品策略取舍                       | 不建议   | 排除   | 不确定    | -    | 用户研究证明需要改变策略             | E15  |
| X-07 | 常规上游 merge、分支与 origin 对账                     | yun_er 维护类别         | 当前仓库就是上游主线                                | `N/A_MAINTENANCE`           | 这是 fork 维护动作，不是功能           | 否       | 排除   | 无        | 0    | 不重开                               | E01  |
| X-08 | Claude SDK/ACP 在同一 Provider 内切换                  | yun_er Provider 大类    | 主线独立 `claude-acp` Provider 覆盖主要场景         | `STRATEGY_PROVIDER_SHAPE`   | 不建议复制 fork 双路径复杂度           | 不建议   | 排除   | 低        | -    | 真实用户场景无法由独立 Provider 满足 | E16  |
| X-09 | Trellis、fork 测试资产与文档工作流                     | yun_er 工具类别         | 主线有 Universal Agents Kit、`docs/` 和自身测试制度 | `N/A_WORKFLOW`              | 不建立第二套并行流程                   | 不建议   | 排除   | 无        | -    | 项目规则明确替换现有工作流           | E19  |

## 10. 已采纳实施路线

### 10.1 P0：高收益、低改造、无协议变更

| 顺序 | 总表 ID | 项目                       | 收益 | 成本 | 子 Spec 最小边界                                |
| ---: | ------- | -------------------------- | ---- | ---- | ----------------------------------------------- |
|    1 | M-01    | PID JSON 部分写入重试      | 高   | XS   | helper + 单个部分写入回归测试                   |
|    2 | P-01    | 文件预览首次读取门禁       | 中高 | XS   | loading 判定 + 单个 query/subscription 回归测试 |
|    3 | M-02    | 普通文本裸文件路径自动链接 | 高   | S    | 扫描层 + parser 复用 + 路径边界测试             |
|    4 | M-03    | Prompt history             | 高   | S    | 仅本机历史、上下键、当前草稿恢复                |

P0 维持四个独立子 Spec/PR，粗估 3-5 人日。`M-16` 是新增的 P0 候选，但必须先复现 Web 交互问题，不自动插入既有顺序。

### 10.2 P1：核心产品增益

| 顺序 | 总表 ID | 项目                                       | 依赖                                                                      |
| ---: | ------- | ------------------------------------------ | ------------------------------------------------------------------------- |
|    1 | M-04    | Session 内容全文搜索                       | timeline 数据完整性                                                       |
|    2 | M-21    | 导入会话真实标题端到端传递                 | optional protocol field + capability                                      |
|    3 | M-22    | New Workspace 页导入当前 project 会话      | 复用 M-21 标题、现有 sheet、untargeted provisioning 与 workspace tab 导航 |
|    4 | P-04    | SenseVoice 与听写模型选择                  | 当前 speech provider/worker                                               |
|    5 | P-03    | 最终答案优先 turn projection               | 当前 server projection 与 renderer                                        |
|    6 | M-05    | 每回合修改文件面板                         | 依赖 P-03                                                                 |
|    7 | P-02    | Codex 重试实时 footer（本地 Review PASS）  | optional live message snapshot；Codex 原始 `error.message`                |
|    8 | P-05    | Prompt presets、模型偏好 LWW               | 独立最小 store                                                            |
|    9 | P-06    | Composer 草稿同步与冲突                    | 在 P-05 经验之后，但不强制共用抽象                                        |
|   10 | M-06    | workspace 文件内容、项目内容、跨 pane 搜索 | 搜索交互可复用，RPC/数据源独立                                            |

P1 粗估 6-9 周。同步顺序固定为 Prompt presets -> 模型偏好 -> Composer drafts；只有出现第三份真实重复后才评估公共同步模块。

`M-22` 只新增 New Workspace 页入口：列表使用当前 project cwd，请求保持 untargeted，随后复用既有 fresh workspace 与 agent tab 导航；不授权重写 workspace 创建或路由链路。

### 10.3 P2：按场景和反馈选择

| 总表 ID    | 项目                             | 当前决策                                     |
| ---------- | -------------------------------- | -------------------------------------------- |
| M-07       | Terminal MCP 命令级工具          | 建议                                         |
| M-08       | Windows pwsh7/gsudo              | 建议                                         |
| M-09       | Mermaid                          | 建议                                         |
| M-10、M-11 | Git 同步按钮计数、submodule diff | 建议；不要重复实现已覆盖的 Git history/count |
| P-07       | Workspace layout 同步            | 条件性；仅 tab 身份                          |
| M-12       | Codex reset 卡片                 | API 稳定后                                   |
| M-13       | 工具类别配色、Shell ANSI         | 视觉优化后置                                 |
| M-14       | Terminal 编辑历史                | 移动需求明确时                               |
| P-08       | route/pane ErrorBoundary         | 可复现白屏后                                 |
| M-15       | Terra/Luna fallback              | 真实目录缺失后                               |

`P-09`、`M-17`、`M-18`、`M-19` 保留为未排期条件性 backlog；`P-10`、`M-20` 和全部 `X-*` 默认不进入路线。

## 11. 依赖与实现约束

- 所有新增协议必须使用 dotted RPC、optional schema、单一 capability gate 和带版本/日期的 `COMPAT` 注释。
- 协议保持双向兼容；不移除字段、不收窄类型、不在 wire schema 中使用 transform/catch/preprocess。
- 不直接 cherry-pick fork 的整份 `session.ts`、agent-stream `view.tsx`、同步层、旧 sidebar 或完整 Terminal/SSH 栈。
- 保持当前 `workspaceId` 所有权、session/service 拆分、timeline epoch/seq 与 projection 分页语义。
- 优先复用主线 parser、draft store、diff/file-open、terminal service、speech provider、Git action model 和现有 UI。
- 不为两份同步需求预建通用框架；第三份真实重复出现后再抽象。
- 每个子 Spec 只运行最窄相关测试；代码改动后必须运行 `npm run typecheck`、`npm run lint`，提交前运行 `npm run format`。
- 禁止本地全量测试，禁止未经许可重启 `6767` daemon。

## 12. 子 Spec 抽取合同

从本表选择任务时，子 Spec 必须包含：

1. `Parent Spec: 0002` 和唯一总表 ID；多个 ID 只有在共享不可拆合同或明确依赖时才合并。
2. 重新记录当时 `HEAD`、`origin/main`、fork 参考 SHA；不得沿用本表状态而跳过复核。
3. 把“当前主线实现”和“精确差距”转成可验证的 In/Out、Done Contract 和失败样例。
4. 定位主线 owner 模块和最窄测试入口；fork 提交只作设计证据，不默认作为 patch。
5. 重新估算收益、成本、回归风险和协议影响；若结论改变，先反向更新本总 Spec。
6. 明确是否涉及协议、持久化、路由、跨平台或产品边界，并加载对应 `docs/` 与 CodeMap。
7. 实施前取得该子 Spec 的精确 `Plan Approved`；本总 Spec 的授权不传播。
8. 子任务验收后在下表登记并更新父项状态，不复制完整执行日志。

### 12.1 子 Spec 注册表

| 子 Spec                                           | 总表 ID | 范围                                                                    | 基线        | 状态                                                        | 结论/父表更新                                                                                                                   |
| ------------------------------------------------- | ------- | ----------------------------------------------------------------------- | ----------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| [0005](../0005_导入会话标题传递/SPEC.md)          | M-21    | 导入会话真实标题端到端传递与显示加固                                    | `b64f4f357` | `Review PASS (local commit)`                                | 本地提交 `084dca00b` 完成实现与验证；远端仍未修复，尚未 push 或合并                                                             |
| [0007](../0007_会话重试状态/SPEC.md)              | P-02    | Codex retry 原文、live snapshot 与会话 footer                           | `084dca00b` | `Pre-Commit Review PASS (local WIP) / Windows E2E deferred` | 三个 P1 根因修复、乱序回归、定向测试、typecheck 与 lint 通过；未 stage/commit/push，浏览器用例待 Linux/CI                       |
| [0008](../0008_新Workspace页导入会话入口/SPEC.md) | M-22    | New Workspace 页当前 project session 列表、untargeted import 与成功导航 | `084dca00b` | `READY TO COMMIT / 17 paths staged / Linux E2E deferred`    | Home failure 组件可见性、`96/96`、static、格式、diff 与 staged review 通过；Linux E2E 为已接受的后续残余验证；未 commit 或 push |

## 13. Research、Plan 与 Review 状态

- Research Findings: 证据、纠错和置信度见 `findings.md`。
- Innovate: Skipped。本轮是既有结论归并，不存在需要裁决的实现方案。
- Plan: 本文件只规定未来子 Spec 的选择和约束，不包含任何产品实现 checklist。
- Execute: 父总表未整体授权；`M-22/0008` 与 `P-02/0007` 已分别取得 `Plan Approved` 并完成各自本地 Execute/Review。
- Review Matrix:

| 轴                                    | 检查                                                     | 结论   | 证据                                                         |
| ------------------------------------- | -------------------------------------------------------- | ------ | ------------------------------------------------------------ |
| Spec Quality & Requirement Completion | 目标、范围、状态、建议、优先级、子 Spec 抽取合同是否完整 | `PASS` | 64 个唯一能力 ID，四组互斥且计数一致                         |
| Spec-Source Fidelity                  | fork 意图、当前主线状态、最近更新与纠错是否可追溯        | `PASS` | `findings.md` 的 E01-E23；运行时证据与实际引用均有定义       |
| Artifact Intrinsic Quality            | 格式、路径、占位符、范围与仓库规范                       | `PASS` | 11 个相关任务文档格式通过；M-21/M-22 父子链接可达；lint 通过 |

- Overall Verdict: `PASS`，可作为后续子 Spec 的选择基准。
- Baseline Validation: 当前 `npm run typecheck` 与 `npm run lint` 均通过，声明生成未留下额外 Git 状态。
- Tests: M-21 的既有记录保持有效；M-22 sheet view model `34/34`、Home completion `9/9`、sheet `18/18`、entry model `3/3`、provisioning `32/32`（合计 `96/96`）、typecheck、lint、17 文件格式、diff check 与 staged review 通过。Linux Playwright 由用户明确延后；完整 Home 页面与 import/navigation E2E 仍无默认 provider fixture，作为后续残余验证。P-02 的三个 P1 乱序回归、protocol/server/App 定向测试、`build:client`、typecheck 与 lint 通过，新增 retry 浏览器用例因 Windows harness 限制待 Linux/CI 执行。
- Plan-Execution Diff: M-22 为保持纯测试边界新增一个 colocated model 文件；最终审查扩展了共享 sheet 的 Host query identity、回调顺序和两条行为回归，其余实现范围与批准计划一致。

## 14. CodeMap 与 Project Sync

- Codemap Mode: `drift-check`（只读）。
- Existing Index: `.skills/project/CODEMAP_INDEX.md`。
- Verdict: `Update Required before P1 timeline/search child specs`。现有 Agent/Timeline map 仍能导航创建与投递，但未索引最新 server projection 分页和 catch-up 变化。
- 本轮不更新 CodeMap；选择 `P-03`、`M-04` 或 `M-05` 时，子 Spec Research 必须先刷新对应 Feature CodeMap。
- Project Sync Candidates: 本总表本身是任务级基准，不同步到 `PROJECT_KNOWLEDGE.md`；若多个子任务反复使用同一兼容约束，再单独提出长期知识候选。

## 15. Open Questions

- 当前无阻塞本总 Spec 落盘的问题。
- 用户现场是否持久化选择了 `workspaceTitleSource=branch` 尚未核实；该设置会有意让分支名覆盖标题，但不能解释导入请求缺少标题字段。
- `M-22` 子 Spec 的异步 Home completion P1 已本地修复；Home failure 组件可见性、`96/96` 定向回归、static、格式、diff 与 staged review 通过。用户明确延后 Linux Playwright，隔离环境已清理；当前无提交阻塞，尚未 commit 或 push。

## 16. Change Log

| 日期       | 变更                                                                     | 依据                                                                                               |
| ---------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| 2026-07-22 | 建立 62 项状态分组总表、路线图和子 Spec 抽取合同                         | 两个来源会话、fork 报告、本会话历次主线复核与当前源码                                              |
| 2026-07-22 | 将标题结论拆为已覆盖的新建/重命名基座 `C-07` 与缺失的导入标题链路 `M-21` | 用户现场反馈、主线最小复现、fork 提交与定向测试                                                    |
| 2026-07-22 | 为 `M-21` 登记独立子 Spec `0005`，状态为 `Plan Review`                   | 用户选择 M-21；子 Spec 尚未取得 Execute 授权                                                       |
| 2026-07-24 | `M-21` 子 Spec `0005` 完成本地实现、定向验证和 Review                    | 远端仍缺失；本地 WIP Review PASS，尚未提交或合并                                                   |
| 2026-07-25 | 将 `C-12` 从 `COVERED` 移入 `PARTIAL` 并登记子 Spec `0007`               | Electron motion 矩阵确认 reduced-motion fallback 歧义                                              |
| 2026-07-25 | 修正 `M-21/0005` 为本地提交状态                                          | Git 直接确认 `084dca00b`；尚未 push 或合并远端                                                     |
| 2026-07-25 | 新增并纠正 `M-22`，登记子 Spec `0008`                                    | New Workspace 页缺当前 project scoped import 入口；fresh workspace 与 tab 规则直接复用现有实现     |
| 2026-07-25 | 按用户裁决关闭 C-12 产品缺口，并将子 Spec `0007` 改挂 `P-02`             | loading 静止来自系统 reduced motion；会话重连/重试状态成为新的专项范围                             |
| 2026-07-25 | 将 `P-02/0007` 收敛为 Codex-only 最小 retry 文案设计                     | Codex app-server 无结构化 attempt，但 CLI 文案含 `N/M`；原文透传替代解析                           |
| 2026-07-25 | 完成 `M-22/0008` 本地实现与 Review                                       | App 入口、定向测试和双 viewport smoke 通过；Windows E2E harness 限制已记录                         |
| 2026-07-25 | 修复 `M-22/0008` P1 异步完成回调                                         | `onImported` 等待 Home project 注册；初版 JSDOM/mock 可见性测试已移除，改用 completion pure seams  |
| 2026-07-26 | 尝试 `M-22/0008` Linux Playwright                                        | `tencent-ssh` Docker 在 `npm ci` 后存储耗尽；已清理本轮临时容器/副本，目标用例待可用 Linux/CI 重跑 |
| 2026-07-26 | 校正 `M-22/0008` P1 记录                                                 | pure seam 定向回归 `95/95` 与 static PASS；staged review/Linux E2E 待完成，未提交或 push           |
| 2026-07-26 | 补 `M-22/0008` Home failure 可见性并第二次重试 Linux                     | 组件组合回归后合计 `96/96`；Linux sshd 无 banner，Playwright 未启动，容器待清理                    |
| 2026-07-26 | 按 Windows 主场景完成 `M-22/0008` 提交裁决                               | 用户延后 Linux Playwright；隔离环境已清理，17 条精确路径 staged diff 可提交，尚未 commit 或 push   |
| 2026-07-26 | 完成 `P-02/0007` Codex-only 本地实现与 Review                            | raw retry message、live-only snapshot、footer 与定向测试通过；Windows E2E 留给 Linux/CI            |
| 2026-07-26 | 完成 `P-02/0007` 三个提交前 P1 修复与最终复审                            | stale compaction、closure 时间戳和 bootstrap completion-order 乱序回归通过；Standards/Spec PASS    |
