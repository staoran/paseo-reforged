# Progress: 推理过程展开设置即时生效

## 2026-07-27 - Spec 与执行前 checkpoint

- 做了什么：只读追踪外观开关、settings cache/storage、reasoning 渲染和 `ToolCall` 内部展开状态；核对功能引入提交与最新 `upstream/main`；建立任务 spec。
- 为什么：区分“设置没有保存”和“设置已到达组件但没有更新局部状态”，避免在错误层级补丁。
- 结果：确认 `autoExpandReasoning` 能更新并传到 reasoning；失效原因是 `defaultExpanded` 只用于 `useState` 首次初始化。选定在 reasoning 调用点按设置变化重挂载的最小方案。
- 证据：`SPEC.md#Facts--Constraints`、`packages/app/src/agent-stream/view.tsx`、`packages/app/src/components/message.tsx`、上游提交 `d96d59946`。
- 阻塞：执行门禁为 `checkpoint`，源码和测试尚未获批修改。
- 残余风险：定向 Playwright 在 Windows 上可能被既有 harness 兼容问题阻断；不把基础设施修复混入本任务。
- 下一步：获得用户批准后，以真实 UI seam 完成一个 Playwright RED/GREEN slice，再运行静态验证并回写 spec。

## 2026-07-27 - 执行批准

- 做了什么：用户批准 reasoning 调用点 key 方案、`0012` spec 范围和真实 Playwright UI seam。
- 结果：Execution Approval 更新为 `Approved`，允许进入测试与源码实现。
- 下一步：先新增回归测试并在未修复代码上确认 RED。

## 2026-07-27 - 实施、回归与收口

- 做了什么：在 reasoning `ToolCallSlot` 增加由 `autoExpandReasoning` 派生的 key；新增真实 App E2E，用 mock provider 的既有 reasoning 时间线经设置页面执行 `off -> on -> off -> on -> 手动折叠`。
- 为什么：key 只在用户切换设置时重挂载 reasoning 子树，复用 `defaultExpanded` 的初始值语义；不把通用 `ToolCall` 改为受控组件，也不影响普通工具调用。
- 结果：目标用例通过（`1 passed (59.2s)`）；`npm run format:files -- packages/app/src/agent-stream/view.tsx packages/app/e2e/appearance-reasoning.spec.ts`、`npm run typecheck` 和 `npm run lint` 均通过。
- 测试调整：RN Web 不输出预期的 `aria-expanded`，改断言详情文本的可见性；同文案会生成嵌套节点，locator 选择首个节点以保持公共 UI seam。
- 证据：`packages/app/src/agent-stream/view.tsx`、`packages/app/e2e/appearance-reasoning.spec.ts`、`SPEC.md#Validation`。
- 阻塞：无。为 Windows 本地运行临时使用 Edge config 和 child-process shim；已在验证后删除，未改动正式 harness。
- 残余风险：Windows 常规 E2E harness 的 `spawn("npx")`、`which tsx` 和默认 Chromium 缺失仍是独立问题；本任务的产品行为已有通过的浏览器证据。
- 文档同步：已更新 `SPEC.md` 与本 progress；Project Sync Scan 未发现应进入长期项目文档的稳定事实。
- 下一步：无，任务完成。
