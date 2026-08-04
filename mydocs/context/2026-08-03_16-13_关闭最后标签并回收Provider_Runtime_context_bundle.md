# 关闭最后标签并回收 Provider Runtime Context Bundle

- Level：`Standard`
- Scope：任务 `0035`
- Built at：`2026-08-03 16:13`
- Updated at：`2026-08-03 16:57`
- Purpose：将用户需求、Light 记录、代码事实、兼容规则和并发约束收敛为 Heavy Research 输入。

## 1. Source Index

| 来源                                                                                      | 类型       | 提供的信息                                                                                                     | 状态      |
| ----------------------------------------------------------------------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------- | --------- |
| 当前对话需求                                                                              | 用户决策   | managed agent tab close-only、所有 provider、保留未归档会话、默认 agent 恢复、sidebar runtime 状态和图标优先级 | confirmed |
| [`0035` Light micro-spec](../micro_specs/0035_关闭最后标签后卸载会话视图.md)              | 任务记录   | 初始 Done Contract、旧行为 E2E、范围升级原因、TDD 候选 seam                                                    | confirmed |
| [`Provider Runtime CodeMap`](../codemap/2026-08-03_16-13_Provider_Runtime关闭恢复功能.md) | 源码索引   | close/archive/layout/sidebar/restore 端到端路径                                                                | confirmed |
| [`docs/agent-lifecycle.md`](../../docs/agent-lifecycle.md)                                | 项目事实源 | `closed`、runtime residency、archive 与 tab 的当前语义                                                         | confirmed |
| [`docs/rpc-namespacing.md`](../../docs/rpc-namespacing.md)                                | 协议规则   | 新 RPC 点分命名、request/response shape                                                                        | confirmed |
| [`docs/protocol-validation.md`](../../docs/protocol-validation.md)                        | 协议规则   | 双向兼容、optional 字段与 schema 限制                                                                          | confirmed |
| protocol/client/server/app 源码                                                           | 实现事实   | lifecycle、close/load、message dispatch、hidden layout、sidebar indicator                                      | confirmed |
| [`0034` micro-spec](../micro_specs/0034_侧边栏会话最后操作时间.md) 与当前 diff            | 已收口任务 | 同一 sidebar view model/row 已加入 `lastActivityAt`，0035 必须增量保留                                         | confirmed |
| 现状 Playwright 用例                                                                      | 验证证据   | 关闭最后 draft 后仍生成 1 个 replacement draft；`1 passed (58.6s)`                                             | confirmed |

## 2. Requirement Facts

1. 用户关闭任一 Paseo-managed agent tab 时，都回收该 agent 的 live provider runtime，但不 archive、不 delete 会话。
2. root agent 与 managed subagent 规则一致；provider-owned `provider_subagent` timeline tab 没有独立 `AgentSession`，仍为 layout-only。
3. 规则适用于任何 provider；Codex 只是资源占用问题的示例，不能出现 provider 特判。
4. 会话保留原 Paseo agent ID、timeline、persistence handle、workspace 关系和其他持久字段。
5. 关闭成功后目标 agent tab 卸载；全部 agent tabs 关闭后 workspace 视图卸载且不生成空 agent/draft，侧边栏仍保留入口。
6. 用户再次点击侧边栏 workspace 后，恢复会话初始默认 agent，而不是最后关闭、最近活动或布局 Map 中的 agent。
7. sidebar 必须能区分 runtime 驻留和 runtime 已关闭，因为 idle runtime 同样占用资源。
8. runtime 图标是 fallback，不覆盖已有业务状态图标：
   - loading/creating 图标优先；
   - running、needs-input、attention、完成等已有状态图标继续优先；
   - 只有当前没有其他状态图标时，才按 runtime residency 显示图标。
9. runtime 状态不能只靠不同颜色表达；必须有图标，并提供 tooltip 与 accessibility label。
10. close-only 必须按 daemon 的 authoritative close outcome 决定是否卸载；不能因 raw reject 与随后 `closed` snapshot 冲突而留下不可预测 UI。
11. 默认 agent 是创建 workspace 时与初始会话标题关联的 root agent；workspace 后续重命名不改变其身份，也不能通过标题字符串匹配反查。

## 3. Business Rules

### 3.1 Lifecycle

- `AgentLifecycleStatus === "closed"` 是“没有受 Paseo 管理的 live provider runtime”的权威状态。
- close-only 不写 `archivedAt`，不调用 provider native archive hook，不 cascade archive managed children。
- runtime 回收必须通过 `AgentSession.close()` 统一契约执行，不能按 `provider === "codex"` 分支。
- running managed agent 关闭前保留显式确认；确认的是停止并释放 runtime，而不是归档会话。
- root agent 和有独立 `AgentSession` 的 managed subagent 都执行 close-only；关闭其中一个不 cascade 关闭其他 managed agents。
- provider-owned `provider_subagent` timeline tab 不对应独立 `AgentSession`，继续 layout-only。

### 3.2 UI Transaction

- App 先完成 capability 检查，再发起 close-only RPC。
- daemon 返回 `closed: true` 后 App 才关闭目标 tab、写入必要 layout 状态；即使同时有 cleanup warning，也以权威 closed 结果卸载并提示 warning。
- daemon 返回 `closed: false`、无权威响应或 capability 缺失时，当前 tab 与交互上下文保留，并显示可理解错误/升级提示。
- 只有最后一个 agent tab 被卸载时才离开 workspace 视图；其他 agent tabs/runtime 保持不变。
- 显式关闭导致的零 agent tab 布局不得触发 replacement draft；新建/首次进入真正空 workspace 的既有 draft seed 需求应保留。

### 3.3 Reopen

- `closed` agent 保持未归档，因此可以经 `ensureAgentLoaded()` 恢复。
- App 关闭 tab 会把 agent 加入 hidden set；普通 workspace 导航不会解除 hidden。
- workspace 必须暴露稳定的默认 agent ID；首个 root agent 创建成功时建立身份关系，title 后续变化不影响该关系。
- 侧边栏重开必须携带默认 agent target，使 `openTabFocused()` 解除 hidden，并由 agent pane/timeline fetch 触发同 ID resume。
- residency 聚合和 reopen target 是两个独立维度：前者聚合全部未归档 managed agents，后者只使用 workspace 默认 agent。
- 旧 workspace 缺默认字段时，可按最早未归档 root agent的 `(createdAt, id)` 确定性推导；是否持久回填由 Innovate 选择。

### 3.4 Sidebar Presentation

- lifecycle bucket 与 runtime residency 是不同维度：`done` 可能是 idle、closed 或无 attention 的其他终态，不能据此推断进程。
- workspace 级 residency 从未归档 managed agents 的原始 lifecycle 聚合：任一非 `closed` 即 resident，全部 `closed` 才 closed。
- 业务状态 icon 分支先决议；只有分支本来不渲染 icon 时才进入 runtime fallback。
- runtime resident 与 runtime closed 必须使用不同的 lucide icon 或同一 icon 的清晰状态变体，并有本地化 tooltip/accessibility 文案；颜色只作辅助。

### 3.5 Compatibility

- 新 RPC 使用 `*.request` / `*.response` 点分 pair，不改现有 `close_items_*` archive 契约。
- 新 capability 放入 `server_info.features.*` 且为 optional。
- 新 App 连接旧 daemon 时只显示升级提示；不 archive、不本地伪造 closed、不做 silent fallback。
- 旧 App 连接新 daemon 时忽略新 capability/RPC，不影响既有功能。

## 4. Acceptance Criteria

| ID    | 验收行为                                                                                                                    | 证据类型                                      |
| ----- | --------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| AC-1  | 关闭任一 root/managed-subagent tab 后只卸载目标；关闭最后一个 agent tab 后没有 replacement draft并离开 workspace            | App policy test + Playwright                  |
| AC-2  | 目标 agent record 未归档且持久 lifecycle 为 `closed`；其他 agent lifecycle 不变                                             | server test + stored record assertion         |
| AC-3  | 目标 provider runtime 的 `close()` 被调用一次；provider-owned child tab 不调用独立 close；Codex 本地 smoke 可证明进程树退出 | manager/session test + 可选真实 provider 证据 |
| AC-4  | authoritative `closed: true` 时卸载并呈现可选 warning；`closed: false`/无响应时 tab 与视图仍可操作并显示错误                | server + App mutation/component test          |
| AC-5  | 侧边栏在无更高优先级 icon 时区分 resident/closed；loading/业务状态仍覆盖 runtime icon                                       | view-model + component test                   |
| AC-6  | runtime icon 有 tooltip、accessibility label/test ID，不只依赖颜色                                                          | component test + browser inspection           |
| AC-7  | 点击 workspace 固定打开持久 default agent ID，而非最后关闭者；若其 closed，则恢复原 persistence handle/timeline             | registry + navigation + resume + Playwright   |
| AC-8  | 任意 provider 都走同一 RPC/manager contract，无 Codex 条件分支                                                              | source review + provider-neutral tests        |
| AC-9  | 旧 daemon 缺 capability 时显示单一升级提示且不执行 close/archive                                                            | capability-gate test                          |
| AC-10 | 新旧 peer schema 双向解析，受影响单文件测试、根级 typecheck/lint 通过                                                       | protocol tests + static checks                |
| AC-11 | 新 workspace 登记初始 root agent 为默认 agent；旧 workspace 的默认目标按 `(createdAt, id)` 确定且不依赖 title               | registry/projection tests                     |

## 5. Constraints

- 当前为 `sdd-riper-one` Heavy Innovate，未收到精确 `Plan Approved` 前不得修改实现或测试代码。
- 新协议必须满足 optional、无 transform/catch/preprocess 的 wire schema 规则和点分命名规则。
- 不重启或干扰端口 `6767` 的主 daemon；E2E 使用隔离 `PASEO_HOME` / dev daemon 并在结束后回收。
- 本地只运行受影响的单个 Vitest 文件和目标 Playwright spec，禁止全量测试。
- 实现代码改动后必须运行根级 `npm run typecheck`、`npm run lint`。
- 任务 0034 已修改 `sidebar-workspaces-view-model.ts`、`sidebar-workspace-row-content.tsx` 及相关测试/i18n并收口；0035 必须在当前未提交 diff 上增量修改，不覆盖用户改动。
- 不创建 commit、branch、PR 或发布；用户未授权这些动作。

## 6. Conflicts And Ambiguities

### Confirmed conflicts

- [`docs/agent-lifecycle.md`](../../docs/agent-lifecycle.md) 当前仍声明 root tab close 会 archive；目标实现完成后需要更新为新的最后标签 close-only 边界。
- `close_items_request` 的 agent 结果包含 `archivedAt`，与 close-only 完成契约冲突，不能复用。
- 当前 `handleCloseAgentTab` 在 archive RPC 完成前就删除 tab，与“失败保留 UI”冲突。
- 当前普通 sidebar workspace click 不携带 agent target；hidden agent 不会被 reconcile 自动打开，与“点击恢复同一会话”冲突。
- 当前 `AgentManager.closeAgent()` 在 provider close failure 时仍持久化/广播 `closed` 后抛错；需要在 RPC/UI 计划中定义一致收敛方式。
- 当前 workspace descriptor 没有默认 agent 身份；workspace title 可异步/手动变化，不能承担 ID 关系。
- 当前 managed subagent tab 为 layout-only，与“关闭 managed agent tab 即回收对应 runtime”冲突；provider-owned child 则必须继续 layout-only。

### Decisions still needed

1. 默认 agent 身份：推荐持久 optional `defaultAgentId`，旧记录按 `(createdAt, id)` 推导并回填；备选是每次纯推导。
2. provider close 抛错但 daemon 已广播 `closed` 时：推荐 response 返回 `closed: true + error warning`；只有权威未关闭/无法确认时才保留 tab。备选 raw reject 会与 snapshot 竞态。

### Resolved decisions

- root agent 与 managed subagent 都 close-only；provider-owned `provider_subagent` layout-only。
- 全部 agent tabs 关闭后卸载 workspace 且不补 draft；sidebar 点击恢复初始默认 agent。
- residency 为“任一未归档 managed agent 非 `closed` 即 resident；全部 `closed` 才 closed”，不决定 reopen target。
- reopen target 禁止使用最后关闭、最近活动、Map 顺序或 title 字符串匹配。

## 7. Candidate Architecture Inputs

- Wire：候选 `agent.runtime.close.request/response`，capability 候选 `agentRuntimeClose`；均未在 Research 阶段锁定。
- Workspace identity：推荐 workspace descriptor 新增 optional `defaultAgentId`；agent 创建成功边界登记，旧记录确定性推导/回填。
- Server：Session handler -> `AgentManager.closeAgent()`；关闭后从 storage/live projection 返回 `agentId/closed/error?` 的权威结果。
- Client：`DaemonClient.closeAgentRuntime(agentId)` 使用 namespaced correlated request。
- App close command：独立纯策略/command seam 区分 managed agent 与 provider-owned child，负责确认、authoritative result 后 cleanup/navigation、失败保留。
- App projection：扩展 `WorkspaceAgentActivity` / `SidebarWorkspaceEntry`，携带 residency；reopen target 消费 workspace default agent ID，不从 activity 推导。
- UI：`WorkspaceStatusIndicator` 保持当前业务分支顺序，在空 icon 分支调用 runtime fallback renderer。

## 8. TDD Input

- 判定：`TDD`；跨协议、资源生命周期和 UI transaction，存在稳定 public seams 和明显回归风险。
- Candidate seam 1：protocol/client correlated RPC，证明点分消息与 rejection。
- Candidate seam 2：workspace registry/agent creation，证明首个 root agent 成为稳定 default，旧记录确定性兼容。
- Candidate seam 3：Session close-only handler，证明 `closed`、未归档、通用 manager 调用与 authoritative error response。
- Candidate seam 4：workspace activity/sidebar projection，证明 managed-agent residency 与 default target 相互独立。
- Candidate seam 5：workspace close command/component，证明 root/managed-subagent 成功后卸载、权威失败保留、provider-owned child layout-only。
- Candidate seam 6：sidebar indicator，证明 loading/业务状态/runtime fallback 的严格优先级与 accessibility。
- Candidate vertical RED/GREEN：建议从“首 root agent 登记为 workspace default + server RPC 关闭该 agent 后返回 closed 且 `archivedAt` 为空”开始，再纵向接 client/App；需用户在 Heavy Plan 后确认 seam。

## 9. Next Actions

1. Research 已收口，Light micro-spec 已标为 `Superseded`，总表仅索引 Heavy Spec。
2. 当前 Innovate checkpoint 选择默认身份方案与 close failure 收敛；推荐 `A + D`。
3. 选定后形成精确 File Changes、Signatures 与原子 Checklist。
4. 固定 TDD seam 后取得用户确认；最终等待精确 `Plan Approved` 才进入 Execute。

## 10. Unparsed Sources

- None。当前输入均为聊天文本、Markdown、TypeScript/TSX 和测试输出，可直接解析。
