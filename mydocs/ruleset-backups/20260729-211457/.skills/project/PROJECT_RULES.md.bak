# Paseo 项目规则

状态：`initialized`

## 项目身份

| 字段 | 值 |
| --- | --- |
| project_id | `paseo` |
| kit_revision | `content-sha256:b14275faea99b84bef3a771422992fda5a2085f5ea508fd29aa9a8b67ff9bc18` |
| 项目类型 | `monorepo` |
| 根目录 | `E:\Code\paseo` |
| 默认协作语言 | 中文 |
| 代码与文档命名语言 | 代码标识、源码文件名和现有 `docs/` 使用英文；`mydocs/` 的任务标题与 CodeMap 正文默认中文 |
| 任务目录格式 | `mydocs/tasks/<4位递增序号>_<中文任务标题>/`；取现有最大编号加一，标题仅保留中文、ASCII 字母数字、连字符和下划线，不追加日期、状态、负责人或项目集合 |
| enabled_type_modules | `backend, frontend, desktop` |
| enabled_workflows | `grill-me, task-tracking, task-decomposition, cross-task-collaboration` |
| execution_gate | `checkpoint` |
| 文档是否需审批 | 项目规则、索引、长期知识和持久 CodeMap 需要 checkpoint；用户已明确请求且范围固定的普通文档按当前任务授权执行 |
| skill_registry | `.skills/project/DEPENDENCY_SKILLS.md` |
| documentation_layout | 见“文档布局” |
| task_index_mode | `disabled` |
| micro_spec_persistence | `inline-allowed` |

## 运行与验证命令

以下命令均由根 `package.json`、`CLAUDE.md` 或 `docs/development.md` 确认；按修改范围选择最窄充分验证。

| 场景 | 命令 | 适用条件 | 事实证据 |
| --- | --- | --- | --- |
| 安装 | `npm ci` | 使用根 `package-lock.json` 的干净安装或 worktree 初始化 | `docs/development.md` |
| 开发 daemon | `npm run dev:server` | checkout-local daemon，默认 `127.0.0.1:6768` | 根 `package.json`、`docs/development.md` |
| 开发 App | `npm run dev:app` | Expo，默认 `http://localhost:8081` | 根 `package.json`、`docs/development.md` |
| 开发 Desktop | `npm run dev:desktop` | Electron + Expo，使用 `8082..8089` 中的空闲端口 | 根 `package.json`、`docs/development.md` |
| 类型检查 | `npm run typecheck` | 修改后；跨包类型异常先按 `CLAUDE.md` 重建声明 | 根 `package.json`、`CLAUDE.md` |
| Lint | `npm run lint` | 修改后；定向检查可追加文件路径 | 根 `package.json`、`CLAUDE.md` |
| 格式检查 | `npm run format:check` | 只读验证 | 根 `package.json` |
| 格式化 | `npm run format` | 提交前；只在获准修改的文件范围内执行 | 根 `package.json`、`CLAUDE.md` |
| 定向测试 | `npx vitest run <file> --bail=1` | 只运行改动对应测试文件，禁止本地全量测试 | `CLAUDE.md`、`docs/testing.md` |
| 客户端声明重建 | `npm run build:client` | protocol/client 声明可能过期时 | 根 `package.json`、`CLAUDE.md` |
| 服务端声明重建 | `npm run build:server` | server/CLI 跨包声明可能过期时 | 根 `package.json`、`CLAUDE.md` |

## 项目事实源

| 领域 | 权威路径或工具 | 修改前必须回读 | 禁止绕过 |
| --- | --- | --- | --- |
| 产品与系统边界 | `docs/product.md`、`docs/architecture.md` | 对应章节与相关 Feature CodeMap | 不以营销站或外部网页替代仓库文档 |
| 依赖与包管理 | 根及各 workspace `package.json`、`package-lock.json` | 根 manifest、目标 package manifest | 不手改 lockfile，不新增重复依赖 |
| App 路由与启动 | `packages/app/src/app/`、`docs/expo-router.md` | route、startup restore、active workspace 规则 | 不绕过 Expo Router 所有权与平台门禁 |
| WebSocket 契约 | `packages/protocol/src/messages.ts`、`docs/rpc-namespacing.md`、`docs/protocol-validation.md` | schema、能力门禁、生成验证 | 不破坏 append-only 兼容，不在 wire schema 中做转换 |
| Daemon 请求处理 | `packages/server/src/server/session.ts`、`packages/server/src/server/bootstrap.ts` | handler、service、相邻测试 | 不把 session handler 当作数据模型真相源 |
| Agent 生命周期 | `packages/server/src/server/agent/`、`docs/agent-lifecycle.md`、`docs/timeline-sync.md` | manager、provider、timeline tests | 不用客户端 presence 作为 timeline 投递正确性门禁 |
| Project/Workspace 持久化 | `packages/server/src/server/workspace-registry.ts`、`docs/data-model.md` | registry、provisioning/archive/recovery service | 不把 `workspaceId` 当路径，不从 `cwd` 推断所有权 |
| 安全 | `SECURITY.md`、目标 transport/auth 实现 | trust boundary 与相关测试 | 不自行放宽 daemon、relay、DNS rebinding 或 forge host 边界 |
| 测试入口 | `docs/testing.md`、目标文件相邻的 `*.test.ts`/`*.spec.ts` | 最窄相关测试 | 禁止本地运行全量测试套件 |
| CodeMap | `.skills/project/CODEMAP_INDEX.md`、`mydocs/codemap/` | 先看漂移信号，再回读源码 | CodeMap 只作索引，冲突时源码优先 |

第三方库、框架、SDK、API、CLI 或云服务问题必须按根 `AGENTS.md` 规则使用 Context7：先解析 library id，再查询当前文档。业务逻辑、重构和代码审查不触发该外部文档流程。

## 文档布局

| 文档 | 路径 | 命名规则 | 何时更新 |
| --- | --- | --- | --- |
| 任务索引 | `N/A` | 未启用总表 | 用户后续明确采用总表时再配置 |
| spec | `mydocs/tasks/<编号>_<中文标题>/SPEC.md` | 每个任务一个合同真相源 | `standard`、`complex` 或需跨会话恢复时 |
| micro-spec | inline 或任务目录内 `SPEC.md` | 同会话低风险任务允许内联 | 范围、风险或验收变化时 |
| task plan | `mydocs/tasks/<编号>_<中文标题>/task_plan.md` | 只记录可验收步骤 | 复杂、多阶段或长任务 |
| findings | `mydocs/tasks/<编号>_<中文标题>/findings.md` | 证据、未知项和否定结果 | Research 产生可复用证据时 |
| progress | `mydocs/tasks/<编号>_<中文标题>/progress.md` | 执行、验证和偏差 | 每个恢复点及收尾 |
| codemap | `mydocs/codemap/` | `<YYYY-MM-DD_hh-mm>_<项目>项目总图.md` 或 `<YYYY-MM-DD_hh-mm>_<功能>功能.md` | 入口、模块边界、依赖、主流程、风险或验证入口变化时 |
| 领域词汇 | `docs/glossary.md` | 延续现有英文术语表 | 项目专有术语被采纳时 |
| ADR | `N/A` | 未登记独立 ADR 目录 | 出现难逆转且有真实取舍的长期决定时先 checkpoint |
| critical context | `.skills/project/CRITICAL_CONTEXT.md` | 仅长期高风险事实 | 稳定且跨任务复用的关键事实变化时 |
| project knowledge | `.skills/project/PROJECT_KNOWLEDGE.md` | 仅已验证项目知识 | 事实稳定且不属于现有 `docs/` 时 |

## 工作区与跨项目配置

| 字段 | 值 |
| --- | --- |
| workspace_mode | `single-project` |
| workspace_root | `E:\Code\paseo` |
| project_registry | `N/A` |
| cross_project_tracking_dir | `N/A` |
| cross_project_authorization | `explicit-user-scope` |
| provider_consumer_order | protocol 先于 client，client 先于 server/CLI/App；跨包声明异常先重建 owner workspace |

## Git 与提交

| 项目规则 | 值 |
| --- | --- |
| commit_format | `N/A`（仓库未登记额外格式） |
| spec_footer | `N/A` |
| commit_hash_in_spec | `no` |
| generated_files_policy | 只通过仓库脚本生成；protocol 生成边界遵循 `docs/protocol-validation.md` |
| local_or_secret_files | 不提交 `.dev/`、本地 `$PASEO_HOME`、密钥、token、日志或未获授权的任务私有材料 |

默认不 stage、commit、push。必须保留工作树中非本任务产生的修改。

## 高风险与不可变约束

- 未获许可不得重启 `127.0.0.1:6767` 主 daemon；超时不等于需要重启。
- 不在本地运行完整测试套件；只运行受影响的单个测试文件。
- 协议保持双向向后兼容；新增 RPC 使用 dotted namespace 和 `.request`/`.response`。
- App 默认跨平台；DOM、native、Electron 和布局分别使用项目登记的 platform gates。
- Workspace 所有权以 opaque `workspaceId` 为准，文件系统操作使用 `cwd`/`worktreeRoot`。
- 修改 App 路由、startup restore 或 active workspace 前必须读取 `docs/expo-router.md`。

## 已知缺口

- Project Setup 尚未执行构建或完整测试；`2026-07-22` Kit 升级复核已通过 typecheck 与 lint，测试仍按具体任务定向运行。
- Hub、browser automation、voice、schedule/loop/chat 等能力尚无专用 Feature CodeMap。
- CodeMap 的事实随源码变化可能漂移；以 `.skills/project/CODEMAP_INDEX.md` 的信号触发复核。
