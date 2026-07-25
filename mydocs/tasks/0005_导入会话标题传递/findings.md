# 导入会话真实标题传递调查发现

本文件只记录 M-21 的调查证据、根因与尚未验证事项。已采纳合同与决策见 `SPEC.md`；执行和验证结果见 `progress.md`。

## 任务绑定

| 字段        | 锚点                                                         |
| ----------- | ------------------------------------------------------------ |
| task_id     | `0005`                                                       |
| 任务合同    | `SPEC.md#导入会话真实标题传递-feature-spec`                  |
| Parent Spec | `../0002_fork改进与主线覆盖总控/SPEC.md#12-子-spec-抽取合同` |
| 总表项      | `M-21`                                                       |

## 调查事实与来源

### F1 - 复核基线

| 事实/来源                                                | 可信度           | 对任务影响                                | 采纳状态                              |
| -------------------------------------------------------- | ---------------- | ----------------------------------------- | ------------------------------------- |
| 主线 `HEAD=045dd0cc6d06f6deafb3be5b9bd7f92abd8e10fb`     | 高，Git 直接读取 | 固定本 Spec Research 事实边界             | 已采纳至 `SPEC.md#父-spec-绑定与基线` |
| `origin/main=679d7131f7afcf4b11fba7a927dd579ac014f83c`   | 高，Git 直接读取 | 记录用户 remote 当前引用，不把它误当 HEAD | 已采纳至 `SPEC.md#父-spec-绑定与基线` |
| `upstream/main=b2139b1400133b8a456b92df5e559c709ee0aa0f` | 高，Git 直接读取 | 确认本轮上游比较基线                      | 已采纳至 `SPEC.md#父-spec-绑定与基线` |
| fork `HEAD=6fb48efdf6eb8daef33d9a818b074d75fa61b39d`     | 高，Git 直接读取 | fork 只作为设计证据，不作为 patch 基线    | 已采纳至 `SPEC.md#父-spec-绑定与基线` |

### F2 - 当前主线根因链

| 位置                                                                                          | 当前事实                                                                           | 影响                                  | 采纳状态                          |
| --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------- | --------------------------------- |
| `packages/app/src/components/import-session-sheet.tsx`                                        | session entry 已含 `title`，点击导入只传 provider、handle、cwd、workspaceId        | 标题在 App→client 边界丢失            | 已采纳至 `SPEC.md#背景与目标`     |
| `packages/client/src/daemon-client.ts`                                                        | `ImportAgentInputBase` 与 request serialization 无 `workspaceTitle`                | client 无法表达真实标题或显式 null    | 已采纳至 `SPEC.md#字段签名`       |
| `packages/protocol/src/messages.ts`                                                           | `ImportAgentRequestMessageSchema` 未声明该字段；Zod object parse 会丢弃未知字段    | 直接发送也无法穿过协议                | 已采纳至 `SPEC.md#字段签名`       |
| `packages/server/src/server/agent/import-sessions.ts`                                         | normalized request 无标题，fresh import 与 provisioning 均收不到标题               | server 不能持久化 Provider 标题       | 已采纳至 `SPEC.md#方案与文件影响` |
| `packages/server/src/server/session/workspace-provisioning/workspace-provisioning-service.ts` | 无目标导入调用 `createWorkspaceForDirectory(input.cwd)`                            | 新 workspace 的 raw title 固定为 null | 已采纳至 `SPEC.md#三态语义`       |
| `packages/server/src/server/agent/agent-manager.ts`                                           | imported agent 标题从 config/首条 prompt 推导；没有 Provider descriptor title 输入 | prompt preview 可能被当作 agent title | 已采纳至 `SPEC.md#三态语义`       |

### F3 - 可复用主线基座

| 位置                                 | 已有能力                                                                     | 对计划的约束                                           | 采纳状态                          |
| ------------------------------------ | ---------------------------------------------------------------------------- | ------------------------------------------------------ | --------------------------------- |
| `workspace-provisioning-service.ts`  | `createWorkspaceForDirectory(cwd, title?)` 已支持 title 持久化               | 只扩展 import input，不建新存储路径                    | 已采纳至 `SPEC.md#方案与文件影响` |
| `runInImportWorkspace()`             | requested workspace 在创建分支前 early return                                | title 参数不得进入该分支，天然保持 workspace ownership | 已采纳至 `SPEC.md#done-contract`  |
| `session.ts` descriptor projection   | `name=resolveWorkspaceDisplayName(...)`，同时下发 raw `title`                | 侧栏加固只需 `title ?? name`，不改协议 descriptor      | 已采纳至 `SPEC.md#方案与文件影响` |
| `import-session-sheet-view-model.ts` | 已有统一 `requiresImportSessionsHostUpgrade()`                               | 新 capability 复用同一门禁和现有文案                   | 已采纳至 `SPEC.md#版本兼容矩阵`   |
| `server_info.features`               | capability 字段均 optional，daemon 宣告 true，App 通过 `useHostFeature` 消费 | 遵循现有 feature contract，不写 fallback RPC           | 已采纳至 `SPEC.md#字段签名`       |
| `workspace-registry`                 | title 已是合法 nullable 持久化字段                                           | 无 migration，无回退数据清理                           | 已采纳至 `SPEC.md#风险与回退`     |

### F4 - Fork 设计证据与主线差异

| fork 证据                | 可采纳语义                                                        | 不能直接照搬的部分                                    | 采纳状态                          |
| ------------------------ | ----------------------------------------------------------------- | ----------------------------------------------------- | --------------------------------- |
| `630936e05`              | `workspaceTitle?: string \| null` 贯穿 App/client/protocol/server | fork 基线没有当前主线完整 capability contract         | 已采纳至 `SPEC.md#接口与状态合同` |
| `581f81378`              | 保留 Provider session 的真实 title                                | 当前主线 owner 和测试位置已有变化                     | 已采纳至 `SPEC.md#背景与目标`     |
| `df8acf5a1`              | explicit null 禁止 prompt preview 冒充标题                        | 需适配当前 AgentManager 的 config-title precedence    | 已采纳至 `SPEC.md#三态语义`       |
| `bd3908d36`、`e0551ce18` | 侧栏 Title 模式显式优先 raw title                                 | 主线 `name` 已 resolved，因此这是兼容加固而非根因修复 | 已采纳至 `SPEC.md#方案与文件影响` |
| `cdc9984d5`              | 清理重复 workspace 名称展示                                       | 当前任务不修改 header/重复文案                        | 已采纳为 Out of Scope             |

### F5 - 测试与文档约束

| 来源                               | 事实                                                                            | 对计划的影响                                                                                      | 采纳状态                            |
| ---------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ----------------------------------- |
| `docs/protocol-validation.md`      | wire schema 不能包含 transform/preprocess/catch                                 | normalization 放在 `normalizeImportAgentRequest()`                                                | 已采纳至 `SPEC.md#已采纳事实与决策` |
| `docs/testing.md`                  | 优先纯逻辑与真实边界，不新增 mock-heavy component test                          | 复用现有 test file 只同步必要 harness/expectation，新 capability truth table 放纯 view-model test | 已采纳至 `SPEC.md#方案与文件影响`   |
| `CLAUDE.md` protocol contract      | 新字段 optional；新 feature 用单一 capability gate，不实现旧 daemon 降级路径    | 增加 optional field 和 Update Host gate                                                           | 已采纳至 `SPEC.md#版本兼容矩阵`     |
| `.skills/project/CODEMAP_INDEX.md` | 本任务 owner 链路可直接由源码和现有项目地图定位；登记漂移只涉及 timeline/search | 不创建或更新 CodeMap                                                                              | 已采纳至 `SPEC.md#任务索引`         |

### F6 - Execute 前远端复核

| 事实/来源                                                                                                                                               | 可信度                          | 对任务影响                                        | 采纳状态                              |
| ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- | ------------------------------------------------- | ------------------------------------- |
| `origin/main=b64f4f35784876021268583b1736ad951495946c`，且与本地 `HEAD` 一致                                                                            | 高，`git fetch` 与 Git 直接读取 | 固定 Execute 基线                                 | 已采纳至 `SPEC.md#父-spec-绑定与基线` |
| `upstream/main=b218267c3cec718c13072cc4b831ac402939d946`                                                                                                | 高，`git fetch` 与 Git 直接读取 | 核对最新上游是否已覆盖 M-21                       | 已采纳至 `SPEC.md#父-spec-绑定与基线` |
| 两条远端主线的 import request、client 和 App 仍无标题字段或 `importSessionWorkspaceTitle` capability                                                    | 高，目标源码与历史定向搜索      | M-21 仍未被远端修复，原方案继续有效               | 已采纳至 `SPEC.md#背景与目标`         |
| 最新 upstream 相邻变化涉及 commit base capability、AgentManager metrics/resume options、provisioning `expectsInitialAgent` context 与 websocket metrics | 高，Git path diff               | M-21 方案无漂移；未来同步上游时需保留这些相邻参数 | 记录为实施注意事项                    |

## 根因调查

| progress 锚点                                    | 问题                                         | 来源/证据                                          | 结论                                                                     | 影响                            |
| ------------------------------------------------ | -------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------- |
| `progress.md#2026-07-22-research-与-plan-review` | 导入或新 workspace 后侧栏仍显示分支          | F2 全链路与父 Spec E21                             | 导入链在 App 边界丢标题，最终 auto-created workspace 持久化 `title=null` | 需要跨四个 package 的窄协议扩展 |
| `progress.md#2026-07-22-research-与-plan-review` | 是否是普通新建 workspace title 整体失效      | 父 Spec 的 server 定向测试与 descriptor projection | 否；有首条 prompt 的普通创建已覆盖，不能扩大到重写命名模型               | M-21 只处理 import flow         |
| `progress.md#2026-07-22-research-与-plan-review` | Title 模式 helper 返回 `name` 是否是直接根因 | F3 descriptor contract                             | 不是直接根因；`name` 已 resolved。raw-title precedence 是兼容加固        | 侧栏改动保持一行纯函数级范围    |

## 未验证假设与待查项

| 假设或问题                                                           | 验证方式                                        | 当前判定                           | 若失败的影响                                                                |
| -------------------------------------------------------------------- | ----------------------------------------------- | ---------------------------------- | --------------------------------------------------------------------------- |
| 用户现场可能持久化选择了 `workspaceTitleSource=branch`               | 用户侧读取 App 设置或切换 Title/Branch 做 smoke | 未验证，且不阻塞 M-21              | 即使 M-21 完成，Branch 模式仍会有意显示分支；需作为使用状态而非产品缺口解释 |
| “有首条 prompt 的普通新建 workspace 在 Title 模式仍显示分支”能否复现 | 独立现场复现并检查 workspace update payload     | 当前 server 回归否定，未做 UI 复现 | 若可复现，应建立独立 runtime hydration Spec，不扩大 M-21                    |
| capability gate 是否应在未来 floor 提升后删除                        | 2027-01-22 后核对最低 daemon 版本               | 暂定保留至 floor >= v0.2.0         | 只影响清理日期，不改变本次 wire 语义                                        |

## 候选待办

| 发现                                                         | 来源                          | 为何不在当前范围                       | 建议落点                                |
| ------------------------------------------------------------ | ----------------------------- | -------------------------------------- | --------------------------------------- |
| Title 模式下普通新建 workspace 的潜在 runtime hydration 问题 | 用户现场描述与 F2/F3 的不一致 | 尚未复现，当前 server test 已通过      | 仅在独立复现成立后新建 Feature/Bug Spec |
| 在设置界面更清晰地区分 Title 与 Branch                       | 用户现场可能选择 Branch       | 属于产品文案/设置 UX，不是标题传递根因 | 产品需求明确后单独立项                  |
