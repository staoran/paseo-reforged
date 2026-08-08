# 审计 upstream 0.3.0 正式版冲突 Micro Spec

## 0. 状态与索引

| 字段               | 值                                                           |
| ------------------ | ------------------------------------------------------------ |
| task_id            | `0056`                                                       |
| spec layer         | `Feature Spec`                                               |
| task status        | `已收口`                                                     |
| document status    | `Closed`                                                     |
| depth              | `deep`                                                       |
| phase              | `Execute`                                                    |
| Execution Approval | `Approved`                                                   |
| Approval Source    | `User；2026-08-08：按 0056 全部推荐方案批准解决 stable 冲突` |
| file path          | `mydocs/micro_specs/0056_审计upstream_0.3.0正式版冲突.md`    |
| parent spec        | `N/A`                                                        |
| superseded by      | `N/A`                                                        |
| created / updated  | `2026-08-08 / 2026-08-08`                                    |

## 1. 目标与完成契约

- 当前理解：以已验证的 Reforged beta.4 merge commit 为基线，把 upstream `v0.3.0` 正式版合入独立 worktree，仅用于暴露和审计新增冲突
- 核心目标：区分 Git 代码冲突与 Git 未报告的意图、交互、界面冲突或重复，并给出可供用户选择的解决建议
- Done Contract：远端 tag 与基线可追溯；代码、意图、交互和界面冲突均按批准方案解决；`CHANGELOG.md` 无未合并条目；定向测试与静态检查通过；仅创建本工作树的本地 merge commit，不改动 `main`、不 push、不发布

## 2. 范围与事实

- 范围内：`v0.3.0-beta.4..v0.3.0` 的代码、协议、App 交互、界面、发布文档与生成文件差异
- 原审计范围外但获本轮授权：冲突解决、定向构建/测试、文档回写和本地 merge commit；版本发布、主工作树已有脏改动、生产 daemon `6767` 仍在范围外
- 当前任务单元：stable 增量 merge conflict audit
- 轻量评估：`升级 deep；虽然上游只新增五个提交，但需要跨代码、交互、界面和品牌/发布意图审计`
- 已确认事实：本地增量基线为 merge commit `62c18211f47942d068bb06c574b7914e8e0cd43e`；远端 tag object 为 `66dbaaead59d68d2da9a802b5337e34bdd5efa6e`，peeled commit 为 `7392e1b7673f7c6eb5131aeef0c8e3e529bce199`
- `grilling` 结论（如使用）：`N/A；基线和分析边界明确`
- 已确认事实：`git merge --no-commit --no-ff v0.3.0` 已建立未提交现场；Git 仅报告 `CHANGELOG.md` 一处 `UU`；stable 增量为 5 个提交、52 个文件、`2628 insertions / 359 deletions`
- 已确认事实：核心功能提交 `b167ee02e`（PR #2995）新增 daemon 端全量 History 搜索、跨 Host 排名、匹配高亮和 `agentHistorySearch` capability；其余提交负责 Pi 说明、Nix hash、stable changelog 与 `0.3.0` 版本
- 风险与未知：原位编辑仍由 capability gate fail-closed；本机未安装 `nix`，只保留已重算 sidecar；其余 stable History 与 Reforged 品牌/UI 合同已由本轮验证覆盖

## 3. 代码冲突与自动合并矩阵

| ID  | 类型 / 判定             | 冲突点                                                                           | 远端意图                                                                                           | 本地意图                                                                                                         | 推荐解决方式                                                                                                                                                                                                    |
| --- | ----------------------- | -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C01 | **显式冲突 / 必须处理** | `CHANGELOG.md` 顶部发布段                                                        | 把 `0.3.0-beta.1..4` 压缩为单个 `0.3.0 - 2026-08-08`，并加入 History 搜索与 Pi 0.84 的准确说明     | 保留 Reforged 独有发行记录、fork commit 链接和产品身份；历史条目还记录了目前暂时关闭的原位编辑                   | 以上游 stable `0.3.0` 段为顶部骨架，把唯一显式产品名改为 `Paseo Reforged`；保留 `0.2.5-beta.2` 及更早 Reforged 历史；在 0.3.0 顶部明确“最新消息原位编辑暂时不可用”，不删除历史 Added 记录，不直接选 ours/theirs |
| C02 | 自动合并 / **接受**     | 根与 10 个 workspace manifest、内部依赖、`package-lock.json`                     | 全线从 `0.3.0-beta.4` 晋升为 `0.3.0`                                                               | Reforged 已批准进入 0.3.0 线，但 repository、homepage、bundle、desktop identity、凭据与发布来源必须继续属于 fork | 接受全部 manifest 和内部依赖的 `0.3.0`；保留当前自动合并后的 Reforged description/repository/desktop/website 来源；lockfile 只保留与最终 manifest 对应的组合结果                                                |
| C03 | 自动合并 / **需重算**   | `nix/npm-deps.hash`                                                              | 使用 upstream stable lockfile 的 `sha256-MDuV...`                                                  | Reforged lockfile 还包含 Mermaid、Panzoom 等 fork 依赖，不能复用 upstream 固定输出 hash                          | 不接受 upstream hash 作为最终值；以合并后的 `package-lock.json` 运行项目登记的 `./scripts/update-nix.sh` 重新补全 lock signature 并计算 hash，再用 `--check` 或 Nix build 验证                                  |
| C04 | 自动合并 / **并集正确** | `messages.ts`、`daemon-client.ts`、`websocket-server.ts`                         | 增加可选 `search`、`searchScore`、`searchMatches`、`searchTruncated` 和 `agentHistorySearch: true` | 保留可选 replay/edit wire 合同，但 server 不宣告 `inPlaceEditLastUserMessage`                                    | 保留当前 schema 并集；stable 的 35 行协议/client/capability 增量在 Reforged 基线上逐项等价，继续只宣告 `agentHistorySearch`，不宣告 Edit                                                                        |
| C05 | 自动合并 / **并集正确** | `session.ts`、`session.workspaces.test.ts`、新增 `agent-history-search*`         | 对 daemon 内全部持久化 Agent 排名，搜索 workspace/title/branch/project，返回单页 top 200           | 保留 stored-only closed Agent、retry/replay 与持久化 edit eligibility                                            | 以上游搜索路径为新增只读分支，保留本地 replay/edit 分支；当前合并相对 HEAD 正好新增 upstream 的 `81 + 163` 行，没有覆盖本地逻辑；解决阶段跑对应单文件 server 测试                                               |
| C06 | 自动合并 / **接受迁移** | 删除 App `utils/score-match*`，新增 protocol `search/text-match*`，改 5 个调用点 | App 和 daemon 共享同一 matcher；History 单独 opt-in typo tolerance                                 | Provider、combobox、命令补全和目录建议必须保持原先精确 narrowing 与排序                                          | 接受迁移并删除旧副本；新实现的非 fuzzy 路径与旧 93 行实现等价，5 个既有调用点均未开启 fuzzy；只让 History 使用 typo tolerance，避免两份 matcher 漂移                                                            |
| C07 | 自动合并 / **接受并集** | 9 个 locale                                                                      | 为 History 搜索增加 `noMatches`、`tooManyMatches`、`hostLoadFailed`、placeholder 和 clear 文案     | 所有 locale 的 `appName` 必须是 `Paseo Reforged`，不能恢复 upstream 品牌                                         | 保留 45 个新增 key；9/9 `appName` 当前仍为 `Paseo Reforged`，无需另做品牌覆盖                                                                                                                                   |
| C08 | 新文件 / **接受**       | 两个 History Playwright、matcher/server/hook/highlight 单测                      | 覆盖真实 daemon 搜索、跨 Host、离线 Host、排名、拼写容错和高亮                                     | beta.4 已统一为 per-worker browser fixture，不能恢复旧 global daemon 生命周期                                    | 保留新测试；它们使用 0055 已采用的 `browser/support/fixtures` 骨架，不引入第二套 daemon 生命周期；解决阶段只跑这些受影响文件，不跑全量套件                                                                      |

## 4. 意图、交互与界面冲突矩阵

| ID  | 类型 / 判定                      | 冲突点                                      | 远端意图                                                                                       | 本地意图                                                                                                      | 推荐解决方式                                                                                                                                                                                      |
| --- | -------------------------------- | ------------------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S01 | 意图冲突 / **必须说明**          | 原位编辑历史承诺与当前 capability           | 历史搜索与 stable 发布不涉及 Reforged Edit；upstream 只提供 canonical prompt index/rewind      | Reforged changelog 曾宣布 Edit，但 0055 已决定保留实现、暂不宣告 capability                                   | server 继续 fail-closed；在 0.3.0 changelog 明示暂时不可用；恢复条件继续服从下方专项方案，不能因为 stable 发布而顺手开放                                                                          |
| S02 | 交互重复 / **暂不合并入口**      | History 搜索与 Command Center 的 Agent 搜索 | History 是 daemon 端、覆盖全部持久化会话、按相关性排名；PR 明确不把 matcher 接入 Cmd+K         | Command Center 是客户端即时入口，搜索当前聚合 Agent/Workspace/命令，并已有跳转 History 的 action              | 保留两个入口但明确职责：Cmd+K 用于当前对象与命令，History 是完整历史搜索；本次不把历史结果复制进 Cmd+K。后续若统一，必须让 Cmd+K 使用同一 RPC/capability，而不是再做客户端分页过滤                |
| S03 | capability 意图冲突 / **建议修** | 旧 daemon 时直接隐藏搜索栏                  | upstream 用单点 gate，任一目标 connected Host 不支持就隐藏字段；offline Host 只显示错误 banner | 项目规则要求缺少新 capability 时显示升级提示，且隐藏字段不应保留会在切回新 Host 后复活的旧 query              | 保留 `agentHistorySearch` 单点 gate、无 fallback；不支持时显示紧凑升级提示，并在 capability 从 true 变 false 或切到不支持 Host 时清空 query，避免不可见过滤条件复活                               |
| S04 | 交互差异 / **接受条件切换**      | 日期分组、相关性与分页                      | 有 query 时扁平相关性列表，最多 200 条，不提供 cursor；过多时提示缩小查询                      | 无 query 时 History 必须保持按日期/时间浏览和 Load more                                                       | 保留当前条件语义：输入 query 才切换为 flat relevance；清空立即恢复日期分组和分页；不为排名结果伪造 Load more                                                                                      |
| S05 | 错误/空状态冲突 / **建议修**     | 全 Host 不可达或全部请求失败                | partial failure 用 banner 命名缺失 Host；成功结果仍可用                                        | 空状态不能同时声称“还没有会话/没有匹配”，全部失败也应保留 Host 名和 retry                                     | 区分 `0 successful hosts` 与 partial failure：前者只显示带 Host 名的可重试 error state，抑制 empty/no-match；后者保留 banner + 已成功结果。补 all-offline/all-rejected 测试                       |
| S06 | 响应式 UI 冲突 / **建议修**      | SearchField 与 HostFilter 共用一行          | 新搜索框固定 `height: 20`，与 Host picker 并排，桌面最大宽 420                                 | Reforged Interface 字号为 11–24px 精确值；共享控件必须在 24px 增高，compact mobile 与长 Host 名不能挤掉搜索框 | SearchField 复用 `createControlGeometry(theme).fieldControlSm/fieldTextSm`，移除固定高度；compact/大字号时改为稳定的双行 rail 或限制 Host trigger 宽度。验证 320px、24px、长 Host 名及 Web/Native |
| S07 | 主题 token 冲突 / **建议修**     | Host error banner 使用 `palette.red[300]`   | upstream 直接使用固定红色                                                                      | Reforged 已建立 light/dark 自适应 `statusDanger` 语义色                                                       | 新 banner 改用 `theme.colors.statusDanger`；不借本次任务清理其他历史 `red[300]` 使用点                                                                                                            |
| S08 | 元素重复 / **接受**              | 搜索框内 X 与 no-match 页的“清除搜索”按钮   | X 提供随时清除，空状态按钮提供显式恢复路径                                                     | 避免两套长期并列命令或不清楚的重复入口                                                                        | 保留两者：一个属于输入控件，一个只在无结果时出现；两者调用同一清除动作，不再新增第三个入口                                                                                                        |

### 原位编辑 capability 后续方案

1. stable 合并继续保留 `replayKind: text_only`、edit RPC、provider rewind/hydrate、optimistic controller 与 `lastReplayableUserMessageId` 持久化，但 server 不宣告 `inPlaceEditLastUserMessage`
2. 以上游 canonical prompt index 为唯一消息身份；rewind 后旧 canonical row 必须消失，replacement turn 只能生成一个 immutable accepted prompt row
3. durable 资格仅由 live `text_only + messageId` 建立；refresh/restart 时同时校验 persistence identity、完整 provider history 和“该 ID 仍为最新 canonical 用户消息”，任一失败即清除并 fail closed
4. 分别为 Codex、Pi、OMP 覆盖 live、same-session refresh、daemon restart、resume、重连、pending submission、stale turn、history 前进、重复 provider echo 与 identity 变化
5. 全矩阵通过后，在同一变更中同时打开 server capability、App gate 与 Edit UI；任一 provider 未满足合同则继续 Rewind-only，不按文本猜测身份

## 5. 执行前检查点

- 当前目标：只分析 beta.4 到 stable 的新增冲突，避免重演已解决的 94 个 beta.4 冲突
- 当前进度：stable merge 现场与 C01–C08、S01–S08 审计均已完成；用户已批准全部推荐方案，代码、交互、界面和文档解决均已完成
- 当前动作是否仍服务核心目标：`是；使用 62c1821 能隔离 stable 新增差异`
- 下一步：清理验证产物，复核 merge 索引与受保护 daemon，并创建已授权的本地 stable merge commit
- 风险与回退：不 abort/reset/push/release；旧 beta.4 worktree、主工作树和 `6767` daemon 均不触碰
- 验证方式：merge base/status、unmerged paths、三方 blob、commit history、自动合并 diff 与界面/交互调用点审计
- TDD 判定、测试 seam 与验收行为：`TDD；以 History 聚合接口、History 页面可见状态和共享 SearchField 控件几何为 seam，覆盖旧 daemon 升级提示与 query 清理、全失败/部分失败、320px/24px/长 Host 名布局`
- seam 确认：`User；2026-08-08 批准 0056 全部推荐方案，其中 S03、S05、S06 已明确上述行为与覆盖要求`
- Execution Approval / Source：`Approved / User；按 0056 全部推荐方案批准解决 stable 冲突`

## 6. 执行与变更记录

- 实际改动：
  - C01：以 upstream stable 段为 `CHANGELOG.md` 顶部骨架，保留 `Paseo Reforged` 身份、旧 Reforged 历史，并明确原位编辑暂不可用
  - C02–C08：接受 stable 的 `0.3.0` manifest/协议/History 搜索/locale/测试并集；保留本地 repository、desktop identity、Edit wire 合同和 per-worker E2E fixture
  - C03：按合并后的 lockfile 重算 `nix/npm-deps.hash` 为 `sha256-kFswdLM7uSfSWzh+ei7FVY5x9tSVuNPOcCzY40ZCJ30=`
  - S03/S05：保留单点 `agentHistorySearch` gate；旧 daemon 显示升级提示并清理不可见 query；区分 partial failure 与 all-host failure，保留 Host 名和 retry
  - S06/S07：SearchField/HostFilter 在 compact、320px 和 24px Interface 下改为稳定双行布局，错误 banner 使用 `theme.colors.statusDanger`
  - 恢复路径：History Retry 绕过 probe backoff 并 supersede 旧 probe；收到 `server_info` 时通知 runtime subscriber；`useAgentHistory` 加入 `use no memo`，避免 React Compiler 缓存命令式 runtime 快照
  - 诊断清理：删除 `__0056*`、`DEBUG-0056*`、runtime identity、Hook debug 标记及 `.tmp-0056-trace-*` 产物
- 偏差与用户决策：使用已验证 beta.4 merge commit `62c1821` 为增量基线；当前 `main` 未包含该提交且有用户脏改动，不作为本轮基线
- Change Log：`2026-08-08` 核对远端 stable tag、五个增量提交并建立独立 worktree；按批准矩阵完成冲突解决、History 恢复修复、定向测试、静态检查与 merge 索引收口

## 7. 验证与完成判断

| 验收项               | 命令或步骤                                                                | 结果 | 证据                                                                                                                                                                                                        |
| -------------------- | ------------------------------------------------------------------------- | ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| tag 与基线           | `ls-remote`、`rev-parse`、commit range                                    | 通过 | tag `66dbaa...`；stable `7392e1b...`；beta.4 merge `62c1821...`                                                                                                                                             |
| Git 冲突清单         | `git status --short`、`git ls-files -u`                                   | 通过 | `git ls-files -u` 为空；`CHANGELOG.md` 已按 C01 解决并 staged                                                                                                                                               |
| stable 增量范围      | commit range、name-status、stat                                           | 通过 | 5 commits；52 files；`2628 insertions / 359 deletions`                                                                                                                                                      |
| 自动合并并集         | stable delta 对比 `git diff --cached HEAD`                                | 通过 | 协议/client/capability `35` 行、session `81` 行、workspace tests `163` 行与 upstream 增量等价；本地 Edit 字段保留且未宣告 capability                                                                        |
| History 产品语义     | PR #2995、commit body、RPC/server/hook/screen/E2E                         | 通过 | daemon 全量 metadata 搜索；跨 Host top 200；partial failure banner；query 时 flat relevance；无 transcript/cursor                                                                                           |
| 版本与品牌           | 11 个 manifest、内部依赖、locale、repository/desktop/website              | 通过 | 全部为 `0.3.0`；9/9 `appName=Paseo Reforged`；fork repository/bundle/release source 保留                                                                                                                    |
| Nix hash 适配性      | lock blob/numstat、hash sidecar、更新脚本                                 | 通过 | 合并后的 `package-lock.json` 对应 sidecar `sha256-kFswdLM7uSfSWzh+ei7FVY5x9tSVuNPOcCzY40ZCJ30=`；本机无 `nix`，未重复 prefetch/build                                                                        |
| Reforged UI 合同     | `SearchField`、`control-geometry`、0052/0022 typography 事实              | 通过 | 复用共享 geometry、compact/24px 双行 rail、长 Host ellipsis、`statusDanger`；跨 Host 320px/24px E2E 通过                                                                                                    |
| History 行为与错误态 | 两份完整 Playwright spec、Hook/Runtime/Server/Protocol/Highlight 单测     | 通过 | 单 Host `6/6`、跨 Host `4/4`、格式化后关键回归 `3/3`；Hook `19/19`、i18n resources `34/34`、push-router `7/7`；既有 HostRuntime `68/68`、Protocol `32/32`、Highlight `7/7`、Server History `18/18` 保持通过 |
| 静态与格式           | `npm run typecheck`、`npm run lint`、`npm run format`、`git diff --check` | 通过 | typecheck/lint/format 均退出 0，最终 diff check 通过                                                                                                                                                        |

- 未验证项与原因：本机未安装 `nix`，因此未运行 `prefetch-npm-deps`/Nix build；真实 Codex、Pi、OMP provider 的原位编辑专项矩阵不属于 stable merge，按 S01 延后
- 剩余风险：仅剩原位编辑 capability 的后续 provider 身份矩阵；History 搜索、错误态、响应式布局和 stable 版本/品牌已由本轮证据覆盖
- Done Contract 是否由证据满足：`是；冲突已解决、批准方案已实施、定向行为与静态检查通过，本轮创建本地 stable merge commit 后收口。`

## 8. 恢复与同步

- 状态说明：`Execute / 已收口 / Closed`
- 当前卡点：`无`
- 下一步唯一动作：`无；本轮创建本地 stable merge commit，不 push/release`
- Resume / Handoff：工作树 `E:\Code\paseo-merge-v0.3.0-stable-analysis`，分支 `merge/upstream-v0.3.0-stable-analysis`，HEAD `62c1821`，MERGE_HEAD tag object `66dbaae` / peeled stable commit `7392e1b`
- Project Sync Candidates：`无；一次性 merge 审计事实留在本任务记录`
- 长期文档同步：`N/A`

### 提交记录

| 提交信息（Commit Message）             | 提交脚注（Commit Footer） | 关联改动或阶段 | 文档同步状态 | 备注                                     |
| -------------------------------------- | ------------------------- | -------------- | ------------ | ---------------------------------------- |
| `merge: upstream v0.3.0 into Reforged` | `N/A`                     | stable merge   | `已同步`     | 已授权本地 merge commit；不 push/release |
