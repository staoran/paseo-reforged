# 合并 upstream 0.3.0-beta.4 到 Paseo Reforged Micro Spec

## 0. 状态与索引

| 字段               | 值                                                               |
| ------------------ | ---------------------------------------------------------------- |
| task_id            | `0055`                                                           |
| spec layer         | `Feature Spec`                                                   |
| task status        | `已收口`                                                         |
| document status    | `Completed`                                                      |
| depth              | `deep`                                                           |
| phase              | `Review`                                                         |
| Execution Approval | `Approved`                                                       |
| Approval Source    | `User`                                                           |
| file path          | `mydocs/micro_specs/0055_合并upstream_0.3.0-beta.4到Reforged.md` |
| parent spec        | `N/A`                                                            |
| superseded by      | `N/A`                                                            |
| created / updated  | `2026-08-08 / 2026-08-08`                                        |

## 1. 目标与完成契约

- 当前理解：从最新本地 `main` 提交建立独立 worktree，把 upstream `v0.3.0-beta.4` 合并进 Paseo Reforged；重新审计代码冲突以及 Git 未报告的意图、交互和界面重复，不沿用旧基线的冲突数量作为执行依据
- 核心目标：得到一个可构建、可验证、无未合并标记的 Reforged 0.3.0 合并提交；保留 Reforged 品牌与发布边界；保留原位编辑实现和恢复资格，但暂不向客户端宣告 capability
- Done Contract：`git diff --name-only --diff-filter=U` 为空；冲突标记扫描为空；协议双向兼容审查、定向测试、typecheck、lint、format 通过；merge commit 只存在于本 worktree 分支；server 不宣告 `inPlaceEditLastUserMessage`

## 2. 范围、基线与事实

- 活跃 worktree：`E:\Code\paseo-merge-v0.3.0-beta.4-realigned`
- 活跃分支：`merge/upstream-v0.3.0-beta.4-realigned`
- 本地基线：`fd146bdab18115173c208239cc6df69a62b1eb1b`，即最新 `main` 的 `fix(server): preserve last-message edit eligibility after restart`
- upstream tag object：`8bb152a9716d4e400723cbc7f2e0a29feb9091b6`；tag commit：`a7c7a6e48245b6bfac039ef3f8e79c58050ba534`；`git ls-remote upstream` 已确认远端 tag object 一致
- 共同祖先：`6fc491e6220fba6543bbbe4bf1b1f58cfe59228b`
- 当前 merge：`94` 个未合并文件，其中 `91 UU`、`3 UD`；三个 modify/delete 为 App 旧 E2E global setup、旧 agent-stream helper、CLI 旧 daemon supervision test
- 与旧 beta.4 工作树相比，未合并文件集合完全一致；新基线改变了 `agent-manager.ts`、`agent-projections.ts` 的 ours 内容，并让 `agent-storage.ts`、`persistence-hooks.ts`、edit daemon E2E 等新增恢复链路自动进入 merge 结果
- 与 beta.2 初始审计相比，beta.4 保留原 80 个冲突并新增 14 个：8 个既有 locale、sidebar help E2E、New Workspace screen、worktree service、website latest release 实现/测试和 download route
- 范围内：94 个代码冲突、相关自动合并语义、版本与内部依赖、协议兼容、E2E 重组、Reforged 品牌和发布来源
- 范围外：push、公开发布、EAS 凭据配置、生产 daemon `6767`、正式 tag、原工作区脏改动、启用原位编辑 capability

## 3. 代码冲突矩阵

下表按语义覆盖全部 94 个未合并文件；一个冲突点可覆盖同一合同下的多个实现和测试文件。

| ID  | 冲突点                                                                                              | 远端意图                                                                                                                    | 本地意图                                                                                                      | 计划解决方式                                                                                                                                                                                                                              |
| --- | --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C01 | 发布说明、项目规则与架构文档：`CHANGELOG.md`、`CLAUDE.md`、README、architecture/release/public docs | 记录 upstream 0.3 的 Hub、relay、timeline、发布和安装方式                                                                   | 保留 Reforged 协作规则、品牌、fork 链接、npm/Docker compatibility 声明                                        | 保留本地规则正文和 Reforged 身份，吸收 0.3 架构事实；逐项把 issue、release、download、Docker、npm 来源标成 Reforged 或明确的 upstream compatibility                                                                                       |
| C02 | Nix desktop：`nix/desktop-package.nix`                                                              | 增加 Linux/Darwin 支持和隐藏 WM-class alias                                                                                 | 使用 Reforged 显示名、runtime name、bundle/desktop identity                                                   | 吸收平台与 alias 机制，所有用户可见名、runtime name 和 alias 改为 Reforged；不恢复 upstream 包身份                                                                                                                                        |
| C03 | 根 lockfile 和 10 个 workspace manifest                                                             | 升级到 `0.3.0-beta.4`，加入新脚本、依赖、E2E 分区和内部版本                                                                 | 保留 fork 仍在使用的脚本/依赖，当前版本仍在 0.2.5 线                                                          | 所有 Reforged workspace 及内部依赖统一到 `0.3.0-beta.4`；按调用点合并脚本/依赖，最后由 npm 重新生成 lockfile，不手工拼 integrity                                                                                                          |
| C04 | Expo identity：`packages/app/app.config.js`                                                         | 使用 upstream slug、bundle ID、scheme、EAS project 和 native beta build 编号                                                | 使用 `Paseo Reforged`、`sh.paseo.reforged*`、fork scheme、环境注入 EAS project ID 和独立凭据                  | 保留全部 Reforged identity/凭据边界；吸收 `native-release-version.js` 的 beta ordinal 计算，但不写死 upstream project ID                                                                                                                  |
| C05 | App E2E 基础设施：两个 UD 旧文件和 `support/helpers/isolated-host-daemon.ts`                        | 迁移到 `browser/`、`support/` 和 per-worker daemon，删除旧 global setup/helper                                              | 保留 Windows `node --import tsx`、fake editor/GH、fork home、relay 与隔离 daemon 合同                         | 以 upstream 目录和 worker 生命周期为唯一骨架，把本地能力迁入新 helper；确认调用点后删除两个旧 UD 文件，避免双 global setup 和双 daemon                                                                                                    |
| C06 | Agent/timeline E2E：stream、file editing、viewed timeline、restart                                  | 覆盖 canonical submission、cursor、active turn、reload/reconnect                                                            | 覆盖 retry、phase、replay/edit、Windows file target 和 last-message 语义                                      | 迁移本地断言到新 fixtures；同时验证 cursor/active turn 与 retry/replay，不保留重复测试进程或依赖旧 helper 的用例                                                                                                                          |
| C07 | New Workspace、settings、help、navigation E2E                                                       | 覆盖 Chat/Terminal selector、移动端布局、通用 settings、help 右栏版本和 reconnect                                           | 覆盖 Import Session、Reforged 文案、resident/timestamp、workspace 恢复                                        | 按最终交互重写断言：三入口不重复、help 为 Reforged、timestamp 取 `lastMessageAt`、恢复和 resident 语义继续成立                                                                                                                            |
| C08 | App stream/projection fixtures：turn footer、view、stream types、replica/attention/slash tests      | 引入 `messageId`、`timelineCursor`、`activeTurn`、pending submission、fork/workflow 状态                                    | 引入 `providerRetryMessage`、`phase`、`replayKind`、optimistic edit 和 change cards                           | Agent shape 同时包含 active turn 与 retry/replay；以 canonical row 为真相源去重 optimistic echo；footer 同时呈现 in-flight fork、retry 和 turn changes                                                                                    |
| C09 | 用户消息与 AgentPanel：`message.tsx`、`agent-panel.tsx`                                             | 使用 rewind/menu、host-level reconnect toast 和 pending 状态                                                                | 提供最新纯文本消息 Edit、原文重新生成和 optimistic edit controller                                            | 保留实现但由 capability gate 隐藏 Edit；未来启用时 Edit 为最新消息直接入口、Rewind 留在菜单；pending 时整行历史操作隐藏；reconnect toast 与 edit controller 分责                                                                          |
| C10 | 文件/Workspace 菜单：file actions、shared context menu、archive test                                | 统一可嵌套菜单引擎和 context-menu surface，部分位置移除 kebab，Native 默认长按                                              | 文件行同时保留 kebab/右键；Web 可连续右键切换；Sidebar Native 仅 kebab，避免长按与拖拽竞争                    | 采用 upstream menu primitives，移植本地 overlay single-owner/direct-switch 合同；文件行保留两入口；Sidebar Native 对长按显式 gate；复用同一 action model 防止重复命令                                                                     |
| C11 | Sidebar projection/render：list、status、menu、row、view-model                                      | plain running dot、checks selector、真实 service 名、unhealthy 优先和通用 trailing/meta                                     | `lastMessageAt` timestamp、resident Agent 数、risk mode 色、closed 隐藏和本地 archive 行为                    | 采用 upstream 分层；默认 trailing=`timestamp` 且数据源只用 `lastMessageAt`；resident count 放 meta/status 行；保留 risk 色、closed 隐藏、unhealthy 优先和真实 service 名                                                                  |
| C12 | Settings、time 与 theme：settings hooks/storage、appearance、theme、time test                       | 通用 key/parser、checks display、compact time resolution、统一 status token                                                 | workspace typography、activity expansion、Hermes 无 `RelativeTimeFormat` fallback、mode 风险色                | 以 upstream parser 架构注册本地键；同时保留 compact descriptor 与本地 locale fallback；默认 timestamp；合并 status token 与 mode 风险色，避免重复颜色来源                                                                                 |
| C13 | 8 个冲突 locale 与自动加入的 Korean locale                                                          | 新增 `appName`、Chat/Terminal、checks、reconnect、help 版本等 key，并加入 `ko`                                              | Reforged 品牌、Import Session、resident/retry/edit 等本地 key                                                 | 对 9 个 locale 做 key 并集；`appName` 值统一为 `Paseo Reforged`；fork URL 和不可用发布渠道不翻译成 upstream 承诺；更新 locale 完整性测试                                                                                                  |
| C14 | New Workspace/composer：controls、mode、composer、screen                                            | 允许 Chat/Terminal 切换，Terminal 禁附件，移动端 selector 与 toolbar 无闪烁，保存 model/thinking preference                 | Import Session 位于同一响应式 control band，并保留本地 mode 风险色/布局                                       | 构建一个响应式 `controlBand`：Chat/Terminal segmented selector + Import Session；Terminal 禁附件，prompt 由 profile sentinel 决定；复用 upstream preference/optimistic state，删除重复入口                                                |
| C15 | 文件预览与 diff：`file-pane/pane.tsx`、`git/diff-pane.tsx`                                          | `filePreviewRenderKind`、HTML preview 和新 diff 渲染路径                                                                    | line target 强制源码视图、Windows 路径解码、变更卡片跳转和性能折叠                                            | 使用 upstream render-kind/HTML 架构；当目标含 line 时强制 source 并保留定位高亮；保留路径解码、change-card navigation 和现有性能边界                                                                                                      |
| C16 | Workspace header 与 open-in-file-manager                                                            | header title/subtitle 去重；统一 `surface` API                                                                              | branch/title 优先级；仅 local daemon/Electron 且路径可解析时显示入口                                          | 使用 `isSubtitleDistinct` 单一语义并保留本地 title 选择；API 统一为 `surface`，同时保留 server/local/Electron availability gate                                                                                                           |
| C17 | CLI daemon supervision UD test                                                                      | 删除旧测试，改由新的 daemon launch contract/脚本覆盖                                                                        | 保留 Windows 启动、监督和错误传播回归                                                                         | 把仍有效的 Windows 断言迁入新 contract test 后删除旧 UD 文件；不并存两套 daemon launcher 测试入口                                                                                                                                         |
| C18 | Protocol messages 与 parsing tests                                                                  | 增加 active turn、prompt index、timeline cursor、pending/staged event 等 0.3 wire 字段                                      | 增加可选 phase/replay/edit RPC 与 retry 相关字段并维持旧客户端兼容                                            | schema 做可选字段并集，保持 discriminated union 和无 transform；双向解析测试覆盖旧 client/new daemon；server 只宣告 `agentTimelinePromptIndex`，暂不宣告 Edit capability                                                                  |
| C19 | Server Agent 核心：manager、projection、run state 及测试                                            | canonical submitted prompt、active turn、prompt index、workflow/subagent、`stagedEvents`、`projectPersistenceHandleForWire` | retry/phase/replay、`lastMessageAt`、stored-only closed，以及最新提交的 durable `lastReplayableUserMessageId` | 以上游 canonical timeline 为骨架；`PendingForegroundRun` 同时保留 `stagedEvents` 与 `purpose/replayKind`；projection 同时输出安全 persistence shape、retry 和时间；按完整 history 最新 ID + persistence identity 精确恢复资格，失败即清除 |
| C20 | Codex/mock/OMP provider 与 harness                                                                  | 对齐 provider canonical identity、rewind/history、process exit 和新 timeline 投影                                           | Codex/Pi/OMP 的 text-only replay、replacement 与 edit identity                                                | 保留 provider rewind/replay 实现但不开放 UI；适配 upstream canonical ID，确保旧 row 被 replacement 取代且只接受一个新 prompt；测试缺口列入后续 capability 专项                                                                            |
| C21 | Session、agent update、websocket 及测试                                                             | bootstrap 顺序、MCP credential redaction、prompt-index capability、reconnect/relay 行为                                     | newest buffered retry state、stored closed、last-message/replay fields、Edit capability                       | 同时保留安全 redaction 与 retry 的 last-write-wins；绝不投影 MCP secret；保留新 reconnect/capability，明确删除 `inPlaceEditLastUserMessage: true` 宣告                                                                                    |
| C22 | Worktree service/utils                                                                              | Git scheduler high priority、include summary、响应式 Git observation                                                        | 精确 `baseRef`、原子 branch rollback、setup tree-kill cancellation、metadata 单写                             | `runWithGitCommandPriority("high")` 与 `WorktreeIncludeSummary` 同时保留；移植 baseRef/rollback/cancellation；metadata 只写一次并补 Windows/posix 定向测试                                                                                |
| C23 | Website release selection：latest-release、test、download                                           | `selectReleaseChannels` 同时展示 stable/beta，并给出 npm/Homebrew/store/Nix 等入口                                          | 下载 API、cache key、asset 命名和发行来源必须来自 Reforged；Reforged 不发布 npm                               | 采用 channel selector，但查询 fork API、使用 fork cache/asset 模式；beta 隐藏 npm；未配置的 Homebrew/App Store/Play Store/Web App 不渲染；测试锁定 channel 与来源                                                                         |
| C24 | Website landing 与 `llms.ts`                                                                        | 以 Hub 取代 Cloud、加入 upstream Hub/CLI/赞助和 0.3 产品叙述                                                                | Reforged 品牌、无误导 Sponsor CTA、兼容来源需显式、现有 fork 产品定位                                         | 吸收 Hub 信息架构并移除过时 Cloud；Hub 外部服务标明属于 upstream；不恢复 landing Sponsor CTA；所有安装示例按 Reforged 可用性调整                                                                                                          |

## 4. 意图、交互与界面冲突矩阵

这些项目不都产生 Git conflict marker，但若原样接受自动合并会改变 fork 的产品和发布语义。

| ID  | 冲突点                          | 远端意图                                                                         | 本地意图                                                                           | 计划解决方式                                                                                                                                  |
| --- | ------------------------------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| S01 | 版本与产品身份                  | upstream 产品进入 0.3 beta，并沿用 Paseo 官方身份                                | Reforged 独立发行、bundle/package/fork URL 与凭据边界                              | 功能和 workspace 版本进入 Reforged `0.3.0-beta.4`，品牌及发行身份不切回 upstream                                                              |
| S02 | 原位编辑 capability             | upstream 提供 canonical prompt index/rewind，但没有本地 Edit 合同                | 本地代码已支持 Edit，且最新 main 已持久化冷启动资格                                | 保留协议/provider/UI/持久化代码，server 不宣告 `inPlaceEditLastUserMessage`，App gate 因此隐藏入口                                            |
| S03 | Edit 与 Rewind 的动作重复       | upstream 把历史动作放入消息菜单                                                  | 本地 Edit 是最新用户消息的高频直接动作，Rewind 是破坏性更强的历史动作              | 未来启用时 Edit 保持直接入口，Rewind 保持菜单项；pending submission 时二者都隐藏，避免对不稳定 timeline 操作                                  |
| S04 | 文件菜单的两种入口              | upstream 倾向统一 context menu 并减少显式 kebab                                  | 本地要求文件行同时有 kebab 和右键，Web 可从一个打开菜单连续切到另一行              | 两入口共享一个 action model；复用 upstream menu engine，但恢复 direct switching 和 single overlay owner，不渲染两套命令                       |
| S05 | Native 长按与拖拽               | upstream ContextMenu 默认在 Native 支持长按                                      | 本地 Sidebar Native 只允许 kebab，长按会与拖拽排序竞争                             | Sidebar row 对 Native context trigger 关闭；文件等无拖拽表面仍可按平台合同使用长按                                                            |
| S06 | Sidebar 行尾空间竞争            | upstream trailing 可显示 diff/timestamp，meta 显示 checks/service                | 本地还有 resident Agent 数、hover kebab、last-message timestamp                    | trailing 唯一槽默认 timestamp；resident count 移到 meta/status；kebab 仅 hover/focus；checks/service 使用 upstream meta，禁止重复展示同一状态 |
| S07 | “隐藏 diff”与新 selector        | upstream 提供可配置 diff/checks/timestamp                                        | 本地任务 0020 曾决定彻底隐藏 diff 且不增加设置                                     | 采用已批准的合并取舍：保留 upstream selector，但默认 `timestamp`；这是对 0020 的显式产品变更，不当作无意回归                                  |
| S08 | New Workspace 三入口            | upstream 新增 Chat/Terminal selector                                             | 本地已有 Import Session，窄屏时若各自占栏会重复和闪烁                              | 三入口放入同一响应式 control band；Terminal 选中时隐藏附件；Import Session 保持单一入口，不复制到 toolbar/menu                                |
| S09 | reconnect 反馈                  | upstream 用 host-level 1 秒 debounce toast，避免每个 workspace 重复提示          | 本地 AgentPanel 持有 edit optimistic controller 和局部状态                         | host runtime 独占连接 toast；AgentPanel 只处理 edit transaction，重连后由 canonical timeline reconciliation 收口，避免双 toast                |
| S10 | Help 菜单版本布局               | upstream 将 app/server 版本放右栏，并使用 `appName`                              | 本地菜单需展示 Reforged 名称并指向 fork issue/changelog                            | 采用右栏布局；`appName=Paseo Reforged`；issue/changelog 指向 fork；E2E 用转义后的拼接正则而非硬编码 upstream 名                               |
| S11 | Website stable/beta 与安装来源  | upstream beta 页展示 npm beta、Nix、Homebrew、store 等官方渠道                   | Reforged 目前只应展示实际产出的 fork assets，不发布 npm，也未配置各 store/Homebrew | channel UI 可用，但按 channel 过滤真实 Reforged assets；隐藏未配置渠道，不能把 upstream 包伪装成 Reforged beta                                |
| S12 | Landing 的 Hub/Cloud/Sponsor    | upstream 以 Hub 替换 Cloud，并强化官方 Hub 与 Sponsor                            | Reforged 不应让用户误以为 upstream 托管服务或赞助会支持 fork                       | 移除 Cloud、吸收 Hub 结构；外部 Hub 和 sponsor 关系明确标注 upstream；landing 不恢复 Sponsor CTA                                              |
| S13 | iOS beta 自动发布               | 新增 tag 触发 EAS workflow，自动送入 `Paseo Beta` TestFlight group               | Reforged EAS/Apple 凭据独立且发布保持 opt-in                                       | 删除自动触发 workflow；保留通用 native beta build 编号脚本，直到 Reforged 单独配置 group 和明确授权发布                                       |
| S14 | Korean README/locale 与链接审计 | 自动加入完整 Korean 文档/UI，内容引用 upstream release、Docker、npm、GitHub      | 新语言也必须遵守 Reforged 品牌与兼容来源声明                                       | 保留 Korean 支持，但逐项改品牌、release/fork URL；npm/Docker 明确为 upstream compatibility，不把它们写成 Reforged 资产                        |
| S15 | 自动合并的 issue/docs/E2E 重复  | issue template、CONTRIBUTING、glossary 自动指向 upstream；E2E 新旧路径可同时残留 | fork 需要自己的问题入口，且测试只能有一个 daemon 生命周期                          | 做全仓链接审计并改为 fork/明确 upstream；迁移本地 E2E 能力后删除旧入口，避免一次测试启动两套 daemon                                           |

## 5. 执行计划与检查点

1. 先解决 identity、manifest、lockfile、E2E 目录迁移，建立唯一版本和测试基础设施
2. 再解决 protocol、server timeline/projection/provider/session，先恢复类型合同，再合并 App stream 与 Edit gate
3. 解决 Sidebar/menu/New Workspace/file preview/settings/i18n，按 S03-S10 的交互合同更新定向测试
4. 最后处理 Nix、website、README/issue/docs 和所有自动合并来源审计
5. 执行 `git diff --check`、冲突标记扫描、受影响 Vitest/Playwright、`npm run typecheck`、`npm run lint`、`npm run format`；验证后完成 merge commit，不 push、不发布

- 当前目标：按已批准矩阵完成 beta.4 realigned 冲突解决、验证和 merge 收口
- 当前进度：94 个未合并文件已按 C01-C24、S01-S15 全部解决；版本、品牌、发行来源、capability、AOT、定向回归与静态门禁均已验证
- 当前动作是否仍服务核心目标：是；新 main 增量已进入计划，没有套用旧 0caa1e8af 基线
- 下一步唯一动作：创建本地 merge commit；不 push、不发布
- 风险与回退：旧 beta.2、旧 beta.4 merge 现场和原工作区均保持不变；不 abort、不 reset；每组使用 stage 2/3 和原始提交复核
- TDD 判定、测试 seam 与验收行为：`N/A；这是双方既有行为的跨分支整合，使用既有协议、daemon、App model 与 Playwright 回归恢复合同，不新增独立 TDD seam`
- seam 确认：`N/A`
- Execution Approval / Source：`Approved / User；2026-08-08 用户明确回复“按 0055 当前全部推荐方案批准执行 beta.4 冲突解决”`

### 原位编辑 capability 后续方案

1. 本次保留 `replayKind: text_only`、edit RPC、Codex/Pi/OMP rewind/hydrate、optimistic controller 和 `lastReplayableUserMessageId` 持久化，但从 server feature advertisement 移除 `inPlaceEditLastUserMessage`
2. 以上游 canonical prompt index 为唯一消息身份骨架；每个 provider rewind 成功后旧 canonical row 必须消失，replacement turn 只能产生一个 immutable accepted prompt row
3. durable 资格只允许由 live `text_only + messageId` 建立；冷启动/refresh 时必须同时满足相同 persistence identity、完整 provider history 和“该 ID 是最新 canonical 用户消息”，否则清除并 fail closed
4. 为 Codex、Pi、OMP 分别补齐 live、same-session refresh、daemon restart、resume、断线重连、pending submission、stale turn、history 前进、重复 provider echo 和 identity 变化测试
5. 上述矩阵全部通过后，在同一个变更中同时打开 server capability、App capability gate 和 Edit UI；任一 provider 不满足合同则继续维持 Rewind-only，不做静默猜测或按文本匹配

## 6. 验证与完成判断

| 验收项                    | 命令或步骤                                                             | 结果 | 证据                                                                                                                                                               |
| ------------------------- | ---------------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 最新本地基线              | `git rev-parse HEAD`（merge 前）                                       | 通过 | `fd146bdab18115173c208239cc6df69a62b1eb1b`                                                                                                                         |
| upstream tag              | 本地 object/commit + `git ls-remote upstream`                          | 通过 | object `8bb152a9716d4e400723cbc7f2e0a29feb9091b6`；commit `a7c7a6e48245b6bfac039ef3f8e79c58050ba534`                                                               |
| merge base/冲突集         | `git merge-base`、unmerged status/count                                | 通过 | base `6fc491e6220fba6543bbbe4bf1b1f58cfe59228b`；`94 = 91 UU + 3 UD`                                                                                               |
| 旧/新 beta.4 冲突文件集合 | `Compare-Object` 两个 worktree 的 unmerged paths                       | 通过 | 无差异；变化仅在 ours 内容和自动合并增量                                                                                                                           |
| 未合并文件清零            | `git diff --name-only --diff-filter=U`                                 | 通过 | 输出为空；94 个 Git 冲突已全部加入最终 merge 结果                                                                                                                  |
| 冲突标记与 whitespace     | `git diff --check`、`rg` 冲突标记                                      | 通过 | 两项均无输出                                                                                                                                                       |
| 版本、身份与 capability   | manifest/lockfile、App/desktop/website 来源、server features、AOT 审计 | 通过 | 10 个主 workspace 与根均为 beta.4；Reforged identity/发行 URL 保留；Edit capability 未宣告；AOT 零差异                                                             |
| 协议与定向回归            | protocol/server/App/website 受影响 Vitest 和 Playwright，均 `--bail=1` | 通过 | server workspace `107 passed / 4 skipped`；App model/store/i18n/state-machine 等定向文件均通过；stream UI 其余 8 项通过后，reconnect 用例修正竞态并聚焦 `1 passed` |
| 静态检查与格式            | `npm run typecheck`、`npm run lint`、`npm run format`                  | 通过 | typecheck 退出码 0；lint `0 warnings / 0 errors`；根格式化完成；`npm run build:server` 亦通过                                                                      |

- 未验证项与原因：按项目规则未运行全量本地测试套件；未执行真实 Codex/Pi/OMP 原位编辑专项、移动设备/EAS 构建或发布 smoke，这些涉及尚未开放的 capability、真实凭据或发布边界
- 剩余风险：0.3 合并面较大，未覆盖组合由 CI 承担；Reforged 可用下载渠道仍需在后续 beta 发布前按实际 release assets 核验；原位编辑继续 fail closed，直至本文件所列 provider identity/history/canonical ID 专项矩阵全部通过
- Done Contract 是否由证据满足：`是；冲突、版本、身份、协议、capability、定向回归、静态门禁和格式均已收口，本地 merge commit 将作为本文件所在提交创建。`

## 7. 恢复与同步

- 状态说明：`已收口 / Completed / Review`
- 当前卡点：`无；0055 推荐方案、验证与 Reverse Sync 已完成。`
- 下一步唯一动作：`N/A；本次只创建本地 merge commit，不 push、不发布。`
- Resume / Handoff：无需恢复；最终分支为 `merge/upstream-v0.3.0-beta.4-realigned`，merge parents 应为本地基线 `fd146bdab` 与 upstream commit `a7c7a6e48`
- Project Sync Candidates：`无；本次 merge 决策先留在任务记录`
- 长期文档同步：`N/A；原位编辑恢复条件先保留在本任务记录，后续 capability 专项启动时再同步到对应设计文档。`

### 提交记录

| 提交信息（Commit Message）                    | 提交脚注（Commit Footer） | 关联改动或阶段  | 文档同步状态 | 备注                                                                                     |
| --------------------------------------------- | ------------------------- | --------------- | ------------ | ---------------------------------------------------------------------------------------- |
| `merge: upstream v0.3.0-beta.4 into Reforged` | `N/A`                     | `0055 / Review` | `已同步`     | Windows Lefthook PATH 未解析 node/npm；等价门禁通过后使用 `--no-verify`；不 push、不发布 |
