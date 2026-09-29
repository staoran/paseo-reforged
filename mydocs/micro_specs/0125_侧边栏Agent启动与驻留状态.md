# 侧边栏 Agent 驻留与空闲资源回收 Micro Spec

## 0. 状态

| 字段               | 值                                                |
| ------------------ | ------------------------------------------------- |
| task_id            | `0125`                                            |
| 关联 0118          | `F15` Sidebar 指标；`F27` 的独立 runtime 回收入口 |
| task status        | `已完成`，回收与驻留规则已落地                    |
| document status    | `Implemented`                                     |
| depth              | `standard`                                        |
| Execution Approval | `Approved`，已授权产品代码实施                    |
| created / updated  | `2026-09-26 / 2026-09-29`                         |
| code baseline      | `work/0118-priority-features@507e66ffb`           |

## 1. 目标与完成契约

- 当前理解：用户确认先落实两个需求的实现规格：手动关闭空闲 Agent 的 runtime；关闭空闲会话页并保留 Agent 记录与侧边栏入口
- 核心目标：复用现有 runtime 释放和标签清理能力，以独立菜单命令回收资源，并在侧边栏显示当前 Workspace 的驻留 Agent 数量
- 本轮 Done Contract：第 4 节回收方案及第 5 节驻留显示、统计、状态和离线规则已实施并完成代码验证
- 已暂缓：打开页面不启动 Agent、旧 `0107` 懒加载、服务端只读历史与历史快照。当前打开、历史请求、重连和发送消息的加载语义继续沿用现状

## 2. 历史实现

| 来源                   | 已实现的行为                                                                                                                                                                           |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 旧 `0035/0049`         | 没有 live session 的 stored-only Agent 对客户端呈现 `closed`；冷启动不能沿用上次进程保存的 `idle/running` 误报驻留                                                                     |
| `023dea188`、旧 `0035` | 曾提供 `agent.runtime.close.request/response`，关闭成功后移除根 Agent 标签并保留未归档记录；本项只参考 runtime 关闭合同，不迁回整套标签关闭策略                                        |
| `7629e7ad8`、旧 `0051` | 以未归档且 `status !== closed` 的 managed Agent 按 Workspace 计数；0 不显示，1 显示 Bot，多个显示 Bot + 数量；不等同 tab 数，也不抢占左侧 Working/Needs input 状态槽                   |
| 旧 `0077`              | Agent 标识固定在元信息行右侧，避免随其他信息长度移动                                                                                                                                   |
| 旧 `0107`              | 曾尝试以 App gate 实现缓存态懒加载；用户反馈打开页面仍启动 Agent。静态核对发现面板仍查询 Provider 子 Agent，而服务端查询会加载父 Agent；本项暂缓此功能，不把旧验收记录当作当前可用证明 |

## 3. 当前代码与差异

- `docs/agent-lifecycle.md` 定义生命周期、历史状态与当前 runtime 归属的区别；部分 Provider 的进程可能在 turn 之间退出而未被及时检测，daemon 持有会话不等于操作系统级存活证明
- `packages/server/src/server/agent/agent-manager.ts` 的类型约束要求 `initializing / idle / running / error` 持有 `AgentSession`，`closed` 的 `session` 为 `null`。`error` 仍可计为 daemon 持有会话，但不能表示进程健康或初始化成功
- `AgentManager.closeAgent()` 继续承担通用生命周期释放；新增 `closeIdleAgentRuntime()` 复用同一条串行生命周期通道，在 provider close 前后二次核验 idle、权限和运行状态，并用关闭栅栏拒绝竞态新回合
- protocol/client/session 已落地 `agent.runtime.close.request/response` 与可选 `server_info.features.agentRuntimeClose` 能力标志。`workspace-screen.tsx` 的新菜单命令在服务端确认后关闭 runtime；“关闭并保留记录”再清理当前标签，不走归档分支
- `packages/app/src/utils/workspace-agent-activity.ts` 现在按 Workspace 索引 managed Agent 与驻留数量；`packages/app/src/hooks/sidebar-workspaces-view-model.ts` 和 `packages/app/src/components/sidebar/workspace-meta-row/index.tsx` 提供权威目录门控的 Bot 与数量显示
- `runtime/directory-sync/index.ts` 将当前连接的 `clientGeneration / connectionEpoch` 作为就绪来源交给 Host snapshot。缓存不会标记当前目录已同步，离线、同步中和同步失败时侧边栏隐藏数量并禁用回收命令
- 当前侧边栏 `Done` 桶仍画弱化状态点，它不表示 Agent 是否关闭。`statusBucket` 也可能受未读、错误、权限和任务运行影响，不能从它反推 runtime
- `docs/timeline-sync.md` 说明当前会话打开过的聊天可保持同步 demand，历史 fetch 会调用 `ensureAgentLoaded()`。手动关闭只释放当下 runtime；保留页面时，后续查询或重连可能再次恢复它。用户已决定暂不改这条链路

## 4. 已确认的空闲资源回收方案

### 4.1 操作入口

| 操作           | 入口                                        | 成功后的结果                                                      |
| -------------- | ------------------------------------------- | ----------------------------------------------------------------- |
| 关闭 Agent     | Workspace 的 `…` / 右键菜单；Agent 标签菜单 | 释放指定 Agent runtime，保留当前页面与 Agent 记录                 |
| 关闭并保留记录 | 指定 managed Agent 的标签菜单               | 释放 runtime 后移除当前标签，保留 Agent 与 Workspace 的侧边栏入口 |

- Workspace 菜单统一显示“关闭 Agent”，不带 Agent 标题或状态副标题；仅一个未关闭 Agent 时直接确认，多个时打开自适应选择弹窗，按名称和短 ID 区分，可勾选后关闭或关闭全部，批量操作只确认一次
- 选择弹窗使用当前权威目录，运行中的 live Agent 禁用；“关闭全部”仅在所有候选均可关闭时启用，不按最新时间猜测目标
- Provider descriptor 不作为独立 runtime 操作对象；managed 子 Agent 可以明确选择，跨 Workspace 子 Agent 在自己的 Workspace 操作
- 本项不增加显式启动按钮或启动 RPC；打开和发送沿用现有加载入口
- 现有 `X`、快捷键关闭及批量关闭保留上游策略：根 Agent 归档，子 Agent layout-only。新的“关闭并保留记录”是独立命令，不经过根 Agent 的 archive-on-close 分支
- Web、桌面和 Native 复用现有菜单引擎；移动端沿用菜单入口，不依赖 hover

### 4.2 服务端关闭合同

- 两个命令共用一项仅闲态关闭 runtime 的能力；RPC 沿用 dotted namespaces，参考历史 `agent.runtime.close.request/response`，不复用归档、取消 turn 或 Reload 来模拟关闭
- 只对未归档且实际为 `idle`、没有 in-flight turn 和待处理权限的 managed Agent 执行关闭。`running / initializing / error` 本轮不增加强制关闭或恢复行为；前端禁用操作，服务端仍以最新状态核验
- 未归档记录已为 `closed` 或 daemon 没有 live runtime 时，返回已经关闭的成功结果；stored-only 记录的历史状态仍未关闭时，先持久化 `closed` 并发布目录更新，直接清除驻留图标，不加载 Agent
- 校验放在现有生命周期约束内，靠近实际释放点；覆盖点击后开始运行及等待期间开始运行的竞态。不得仅在 RPC handler 先查 `idle` 后调用可关闭任意状态的旧方法
- 复用现有 provider `close()`、事件排空、closed 状态持久化和广播。该闲态约束仅用于本项用户命令，不改变归档、Reload 和 Workspace teardown 的释放合同
- 保留 Agent ID、provider persistence handle、Workspace、历史、标题、attention、标签与父子关系，不调用 provider native archive。runtime 关闭作用于所有客户端；独立 managed 子 Agent 不自动级联关闭或归档
- `idle` 只说明没有当前 Agent turn，不证明 runtime 内没有后台 shell、watch 或 Provider 子任务。关闭确认说明这些 runtime 内活动会终止，不增加后台探活系统
- 新能力由单个可选 `server_info.features.*` 标志声明“支持仅闲态关闭”，App 在操作入口统一检查。不支持时提示更新 Host，不退化成归档，也不能只凭旧版泛化 runtime-close 标志认定支持

### 4.3 页面、反馈与时间

- 有 live runtime 的关闭复用 `confirmDialog`，说明保留记录及终止 runtime 内后台活动；菜单命令显示 pending 并禁用重复操作
- “关闭 Agent”在权威响应后反馈结果，不移除当前标签，不将 Workspace 标为已读或已归档。驻留标记与数量跟随 daemon 目录更新，不提前减数
- “关闭并保留记录”先等待服务端确认 runtime 已关闭，再复用 `closeWorkspaceTabWithCleanup()` 移除当前标签与其同步 demand。managed 子 Agent 还需沿用当前客户端 open-tab 标记清理；不清除其他客户端的标记
- 关闭失败、Host 离线或闲态校验失败时保留页面与记录，展示具体错误并允许重试。runtime 已关闭但标签清理失败时如实提示，不能通过归档补偿；重试可以利用重复关闭成功的合同
- 关闭最后一个标签时沿用现有空 Workspace 的处理，不增加路由或自动恢复规则。标签清理释放视图与订阅，持久历史和共享缓存继续保留
- 不新增阅读或完成时间字段；关闭后的状态变化由 0124 已确认的分组与 `statusEnteredAt` 算法处理
- 当前历史读取、查询与重连仍可重新加载 Agent；本项不承诺“保持关闭直到显式启动”。暂不保存服务端历史快照，不修改 Timeline 同步、翻页或 Provider 历史读取

### 4.4 实施与验收边界

| 模块                             | 已落地内容                                                           |
| -------------------------------- | -------------------------------------------------------------------- |
| protocol / client / session      | 增加仅闲态 runtime 关闭 RPC、能力标志与请求结果；保留现有协议兼容    |
| AgentManager / lifecycle command | 增加闲态核验、关闭栅栏、重复请求合并、stored-only 快速返回和状态发布 |
| Sidebar / Agent 标签菜单         | 增加 Workspace 明确选 Agent 的关闭命令和 Agent 标签双关闭动作        |
| workspace-screen / 标签清理      | 服务端确认后执行“关闭并保留记录”的当前标签清理和子 Agent 标记更新    |
| 既有测试与翻译                   | 覆盖关闭合同、目录来源、菜单动作、驻留索引和各 locale 文案           |

- 关键单测：idle 成功、已 closed/stored-only 不唤醒、running/initializing 拒绝、关闭与开始 turn 的竞态、provider 关闭失败、重复请求、归档记录拒绝
- 交互合同：两个入口共用关闭命令；记录与侧边栏保留；只移除选择的标签；managed 子 Agent 的其他客户端标记保留；失败不移除标签；原有 `X` 和批量归档行为保持
- 已运行 10 个相关 Vitest 文件共 469 个测试、完整 `npm run typecheck` 和完整 `npm run lint`。未做 Playwright/UI 视觉验收，也未做真实 Provider 进程释放实测

## 5. 驻留标记

### 5.1 已确认的显示与统计范围

| 项目     | 已确认方案                                                                                                                                                       |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 显示     | 采用方案一：0 个不显示，1 个显示 Lucide `Bot`，多个显示 `Bot + 数量`；固定在元信息行右侧，只读                                                                   |
| 统计范围 | 未归档、daemon 可见的 managed Agent 按各自 `workspaceId` 计数，包含同 Workspace 子 Agent；跨 Workspace 子 Agent 计入自己的 Workspace，Provider descriptor 不另计 |

- 计数包含当前会话及重启前未关闭的历史记录，不等同操作系统进程数或标签数；没有 live session 的历史记录以橙色 Bot 和 tooltip 提醒 runtime 尚未恢复
- 现有项目图标角标、工作状态槽及 0124 未读绿点继续承载原有状态；驻留标记不使用它们的位置或颜色
- 0124 的工作分组、未读视觉和时间合同已确认，本节不改变它们

### 5.2 已确认的驻留状态

| 状态或记录             | 是否计入驻留 | 原因                                            |
| ---------------------- | ------------ | ----------------------------------------------- |
| `initializing`         | 是           | daemon 已持有 provider 会话，但不表示初始化完成 |
| `idle`                 | 是           | 会话等待下一轮                                  |
| `running`              | 是           | 会话正在执行                                    |
| `error`                | 是           | 错误状态仍持有会话，不表示进程健康              |
| stored-only 未关闭记录 | 是           | 保留重启前状态，橙色提示没有 live provider 会话 |
| `closed`               | 否           | 已显式关闭且可恢复的历史记录                    |
| 已归档                 | 否           | 不属于活动目录统计范围                          |

- 以当前权威目录的 `status !== closed` 判定计数，`runtimeAttached` 区分当前持有的会话与磁盘历史记录；不增加进程探活、健康检测或额外查询
- 计入驻留与允许关闭分别判断：live `initializing / running / error` 可以计数但不可关闭；stored-only 的这些历史状态可直接关闭并清除图标

### 5.3 已确认的离线与同步规则

| Host / 目录状态                        | 驻留标记                       | 本项两个关闭命令               |
| -------------------------------------- | ------------------------------ | ------------------------------ |
| 在线，当前连接的活动 Agent 目录已同步  | 按权威数量显示，0 隐藏         | 按第 4 节能力与闲态约束启用    |
| 离线、连接中或连接错误                 | 隐藏，不将缓存数量当作当前状态 | 不可用，使用现有 Host 离线提示 |
| 在线但首次加载、重连同步或刷新尚未完成 | 隐藏，不显示部分分页数量       | 等待同步完成                   |
| Agent 目录同步失败                     | 隐藏，保留现有同步错误反馈     | 不可用，恢复同步后重新判断     |

- 未知与确知为 0 都不显示 Bot，但未知不能在提示或菜单中描述成“没有驻留 Agent”；不新增灰色 Bot、问号角标或单独加载图标
- 离线不删除已有会话、记录或缓存，也不推断远端 Agent 已停止；侧边栏沿用当前 Host 连接与错误表现
- 重连后等待当前连接目录同步提交，随后使用现有增量更新；不能仅检查 `ready` 或曾加载过的标志。复用目录来源约束及现有状态通知，必要时只补最小的就绪投影，不建立新的同步状态系统
- 第 5.2 / 5.3 节已确认并实施；本轮不包含旧懒加载、只读入口不唤醒和服务端历史副本

## 6. 状态与恢复

- 当前状态：空闲 runtime 关闭、“关闭并保留记录”、Workspace 多选关闭弹窗、橙色历史驻留标记、stored-only 直接关闭、目录来源门控和离线规则均已实施
- 下一步：需要时补做 Playwright/UI 视觉验收和真实 Provider runtime 释放实测；暂缓项不自动扩展
- 2026-09-27：完成历史驻留标记和生命周期调查；用户补充两项回收需求，并明确暂不做打开页面不启动 Agent，要求先固定其余两项方案到 spec
- 2026-09-27：用户选择方案一，固定元信息行右侧 Bot 与数量显示，按 Workspace 统计并包含 managed 子 Agent；继续讨论驻留状态与离线规则
- 2026-09-27：用户确认 `initializing / idle / running / error` 计入驻留、`closed` 与已归档不计入，以及离线或当前连接目录未同步时隐藏标记并禁用关闭操作；0125 定稿，暂不实施
- 2026-09-28：用户授权实施 0125；完成闲态 runtime 关闭、关闭并保留记录、Workspace 驻留 Bot/数量、目录来源门控、菜单动作和多语言，定向测试、typecheck 与 lint 通过
- 2026-09-29：用户确认统一关闭入口、多选或关闭全部；重启后保留历史状态并显示橙色标记，stored-only 可直接关闭；根标签普通关闭仍归档并终止 runtime
- 暂缓项：旧懒加载补漏、所有只读入口不唤醒、服务端历史副本；后续重新提出时另定规格，不自动扩大本项
- Project Sync Candidates：无
