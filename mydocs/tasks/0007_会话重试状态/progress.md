# Progress: 会话重试状态

## 2026-07-25 - 任务改挂

- 做了什么：清空 0007 的 C-12 Electron 动画内容，将任务改挂二号总表 `P-02`。
- 为什么：用户确认 C-12 属于系统 reduced motion，不再作为产品问题处理；当前要转向会话重连/重试状态。
- 筛选结果：只纳入 `P-02`；排除 `M-01` desktop smoke PID JSON 文件重试。
- 基线：`HEAD=084dca00b`、`origin/main=b64f4f357`、`upstream/main=65633004b`、fork HEAD=`6fb48efd`。
- fork 证据：`5b5d68311` 跨 protocol/server/App 共 17 个文件，只作为后续 Research 输入。
- 删除内容：两份 Electron/CDP 探针及旧 C-12 Spec、findings、plan、progress 正文。
- 产品边界：未修改产品代码、测试、协议、CodeMap 或长期 docs；Product Execution Approval 仍为 `Pending`。
- 遇到的错误：首次从主仓读取 `5b5d6831` 失败；确认提交只存在于 fork 后，改用显式 `git -C E:\Code\paseo-reclaude` 成功读取。
- 验证脚本修正：综合脚本先后遇到表达式空格、路线短表重复 ID、JS 模板反引号和外层 PowerShell 变量展开问题；停止继续修补后，改用无变量的单值查询完成统计。
- 当前状态：`Research Pending`。
- 下一步：复核 Agent/Timeline CodeMap 与当前主线 runtime retry 链路。

## Validation

- 父子文档、计数和状态一致性：通过；64 项为 `C=23/P=10/M=22/X=9`，建议统计为 `是=20/条件性=10/否或不建议=34`，E01-E23 覆盖全部引用。
- 目录清理：通过；旧 0007 目录不存在，新目录只有 SPEC、findings、task plan、progress，探针数量为 0。
- 文档格式：7 个相关文件通过 `npm run format:files`。
- `npm run lint`：通过，0 warnings / 0 errors。
- `npm run typecheck`：通过。
- `git diff --check`：通过。
- 产品测试：未运行；本轮无产品改动。

## 2026-07-25 - Provider retry 支持矩阵与 Codex 核验

- 基线纠正：当前工作分支与 `upstream/main` 分叉 55/12；远端 `refs/heads/main` 已核对为 `65633004b`，因此关键结论全部直接在该 ref 重验。
- 主线结论：`v0.2.1` 没有 `providerRuntimeState`、`provider_runtime_changed` 或 footer runtime label；fork `5b5d68311` 只接入 OpenCode。
- Codex 证据：本机 `codex-cli 0.145.0` 的稳定 app-server schema/TS bindings 明确提供 `error.willRetry`、error、threadId 和 turnId，没有 attempt/backoff/delay。
- Codex 当前行为：主线 adapter 没有 `error` 分支，通知进入 `unknown_method` 并只写 trace；因此当前不能显示 retry 状态，但具备接入“正在重试”布尔状态的上游合同。
- Provider 分层：Claude、OpenCode、OMP 可提供 attempt；Codex 只能提供布尔状态；ACP/Copilot 没有标准 retry update；Pi 当前无已知事件且本机 runtime 不可用。
- 状态决策：公共语义使用 `retrying`，attempt optional；adapter 解释原生事件、manager 持有 ephemeral state、snapshot optional 投影、terminal/恢复活动清除，不从 timeline 或错误文案反推。
- 外部资料：Context7 首次返回官方 Codex app-server README；后续精确源码查询两次传输失败，未影响本机版本 schema 结论。
- 日志检查：生产 daemon log 对 Codex unhandled/error/willRetry 的只计数检索均为 0；trace 可能未落盘，故只记录为“未捕获”，不作为反证。
- 改动边界：只更新 0007 与父表任务文档；未修改产品代码、协议、测试、CodeMap 或主 daemon。
- 收口验证：7 份相关任务文档通过定向格式检查；`npm run lint`、`npm run typecheck` 与 `git diff --check` 通过；工作区其余任务和产品改动保持不动。
- 当前状态：`Research Complete / Plan Pending`；下一步是裁定第一阶段 Provider 范围并请求精确 `Plan Approved`。

## 2026-07-25 - Codex 最小协议与测试设计

- 做了什么：将 P-02 收敛为 Codex-only；设计 optional `providerRetryMessage?: string`，用 app-server `error.message` 原文呈现 CLI 的 retry 次数，而不是新增结构化 attempt。
- 为什么：Codex `ErrorNotification` 只提供 `error`、`willRetry`、`threadId`、`turnId`。官方实现与 TUI 表明 retry 可见文案由 `message` 提供，且任一非 retry live notification 会恢复普通状态。
- 关键边界：release/WebSocket 首个可见值可为 `2/5`；不解析或补造次数；`additionalDetails` 不进 footer；warning、普通 root activity、terminal/new turn/close/reload 都清除；native turn、child/pending-child、out-of-band compact、coalescer 和 directory bootstrap 均有定向回归项。
- 持久化边界：live snapshot 可包含字段，`StoredAgentRecord`、agent list、timeline 与 replica cache 均不得保存；manager 更新必须 `persist: false`，并在 set/update/clear 时推进 `updatedAt`。
- 改动范围：只更新 0007 合同、计划和进度，以及父表 P-02 投影；产品代码、协议、测试、CodeMap 和主 daemon 均未修改。
- 当前状态：`Codex Design Complete / Product Execution Pending`；下一步是用户要求实施时给出 Execute checkpoint。

## 2026-07-26 - 上游运行时遗漏边界复核

- 做了什么：用 Codex `rust-v0.145.0` 的 app-server、retry、TUI 与 WebSocket fallback 源码复核既有设计，并同步 findings。
- 结论修正：上一阶段“Codex 只有布尔 retrying、不能显示次数”仅适用于结构化字段；现已确认 CLI 次数存在于 raw `error.message`，本阶段不再使用 optional attempt 设计。
- 新证据：`responses_retry.rs` 直接格式化 `Reconnecting... {retry_count}/{max_retries}`；release WebSocket 测试允许首条为 `2/N`；transport fallback 可为 `5/5 -> warning -> 1/5`；local/remote compact 复用相同可见 retry 文案。
- 补充防线：native `threadId` 必须先确认 root owner；`turn/completed.turn.id` 必须纳入 parser/fixture 来拒绝 stale terminal；warning 只有 root/current-native-turn 已知时清除；history replay 不得重建 retry 状态。
- 留存限制：`willRetry` 只覆盖可见的 stream/compact retry，不能承诺所有底层 HTTP retry 都会显示；`additionalDetails` 继续排除。
- 验证状态：仅任务文档已更新；产品代码、协议、测试、CodeMap 与 daemon 未修改。待完成定向文档格式和差异检查。

## 2026-07-25 - Codex retry 遗漏边界与文档收口

- 做了什么：用 Context7 官方 Codex app-server 文档和主线实际代码复核 warning、live subscription、`fetch_agents`、`AgentListItemPayload`、replica cache 与 retry budget 边界。
- 关键修正：`warning` 的 threadId 可缺失，只有已确认 root/native turn 的 runtime warning 才能清除；同一 daemon 的新订阅可恢复当前内存 retry，但 provider history、client cache 和 daemon restart 不得恢复旧文案。
- 协议取舍：活动 `fetch_agents`/`agent_update` 继续复用 `AgentSnapshotPayload` 并可携带 live 字段；`StoredAgentRecord`、`AgentListItemPayload` 和 replica cache 排除该字段，避免为活动列表另造协议类型。
- 测试清单修正：协议入口改为现有 `agent-feature-schemas.test.ts`，补入 `agent-updates-service.test.ts`、`runtime/replica-cache/index.test.ts`、`agent-directory-reconciliation.test.ts`、`use-agent-screen-state-machine.test.ts` 与 `session` list request 场景；footer 目标明确为 `agent-stream/turn-footer.tsx`。
- 改动边界：仅更新 0007 的 SPEC、findings、task plan、progress；未修改产品代码、协议、测试、CodeMap 或 daemon。
- 当前状态：`Codex Design Complete / Product Execution Pending`；下一步仍是用户要求实施时给出 Execute checkpoint，产品代码保持冻结。

## 2026-07-25 - App 投影与生命周期遗漏复核

- 做了什么：沿源码追踪 `normalizeAgentSnapshot -> Agent -> ChatAgentStateShape -> AgentScreenAgent -> AgentStreamView -> TurnFooter`，并复核 `agentStreamViewPropsEqual`、`viewState.source/sync`、close/reload/replace/archive、warning 空 thread、缺失 native turn ID、fetch-agent/MCP 详情、replica cache 与 MultiAgent review 的 parent route。
- 结论：新增字段只改 protocol 或 adapter 不足以让 footer 更新；memo 比较和 sync/source 门禁是必须的；closed/reloaded snapshot 必须主动清除 retry；`threadId` 缺失与显式 `null` 都不能默认当 root；无 native `turn.id` 的旧完成通知不能作为 stale/clear 证据；retry 的 set/clear 必须在 root route 与 native identity 校验后、Paseo foreground turn 覆盖前集中处理；UI 用户可见验证应走真实浏览器/E2E。
- 改动边界：仅补充 0007 的 SPEC、findings、task plan、progress；未修改产品代码、协议、测试、CodeMap 或 daemon。
- 验证：`npm run format:files --`（4 个 0007 文档）、`npm run lint`、`npm run typecheck` 与 `git diff --check` 均通过；未运行产品测试，因为本轮没有产品代码或测试改动。
- 当前状态：`Codex Design Complete / Product Execution Pending`；下一步仍是文档范围验证，产品 Execute 保持冻结。

## 2026-07-26 - Codex-only Execute 批准

- 做了什么：用户明确回复 `Plan Approved`，批准按冻结的 Codex-only 合同进入产品实现。
- 当前边界：只增加 `providerRetryMessage?: string`、Codex live retry 映射、manager/snapshot 投影和 footer 展示；不解析次数、不接入其他 Provider、不更新持久 CodeMap。
- 测试 seam：provider adapter 事件流、manager/snapshot 公开投影、App 状态投影与真实浏览器 footer 行为，均沿用已批准的定向测试清单。
- 工作树：产品文件当前无既有改动；其他任务文档和未跟踪目录属于用户或其他任务，必须保留。
- 当前状态：`Codex Execute Approved / Implementation In Progress`。
- 下一步：先建立 adapter 与 snapshot 的最小 failing tests，再逐层完成实现和验证。

## 2026-07-26 - Codex-only 实现与 Review 收口

- 实现：向 live `AgentSnapshotPayload` 增加唯一 optional string；Codex adapter 按 native root thread/turn 过滤 `error`/`warning`，原样发布 `error.message`；Manager 只在内存中 set/update/clear 并以 `persist: false` 发 snapshot。
- App：缺字段归一化为 `null`，replica cache 明确排除；screen state 只在 authoritative、sync idle、running 时保留文案；stream memo 与 footer memo 均纳入 retry-only 更新，footer 使用 amber 单行尾部截断。
- 边界：未解析 `N/M`，未接入其他 Provider，未写 timeline、waiter、`StoredAgentRecord`、`AgentListItemPayload` 或 client cache，未新增 capability、RPC 或通用 retry object。
- 测试：protocol、projection、snapshot、replica cache、screen state、directory、live `agent_update`、Manager 与 Codex adapter 定向回归通过；Manager 最终复验 `145/145`，`npm run build:client`、全仓 typecheck 与全仓 lint 通过。
- Review：Completion、Fidelity、Quality、Risk 三轴均为 `PASS`；全局 lint 暴露的 `handleStreamEvent` complexity 已通过两个局部私有方法消除，事件顺序和行为不变。
- 浏览器：新增真实 Playwright 用例和 WebSocket snapshot 注入 helper，覆盖 `2/5 -> 3/5 -> clear`、retry-only memo 更新、断线/stale 隐藏及长文本截断。Windows npm 脚本错误拆分浏览器名；直接 Playwright 又因 global setup 使用 POSIX `which` 和 `spawn("npx")` 导致 `ENOENT`，因此用例未执行，保留给 Linux/CI。
- Git/运行时：未 stage、commit 或 push，未触碰端口 `6767`；工作树中的 0005、设置项和其他任务改动保持不动。
- 当前状态：`Codex-only Implementation Complete / Review PASS / Windows E2E Deferred`。
- 下一步：Linux/CI 运行新增 E2E；其他 Provider 如需接入，按各自原生事件另立范围，不扩大当前协议。

## 2026-07-26 - 提交前复审与 P1 修复授权

- 复审结论：撤回既有 `Review PASS`。确认三个阻断项：旧 turn compaction 可清当前 retry、closure/null snapshot 未推进 `updatedAt`、bootstrap pending Map 可能让异步后完成的旧 retry 覆盖较新 clear。
- 用户授权：按三个 P1 做最小修复，补对应乱序测试，完成后复用现有定向验证清单并重新审查 Codex-only diff。
- 固定测试 seam：Codex adapter session subscription、AgentManager state subscription、AgentUpdatesService subscription output；按 R1 -> R2 -> R3 逐项 red/green。
- 当前状态：`Codex-only Pre-Commit Remediation In Progress / Review FAIL / Windows E2E Deferred`。
- 下一步：先写 R1 stale compaction 失败测试，不修改其他 Provider、协议形状、App UI 或无关任务文件。

## 2026-07-26 - 三个 P1 修复与最终复审

- R1：`thread/compacted` 携带 native `turnId` 时只允许匹配当前 turn 的通知清除 retry；乱序用例通过真实 `session.run()`、fake app-server stdout 和公开 subscription 验证旧 turn 不清、新 turn 会清。
- R2：`prepareAgentForClosure()` 在生成 closed/null snapshot 前调用现有 `touchUpdatedAt()`；乱序断言证明 closed snapshot 时间戳严格晚于最后 retry snapshot。
- R3：bootstrap pending upsert 按 `updatedAt` 保留较新版本；`2/5 -> 3/5 -> clear` 的 payload 构建倒序完成后只 flush clear。
- 定向验证：Codex retry `4/4`、AgentManager `145/145`、AgentUpdatesService `29/29`、projection `17/17`、protocol `8/8`、snapshot `4/4`、directory `7/7`、screen state `26/26`、replica cache `5/5` 均通过；`npm run build:client`、最终 `npm run typecheck` 与 `npm run lint` 通过。
- 已知测试限制：Codex adapter 全文件两次被既有 `resumeSession` 500ms 时序测试提前中断，该用例隔离运行 `1/1` 通过；本轮 retry filter `4/4` 通过。Windows Playwright 仍在浏览器启动前受 POSIX `which` / `spawn("npx")` 阻塞。
- 最终复审：Standards `PASS`、Spec `PASS`，没有新的 Codex-only 阻断项；未扩展其他 Provider、协议对象或 E2E 基础设施。
- Git/运行时：未 stage、commit 或 push，未触碰主 daemon `6767`；工作树其他任务改动保持不动。
- 当前状态：`Codex-only Implementation Complete / Pre-Commit Review PASS / Windows E2E Deferred`。
- 下一步：提交需用户另行授权；浏览器用例留给 Linux/CI。
