# Paseo 核心依赖与技能登记

最后核对：`2026-07-22`

## 核心能力实例

| capability              | canonical_route                                         | required_dependency                              | source_scope   | version_policy       | missing_action       | evidence                                                                                                           | last_verified |
| ----------------------- | ------------------------------------------------------- | ------------------------------------------------ | -------------- | -------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------- |
| SDD Harness（轻量路径） | `../core/skill-coordination.md#sdd-riper`               | `$sdd-riper-one-light`                           | `global-agent` | `floating-installed` | `stop-and-install`   | 已加载全局 Skill；本次完成 Restate、Research、Installation checkpoint、批准边界与验证闭环                           | `2026-07-22`  |
| CodeMap                 | `../core/skill-coordination.md#codemap`                 | `$codemap`                                       | `global-agent` | `floating-installed` | `stop-and-install`   | 已加载 `C:/Users/staor/.skills-manager/skills/codemap/SKILL.md`，并按 project/feature 模板产出五张 map             | `2026-07-20`  |
| 项目自定义              | `../core/skill-coordination.md#项目-skill-与自定义内容` | `.skills/workflows/project-customization.md`     | `bundled`      | `kit-version`        | `stop-and-repair`    | 工作流存在；本次完成 project-rules 与 dependency-capability 复核；revision 见 `PROJECT_RULES.md`                    | `2026-07-22`  |
| 第三方官方文档          | 根 `AGENTS.md#context7`                                 | Context7 MCP：`resolve-library-id`、`query-docs` | `global-agent` | `managed-global`     | `stop-and-configure` | 当前 runtime 可发现 `mcp__context7__resolve_library_id` 与 `mcp__context7__query_docs`；本次内部源码地图未触发查询 | `2026-07-20`  |
| 需求提纯                | `../core/skill-coordination.md#能力选择`                | `.skills/workflows/grill-me.md`                  | `bundled`      | `kit-version`        | `stop-and-repair`    | 文件存在；本次无需求歧义，未触发执行；revision 见 `PROJECT_RULES.md`                                                | `2026-07-22`  |
| 任务跟踪                | `../core/skill-coordination.md#能力选择`                | `.skills/workflows/task-tracking.md`             | `bundled`      | `kit-version`        | `stop-and-repair`    | 文件存在；本次创建 `0003` Spec/progress，`task_index_mode=disabled`，未创建任务索引                                 | `2026-07-22`  |
| 任务拆解                | `../core/skill-coordination.md#能力选择`                | `.skills/workflows/task-decomposition.md`        | `bundled`      | `kit-version`        | `stop-and-repair`    | 文件存在；本次为单阶段升级，未触发拆解；revision 见 `PROJECT_RULES.md`                                              | `2026-07-22`  |
| 跨任务协作              | `../core/skill-coordination.md#能力选择`                | `.skills/workflows/cross-task-collaboration.md`  | `bundled`      | `kit-version`        | `stop-and-repair`    | 文件存在；本次无跨任务共享写入，未触发执行；revision 见 `PROJECT_RULES.md`                                          | `2026-07-22`  |

## 项目依赖入口

| 依赖/服务          | 当前版本或来源                         | 本项目集成入口                                              | 官方文档策略                                  | 变更风险                            | 验证                                    |
| ------------------ | -------------------------------------- | ----------------------------------------------------------- | --------------------------------------------- | ----------------------------------- | --------------------------------------- |
| Node.js            | `.tool-versions`                       | 根 npm scripts、`packages/server`、`packages/cli`           | Context7 或 Node 官方文档                     | runtime 与 native module 兼容       | `npm run typecheck` 与目标 package 构建 |
| npm workspaces     | 根 `package.json`、`package-lock.json` | `packages/*`                                                | Context7 或 npm 官方文档                      | workspace 声明和生成的跨包类型      | `npm ci`、目标 build/typecheck          |
| WebSocket protocol | 仓库内 `@getpaseo/protocol`            | `packages/protocol/src/messages.ts`                         | 仓库源码和 `docs/protocol-validation.md` 优先 | 双向兼容、能力门禁、帧大小          | protocol 定向测试与 client/server e2e   |
| Agent providers    | 仓库注册表与本机 provider runtime      | `packages/server/src/server/agent/providers/`               | 查询具体 SDK/CLI 时使用 Context7              | 鉴权、session resume、stream 归一化 | provider 相邻测试和目标真实集成测试     |
| Git/worktree       | 本机 Git CLI                           | `packages/server/src/utils/worktree.ts`、workspace services | 查询 CLI 语义时使用 Context7                  | 路径、分支、共享引用与删除          | worktree/workspace 定向测试             |

## 项目私有技能

当前未登记项目私有 Skill。`.skills/project-skills/` 中未登记内容不得自动作为能力加载。

## 维护规则

- 只增量登记真正影响开发决策的能力，不复制全局 Skill 正文。
- canonical route、依赖可见性、版本策略或规则包 revision 变化时，同一任务更新本文件。
- 必需依赖缺失时执行对应 `missing_action`，不得用项目内摘要或索引模拟外部能力。
- 第三方文档查询遵循根 `AGENTS.md`：先 `resolve-library-id`，再用完整问题 `query-docs`。
- CodeMap 是源码索引；地图与源码冲突时源码优先，并更新 `.skills/project/CODEMAP_INDEX.md`。
