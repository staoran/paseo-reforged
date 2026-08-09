# 修复 stable 合并后 Playwright 合同 Micro Spec

## 0. 状态与索引

| 字段               | 值                                                          |
| ------------------ | ----------------------------------------------------------- |
| task_id            | `0057`                                                      |
| spec layer         | `Feature Spec`                                              |
| task status        | `已收口`                                                    |
| document status    | `Closed`                                                    |
| depth              | `standard`                                                  |
| phase              | `Execute`                                                   |
| Execution Approval | `Approved`                                                  |
| Approval Source    | `User；2026-08-09：按 0057 全部推荐方案批准执行`            |
| file path          | `mydocs/micro_specs/0057_修复stable合并后Playwright合同.md` |
| parent spec        | `N/A`                                                       |
| superseded by      | `N/A`                                                       |
| created / updated  | `2026-08-09 / 2026-08-09`                                   |

## 1. 目标与完成契约

- 当前理解：upstream `v0.3.0` 已通过 `6df200eed` 合入 Reforged，随后 stable 合同修正与 beta.5 changelog 已进入 `main`；GitHub CI run `31290701672` 的四个 Playwright shard 暴露 16 个此前本地定向验证未覆盖的合同冲突，本地完整受影响批次又发现 4 个过时的稳定/Windows 合同断言
- 核心目标：保留 upstream stable 的新能力与结构，同时恢复已经批准的 Reforged 产品意图；仅在测试或夹具过时时更新合同，不用放宽断言掩盖产品回归
- Done Contract：16 个首轮 CI 失败与后续 CI 暴露的交互时序问题按下表十个根因闭合；首批受影响 Playwright 59/59、C03 回归用例与 C10 重连用例 10 次重复、对应单文件 Vitest、`typecheck`、`lint`、`format`、`git diff --check` 通过；修正提交进入并推送 `main` 后新 CI 全绿；本任务不直接创建 release tag

## 2. 范围与事实

- 范围内：stable 合并后暴露的 timeline hydration、elapsed gate、mock stream、后台订阅、Markdown 文件链接、选择复制（含 Windows Chromium 双击边界）、Sidebar 时间与菜单、workspace restart 合同；对应产品代码、测试夹具、E2E 断言和任务记录
- 范围外：打开 `inPlaceEditLastUserMessage` capability、修改真实 provider 行为、重启主 daemon `6767`、发布 tag、性能优化实施
- 当前任务单元：把 CI 的 16 个失败收敛为十个可独立验证的合同修正，吸收本地批次发现的 4 个过时合同，并在全绿后把同一提交链合入 `main`
- 轻量评估：`standard；跨 App timeline、测试 gate、mock provider 与 Sidebar，但每项根因和预期行为均已有外部证据`
- 已确认事实：发布分支与 `origin/main` 当前为 `9adf4a6f8`；本地 `main` 仍保持 `928a4ccad` 且有受保护的性能文档未提交改动；stable merge 为 `6df200eed`，stable 合同修正为 `4d8c96312`
- 已确认事实：run `31290701672` 中 format、lint、typecheck、workspace tests、app tests、server tests 与 desktop tests 通过；失败仅为 Playwright shard `1/4` 12 个、`2/4` 1 个、`3/4` 2 个、`4/4` 1 个
- 已确认事实：首个 prompt trace 显示 authoritative hydration 把 thought/commentary 从一个 168px row 拆为 130px 与 90px 两个 Activity Fold row，使逻辑高度增加 52px；bottom-follow 将 `scrollTop` 从 0 调为 8，已显示用户行从 top 132 移到 124
- 已确认事实：follow-up trace 显示 gate 只截留第一条 `running agent_update`；daemon 后发的第二条 running snapshot 在释放前穿透，导致 submission-only 阶段提前出现 elapsed
- 已确认事实：本地定向 Playwright 首轮 55/59 通过，4 个红点分别是普通流文案、后台订阅集合等待器、HTML 行号默认视图和 Windows Chromium 选择/剪贴板边界；修正后四条回归均通过
- 已确认事实：main CI run `31304387729` 除 Playwright shard 4/4 外全部通过；shard 4 在两次尝试中均只失败 `viewed-agent-timelines.spec.ts` 的普通 `ten-second-stream` 旧文案断言，同分片其余 110 个用例通过、4 个跳过
- 已确认事实：全局检索只剩该 E2E 断言把普通流当成 chunked-final；`appearance-typography.spec.ts` 的同名文本是显式 timeline fixture，不属于普通流结束标记
- 已确认事实：main CI run `31305997163` 的 17 个 job 中 16 个通过；唯一失败是 Playwright shard 1/4 的 provider retry 重连用例，CI 两次与本地 5 次中的 2 次都在重连后注入 `Reconnecting... 3/5` 时找不到提示
- 已确认事实：重连后 App 会发送 `fetch_agent` / timeline refresh；现有测试在 `gate.restore()` 后才启用 `holdAgentRefresh()`，无 retry 字段的 refresh 快照可竞态覆盖随后注入的 retry 状态
- 已确认事实：在 `gate.restore()` 前过早 hold 会阻断路由恢复所需的基础 Agent 快照，本地 10/10 落入 `Workspace unavailable`；仅移动到 `expectComposerVisible` 后仍会命中瞬时旧视图，单轮继续失败
- 已确认事实：定向协议日志捕获到重连的两个独立 timeline tail 消费者：Agent 初始化与 viewed-timeline sync；成功轮在第二个 request 发出后 publish，失败轮在第二个 request 前 publish，随后 hydration 重建无 retry 的基础投影
- 风险与未知：十项修正共享 browser fixture 与 timeline 滚动路径，可能产生交叉影响；本地定向批次不是完整仓库矩阵，main CI 仍是最终证据

## 3. 冲突矩阵与计划解决方式

| ID  | 冲突点 / 失败数                         | 远端意图                                                                                                        | 本地意图                                                                                                                              | 计划解决方式                                                                                                                  |
| --- | --------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| C01 | Sidebar 时间字号 / 1                    | stable 合并后的 Sidebar token 让时间恢复为 16px                                                                 | 0052 已确认时间是 13px 的次级元数据，标题与时间不能同权重                                                                             | 产品样式恢复 13px，并保留 20px 行高、弱化颜色和 desktop/compact 几何断言                                                      |
| C02 | Markdown 行号文件链接 / 1               | stable HTML Preview 中的文件链接可点击，并沿用新的文件 pane 打开路径                                            | 从 assistant Markdown 点击 `file:line` 后仍要打开目标文件，Preview 保持可用，Source 能定位并高亮行号                                  | 让可渲染文件先进入 Preview，同时保留 Source 切换和行号高亮；E2E 同时断言两种视图，不恢复旧的强制 Source 分支                  |
| C03 | Mock 普通流结束文案 / 6                 | stable 的 chunked-final 专用场景使用新的结尾内容                                                                | 普通 `ten-second-stream` 的 rewind、submission、hidden-hot-chat 与 old-daemon 合同依赖 `_(end of synthetic stream)_` 作为稳定完成标记 | 普通模型恢复旧结束文案；新文案只由 `Emit a chunked final answer` 专用输入产生，并同步 mock provider 单测与全部普通流 E2E 断言 |
| C04 | 后台 reasoning 订阅 / 1                 | stable 最多保留 5 个 hot agents，避免后台 timeline 无界驻留                                                     | 后台 Agent 完成后仍须 catch-up，Activity Fold 自动折叠且回访可见                                                                      | 保留 5 个上限；测试逐个确认 decoy 已订阅并确认目标 Agent 最终被淘汰，再回访目标验证 catch-up，不扩大产品缓存                  |
| C05 | Sidebar 菜单结构 / 2                    | stable 将 Grouping 菜单和浮层结构调整到新的 display-preferences 交互                                            | workspace/project 右键与 kebab 必须打开同一动作，连续右键和外部关闭仍有效                                                             | 更新 E2E 选择器与共享菜单打开/关闭 helper，复用当前菜单结构；不恢复已删除元素或增加重复入口                                   |
| C06 | Workspace restart 状态 / 1              | 没有 live runtime 的重启结果按 stable 状态机落为 `closed/done`                                                  | 测试真正要证明同 cwd workspace 的 tab ownership 迁移，不应把旧运行态当 ownership 证据                                                 | 更新过时状态断言为 stable 语义，继续严格断言 agent/workspace/tab ownership 与重启后的可见归属                                 |
| C07 | Assistant selection copy / 1            | UI 可见链接标签可追加 `(line 4)`，帮助用户理解跳转位置                                                          | 复制为 Markdown 时必须保留原始链接标签和目标，不能把仅用于显示的行号装饰写入剪贴板；双击 code 不应误带反引号                          | 忽略显示行号装饰；将仅被浏览器双击吸收的相邻空白裁回 code region，真实跨界文本仍保留 Markdown；Windows 断言统一换行           |
| C08 | 首个 prompt authoritative hydration / 1 | stable Activity Fold 将 thought/commentary 拆成独立块并维持正常 bottom-follow                                   | brand-new Agent 的首个 prompt 已经显示后，authoritative history 替换不能移动该可见行                                                  | 以 `isAuthoritativeHistoryReady` 为一次性边界锚定可见用户行；hydration 完成后恢复正常 bottom-follow，不冻结后续流式滚动       |
| C09 | Follow-up elapsed gate / 3              | stable daemon 可连续发送更新更晚的 `running agent_update`                                                       | submission-only 阶段不显示 elapsed；权威 running snapshot 到达后才显示并保持连续                                                      | 让 E2E gate 在 hold 生效期间持续截留匹配更新，仅保留最新一条供 release；补 gate 单测并保留三种事件顺序的原产品断言            |
| C10 | Provider retry 重连 refresh 竞态 / 1    | stable 重连后由 Agent 初始化与 viewed-timeline sync 分别拉取 authoritative tail，使运行视图回到 daemon 权威状态 | 测试注入的 live retry 状态在当前运行视图中必须可见，直到显式 remove；两次 hydration 不能以不确定顺序覆盖该测试事件                    | gate 按 requestId 等待当前连接的两个 timeline 响应均已转发，再注入 retry；remove 前继续 hold 后续 refresh，不修改产品代码     |

### 失败用例映射

| 根因 | CI 失败用例                                                                                                         |
| ---- | ------------------------------------------------------------------------------------------------------------------- |
| C01  | `appearance-typography.spec.ts`：Sidebar activity time secondary metadata                                           |
| C02  | `file-editing.spec.ts`：Markdown preview + assistant link target in Source                                          |
| C03  | `agent-message-rewind.spec.ts` 2 个；`agent-message-submission.spec.ts` 3 个；`viewed-agent-timelines.spec.ts` 1 个 |
| C04  | `appearance-reasoning.spec.ts`：hidden chat chunked final answer                                                    |
| C05  | `sidebar-context-menu.spec.ts` 2 个                                                                                 |
| C06  | `workspace-model-restart.spec.ts` 1 个                                                                              |
| C07  | `assistant-selection-copy.spec.ts` 1 个                                                                             |
| C08  | `agent-consecutive-turns.spec.ts`：first prompt authoritative hydration                                             |
| C09  | `agent-consecutive-turns.spec.ts`：三种 follow-up event ordering                                                    |
| C10  | `agent-stream-ui.spec.ts`：provider retry message after reconnect                                                   |

## 4. 涉及文件与执行计划

| 文件或模块                                                                | 计划变化                                     | 事实源                                       |
| ------------------------------------------------------------------------- | -------------------------------------------- | -------------------------------------------- |
| `packages/app/src/agent-stream/*`                                         | 增加一次性 hydration 可见行锚定              | CI trace、`isAuthoritativeHistoryReady`、C08 |
| `packages/app/e2e/support/helpers/daemon-websocket-gate.ts`               | 持续 hold 匹配 snapshot 并释放最新值         | CI trace、C09                                |
| `packages/app/e2e/support/helpers/timeline-delivery.ts`                   | 增加包含/排除订阅等待器                      | C04 本地额外合同                             |
| `packages/server/src/server/agent/providers/mock-load-test-agent*`        | 分离普通流与 chunked-final 结束文案          | 5 个 E2E 失败、C03                           |
| `packages/app/src/components/sidebar/sidebar-workspace-activity-time.tsx` | 恢复 0052 的 13px 次级元数据样式             | 0052、C01                                    |
| selection copy 与 file-link 打开路径                                      | 保留显示增强并恢复复制/定位语义              | C02、C07                                     |
| 受影响 browser spec 及共享 helper                                         | 更新 stable 已改变的夹具、状态和菜单结构断言 | C02、C04、C05、C06、C07                      |
| `packages/app/e2e/browser/viewed-agent-timelines.spec.ts`                 | 恢复 hidden hot chat 的普通流结束标记断言    | main CI run `31304387729`、C03               |
| `packages/app/e2e/browser/agent-stream-ui.spec.ts`、provider retry gate   | 等待双 timeline hydration 后再注入 retry     | main CI run `31305997163`、C10               |
| `mydocs/micro_specs/0057_*`、`mydocs/todolist.md`                         | 记录授权、实现、验证、提交和恢复锚点         | 项目工作流                                   |

1. 先修复可由单文件单测证明的 gate、mock provider、Sidebar 样式和 copy/link 序列化
2. 再修复 hydration 锚定，并用现有 unit seam 与两组连续 turn E2E 验证滚动不回归
3. 更新确属 stable 语义变化的 E2E 夹具/断言，运行受影响 Playwright 文件与静态检查后提交；main CI 暴露的同类漏改仍在 C03 内闭合
4. 对 C10 单用例执行 10 次重复验证，确认重连 refresh 与 retry 注入顺序稳定
5. fast-forward 或等价合入 `main`、push，等待新 CI 全绿；release 进入独立发布门禁

## 5. 执行前检查点

- 当前目标：消除 stable merge 后新增的 16 个 Playwright 合同失败，同时保留 upstream stable 与已批准 Reforged 意图
- 当前进度：C01-C10 已通过三个提交进入并推送 `main`；最终 main CI 与 Docker source-build 检查全绿
- 当前动作是否仍服务核心目标：`是；每项计划均可追溯到 CI 失败或既有 0052/0056 产品决策`
- 下一步：无；beta.5 发布进入独立发布门禁，不属于本任务 Done Contract
- 风险与回退：hydration 与 bottom-follow 仍共享滚动控制器；最终 main CI 四个 Playwright shard 已覆盖该交互；不 reset/abort、不触碰 `6767`
- 验证方式：受影响单文件 Vitest；十个根因对应的 browser spec 与 C10 定向 Playwright；`npm run typecheck`、`npm run lint`、`npm run format`、`git diff --check`；最终以 main CI 全绿为证据
- TDD 判定、测试 seam 与验收行为：`N/A；16 个现有 Playwright 失败已是有效回归 seam，本轮恢复既有/已批准行为，不新增测试先行循环`
- seam 确认：`N/A；使用现有失败合同，不新增 TDD seam`
- Execution Approval / Source：`Approved / User；2026-08-09：按 0057 全部推荐方案批准执行`

## 6. 执行与变更记录

- 实际改动：恢复 Sidebar 13px 次级时间元数据；文件行号链接保留 Preview，切换 Source 后定位高亮；分离普通 mock stream 与 chunked-final 结尾文案；用 5 个真实 decoy 验证 hot-agent 淘汰与回访 catch-up；适配 stable Sidebar 菜单与 workspace restart 状态机
- 实际改动：文件链接复制排除显示用 `(line 4)`；Chromium 双击 inline code 仅裁掉浏览器吸收的相邻空白，真实跨界选择继续保留 Markdown；Playwright 剪贴板读取将 Windows CRLF 规范化为 LF
- 实际改动：authoritative hydration 以首个可见 history row 为一次性锚点，500ms settle 后恢复 bottom-follow，并在 inactive/unmount 时清理计时器；WebSocket gate 在 hold 期间持续截留同 Agent/status 更新，只释放最新 snapshot
- 实际改动：provider retry gate 按当前连接的 requestId 去重记录两个 timeline tail 响应，测试在双 hydration 完成后才注入 retry；drop 后忽略旧 socket 的迟到响应，remove 阶段继续 hold refresh
- 偏差与用户决策：`2026-08-09 用户批准 C01-C09 全部推荐方案；完整受影响批次额外暴露四个过时 Windows/stable 合同，仅在原批准的交互语义内收敛测试与边界处理`
- 偏差与用户决策：`2026-08-09 C10 为第二轮 CI 新暴露的测试交互竞态；未改产品行为，按同一 stable 合同范围增加协议屏障并记录两次失败探针`
- Change Log：`2026-08-09` 从 GitHub run `31290701672` 提取全部 16 个失败，结合 trace 与代码归并为 C01-C09；用户批准后完成实施，受影响 Playwright 首轮 55/59，闭合额外四个合同后达到 59/59
- Change Log：`2026-08-09` 提交 `64e93b04e` 推送 main 后，CI run `31304387729` 的 shard 1/2/3 与其余所有 job 通过；shard 4 的 `viewed-agent-timelines.spec.ts` 两次稳定暴露 C03 普通流文案漏改，进入追加修正
- Change Log：`2026-08-09` 全局检索确认只剩一条普通流 E2E 断言；替换为 `(end of synthetic stream)` 后，`Viewed agent timelines › a hidden hot chat stays current` 本地 `1/1` 通过
- Change Log：`2026-08-09` 提交 `9adf4a6f8` 推送 main 后，CI run `31305997163` 的 17 个 job 中 16 个通过；唯一失败 C10 在 CI 两次及本地 5 次中的 2 次复现，定位为 reconnect refresh 覆盖测试注入状态的交互时序竞态
- Change Log：`2026-08-09` 首次按恢复前 hold 验证时 10/10 失败，截图显示基础 Agent 快照被阻断并进入 `Workspace unavailable`；将 gate 边界修正为基础视图恢复后、retry 注入前
- Change Log：`2026-08-09` 第二次单轮仍失败后加入定向协议日志；两轮即捕获一绿一红，差异唯一落在第二个 timeline request 相对 publish 的顺序，改用去重 requestId 响应屏障并删除全部临时日志

### 原位编辑 capability 后续方案

- 当前保持 fail-closed：server 暂不在 `server_info.features.*` 宣告 `inPlaceEditLastUserMessage`，客户端不展示入口
- 后续建立独立任务，完成 provider / daemon / client 三层 capability 矩阵，不在 stable 合并收尾中顺带开启
- 开启前必须验证旧 daemon 与新客户端的双向兼容，并对真实 Codex、Pi、OMP provider 做最后一条用户消息的重启/回放矩阵
- 只有在用户批准分阶段开启范围、观测指标和回滚方案后，才在 server 单点宣告 capability 并开放 UI

## 7. 验证与完成判断

| 验收项              | 命令或步骤                                                                | 结果 | 证据                                                                                       |
| ------------------- | ------------------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------ |
| 失败清单            | 四个失败 job 的 `--log-failed` 摘要                                       | 通过 | 12 + 1 + 2 + 1，共 16 个失败                                                               |
| 定向单测            | 5 个受影响 Vitest 文件                                                    | 通过 | strategy `13/13`、mock provider `16/16`、gate `1/1`、selection copy `33/33`、Sidebar `5/5` |
| 定向 Playwright     | 首批 9 个受影响 browser spec                                              | 通过 | 首轮 `55/59`；四个过时合同修正后单点 `4/4`，累计 `59/59`                                   |
| CI 追加 Playwright  | `viewed-agent-timelines.spec.ts` hidden hot chat                          | 通过 | CI 两次 RED 均期待过时 chunked-final 文案；修正后本地 `1/1` GREEN                          |
| C10 定向 Playwright | `agent-stream-ui.spec.ts` provider retry reconnect                        | 通过 | 单轮 `1/1`；`--repeat-each=10 --workers=1` 为 `10/10`，无 `Workspace unavailable`          |
| 静态与格式          | `npm run typecheck`、`npm run lint`、`npm run format`、`git diff --check` | 通过 | typecheck/format 退出 0；lint `0 warnings / 0 errors`；diff check 通过                     |
| main CI             | run `31304387729`                                                         | 失败 | 17 个 job 中 16 个通过；仅 Playwright shard 4 的一条 C03 旧断言失败                        |
| 第二轮 main CI      | run `31305997163`                                                         | 失败 | 17 个 job 中 16 个通过；仅 Playwright shard 1 的一条 C10 重连时序竞态失败                  |
| 最终 main CI        | run `31310395218`                                                         | 通过 | `c017dcca1` 的 18 个 job 全部成功，四个 Playwright shard 与双平台 server/desktop 均通过    |
| Docker source build | run `31310395221`                                                         | 通过 | `c017dcca1` 的非发布 source-build 检查成功，未发布 Docker 镜像                             |

- 未验证项与原因：未运行完整本地测试套件，遵守项目的本地定向测试限制；完整仓库矩阵由最终 main CI 覆盖
- 剩余风险：本任务合同内无已知未闭合回归；beta.5 的版本、tag、资产和 prerelease 仍服从独立发布门禁
- Done Contract 是否由证据满足：`是；C01-C10 已提交并推送 main，定向验证、静态检查、最终 main CI 与 Docker source-build 检查均通过`

## 8. 恢复与同步

- 状态说明：`Execute / 已收口 / Closed`
- 当前卡点：`无`
- 下一步唯一动作：`无；beta.5 发布按独立发布门禁继续`
- Resume / Handoff：工作树 `E:\Code\paseo-release-v0.3.0-beta.5`，分支 `release/v0.3.0-beta.5`，产品与测试收口提交 `c017dcca1`
- Project Sync Candidates：`无；stable 合并的一次性合同修复留在本记录，原位编辑的长期约束已在既有 capability gate 规则中表达`
- 长期文档同步：`N/A`

### 提交记录

| 提交信息（Commit Message）                          | 提交脚注（Commit Footer） | 关联改动或阶段 | 文档同步状态 | 备注                                    |
| --------------------------------------------------- | ------------------------- | -------------- | ------------ | --------------------------------------- |
| `fix: restore stable merge contracts`               | `N/A`                     | C01-C09        | `已合入`     | `64e93b04e`；main CI 追加暴露 C03 漏改  |
| `test: align hidden hot chat mock contract`         | `N/A`                     | C03 CI 补漏    | `已合入`     | `9adf4a6f8`；run `31305997163` 暴露 C10 |
| `test: stabilize provider retry reconnect contract` | `N/A`                     | C10            | `已合入`     | `c017dcca1`；run `31310395218` 全绿     |
