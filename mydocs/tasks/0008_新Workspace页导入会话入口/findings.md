# New Workspace 页导入会话入口调查发现

本文件记录 `M-22` 的源码事实、入口差异、默认归属规则和 M-21 复用判断。合同见 `SPEC.md`，当前门禁见 `task_plan.md`，动作记录见 `progress.md`。

## Execute 结论

- 页面入口已按研究结论接通：当前 project cwd 进入既有 sheet，request 保持 untargeted，成功导航只使用 import response 的 workspace/agent 身份。
- 本地实现没有修改 server、protocol 或 persistence；Home 的正常列表范围、untargeted placement 和成功导航未改，P1 仅修正其 project 注册失败回传。M-21 标题链路可直接复用的判断成立。
- P1 定向回归 `96/96`、typecheck、lint、17 文件格式、diff check 与精确 staged 双轴审查已通过。用户明确将 Linux Playwright 延后，不作为当前 Windows 主场景提交门禁；隔离环境已清理。

## 任务绑定

| 字段        | 锚点                                                                    |
| ----------- | ----------------------------------------------------------------------- |
| task_id     | `0008`                                                                  |
| Parent Spec | [0002/M-22](../0002_fork改进与主线覆盖总控/SPEC.md#12-子-spec-抽取合同) |
| 关联任务    | [0005/M-21](../0005_导入会话标题传递/SPEC.md)                           |

## F1 - Git 与上游基线

| 事实                                                                                                            | 证据                          | 结论                                |
| --------------------------------------------------------------------------------------------------------------- | ----------------------------- | ----------------------------------- |
| `HEAD=084dca00b`，相对 `origin/main=b64f4f357` ahead 1                                                          | Git refs                      | ahead 提交是已完成的 M-21           |
| 最新本地 `upstream/main=65633004b`                                                                              | Git ref 与此前 `ls-remote`    | 上游复核基线已更新                  |
| `origin/main`、`upstream/main`、Research 基线 `084dca00b` 的 New Workspace screen 均未引用 `ImportSessionSheet` | `git grep` 与基线源码         | New Workspace 导入入口确实缺失      |
| 两条远端均已有 `runInImportWorkspace()` 的 untargeted fresh workspace 规则                                      | `git grep` 与当前源码         | server 默认行为不是 M-22 新功能     |
| `084dca00b` 增加 import title 传递但未修改 New Workspace screen                                                 | `git diff origin/main...HEAD` | M-21 可复用，不能替代 M-22 页面入口 |

## F2 - 三种入口的当前合同

| 入口                           | list `cwd`               | request `workspaceId` | 结果                                                     |
| ------------------------------ | ------------------------ | --------------------- | -------------------------------------------------------- |
| Home / Open Project            | 省略                     | 省略                  | Host 全局列表；按 session cwd 创建 fresh workspace       |
| Workspace 菜单                 | 当前 workspace directory | 当前 workspace ID     | 当前 workspace 列表；导入为该 workspace 的 agent tab     |
| New Workspace（Research 基线） | 尚无入口                 | 尚无 request          | M-22 应使用当前 project cwd，但保持 untargeted placement |

用户指出的“不同入口有不同标签页和 workspace 行为”与源码一致。M-22 不统一这些行为，也不把 Home 或 Workspace 入口改成当前 project 模式。

## F3 - New Workspace 已有当前项目上下文

| 位置                              | 已确认事实                                                                                             | 对 M-22 的意义                                    |
| --------------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------- |
| `packages/app/src/app/new.tsx`    | route 接收 `serverId/dir/name/projectId`                                                               | 项目入口可预选 Host 与 project                    |
| `new-workspace/project-picker.ts` | `selectedSourceDirectory` 由 `getHostProjectSourceDirectory(selectedProject, selectedServerId)` 得到   | 无需新增 project lookup 或从路径反推 UI selection |
| `new-workspace-screen.tsx`        | 已有 `selectedServerId`、runtime `client`、`isConnected`、`selectedProject`、`selectedSourceDirectory` | 导入 entry 只需消费现有 context                   |
| `new-workspace-screen.tsx`        | Research 基线只渲染 project/host/isolation/base 与 Composer                                            | 精确缺口是导入操作和 sheet/navigation 状态        |

## F4 - 当前项目列表筛选

- `ImportSessionSheet` 在收到 `cwd` 时，对每个启用 Provider 调用 `fetchRecentProviderSessions({ cwd, providers, limit })`。
- recent-session React Query key 由 `serverId`、`cwd` 和 Provider 共同确定；同路径、同 Provider 的不同 Host 不再共享缓存结果。
- `listImportableProviderSessions()` 把 request cwd 传给 provider manager，并再次用 `createRealpathAwarePathMatcher(request.cwd)` 过滤返回 session。
- path matcher 比较 lexical 与可解析 realpath 变体，目标是路径等价，不是目录树包含关系。
- 因此把 `selectedSourceDirectory` 传给 sheet 可以得到当前 project root 的 Provider session 列表；不能传 `null`，否则会退化为 Home 的 Host 全局列表。

## F5 - untargeted import 的 workspace/project 默认规则

- `ImportSessionSheet` 只在 `workspaceId` prop truthy 时把该字段放进 `importAgent()`；New Workspace 不提供该 prop 即为 untargeted import。
- `runInImportWorkspace()` 在没有 requested workspace 时调用 `createWorkspaceForDirectory(input.cwd, input.initialTitle)`。
- `createWorkspaceForDirectory()` 每次调用 `generateWorkspaceId()`，即使同 cwd 已有 workspace 也创建 fresh opaque workspace。
- 没有显式 `projectId` 时，provisioning 通过 `getOrCreateActiveByRoot()` 复用同 root 的 active project；正常 current-root 路径会落在当前 project 下。
- fresh workspace 使用 checkout/local placement；页面的 worktree isolation、base ref、prompt 和附件均不参与 import。
- symlink 别名可通过列表的 realpath 筛选，但 project registry 的 exact-root allocation 仍以路径等价规则为准。该极端边界尚未证明，应避免把它写成已保证的跨别名 project identity。

## F6 - 成功导航

- `importAgent()` 返回完整 agent snapshot，其中 `workspaceId` 是 server 创建并传给 agent manager 的权威 ID。
- `navigateToWorkspace()` 已被 New Workspace 创建链路使用，支持传入 agent tab target。
- M-22 可直接用 `{ serverId, workspaceId: agent.workspaceId, target: { kind: "agent", agentId: agent.id } }` 导航，不需要先 `project.add`、按 cwd 查 workspace 或经过 Home agent route。
- import response 缺失 workspace ID 时，entry 抛出携带 `agentId` 的 `ImportedSessionWorkspaceMissingError`；sheet 在回调成功前不会关闭，因此该失败会显示为可见的 mutation error。
- 这条导航不会改变另外两个入口的现有策略。

## F7 - 0005/M-21 复用边界

| 范围                        | 复用结论                                                           |
| --------------------------- | ------------------------------------------------------------------ |
| Provider title 到 request   | 直接复用当前 `ImportSessionSheet` 的 `workspaceTitle: entry.title` |
| server title 三态           | 直接复用 M-21 的 omitted/null/string 语义与 capability gate        |
| workspace/project placement | 使用更早主线默认规则，不归因于 M-21                                |
| tab navigation              | 使用既有 workspace tab model，不归因于 M-21                        |
| New Workspace entry         | M-21 未实现，必须由 M-22 新增                                      |

## F8 - 最窄测试 seam

- `new-workspace-screen.tsx` 超过 2000 行且没有 screen-level test；为一个入口建立整屏 mock harness 成本和脆弱性过高。
- 一个 colocated entry 组件可以真实渲染 Button 与 `ImportSessionSheet`，只接收当前 server/client/cwd/disabled，并自行处理成功导航。
- 纯 entry model 覆盖没有 cwd 时禁用、返回 workspace/tab 导航和缺失 workspace ID；Playwright 覆盖入口、sheet 和当前 cwd。默认 daemon 尚无可选的 deterministic provider session，故 import request 的无 `workspaceId` 与真实导航仍是显式 E2E 缺口。
- `import-session-sheet.test.tsx` 复用现有 JSDOM harness，将真实 sheet 接到真实 Home completion helper；provisioning service tests 继续只作 server 回归基线。

## F9 - 最终审查问题与修复证据

| 审查问题                                 | RED 证据                             | 修复与 GREEN 证据                                                         |
| ---------------------------------------- | ------------------------------------ | ------------------------------------------------------------------------- |
| recent-session cache 未按 Host 隔离      | 切换 Host 后仍显示 `Host A session`  | pure query-root 回归加入 `serverId`，避免同 cwd/provider 的 Host 共享 key |
| 完成回调失败前 sheet 已关闭              | `onImported` 抛错后 sheet DOM 已卸载 | pure completion 回归在 rejection 时不调用 `onClose` 或 targeted tab       |
| 缺失 workspace ID 缺少可识别的错误上下文 | 原实现只抛出普通 `Error`             | `ImportedSessionWorkspaceMissingError` 携带 imported agent 的 `agentId`   |

额外文档漂移已同步修正：entry 测试路径由 `.test.tsx` 改为实际的 `.test.ts`；补充 Home failure 组件可见性后，P1 的 source-level 定向回归为 `96/96`。

## F10 - 异步 Home 完成回调

- 后续 staged review 证明 F9 的 callback failure 回归只覆盖同步 `throw`：`onImported` 被声明为 `void`，sheet 也未等待返回值。
- Home 的 `handleImported` 原先启动未等待的 `openImportedProject()`；其 `{ ok: false }` 结果会在 sheet 已关闭后被静默忽略。
- 修复后的 callback 类型为 `void | Promise<void>`，sheet 在 `onClose` 前等待它；Home 将 project 注册失败转换为 rejection。共享 completion seam 断言失败时不关闭/不打开 targeted tab，组件组合回归进一步断言真实 sheet 显示错误且不关闭、不导航。完整 Home 页面 E2E 仍需要真实可导入 provider-session fixture。

## 未验证项

| 项目                                                    | 当前判定         | Execute 时处理                                          |
| ------------------------------------------------------- | ---------------- | ------------------------------------------------------- |
| symlink alias session 是否仍复用 UI 当前 project record | 非主路径，未保证 | 不扩当前计划；若 normal path 红测失败则回到 Plan Review |
| 旧 daemon 不支持 M-21 title capability                  | 已有明确 gate    | 沿用 Update Host 空态，不新增降级路径                   |

## F11 - Linux E2E 执行边界

- 本机没有 WSL Linux 发行版；Windows global setup 不能作为 Linux E2E 证据。
- 用户授权后，`tencent-ssh` Docker context 使用一次性 Playwright `v1.56.1-noble` 容器，并只复制 `HEAD` 加 8 个 M-22 产品/E2E 文件，排除 `.dev`、`node_modules`、任务文档和无关未跟踪内容。
- 容器在 `npm ci` 阶段写入约 `621MB` 后，Docker 返回 `no space left on device`；目标 Playwright 尚未开始。已删除该容器和本地临时副本，不清理任何远程既有容器、镜像或卷。

## F12 - Home 失败可见性与第二次 Linux 重试

- 两个分离的 pure seam 测试不足以直接证明用户能在 sheet 中看到 Home project 注册失败；新增组件组合回归使用真实 `ImportSessionSheet` 和真实 `completeImportedProjectSession()`，断言错误文案可见、sheet 不关闭、agent 不导航。
- 默认 E2E daemon 仍没有确定性可导入 Provider session，因此完整 Home 页面 E2E 和完整 import/navigation E2E 仍是残余测试缺口；新增 Playwright 只覆盖 New Workspace 入口、sheet 与 current-project fetch cwd。
- 第二次 `tencent-ssh` 隔离容器已避开磁盘和生命周期脚本问题，但 detached 安装后 sshd 无法返回 banner，目标 Playwright 未启动。主机恢复后确认同名容器已不存在，本地临时副本已删除；用户明确将 Linux 验证延后。
