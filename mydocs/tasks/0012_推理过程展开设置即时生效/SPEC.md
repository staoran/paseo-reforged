# Spec: 推理过程展开设置即时生效

## Goal

- 要解决什么问题：`设置 -> 外观 -> 详细程度 -> 始终展开推理过程` 的值虽然能保存，但切换后已挂载的推理块不展开也不折叠，用户观察到开关无效果。
- 最终目标：开关切换立即重置当前时间线内所有推理块的展开状态；设置开启时展开，关闭时折叠。
- 本轮核心目标：修复现有推理块不响应设置变化的问题，并保留切换完成后的手动展开/折叠能力。
- 验收结果：真实 App UI 中，同一个已存在的推理块能随开关 `off -> on -> off -> on` 依次折叠、展开、折叠、展开；最后一次展开后仍可由用户手动折叠。

## Done Contract

- 完成条件：现有和后续推理块都采用最新设置；设置每次变化时覆盖块的旧手动状态，变化完成后用户仍能手动切换；普通工具调用不受影响。
- 证明方式：新增一个使用真实浏览器、真实测试 daemon 和 mock provider reasoning 时间线的定向 Playwright 回归测试，并通过 typecheck、lint 与格式检查。
- 仍未完成：只证明设置值已持久化、只证明新挂载块的默认值、未覆盖同一现有块的双向切换，或手动折叠会被设置持续强制恢复。

## Scope

- In：reasoning 项的展开状态重置语义；外观设置到现有时间线的 UI 行为；定向回归测试。
- Out：普通工具调用展开逻辑、设置存储格式、文案/i18n、路由行为、Windows Playwright harness 的既有兼容问题。
- 用户已切分的任务单元：先固化问题和结论，再实现并验证所选语义。
- 轻量评估：`standard`，单项目、单一行为修复；无需升级 deep。

## Facts / Constraints

- 设置入口 `packages/app/src/screens/settings/appearance/appearance-section.tsx` 调用 `updateSettings({ autoExpandReasoning })`。
- `packages/app/src/hooks/use-settings/index.ts` 会把该字段交给 app settings 更新；`storage.ts` 定义默认值 `false`、读取布尔值并持久化。此前定向诊断已验证 `true -> false` 同时更新 Query cache 与 `@paseo:app-settings`。
- `packages/app/src/agent-stream/view.tsx` 窄订阅最新设置，并把值作为 reasoning `ToolCallSlot` 的 `defaultExpanded` 和 `forceInline`。因此设置写入和消费链路均已连通。
- 根因在 `packages/app/src/components/message.tsx`：`useState(defaultExpanded ?? false)` 只在 `ToolCall` 首次挂载时读取默认值。后续 prop 变化虽能通过 memo comparator 触发重渲染，却不会重新初始化 `isExpanded`。
- `forceInline` 只决定紧凑布局是否在时间线内渲染详情，不会更新 `isExpanded`；桌面布局本来就 inline，因此它不能补偿上述状态问题。
- reasoning 是 `ToolCall` 的唯一 `defaultExpanded` 调用方；普通工具调用不传该 prop。
- 功能由上游提交 `d96d59946` 引入；截至 `upstream/main` 的 `e859d2df12eeeda1ee254431f2e922b236918278`，实现仍保留相同根因，且没有该设置的行为回归测试。
- 项目测试只允许定向执行；修改后必须运行 `npm run typecheck` 和 `npm run lint`，不得重启主 daemon 或运行全量测试。

## Selected Semantics

- 设置变化是一次明确的状态重置事件：开启时把当前推理块设为展开，关闭时设为折叠。
- 设置值保持不变期间不强制控制每个块；用户可继续手动展开或折叠，手动结果保持到下一次设置变化或组件正常重挂载。
- 新出现或重新挂载的推理块以当时设置值为初始状态。
- 紧凑布局继续沿用现有规则：开启时 reasoning 强制 inline；关闭时恢复原有详情面板交互。

## Implementation Plan

1. [Done] 在 `renderThoughtItem` 的 reasoning `ToolCallSlot` 上使用由 `autoExpandReasoning` 派生的 React key。设置变化时仅重挂载对应 reasoning 展示，重新应用现有 `defaultExpanded`/`forceInline`；设置不变时保留用户的手动状态。
2. [Done] 新增聚焦的 `packages/app/e2e/appearance-reasoning.spec.ts`，通过 mock provider 生成真实 reasoning，沿真实外观设置路由切换开关，并断言同一 Thinking 块的详情文本出现、消失和最终手动折叠。
3. [Done] 运行目标 Playwright GREEN、目标文件格式化、根 typecheck 和 lint。

## Test Seam

- 公共 seam：用户可操作的外观设置开关、同一工作区时间线中 Thinking 块的详情文本可见性，以及 Thinking 按钮的点击行为。
- 测试不挂载组件、不读取 React 内部 state、不 mock App 模块；使用真实浏览器、真实隔离 daemon 和现有 mock provider adapter。
- React Native Web 不输出该按钮的 `aria-expanded`；详情文本会生成嵌套的同文案节点，因此 locator 只选择首个匹配节点，不依赖内部 state 或 DOM 结构计数。
- 用户已在执行 checkpoint 中确认该 seam。

## Open Questions

- 无。用户已明确选择“切换立即作用于现有推理块，但之后仍允许手动折叠”的语义。

## Restated Understanding

- 我理解当前任务是：保留现有设置与渲染链路，只修复它未能重置已挂载 reasoning 内部状态的缺口。
- 当前核心目标是：设置变化立即可见，同时避免把推理块改成无法手动折叠的永久受控组件。
- 当前边界是：最小调用点修复和一个真实 UI 回归测试。
- 暂不处理：文案调整、工具调用显示策略和 Windows E2E 基础设施整治。

## Goal Alignment Check

- 当前动作是否仍服务于核心目标：是，修复点直接位于设置值进入 reasoning 展示的唯一调用点。
- 模型当前路径是否仍在用户边界内：是。
- 是否出现更适合代码地形的水流路径：是；通过 reasoning 子树的 key 重置一次状态，比修改通用 `ToolCall` 或增加受控状态协议更小，且不会影响普通工具调用。
- 是否需要调整本轮目标或范围：否。

## Checkpoint Summary

- 当前任务理解：设置链路正常，已挂载块的 `useState` 没有响应默认值变化。
- 当前核心目标：设置切换重置现有推理块，之后继续允许手动切换。
- 当前进度：reasoning 调用点 key、真实 UI 回归测试和静态验证均已完成。
- 下一步：审阅最终工作树并收口；无待实现代码。
- 涉及文件 / 模块：`packages/app/src/agent-stream/view.tsx`、新增的 App E2E spec、本任务 spec/progress。
- 风险：key 变化会重置该 reasoning 展示的局部 hover/测量状态，但只发生在用户显式切换设置时，且展开状态重置正是目标；Windows harness 可能阻断本地 E2E 运行，需要如实记录而不扩大本次修复范围。
- 验证方式：定向 Playwright GREEN、`npm run typecheck`、`npm run lint`、目标文件格式检查。
- Execution Approval: `Approved`（2026-07-27，reasoning 调用点 key 方案与上述 Playwright seam）

## Change Log

- 2026-07-27：完成只读链路分析，确认根因不是设置持久化，而是 `defaultExpanded` 仅在首次挂载读取。
- 2026-07-27：采纳“切换时重置、之后允许手动操作”的语义；选择 reasoning 调用点 key 重置方案，避免扩大通用 `ToolCall` 状态合同。
- 2026-07-27：用户批准按本 spec 与 Playwright 公共 seam 执行。
- 2026-07-27：在 reasoning `ToolCallSlot` 增加设置派生 key，并新增真实 UI 回归测试。
- 2026-07-27：测试发现 RN Web 不提供预期的 `aria-expanded`，改用详情文本可见性这个公共结果 seam；随后处理同文案嵌套节点的 locator 严格模式问题。

## Validation

- Self-check：已检查设置入口、更新与存储、reasoning 消费点、`ToolCall` 状态、memo comparator、compact `forceInline` 分支和 `defaultExpanded` 全部调用方。
- Static checks：`npm run format:files -- packages/app/src/agent-stream/view.tsx packages/app/e2e/appearance-reasoning.spec.ts` 通过；`npm run typecheck` 通过；`npm run lint` 通过（均为 2026-07-27）。
- Runtime / Test：隔离 daemon、Metro、relay 和系统 Edge 下运行 `appearance-reasoning.spec.ts`，`1 passed (59.2s)`；覆盖 `off -> on -> off -> on -> 手动折叠`。为绕过 Windows 既有 harness 问题使用了临时 shim/config，验证后已删除。
- Human confirmation：用户已确认目标语义、实现范围与测试 seam。
- 结果汇总：调用点 key 使设置变化重新初始化 existing reasoning 的展开状态；测试证明切换完成后仍可手动折叠。
- 核心目标是否已由证据证明完成：是。
- 剩余风险：常规 Windows E2E harness 仍有 `spawn("npx")`、`which tsx` 和默认 Chromium 缺失的问题；这次未将其纳入产品代码改动。

## Resume / Handoff

- 当前状态：完成。
- 当前卡点：无。
- 下一步：无；若要治理 Windows E2E harness，需另立任务。
- 下一轮核心目标：N/A。

## Project Sync Candidates

- 是否发现可复用项目事实：No。
- 候选事实：当前根因与 Windows harness workaround 均只适用于本任务；后者也未进入项目代码，均不提升为长期项目知识。
- 同步状态：Skipped。
