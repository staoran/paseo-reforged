# 导入会话真实标题传递进度

执行、验证与实际收口时间线唯一来源。当前状态读 `task_plan.md`；合同读 `SPEC.md`；调查证据读 `findings.md`。

## 任务绑定

| 字段     | 锚点                                        |
| -------- | ------------------------------------------- |
| task_id  | `0005`                                      |
| 任务合同 | `SPEC.md#导入会话真实标题传递-feature-spec` |
| 当前状态 | `task_plan.md#当前操作状态`                 |
| 调查记录 | `findings.md#调查事实与来源`                |

## 实现说明

| 时间/阶段         | Spec 锚点              | 类别     | 说明、原因与影响/待确认                                                                                             |
| ----------------- | ---------------------- | -------- | ------------------------------------------------------------------------------------------------------------------- |
| 2026-07-22 / Plan | `SPEC.md#三态语义`     | 设计决策 | `undefined` 保留旧 client fallback，`null` 表示 Provider 明确无真实标题，string 由 server trim 后使用；三态不得压扁 |
| 2026-07-22 / Plan | `SPEC.md#版本兼容矩阵` | 权衡     | 新 App 对旧 daemon 统一显示现有 Update Host 空态，以符合项目“新 feature 不做降级路径”的合同                         |
| 2026-07-22 / Plan | `SPEC.md#out-of-scope` | 设计决策 | requested workspace 和 archived agent 保留已有标题，避免导入动作产生隐式重命名                                      |

## 2026-07-22 Research 与 Plan Review

- 动作/实际变更：复核当前 Git refs、父 M-21/E21、主线 App→client→protocol→server→workspace/sidebar owner 链与定向测试入口；对照 fork 标题系列提交的净语义；创建 `0005` 逻辑 Spec Record，并在父 Spec 子项注册表登记 `Plan Review`。
- 结果/验证表锚点：`progress.md#验证`；文档、typecheck、lint、格式与 Git 范围检查均已完成。
- 失败/阻塞：产品 Execute 被 checkpoint 门禁阻塞；等待精确 `Plan Approved`。无 Research 技术阻塞。
- 残余风险/下一步：用户审阅 capability 全局门禁、explicit null、既有 workspace 不改名和测试范围；批准后从 T1 开始，禁止跳过协议阶段。

## 2026-07-24 Plan Approved 与执行基线刷新

- 动作/实际变更：抓取 `origin` 与 `upstream` 最新引用，确认两条远端主线均未实现导入会话标题传递；将 Execute 基线刷新为本地/`origin/main=b64f4f35784876021268583b1736ad951495946c`、`upstream/main=0cb9ecf44be4274d2ed69257d2a4bfe75b953752`。
- 授权：用户回复精确字样 `Plan Approved`，G1 已解除。
- 结果：原三态、workspace ownership、capability 与测试方案无漂移；任务进入 Execute / T1。
- 下一步：先在 protocol/client seam 建立失败断言，再实施 optional field 与精确 wire 序列化；T1 定向测试和 `build:client` 通过前不进入 T2。

## 2026-07-24 T1 - Protocol 与 client

- 动作/实际变更：为 `import_agent_request` 增加 optional nullable `workspaceTitle`，为 server feature schema 增加 optional `importSessionWorkspaceTitle`；扩展 `DaemonClient.importAgent()` input，并用 `!== undefined` 精确序列化标题。
- Red 证据：protocol 解析最初剥掉 `workspaceTitle`；client 最初不发送标题；feature schema 最初剥掉 capability。三条断言均先失败。
- Green 证据：`messages.workspaces.test.ts` 36/36、`messages.test.ts` 20/20、`daemon-client.test.ts` 106/106 通过；最终 `rtk npm run build:client` 退出码 0。
- 偏差：client 首次实现后测试仍红是 protocol `dist` 陈旧；按项目规则重建 owner workspace 后转绿，未增加本地重复类型。
- 下一步：进入 T2，先验证 server post-validation normalization 的三态属性存在性。

## 2026-07-24 T2 - Server normalization 与持久化

- 动作/实际变更：schema 后保留并归一化标题三态；只给自动创建的 import workspace 传 `initialTitle`；只给 fresh imported agent 传存在的 `title`；用 import-only override 让 string/null 覆盖 provider config 与 prompt fallback；daemon 宣告 capability。
- Red 证据：normalization 最初丢字段；auto-created workspace 最初保存 `null`；AgentManager 最初让 config title 抢占；orchestration 最初未传两个下游；daemon 最初未宣告 capability。每条对应断言均先失败。
- Green 证据：`import-sessions.test.ts` 18/18、`workspace-provisioning-service.test.ts` 32/32、`agent-manager.test.ts` 144/144、`session.workspaces.test.ts` 96 passed/4 skipped、`websocket-server.relay-reconnect.test.ts` 22/22 通过；`rtk npm run build:server` 退出码 0。
- 边界证据：targeted workspace 不发生 registry upsert；archived agent 即使请求携带新标题仍保留历史标题；omitted 不向 provisioning/AgentManager 增加属性。
- 下一步：进入 T3，扩展单一 App capability gate，直接传 `entry.title`，并加固 sidebar Title 模式。

## 2026-07-24 T3 - App capability、传参与侧栏

- 动作/实际变更：App 通过 `useHostFeature()` 读取 `importSessionWorkspaceTitle` 并并入既有统一升级门禁；导入请求原样传递 `entry.title`；Title 模式改为 `workspace.title ?? workspace.name`，Branch 模式保持 branch/name 优先级。
- Red 证据：新增 capability truth-table 断言最初收到 `false`；组件测试最初显示 Update Host；sidebar raw title 断言最初只返回 resolved name。
- Green 证据：`import-session-sheet-view-model.test.ts` 31/31、`import-session-sheet.test.tsx` 17/17、`sidebar-workspace-title.test.ts` 4/4 通过。
- 范围证据：组件测试只增加 host capability 默认支持夹具和精确调用期望；未新增组件测试场景、生产文件、UI 文案或 fallback。

## 2026-07-24 T4 与 Review 收口

- 远端固定点：重新抓取后，`origin/main=b64f4f35784876021268583b1736ad951495946c`、`upstream/main=b218267c3cec718c13072cc4b831ac402939d946`；两者仍无 `workspaceTitle`、`importSessionWorkspaceTitle` 或等价修复。
- 构建与静态门禁：`build:client`、`build:server`、`typecheck`、`lint`、20 个产品文件格式检查和 `git diff --check` 均通过；AOT/声明生成未留下额外 diff。
- Review：Spec 质量与需求完成度、Spec-Code 一致性、代码内在质量三轴均为 `PASS`；无 blocking issue，无计划外 RPC、迁移、服务、路由、文案或生产文件。
- 未执行：遵循项目规则未运行全量测试；非阻塞 checkout-local daemon 人工 smoke 未运行；未连接或重启端口 `6767`。
- Git：保留本地未暂存 WIP；未 stage、commit 或 push。远端主线仍判缺失，不能把本地完成误报为远端已修复。
- 下一步：仅在用户明确授权后提交、同步 upstream 或创建 PR。

## 验证

| 验收项       | 命令/步骤                                                                                                                                                                                                                                                                                                                          | 结果    | 证据或未执行原因                                                                                                                        | findings 锚点                   |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| 文档格式     | `rtk npm run format:check:files -- mydocs/tasks/0005_导入会话标题传递/SPEC.md mydocs/tasks/0005_导入会话标题传递/findings.md mydocs/tasks/0005_导入会话标题传递/task_plan.md mydocs/tasks/0005_导入会话标题传递/progress.md mydocs/tasks/0002_fork改进与主线覆盖总控/SPEC.md mydocs/tasks/0002_fork改进与主线覆盖总控/progress.md` | `PASS`  | 6 个文件均符合项目格式                                                                                                                  | `N/A`                           |
| 占位符与门禁 | 定向搜索常见占位标记，并核对 `Plan Approved` 只用于执行门禁                                                                                                                                                                                                                                                                        | `PASS`  | 无未替换占位符；执行授权、完成状态与 Review 结论一致                                                                                    | `N/A`                           |
| 路径与父注册 | `rtk rg --files`、父 Spec registry 定向检查                                                                                                                                                                                                                                                                                        | `PASS`  | `0005` 四文件存在；父表登记 local WIP PASS，远端状态仍为 MISSING                                                                        | `N/A`                           |
| Typecheck    | `rtk npm run typecheck`                                                                                                                                                                                                                                                                                                            | `PASS`  | 退出码 0；协议 AOT 生成步骤完成且未留下额外 Git 状态                                                                                    | `findings.md#F5-测试与文档约束` |
| Lint         | `rtk npm run lint`                                                                                                                                                                                                                                                                                                                 | `PASS`  | 0 warnings、0 errors                                                                                                                    | `findings.md#F5-测试与文档约束` |
| 构建         | `rtk npm run build:client`、`rtk npm run build:server`                                                                                                                                                                                                                                                                             | `PASS`  | 两个 owner stack 均退出码 0；生成步骤未留下额外 diff                                                                                    | `findings.md#F5-测试与文档约束` |
| 产品定向测试 | Spec `定向行为验证` 中的 10 个测试文件                                                                                                                                                                                                                                                                                             | `PASS`  | T1 3 文件、T2 5 文件、T3 3 文件均通过；其中 capability schema 与 protocol request 共用 `messages.test.ts`/`messages.workspaces.test.ts` | `findings.md#F5-测试与文档约束` |
| 产品格式     | `rtk npm run format:check:files -- <20 个任务产品文件>`                                                                                                                                                                                                                                                                            | `PASS`  | 20 个文件均符合 Biome 格式                                                                                                              | `N/A`                           |
| Git 范围     | `rtk git diff --check`、`rtk git status --short`                                                                                                                                                                                                                                                                                   | `PASS`  | 仅有 20 个计划产品文件与既有未跟踪任务文档；没有生成物范围外变化                                                                        | `N/A`                           |
| 全量测试     | `N/A`                                                                                                                                                                                                                                                                                                                              | not run | 项目明确禁止本地全量测试；使用最窄定向测试替代                                                                                          | `findings.md#F5-测试与文档约束` |
| 人工 smoke   | checkout-local daemon 导入与 Title/Branch 切换                                                                                                                                                                                                                                                                                     | not run | Spec 定义为非阻塞；不启动或连接 `6767` 主 daemon                                                                                        | `N/A`                           |

## 收口与同步

| 收口项            | 结果/证据                                                                         |
| ----------------- | --------------------------------------------------------------------------------- |
| 任务索引同步      | `N/A`（项目未启用 task index）                                                    |
| Parent Spec 同步  | `0002` 登记 `0005 / M-21 / Review PASS (local WIP)`；远端主线仍判 MISSING         |
| Project Sync Scan | 无；三态与 capability 约束均属于当前一次性 Feature Spec，项目协议规则已有权威文档 |
| 文档同步          | 更新任务四文件和父 Spec/progress；未修改 `docs/`、CodeMap 或长期知识              |
| 提交关联          | `N/A`；未 stage、commit 或 push                                                   |
