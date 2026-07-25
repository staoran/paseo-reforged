# 导入会话真实标题传递 Feature Spec

本文件保存 M-21 子任务的实施合同与已采纳决策。用户已于 `2026-07-24` 回复精确字样 `Plan Approved`，产品代码执行门已解除。

## 任务索引

| 字段           | 值                                                                                                                        |
| -------------- | ------------------------------------------------------------------------------------------------------------------------- |
| task_id        | `0005`                                                                                                                    |
| 任务深度       | `standard`（Research 初始按公共协议变更评为 `complex`；方案分叉消除后在 Plan 前降级，协议兼容门禁不降级）                 |
| 项目规则       | `.skills/project/PROJECT_RULES.md#Paseo-项目规则`                                                                         |
| 任务索引       | `N/A`（项目未启用 task index）                                                                                            |
| 创建时间       | `2026-07-22`                                                                                                              |
| 最近更新       | `2026-07-24`                                                                                                              |
| 批准状态       | `Plan Approved / Review PASS / local WIP complete`                                                                        |
| 关联 codemap   | `N/A`（owner 链路已由当前源码确认；父 Spec 的 timeline/search 漂移与本任务无关）                                          |
| 关联关键上下文 | `../0002_fork改进与主线覆盖总控/SPEC.md#12-子-spec-抽取合同`、`../0002_fork改进与主线覆盖总控/findings.md#6-标题专项调查` |

## 父 Spec 绑定与基线

| 字段            | 值                                                                           |
| --------------- | ---------------------------------------------------------------------------- |
| Parent Spec     | `0002_fork改进与主线覆盖总控`                                                |
| 总表 ID         | `M-21`                                                                       |
| 父表优先级      | `P1`                                                                         |
| 收益/预计成本   | `高 / S（单人约 1-2 天，实施前按实际测试增量复核）`                          |
| 主线 `HEAD`     | `b64f4f35784876021268583b1736ad951495946c`                                   |
| `origin/main`   | `b64f4f35784876021268583b1736ad951495946c`                                   |
| `upstream/main` | `b218267c3cec718c13072cc4b831ac402939d946`                                   |
| fork 参考       | `E:\Code\paseo-reclaude@6fb48efdf6eb8daef33d9a818b074d75fa61b39d`            |
| fork 代表提交   | `630936e05`、`581f81378`、`df8acf5a1`、`bd3908d36`、`e0551ce18`、`cdc9984d5` |

## 目标、范围与完成契约

### 背景与目标

Provider 会话列表已经返回真实的 `entry.title`，但当前主线在点击导入后丢失该字段。无目标 workspace 的导入因此创建 `title=null` 的 workspace；侧栏 Title 模式只能显示分支或目录派生名。目标是把 Provider 的真实标题贯穿 App、client、wire schema、server import、workspace 持久化和 fresh imported agent 持久化，并让侧栏 Title 模式显式优先原始 title。

### In Scope

- 为既有 `import_agent_request` 增加向后兼容的 optional `workspaceTitle?: string | null`。
- 在 App 中只传递 Provider 返回的 `entry.title`；不得用 `firstPromptPreview` 或展示 fallback 代替真实标题。
- 在 server validation 之后统一 trim，并保留“字段缺失 / 显式无标题 / 真实标题”三态。
- 只给无 `workspaceId` 时自动创建的新 workspace 应用导入标题。
- 给 fresh imported agent 应用同一真实标题；显式 `null` 禁止退回 config title 或首条 prompt。
- 新增单一 host capability `server_info.features.importSessionWorkspaceTitle`，复用现有 Update Host 空态。
- Title 模式显式使用 `workspace.title ?? workspace.name`；Branch 模式保持现状。
- 增加与风险相称的 protocol、client、server 和 App 定向回归。

### Out of Scope

- 不新增或重命名 RPC；`import_agent_request` 不是本任务中新建的 RPC，不迁移为 dotted namespace。
- 不重命名用户明确选择的既有 workspace，不修改其 `title`、`name` 或 Git branch。
- 不从 prompt preview、首条 user message、目录名或 branch 猜测 Provider 的真实标题。
- 不回填历史导入记录，不增加数据迁移或持久化 schema 版本。
- 不重命名已归档后重新导入的既有 agent；其已持久化标题继续作为事实源。
- 不修改 Title/Branch 设置默认值，不调查用户本机是否持久化选择了 Branch 模式。
- 不新增文案、服务、跨层框架或第二套 workspace 命名模型。
- 不 cherry-pick fork 提交；fork 仅作行为与测试证据。
- 不修改 App 路由、startup restore 或 active workspace selection。
- 不重启端口 `6767` 的主 daemon，不运行任何全量测试，不 stage、commit 或 push。

### Done Contract

1. `ImportAgentRequestMessageSchema` 能无损解析 string、`null` 和 omitted 三态，旧 request 继续通过。
2. `DaemonClient.importAgent()` 能发送 string 与显式 `null`，并在 input 为 `undefined` 时完全省略 wire 字段。
3. App 只把 `entry.title` 作为 `workspaceTitle`；无标题时发送 `null`，不调用展示用 title fallback。
4. Server 在 schema 外把非空 string trim，把空白 string 归一为 `null`，但 omitted 必须继续保持 `undefined`。
5. 无目标 workspace 的 fresh import 使用归一后的 string/null 创建 workspace；导入失败仍沿用现有原子回退。
6. 指定既有 `workspaceId` 时，无论 request 标题为何值，该 workspace 的持久化标题均不改变。
7. Fresh imported agent 的标题遵守三态合同；显式 `null` 即使遇到 provider config title 或首条 prompt 也保持无标题。
8. 旧客户端连接新 daemon 时仍可省略字段并保留现有 agent title fallback；新 App 连接未宣告 capability 的 daemon 时显示现有 Update Host 空态，不静默降级。
9. Title 模式优先 raw `workspace.title`，Branch 模式仍优先 `currentBranch`，无 branch 时仍回退 `workspace.name`。
10. 最窄相关测试、声明构建、typecheck、lint 和定向格式检查通过；没有产品范围外 diff。

## 已采纳事实与决策

| 类别       | 内容                                                                                                      | 来源/决策者                              | 判定   |
| ---------- | --------------------------------------------------------------------------------------------------------- | ---------------------------------------- | ------ |
| 已采纳事实 | 当前导入 UI 已取得 `entry.title`，但 `importAgent()` 调用未传递                                           | `findings.md#F2-当前主线根因链`          | 已确认 |
| 已采纳事实 | 当前 client input、wire schema、normalized request 和 provisioning input 均无标题字段                     | `findings.md#F2-当前主线根因链`          | 已确认 |
| 已采纳事实 | `runInImportWorkspace()` 仅在无 requested workspace 时创建记录，已有 workspace 分支可天然守住“不改名”边界 | `findings.md#F3-可复用主线基座`          | 已确认 |
| 已采纳事实 | descriptor 的 `name` 已是 resolved display name；raw `title` 也已单独下发                                 | `findings.md#F3-可复用主线基座`          | 已确认 |
| 已采纳决策 | 复用 `import_agent_request`，增加 optional field，不新增 RPC                                              | 本 Spec                                  | 已确认 |
| 已采纳决策 | wire schema 保持纯结构；trim/null normalization 只在 server post-validation 执行                          | `docs/protocol-validation.md`、本 Spec   | 已确认 |
| 已采纳决策 | capability 名称为 `importSessionWorkspaceTitle`，App 在一个入口统一门禁                                   | `CLAUDE.md` Feature contract、本 Spec    | 已确认 |
| 已采纳决策 | fork patch 不直接套用；按当前主线的 workspace ownership、capability 和测试结构重做                        | `findings.md#F4-fork-设计证据与主线差异` | 已确认 |

## 接口与状态合同

### 字段签名

| 层                        | 计划签名                                           | 约束                                                         |
| ------------------------- | -------------------------------------------------- | ------------------------------------------------------------ |
| Protocol request          | `workspaceTitle: z.string().nullable().optional()` | 只声明结构，不 `.transform()`、`.catch()` 或 `.preprocess()` |
| Client input              | `workspaceTitle?: string \| null`                  | 使用 `!== undefined` 判断是否发送，不能用 truthy spread      |
| Normalized server request | `workspaceTitle?: string \| null`                  | omitted 不创建属性；string/null 保留属性存在性               |
| Provisioning input        | `initialTitle?: string \| null`                    | 仅 auto-create 分支消费；requested workspace 分支忽略        |
| Agent import input        | `title?: string \| null`                           | 仅 fresh provider import 消费；archived restore 保留历史标题 |
| Agent register option     | `initialTitleOverridesConfig?: boolean`            | 仅 import 显式传值时为 true，使 null/string 覆盖 config      |
| Server capability         | `features.importSessionWorkspaceTitle?: boolean`   | daemon 宣告 `true`；App 统一读取并门禁                       |

### 三态语义

| Wire 输入             | Server normalized | 自动创建 workspace                         | Fresh imported agent                         | 兼容含义                  |
| --------------------- | ----------------- | ------------------------------------------ | -------------------------------------------- | ------------------------- |
| omitted / `undefined` | 属性仍 omitted    | 保持现有 derived name，raw title 为 `null` | 保留当前 config title / 首条 prompt fallback | 旧客户端行为              |
| `null` 或空白 string  | 显式 `null`       | raw title 为 `null`，显示派生名            | 强制无标题，不使用 config/prompt             | Provider 明确没有真实标题 |
| 非空 string           | trim 后 string    | raw title 与 resolved name 使用该值        | 持久化同一值                                 | Provider 真实标题         |

`workspaceId` 一旦存在，上表的 workspace 列统一变为“保持既有记录不变”；fresh imported agent 仍按 request 三态处理。

### 版本兼容矩阵

| App/client                    | Daemon    | 预期行为                                                                     |
| ----------------------------- | --------- | ---------------------------------------------------------------------------- |
| 新 App                        | 新 daemon | capability 为 true，执行完整三态标题链路                                     |
| 新 App                        | 旧 daemon | import sheet 复用 `Update the host to import sessions.` 空态；不发送降级请求 |
| 旧 client                     | 新 daemon | request 省略字段；daemon 保留既有 import 与 agent title fallback             |
| 旧 client                     | 旧 daemon | 完全维持现状                                                                 |
| 新通用 client（字段 omitted） | 新 daemon | 与旧 client 相同，不因 SDK 升级被强制改变语义                                |

兼容清理点只放在 App capability gate：`COMPAT(importSessionWorkspaceTitle): added in v0.2.0, drop the gate when daemon floor >= v0.2.0 after 2027-01-22.`。Protocol optional 字段属于长期双向兼容合同，不计划改为 required。

## 方案与文件影响

| 模块/文件                                                                                          | 计划变化                                                                                                  | 原子验收                                                   |
| -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `packages/protocol/src/messages.ts`                                                                | request 增加 optional nullable 字段；server features 增加 optional capability                             | string/null/omitted 均可解析；旧 payload 不变              |
| `packages/protocol/src/messages.workspaces.test.ts`                                                | 扩充既有 import request contract cases                                                                    | 字段存在性与值逐态断言，不在 schema 层 trim                |
| `packages/client/src/daemon-client.ts`                                                             | 扩展 `ImportAgentInputBase` 并按 `!== undefined` 序列化                                                   | null 发出、undefined 省略                                  |
| `packages/client/src/daemon-client.test.ts`                                                        | 扩充既有 import request 捕获测试                                                                          | string、null、omitted 三态 wire 证据                       |
| `packages/server/src/server/websocket-server.ts`                                                   | 在 `server_info.features` 宣告 `importSessionWorkspaceTitle: true`                                        | client 能通过统一 feature hook 读取                        |
| `packages/server/src/server/agent/import-sessions.ts`                                              | post-validation normalization；把标题传给 provisioning 与 fresh agent import                              | blank/null/omitted 不被压扁；archived restore 不改旧标题   |
| `packages/server/src/server/agent/import-sessions.test.ts`                                         | 覆盖 normalization 和两个下游 input 的属性存在性                                                          | string trim、blank→null、omitted 无属性                    |
| `packages/server/src/server/session/workspace-provisioning/workspace-provisioning-service.ts`      | `ImportWorkspaceInput` 增加 `initialTitle`；只在 auto-create 分支传给既有 `createWorkspaceForDirectory()` | 新记录持久化 title；requested workspace 不变；失败回退不变 |
| `packages/server/src/server/session/workspace-provisioning/workspace-provisioning-service.test.ts` | 新增 titled auto-create 与 requested workspace 不改名回归                                                 | 同时读取 registry 验证持久状态                             |
| `packages/server/src/server/agent/agent-manager.ts`                                                | import input 增加 optional title；显式 null/string 覆盖 config/prompt fallback，omitted 保持旧 fallback   | fresh agent 三态写入正确；其他 create/resume 路径不变      |
| `packages/server/src/server/agent/agent-manager.test.ts`                                           | 在既有 provider import 测试附近覆盖三态                                                                   | 尤其断言 explicit null 能压过 config title 和 prompt       |
| `packages/server/src/server/session.workspaces.test.ts`                                            | 增加一条 request→auto-created workspace 的窄集成回归，并确认 targeted import 不改名                       | 覆盖 handler 到 registry 的真实组合链路                    |
| `packages/app/src/components/import-session-sheet.tsx`                                             | 读取新 capability；调用 client 时传 `entry.title`，不得传展示 fallback                                    | titled 与 untitled entry 输入语义明确                      |
| `packages/app/src/components/import-session-sheet-view-model.ts`                                   | 扩展现有统一 host-upgrade 判定                                                                            | 缺 capability 时统一阻断，不新增分散分支                   |
| `packages/app/src/components/import-session-sheet-view-model.test.ts`                              | 扩充 capability truth table                                                                               | snapshot、workspace target、title capability 的组合可读    |
| `packages/app/src/components/import-session-sheet.test.tsx`                                        | 只做既有 harness capability 默认值与精确调用期望的必要同步；不新增 mock-heavy 场景                        | 现有 import 组件回归不因新字段破坏                         |
| `packages/app/src/components/sidebar/sidebar-workspace-title.ts`                                   | Title 模式改为 `title ?? name`，Branch 模式不动                                                           | raw title 优先且两种 fallback 不回归                       |
| `packages/app/src/components/sidebar/sidebar-workspace-title.test.ts`                              | 增加 raw title 与 branch precedence cases                                                                 | 用户可见 label 合同稳定                                    |

不新增生产文件。若实施时发现必须增加另一服务、RPC、持久化迁移、路由变更或新文案，立即停止执行并重新进入 Plan Review。

## 实施顺序与原子 Checklist

1. Protocol 与 client
   - [x] 在 request schema 增加 `workspaceTitle`，在 server feature schema 增加 capability。
   - [x] 为 protocol 增加 string/null/omitted contract assertions。
   - [x] 扩展 client input 与序列化，增加 wire 三态 assertions。
   - [x] 运行 protocol/client 两个定向测试和 `build:client`，失败不得向下推进。
2. Server normalization 与持久化
   - [x] 在 `normalizeImportAgentRequest()` 中区分属性缺失，schema 外 trim，blank 归一为 null。
   - [x] 扩展 provisioning input，只在 auto-create 分支消费 `initialTitle`。
   - [x] 把存在的 title 属性传给 fresh agent import；archived restore 保持原记录。
   - [x] 扩展 AgentManager 的 imported title resolution，让 explicit null/string 覆盖 config/prompt，undefined 保持旧 fallback。
   - [x] 宣告 server capability。
   - [x] 运行 server 四个定向测试；重点检查 existing workspace 和 rollback。
3. App 与侧栏
   - [x] App 读取 capability 并扩展唯一 host-upgrade gate。
   - [x] `importAgent()` 直接传 `entry.title`，不经 `getSessionTitle()`。
   - [x] Title 模式显式优先 raw title；Branch 模式保持不变。
   - [x] 更新纯逻辑测试与既有组件测试的必要期望，不增加新的 mock-heavy 场景。
4. 收口
   - [x] 运行定向格式、build、typecheck、lint 和所有受影响测试文件。
   - [x] 检查 `git diff --check`、实际范围和 compat marker。
   - [x] 更新本任务 progress、Plan-Execution Diff、Review Verdict，并把 M-21 结果反向同步到父 Spec。

## 风险与回退

| 风险                                                | 触发条件                                 | 防护                                               | 计划回退                                          | 负责人/决策 |
| --------------------------------------------------- | ---------------------------------------- | -------------------------------------------------- | ------------------------------------------------- | ----------- |
| `null` 被 truthy/`??` 逻辑压成 omitted              | client 或 server 用真值判断展开字段      | 三态测试同时断言值和 property presence             | 回退该层改动并恢复现有 import；不带病跨层推进     | 实施者      |
| explicit null 被 provider config 或 prompt 重新命名 | AgentManager 继续让 config title 优先    | import-only override flag 与三态 agent test        | 移除 override 前先恢复 App capability gate 为阻断 | 实施者      |
| 导入到既有 workspace 时发生自动改名                 | provisioning 在 requested 分支消费 title | early-return 分支不写 registry；持久化前后对比测试 | 回退 provisioning 参数消费，保留 wire 字段兼容    | 实施者      |
| 新 App 对旧 daemon 静默退化                         | capability 未接入统一 gate               | 单一 gate 与兼容矩阵测试                           | 隐藏新行为并显示既有 Update Host 空态             | 实施者      |
| prompt preview 冒充真实标题                         | App 复用展示 helper                      | 直接传 `entry.title`；组件调用期望覆盖 null/string | 回退 App 传参，不在 server 猜测                   | 实施者      |
| Branch 模式被 Title 加固改变                        | helper 合并两种模式                      | 分支优先与无分支 fallback 测试                     | 单独回退 sidebar helper，不回退持久化链路         | 实施者      |
| 部署后回退留下 title 数据                           | 新版本已成功持久化标题                   | title 是现有合法字段，无迁移                       | 代码回退不删除合法 title；无需数据回滚            | 发布负责人  |

## 验收与验证计划

### 定向行为验证

| 验收项                    | 预期证据                                                        | 命令/步骤                                                                                                                                                                                  | 未满足时处理              |
| ------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------- |
| Protocol 三态与兼容       | import request string/null/omitted 通过，旧 shape 继续通过      | `rtk npx vitest run packages/protocol/src/messages.workspaces.test.ts --bail=1`                                                                                                            | 停在 Protocol 阶段        |
| Client wire               | 捕获 envelope 精确包含 string/null，undefined 无属性            | `rtk npx vitest run packages/client/src/daemon-client.test.ts --bail=1`                                                                                                                    | 不进入 server 实施        |
| Server normalization/flow | request 属性存在性、下游 input 和 archived restore 正确         | `rtk npx vitest run packages/server/src/server/agent/import-sessions.test.ts --bail=1`                                                                                                     | 修复三态后再继续          |
| Agent title               | undefined fallback、null suppression、string title 均正确       | `rtk npx vitest run packages/server/src/server/agent/agent-manager.test.ts --bail=1`                                                                                                       | 禁止以 workspace 测试替代 |
| Workspace ownership       | auto-create 有 title；requested workspace 不改名；rollback 保持 | `rtk npx vitest run packages/server/src/server/session/workspace-provisioning/workspace-provisioning-service.test.ts --bail=1`                                                             | 停止并检查所有权边界      |
| Handler 集成              | request 到 registry 的 fresh/targeted 两条链路正确              | `rtk npx vitest run packages/server/src/server/session.workspaces.test.ts --bail=1`                                                                                                        | 不声明端到端完成          |
| App gate 与传参           | capability truth table、既有 sheet 行为和精确 client input 正确 | `rtk npx vitest run packages/app/src/components/import-session-sheet-view-model.test.ts --bail=1`；`rtk npx vitest run packages/app/src/components/import-session-sheet.test.tsx --bail=1` | 不增加另一套 UI fallback  |
| Sidebar label             | Title/Branch/raw title fallback 全部通过                        | `rtk npx vitest run packages/app/src/components/sidebar/sidebar-workspace-title.test.ts --bail=1`                                                                                          | 单独回退显示加固          |

### 构建与静态门禁

按实现顺序运行，禁止全量 test suite：

1. `rtk npm run build:client`
2. `rtk npm run build:server`
3. `rtk npm run typecheck`
4. `rtk npm run lint`
5. 对以下本任务文件执行 `rtk npm run format:files --`：`packages/protocol/src/messages.ts`、`packages/protocol/src/messages.workspaces.test.ts`、`packages/client/src/daemon-client.ts`、`packages/client/src/daemon-client.test.ts`、`packages/server/src/server/websocket-server.ts`、`packages/server/src/server/agent/import-sessions.ts`、`packages/server/src/server/agent/import-sessions.test.ts`、`packages/server/src/server/agent/agent-manager.ts`、`packages/server/src/server/agent/agent-manager.test.ts`、`packages/server/src/server/session/workspace-provisioning/workspace-provisioning-service.ts`、`packages/server/src/server/session/workspace-provisioning/workspace-provisioning-service.test.ts`、`packages/server/src/server/session.workspaces.test.ts`、`packages/app/src/components/import-session-sheet.tsx`、`packages/app/src/components/import-session-sheet-view-model.ts`、`packages/app/src/components/import-session-sheet-view-model.test.ts`、`packages/app/src/components/import-session-sheet.test.tsx`、`packages/app/src/components/sidebar/sidebar-workspace-title.ts`、`packages/app/src/components/sidebar/sidebar-workspace-title.test.ts`。
6. `rtk git diff --check`
7. `rtk git status --short`，确认保留用户现有三处 E2E 修改，且无范围外生成物

本任务不要求本地全量 Playwright。若上述组合测试全部通过，Review 可用隔离的 checkout-local daemon 做一次非阻塞 smoke：从 Home 导入有真实标题的 session，确认 Title 模式显示真实标题、Branch 模式显示分支；不得连接或重启端口 `6767`。

## Checkpoint

- 当前理解：M-21 的根因是导入链路丢失 Provider 已提供的真实标题，不是 workspace 新建标题模型整体缺失。
- 核心方案：既有 request 增加 optional nullable 字段；server 保留三态；只给自动创建 workspace 应用标题；fresh agent 同步标题；App 用单一 capability gate；侧栏做显式 raw-title 优先加固。
- 关键兼容取舍：新 App 面对未宣告 `importSessionWorkspaceTitle` 的 daemon 时，整个 import sheet 使用现有 Update Host 空态，不提供静默降级路径。
- 关键数据取舍：不 backfill 历史记录；既有 workspace 与 archived agent 均不自动改名。
- 当前状态：T1-T4、静态门禁与三轴 Review 均完成；本地 WIP 为 `PASS`，尚未 stage、commit 或 push。
- 执行授权：用户已于 `2026-07-24` 回复精确字样 `Plan Approved`。

## 追踪与同步锚点

- task plan：`task_plan.md#当前操作状态`
- 最近 progress：`progress.md#2026-07-24-t4-与-review-收口`
- findings：`findings.md#调查事实与来源`
- subtask 索引：`task_plan.md#子任务与依赖`
- 文档同步决定：父 `0002` 已登记本地 WIP 完成；`origin/main` 与 `upstream/main` 在未合并前仍判缺失

## Review Verdict

| 轴                    | 结论   | 证据                                                                                                                 |
| --------------------- | ------ | -------------------------------------------------------------------------------------------------------------------- |
| Spec 质量与需求完成度 | `PASS` | Done Contract 10 项均有对应实现与定向测试；范围、三态、兼容和所有权边界明确                                          |
| Spec-Code 一致性      | `PASS` | 20 个计划产品文件均按既定签名修改；未新增 RPC、迁移、服务、路由或文案                                                |
| 代码内在质量          | `PASS` | 三态属性存在性、existing workspace、archived agent、Title/Branch 分支均有回归；typecheck、lint、格式与 diff 检查通过 |

- Overall Verdict：`PASS / local WIP complete`。
- Blocking Issues：无。
- 未执行：按项目规则未运行全量测试；未启动 checkout-local daemon 做人工 smoke。现有定向单元/集成测试已覆盖批准的合同，人工 smoke 为非阻塞项。

## Plan-Execution Diff

- 产品范围无偏差；所有计划生产文件均按 Spec 修改，未新增生产文件。
- 测试范围只扩展既有 seam；App 组件测试仅增加 host capability 默认支持夹具和精确 `importAgent()` 调用期望，没有新增 mock-heavy 场景。
- Execute 收口前再次抓取远端，`upstream/main` 从计划基线前进到 `b218267c3`；相邻改动不覆盖 M-21，也未改变本方案。

## Resume / Handoff

- 当前恢复点：任务实现和 Review 已完成，工作区保留未暂存的本地 WIP。
- 远端事实：`origin/main=b64f4f357`、`upstream/main=b218267c3` 均未包含 M-21 修复。
- 后续动作：只有用户明确授权后才 stage、commit、同步 upstream 或创建 PR；执行前应保留 upstream 在 provisioning、AgentManager 与 websocket-server 的相邻改动。
