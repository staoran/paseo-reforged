# Paseo Reforged

## 基本介绍

| 字段           | 内容                                                                                                                                          |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| 项目目的       | 自托管、local-first 的多端界面，用于从任意位置监控和控制本机 AI 编码 Agent，代码保留在用户机器上。                                            |
| 项目类型       | npm workspace monorepo，包含后台 daemon、Expo 移动端与 Web 客户端、CLI、端到端加密 relay、Electron 桌面端、网站和配套 Agent Skills。          |
| 主技术栈       | Node.js、TypeScript、npm workspaces、React、React Native / Expo、Electron、WebSocket 和 Zod。                                                 |
| 项目根目录     | 本 `PROJECT.md` 所在 checkout/worktree 的仓库根；所有相对路径从当前根解析，不固化其他 checkout 的绝对路径。                                   |
| 主入口与事实源 | `package.json`、根 `AGENTS.md`（符号链接到 `CLAUDE.md`）、`docs/`、各 `packages/*/package.json` 及对应源码。                                  |
| 最小验证入口   | 规则或文档安装使用结构、路径和内容检查；代码改动使用 `npm run typecheck`、`npm run lint`，测试只运行受影响的单个 Vitest 文件并带 `--bail=1`。 |

## 详细介绍

Paseo 通过本机 daemon 管理 Agent 生命周期和 WebSocket API，由客户端、CLI、桌面端与 relay 提供不同访问面。系统设计和流程知识以 `docs/` 为权威来源，包清单与命令以 `package.json` 为权威来源。

| 目录                                   | 职责                                              |
| -------------------------------------- | ------------------------------------------------- |
| `packages/server`                      | daemon、Agent 生命周期、WebSocket API、MCP server |
| `packages/app`                         | Expo 移动端与 Web 客户端                          |
| `packages/cli`                         | `paseo run/ls/logs/wait` 等 CLI                   |
| `packages/relay`                       | 远程访问的端到端加密 relay                        |
| `packages/desktop`                     | Electron 桌面包装层                               |
| `packages/website`                     | Paseo 网站                                        |
| `packages/protocol`、`packages/client` | 协议 schema 与共享客户端                          |
| `skills/`、`.agents/skills/`           | 本项目私有 Skill；只按本文件的精确登记加载        |

迁移前的 Universal Agents Kit 运行时保留在 `.skills/`，但不再作为本规则集的活动任务路由或真相源，除非用户明确要求维护或迁移它。既有 `0001` 至 `0014` 任务包已于 2026-08-02 合并迁移为 `mydocs/specs/NNNN_中文标题.md` 单文件 Spec，旧 `mydocs/tasks/` 路径不再使用，编号继续视为已占用。

## 项目工作流参数

项目级 `AGENTS.md` 只路由流程；具体参数在此登记。未登记时，不虚构门禁、文件名、命令或提交格式。

| 参数                         | 本项目规则                                                                                                                                                                                                                                                                                                                                                   | 权威路径或证据                                                                                                                               |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| 任务总表、spec 与 micro-spec | 正式任务先登记总表，再立即从已登记模板创建独立任务文档；Light `fast/standard/deep` 使用 micro-spec，Heavy 使用 Spec，禁止只在会话或本文件内联。模板只放 `mydocs/templates/`，实例只放 `mydocs/specs/` 或 `mydocs/micro_specs/`。Light `zero`、查询和纯机械非行为修改豁免。                                                                                   | `mydocs/todolist.md`、`mydocs/templates/SPEC.template.md`、`mydocs/templates/MICRO_SPEC.template.md`、`mydocs/specs/`、`mydocs/micro_specs/` |
| 任务编号与文件命名           | 以总表基线和全部既有任务路径为来源，取大于当前基线的最小未占用十进制编号并补齐四位；登记后创建 `mydocs/specs/NNNN_中文短标题.md` 或 `mydocs/micro_specs/NNNN_中文短标题.md`。候选待办不占编号。父子任务中每个可独立执行的本地子项使用独立编号并登记；Light 升级 Heavy 时沿用同一编号并互链，是跨目录重复编号的唯一例外。发现冲突时暂停并重新分配未占用编号。 | `mydocs/todolist.md`、`mydocs/specs/`、`mydocs/micro_specs/`                                                                                 |
| 任务文档语言                 | 默认使用中文标题和正文；代码标识符、命令、路径、协议字段和引用原文保持其技术字面量。用户明确指定其他语言时按当前要求执行。                                                                                                                                                                                                                                   | 根 `AGENTS.md` 与当前用户要求                                                                                                                |
| 父子 Spec 拆分               | 只有任务包含多个可独立执行、验证或交接的单元，且集中记录妨碍恢复时才拆分。父 Spec 保留总目标、公共边界、契约、索引、依赖与集成验证；子文档只记录本地执行与验证。恢复顺序固定为父 Spec，再读其标记的当前子项。                                                                                                                                                | 根 `AGENTS.md#Spec 拆分与真相源`、`mydocs/templates/SPEC.template.md`                                                                        |
| 行为改动的授权门禁           | 非 Goal 模式下，行为改动最低使用 Light `fast`，任务文档与 checkpoint 完成后等待执行批准；Heavy Execute 需要用户明确 `Plan Approved`。Goal 模式只覆盖已明确目标和安全边界内的 Light 批准。删除重要数据、生产写入、公开发布、凭证/权限/计费变更、不可逆迁移、强制推送和明显扩范围始终需要明确确认。                                                            | 根 `AGENTS.md#授权、Goal 模式与任务深度`                                                                                                     |
| 跨项目父级入口（可选）       | 当前未登记共同父工作区 Registry；任务需要其他项目时停止扩张并报告，不跳转到其他 checkout。                                                                                                                                                                                                                                                                   | 当前项目根与根 `AGENTS.md`                                                                                                                   |
| 提交与文档同步               | 仅在 Goal 或用户明确要求时创建分支、commit、PR 或 issue；未登记固定 commit footer。提交前运行 `npm run format`，并按改动风险完成验证。稳定、可复用且已验证的系统或流程知识同步到既有 `docs/`；一次性事实留在任务文档，并回写总表状态。                                                                                                                       | `package.json`、`docs/`、根 `AGENTS.md#完成与同步`                                                                                           |
| 生成链路与测试可读性         | 修改权威源码或 schema，不直接修补生成物；跨 workspace 类型异常先构建声明所属栈。测试名描述可观察行为，代码测试只运行受影响文件，不运行全量本地套件。                                                                                                                                                                                                         | `docs/protocol-validation.md`、`docs/testing.md`、`docs/development.md`、`package.json`                                                      |

## 项目专有规则

| 规则                           | 适用范围                                                                                                                                                                                                               | 权威路径或命令                                                                                          | 验证                                                                                    |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| 项目知识先查 `docs/`           | 非平凡工程任务；涉及已登记主题时读取对应文档                                                                                                                                                                           | `docs/`、`docs/glossary.md`、`docs/architecture.md`、`docs/development.md`                              | 确认任务引用的文档存在，并按其中约束检查改动                                            |
| 保护主 daemon                  | 启停、诊断或连接 daemon；未经许可不得重启生产式 `6767` 实例，也不得把超时直接解释为必须重启                                                                                                                            | `docs/development.md`、`package.json` 中开发 daemon 默认监听 `6768`                                     | 启停前核对目标端口和 `PASEO_HOME`；未获许可时保持 `6767` 不变                           |
| 本地测试限于受影响文件         | 所有测试任务；禁止运行完整本地测试套件，也不重复其他 Agent 已报告通过的套件                                                                                                                                            | `docs/testing.md`；`npx vitest run 受影响测试文件 --bail=1`                                             | 结果中只出现目标测试文件；完整验证交给 CI                                               |
| 代码改动执行静态检查           | 任何代码改动后运行 typecheck 与 lint；提交前使用 npm 脚本格式化，不直接调用底层 lint/format 工具                                                                                                                       | `npm run typecheck`、`npm run lint`、`npm run format`、`npm run format:files -- 文件路径`               | 命令退出码为 0；失败时区分既有问题与本次回归                                            |
| 跨 workspace 声明先重建        | 依赖其他 workspace 的类型检查报错                                                                                                                                                                                      | `npm run build:client`；server/CLI 栈使用 `npm run build:server`；`docs/development.md`                 | 重建声明后复现类型检查，再决定是否修改源码                                              |
| WebSocket 协议保持双向兼容     | `packages/protocol` 及消息 schema；新增字段可选并有合理默认，不删除、收窄或把可选改为必填；wire schema 禁用 transform/catch/preprocess，共享 literal tag 使用 discriminated union                                      | `docs/protocol-validation.md`、`docs/architecture.md`、`packages/protocol`                              | 运行受影响协议测试，并从旧客户端解析新 daemon、旧 daemon 消息被新客户端接受两个方向审查 |
| 新能力使用单点 capability gate | 需要较新 daemon 的客户端功能；在 `server_info.features.*` 单点检测，不为旧 daemon 实现降级 fallback                                                                                                                    | `docs/architecture.md`、`packages/protocol`、`packages/app`                                             | 缺少 capability 时只显示升级提示；下游读取干净 shape                                    |
| 兼容层可检索且有期限           | 所有旧客户端/旧 daemon 兼容 shim                                                                                                                                                                                       | `rg "COMPAT\("`、`docs/protocol-validation.md`                                                          | 每个 shim 都含 `COMPAT(name)`、引入版本和目标移除日期                                   |
| 新 RPC 使用点分命名            | 新增 WebSocket RPC                                                                                                                                                                                                     | `docs/rpc-namespacing.md`                                                                               | request/response 成对使用 `domain.provider.operation.request` 与 `.response`            |
| App 默认跨平台                 | `packages/app`；DOM 用 `isWeb`，原生 API 用 `isNative`，Electron 用 `getIsElectron()`，布局用 `useIsCompactFormFactor()`；较大平台差异使用 `.web`、`.native` 或 `.electron` 文件；禁用 `onPointerEnter/onPointerLeave` | `packages/app/src/constants/platform.ts`、`packages/app/src/constants/layout.ts`、`docs/hover.md`       | 对目标平台做最窄构建或测试，并检查 DOM 访问有 `isWeb` 边界                              |
| 路由与 UI 专题先读对应文档     | 修改 Expo 启动/路由/工作区恢复、Unistyles、表单、hover 或浮层                                                                                                                                                          | `docs/expo-router.md`、`docs/unistyles.md`、`docs/forms.md`、`docs/hover.md`、`docs/floating-panels.md` | 变更前读取命中文档，验证对应平台和交互状态                                              |
| 发布走登记的私有 Skill         | beta 或 stable 发布；发布、推送和公开写入仍需用户明确授权                                                                                                                                                              | `.agents/skills/release-beta/SKILL.md`、`.agents/skills/release-stable/SKILL.md`、`docs/release.md`     | 按 Skill 的完成清单核对版本、验证、tag 和发布结果                                       |

## 私有技能路由

只加载下表中命中任务的精确路径；未登记的 `SKILL.md` 不自动加载。

| Skill             | 精确路径                                 | 触发条件                                                                                          | 不触发条件                                              | 验证或缺失动作                                                      |
| ----------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------- |
| `paseo`           | `skills/paseo/SKILL.md`                  | 管理 Paseo workspace、workspace scripts、Agent、schedule 或 heartbeat，或需要这些能力的项目内参考 | 普通代码修改且不涉及这些 Paseo 操作                     | 路径不可读时报告并改查 `docs/` 与 CLI 帮助，不伪造命令              |
| `paseo-advisor`   | `skills/paseo-advisor/SKILL.md`          | 用户明确要求 advisor、second opinion 或某模型提供外部看法                                         | 用户要求当前 Agent 直接完成任务，或未授权调用其他 Agent | 仅在用户明确授权委派后加载；失败时保留当前任务所有权并报告          |
| `paseo-committee` | `skills/paseo-committee/SKILL.md`        | 用户明确要求 committee，或明确授权在卡住、循环、视野过窄或困难规划时调用                          | 未授权子智能体，或已有直接可验证的下一步                | 只使用允许的 Codex 原生子智能体能力；汇总结论，不自动实施超范围方案 |
| `paseo-handoff`   | `skills/paseo-handoff/SKILL.md`          | 用户明确要求 handoff、转交任务给另一 Agent                                                        | 普通最终总结、换会话或当前 Agent 仍应继续执行           | 转交前核对接收方、范围和上下文；未授权委派时不触发                  |
| `release-beta`    | `.agents/skills/release-beta/SKILL.md`   | 用户明确说 release beta、cut/ship a beta 或调用对应命令                                           | 仅讨论发布、修改版本文件或没有发布授权                  | 加载后遵守发布门禁；任何远程推送和公开发布按用户授权执行            |
| `release-stable`  | `.agents/skills/release-stable/SKILL.md` | 用户明确说 release stable、promote、release patch/minor 或调用对应命令                            | beta 发布、仅讨论发布或没有发布授权                     | 加载后遵守发布门禁；任何远程推送和公开发布按用户授权执行            |
