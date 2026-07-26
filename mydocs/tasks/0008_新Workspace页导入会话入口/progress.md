# New Workspace 页导入会话入口进度

## 2026-07-25 初始立项（已被纠正）

- 初始判断误把 M-22 定义为“fresh workspace ID 到 agent tab 的组合回归”。
- 该判断确认了 server 默认规则和 M-21 复用边界，但把已存在的行为当成主要交付物，偏离了用户需要的 New Workspace 页面入口。
- 旧计划中的单个 server 组合测试不再是 M-22 的实施目标；未执行该测试修改。

## 2026-07-25 目标纠正与 Feature Spec 重写

- 用户纠正：核心目标是在 New Workspace 页新增“Import session”入口；默认加载当前 project sessions，并通过既有 untargeted import 在当前 project 下创建 fresh workspace 承接 imported agent/tab。
- 页面证据：route 和 screen 已有 `selectedServerId`、`selectedProject`、`selectedSourceDirectory`、runtime client 与连接状态，但没有 `ImportSessionSheet` 入口。
- 列表证据：sheet 会把 cwd 发给 `fetchRecentProviderSessions()`；server 使用 realpath-aware matcher 二次过滤。
- placement 证据：不传 `workspaceId` 时，server 每次生成 fresh workspace ID，并通过 active exact-root project allocation 复用当前 project。
- 导航证据：import response 已包含 agent 的权威 `workspaceId`，可直接交给 `navigateToWorkspace()` 和 agent tab target。
- 入口边界：Home 继续是 Host 全局 untargeted import；Workspace 菜单继续是当前 workspace targeted import；M-22 不统一或重写两者。
- 复用结论：M-21 的标题字段、三态语义和 capability gate 可直接复用；workspace/project placement 与 tab model 来自更早主线。
- 文档变更：任务目录更名为 `0008_新Workspace页导入会话入口`，四份记录全部重写；父 `0002` 同步改为页面入口缺口。
- 执行状态：`LOCKED`，等待精确 `Plan Approved`；未修改产品或测试文件。

## 当前验证

| 验收项                   | 状态    | 说明                                                                          |
| ------------------------ | ------- | ----------------------------------------------------------------------------- |
| Git/source/upstream 复核 | `PASS`  | 三个基线均无 New Workspace import entry；untargeted 默认规则存在              |
| 当前 project context     | `PASS`  | `selectedSourceDirectory` 来自当前 selected project/Host                      |
| 列表与 placement 链      | `PASS`  | cwd 双层筛选、fresh workspace、active root project 复用已由源码和既有测试确认 |
| M-21 复用边界            | `PASS`  | 只复用标题/capability；不归因 workspace/navigation                            |
| 文档格式与链接           | `PASS`  | 11 个相关文件格式通过；M-21/M-22 父子路径与 anchors 可达；M-22 旧引用为零     |
| 总表统计与证据闭包       | `PASS`  | 64 个唯一 ID；四组 `23/10/22/9`；E01-E23 均有定义                             |
| typecheck/lint           | `PASS`  | typecheck 退出码 0；lint 为 0 warnings、0 errors；无生成文件漂移              |
| Git 范围                 | `PASS`  | `git diff --check` 通过；仅保留既有 0005 改动和未跟踪任务文档                 |
| 产品定向测试             | not run | 本轮只获授权修正文档；产品 Execute 仍锁定                                     |
| 全量测试                 | not run | 项目明确禁止本地全量测试                                                      |

## 2026-07-25 Plan Approved 与 Execute 启动

- 用户回复精确字样 `Plan Approved`；M-22 的产品代码与定向测试执行门解除，Git stage、commit、push 仍未授权。
- 当前核心目标不变：New Workspace 页使用当前 project cwd 打开既有 import sheet，以 untargeted request 创建 fresh workspace，并导航到返回 agent 的 workspace/tab。
- 当前阶段进入 T1：先建立用户可观察 seam 的失败回归，再做最小 App 入口与接线；server、protocol、persistence 和既有导入入口保持零改动。
- 已加载项目要求的 `sdd-riper-one-light`、`karpathy-guidelines` 和满足自主触发条件的 `tdd`；测试仍服从 `docs/testing.md` 的 ports/adapters 或真实 E2E 边界。

## 2026-07-25 Execute 与 Review 完成

- 新增 `NewWorkspaceImportSessionEntry`，复用通用 Button 和既有 `ImportSessionSheet`；页面只传 `selectedServerId`、runtime client、`selectedSourceDirectory` 和阻塞状态。
- sheet 调用明确不传 `workspaceId`。成功后通过纯 helper 使用 imported agent 的权威 `workspaceId` 与 `{ kind: "agent", agentId }` 导航；兼容 schema 返回缺失 workspace ID 时显式拒绝，不建立 fallback。
- 为避免 Node 单测加载 React Native Flow 源，纯禁用/导航 seam 放入同目录 `import-session-entry-model.ts`，没有引入组件 mock。
- 新增真实 UI Playwright 用例，断言入口可见可用、sheet 打开，并从 WebSocket frame 观察 fetch request 的 cwd 等于当前 project root。
- 验证通过：entry `3/3`、import sheet `17/17`、workspace provisioning `32/32`、`npm run typecheck`、`npm run lint`（0 warnings / 0 errors）、目标文件格式化和 `git diff --check`。
- Playwright 用例未在 Windows 本机执行：现有 global setup 依赖 Unix `which`，并以裸 `spawn("npx")` 启动 Metro，分别失败于 command not found 与 `ENOENT`；未为 M-22 修改 harness，留给 Linux/CI。
- 隔离 smoke 使用 `6768` daemon 与 `8081` Expo Web，未触碰 `6767`。`1440x900` 与 `390x844` 下入口均无重叠，desktop modal 与 compact bottom sheet 均可打开，列表实际显示 `E:\Code\paseo` project sessions。
- Review：`PASS WITH WINDOWS E2E LIMITATION`。server、protocol、persistence、Home 导入和 Workspace targeted import 均未修改；工作树未 stage、commit 或 push。

## 2026-07-25 最终审查修复启动

- 最终 diff 审查撤销此前预写的 PASS：recent-session query key 缺少 `serverId`，同 cwd/Provider 的跨 Host 缓存会复用；`onImported` 抛错发生在 sheet 关闭之后，失败状态不可见；缺失 workspace ID 只抛普通 `Error`，没有携带结构化 agent 上下文。另发现 Spec 的 seam 测试命令误写为 `.test.tsx`。
- 用户已明确授权修复三项代码问题并补定向测试。当前核心目标仍是 New Workspace 页按当前 Host/project 导入会话，范围只扩到既有 `ImportSessionSheet` 的 Host cache identity、后置回调失败顺序和 entry 的类型化错误。
- 当前状态：先建立跨 Host cache isolation 与回调失败可见性的 RED 回归；尚未 stage、commit 或 push。

## 2026-07-25 最终审查修复与复审完成

- 跨 Host cache isolation 回归先 RED：同 cwd/provider 切换到 Host B 后仍显示 `Host A session`；query key 加入 `serverId` 后 GREEN。
- 完成回调失败回归先 RED：`onImported` 抛错前 sheet 已关闭、DOM 为空；完成回调移到 `onClose` 前后 GREEN，错误文案保持可见且 `onClose` 未调用。
- 缺失 workspace ID 改为 `ImportedSessionWorkspaceMissingError`，错误实例携带 imported agent 的 `agentId`。
- 最终定向测试通过：entry `3/3`、sheet `19/19`、provisioning `32/32`，合计 `54/54`。
- `npm run typecheck` 通过；`npm run lint` 为 0 warnings、0 errors；12 个目标文件的 `format:files -- --check` 和 `git diff --check` 通过，无生成文件漂移。
- 根级 `format:check` 脚本固定扫描 `.`，即使追加路径仍报告 2934 个全仓基线格式问题；本轮没有运行全仓格式化，也没有修改 M-22 之外的文件来处理该基线。
- Review：`PASS WITH WINDOWS E2E LIMITATION`。新增 Playwright 用例仍因现有 Windows harness 的 Unix `which` 与裸 `spawn("npx")` 限制未执行；本轮未重启 `6767`，未 stage、commit 或 push。

## 2026-07-25 P1 异步完成回调修复启动

- 后续 staged review 发现：`ImportSessionSheet` 的 `onImported` 类型为同步 `void` 且未等待；Home 的 `handleImported` 以 fire-and-forget 方式执行 `openImportedProject()`，因此异步失败仍会在 sheet 关闭后发生。
- 用户授权让 `onImported` 支持并等待异步结果、补 Home 失败可见性测试、同步任务状态日期、重新暂存审查并在 Linux/CI 执行 Playwright；commit 与 push 仍未授权。

## 2026-07-25 P1 异步完成回调本地验证

- 初版通过 JSDOM/mock 复制 Home callback 的失败可见性测试随后被审查否决并移除；它不绑定真实 Home 实现，且违反 `docs/testing.md` 的测试边界。
- `onImported` 改为 `void | Promise<void>` 并在 `onSuccess` 中等待；Home 回调改为等待真实 project 注册 completion，失败时抛回 sheet。
- 替代回归：共享 sheet completion helper 覆盖异步等待与失败时不 close/tab，Home completion helper 覆盖 project 注册失败拒绝和不导航；直接 Home error UI E2E 仍需要可导入的默认 provider fixture。
- Linux E2E 尚未运行：本机没有 WSL 发行版；当前 Docker context 为远程 `tencent-ssh`，未在未获授权前复制未提交工作树到该环境。

## 2026-07-26 P1 暂存与 Linux E2E 执行

- 用户授权后，从 `HEAD` 导出受跟踪源码并仅叠加 8 个 M-22 产品/E2E 文件；副本排除 `.dev`、`node_modules`、任务文档、Git 历史和无关未跟踪内容。
- `tencent-ssh` 上的 Playwright `v1.56.1-noble` 容器在 `npm ci` 后耗尽 Docker 存储，后续 `docker exec` 返回 `no space left on device`；目标用例没有开始，不能标记 PASS 或 FAIL。
- 已删除唯一创建的远程容器（约 `621MB` 可写层）和本地临时副本；没有停止、删除或清理任何远程既有容器、镜像、卷或主 daemon。
- 下一步：重跑静态检查后精确暂存 17 条 M-22 路径并完成 staged review；Linux E2E 需在有足够磁盘的环境重新执行。

## 2026-07-26 P1 纯 seam 回归与记录校正

- 新增 `buildRecentProviderSessionsQueryRoot()` 与 `completeImportedSession()`，使 cache identity 和 awaited completion 可在不挂载组件的情况下测试。
- 新增 `completeImportedProjectSession()`，由真实 Home callback 调用；其失败会拒绝回调，因而共享 sheet mutation 保持错误状态而不提前关闭。
- 定向回归：sheet view model `34/34`、Home completion `9/9`、既有 sheet `17/17`、entry model `3/3`、provisioning `32/32`，合计 `95/95`。
- 已通过：本轮 typecheck、lint 与 `git diff --check HEAD`。17 条精确路径已暂存；尚待：17 文件格式复验、staged review、隔离 Linux Playwright；不提交或 push。

## 2026-07-26 Home 失败可见性回归与 Linux 重试阻塞

- 补充真实 `ImportSessionSheet` 与 `completeImportedProjectSession()` 的组件组合回归：import 成功后 project 注册失败时显示 sheet 错误，且不关闭、不导航。sheet `18/18`，定向回归合计 `96/96`。
- `npm run typecheck` 再次通过；`npm run lint` 为 0 warnings、0 errors；没有生成文件漂移。
- `tencent-ssh` 上复用 `paseo-m22-e2e-20260726-1150` 隔离容器，以 `npm ci --ignore-scripts --prefer-offline` 避开先前生命周期脚本 `spawn ENOMEM`。attached SSH 在依赖下载后重置，改为 detached 重跑后远端 sshd 持续无法返回 banner；90 秒连接窗口仍超时。
- Playwright 目标命令尚未启动，不能记为 PASS 或 FAIL；主机恢复前也无法确认安装结果或清理该隔离容器。最终提交结论保持阻塞，Git commit 与 push 未执行。
- 17 条精确 M-22 路径已重新暂存；17 文件格式、`git diff --cached --check`、`git diff --check` 与 staged 规范/Spec 双轴审查通过，未发现新代码问题。0005 和其他未跟踪任务内容未暂存。

## 2026-07-26 Windows 主场景提交裁决

- 用户明确先不执行 Linux Playwright，以 Windows 为主要使用场景，接受该用例和完整 Home/import/navigation E2E 作为后续残余验证。
- `tencent-ssh` 恢复后确认同名隔离容器已不存在；本地临时副本 `paseo-m22-linux-20260726-1150` 已删除，隔离环境清理完成。
- 当前 17 路径 staged diff 可提交；Git commit 与 push 尚未执行。
