# Paseo Reforged

## 基本介绍

只保留多数工程任务都会用到的稳定事实。

| 字段       | 内容                                                                                                                            |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------- |
| 项目目的   | 自托管、local-first 的多端界面，用于从任意位置监控和控制本机 AI 编码 Agent，代码保留在用户机器上                                |
| 项目类型   | npm workspace monorepo，包含 daemon、Expo 移动端与 Web 客户端、CLI、加密 relay、Electron 桌面端、网站和 Agent Skills            |
| 主技术栈   | Node.js、TypeScript、npm workspaces、React、React Native / Expo、Electron、WebSocket、Zod                                       |
| 项目根目录 | 本 `PROJECT.md` 所在 checkout/worktree 的仓库根；所有相对路径从当前根解析                                                       |
| 关键事实源 | `package.json`、`docs/`、各 `packages/*/package.json`、对应源码和更近的局部 `AGENTS.md`                                         |
| 最小验证   | 规则或文档运行 `npm run format:check:files -- <files>`；代码运行 `npm run typecheck`、`npm run lint` 和受影响的单个 Vitest 文件 |

主要模块：

| 目录                                   | 职责                                              |
| -------------------------------------- | ------------------------------------------------- |
| `packages/server`                      | daemon、Agent 生命周期、WebSocket API、MCP server |
| `packages/app`                         | Expo 移动端与 Web 客户端                          |
| `packages/cli`                         | `paseo run/ls/logs/wait` 等 CLI                   |
| `packages/relay`                       | 远程访问的端到端加密 relay                        |
| `packages/desktop`                     | Electron 桌面包装层                               |
| `packages/website`                     | Paseo 网站                                        |
| `packages/protocol`、`packages/client` | 协议 schema 与共享客户端                          |
| `skills/`、`.agents/skills/`           | 本项目私有 Skill；只按本文件精确登记加载          |

## 项目工作流参数

| 参数       | 配置或事实源                                                                                                                                                            |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 任务总表   | `mydocs/todolist.md`；正式任务在此登记并回写状态，候选待办不占编号；与任务文档冲突时以任务文档为准                                                                      |
| 任务深度   | 查询和不改变行为的单点机械修改使用 `zero` 且不落任务文档；其他低风险单项目行为改动使用 Light `fast/standard/deep`；公共契约、数据、权限、生成链路或高风险任务使用 Heavy |
| Spec 模板  | Heavy：`mydocs/templates/SPEC.template.md`；Light：`mydocs/templates/MICRO_SPEC.template.md`                                                                            |
| Spec 实例  | Heavy：`mydocs/specs/`；Light：`mydocs/micro_specs/`                                                                                                                    |
| 任务编号   | 扫描总表和两个实例目录，取大于当前基线的最小未占用十进制编号并补齐四位；文件名为 `NNNN_中文短标题.md`；Light 升级 Heavy 时沿用编号并互链，其他冲突必须重新分配          |
| 文档语言   | 标题和正文默认中文；代码标识符、命令、路径、协议字段和引用原文保留技术字面量                                                                                            |
| 父子 Spec  | 仅当多个任务单元可独立执行、验证或交接，且集中记录妨碍恢复时拆分；父文档保留公共边界、契约、索引、依赖和集成验证，恢复时先读父文档                                      |
| 执行门禁   | 非 Goal 的 Light 在任务文档和 checkpoint 完成后取得执行批准；Heavy Execute 需要用户明确 `Plan Approved`；Goal 只覆盖明确目标和安全边界内的 Light 批准                   |
| 跨项目入口 | 无；需要其他项目时停止扩张并报告，不跳转到其他 checkout                                                                                                                 |
| 提交规则   | 只有用户或 Goal 明确授权才创建分支、commit、PR 或 issue；无固定 footer；提交前运行 `npm run format` 并完成风险相称的验证                                                |
| 文档同步   | 稳定、可复用且已验证的系统或流程知识同步到既有 `docs/`；一次性事实保留在任务文档，任务状态回写 `mydocs/todolist.md`                                                     |
| 生成边界   | 修改权威源码或 schema，不直接修补生成物；跨 workspace 类型异常先重建声明所属栈                                                                                          |
| 测试约定   | 测试名描述可观察行为；只运行受影响的单个 Vitest 文件并带 `--bail=1`，不运行完整本地测试套件；静态检查使用根 npm scripts                                                 |

## 项目专有规则

| 规则                           | 适用范围                                                                                                                                                                                 | 权威来源                                                                                                | 验证                                                                                 |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| 项目知识先查 `docs/`           | 非平凡工程任务；涉及已登记主题时读取对应文档                                                                                                                                             | `docs/`、`docs/glossary.md`、`docs/architecture.md`、`docs/development.md`                              | 确认引用文档存在并按其约束检查改动                                                   |
| 保护主 daemon                  | 启停、诊断或连接 daemon；未经许可不得重启 `6767` 实例，也不得把超时直接解释为必须重启                                                                                                    | `docs/development.md`；`package.json` 中开发 daemon 默认监听 `6768`                                     | 启停前核对端口和 `PASEO_HOME`；未获许可时保持 `6767` 不变                            |
| 本地测试限于受影响文件         | 所有测试任务；不运行完整本地测试套件，也不重复已报告通过的套件                                                                                                                           | `docs/testing.md`；`npx vitest run <受影响测试文件> --bail=1`                                           | 结果只包含目标测试文件；完整验证交给 CI                                              |
| 代码改动执行静态检查           | 任何代码改动后运行 typecheck 与 lint；提交前使用 npm 脚本格式化                                                                                                                          | `npm run typecheck`、`npm run lint`、`npm run format`、`npm run format:files -- <files>`                | 命令退出码为 0；失败时区分既有问题与本次回归                                         |
| 跨 workspace 声明先重建        | 依赖其他 workspace 的类型检查报错                                                                                                                                                        | 客户端栈运行 `npm run build:client`；server/CLI 栈运行 `npm run build:server`；`docs/development.md`    | 重建声明后复现类型检查，再决定是否修改源码                                           |
| WebSocket 协议保持双向兼容     | `packages/protocol` 及消息 schema；新增字段可选并有默认，不删除、收窄或把可选改为必填；wire schema 禁用 transform/catch/preprocess，共享 literal tag 使用 discriminated union            | `docs/protocol-validation.md`、`docs/architecture.md`、`packages/protocol`                              | 审查旧客户端解析新 daemon 和新客户端接受旧 daemon 消息两个方向，并运行受影响协议测试 |
| 新能力使用单点 capability gate | 需要较新 daemon 的客户端功能；在 `server_info.features.*` 单点检测，不为旧 daemon 实现降级 fallback                                                                                      | `docs/architecture.md`、`packages/protocol`、`packages/app`                                             | 缺少 capability 时只显示升级提示；下游读取干净 shape                                 |
| 兼容层可检索且有期限           | 所有旧客户端或旧 daemon 兼容 shim                                                                                                                                                        | `rg "COMPAT\("`、`docs/protocol-validation.md`                                                          | 每个 shim 含 `COMPAT(name)`、引入版本和目标移除日期                                  |
| 新 RPC 使用点分命名            | 新增 WebSocket RPC                                                                                                                                                                       | `docs/rpc-namespacing.md`                                                                               | request/response 成对使用 `domain.provider.operation.request` 与 `.response`         |
| App 默认跨平台                 | `packages/app`；DOM 用 `isWeb`，原生 API 用 `isNative`，Electron 用 `getIsElectron()`，布局用 `useIsCompactFormFactor()`；较大平台差异使用平台文件；禁用 `onPointerEnter/onPointerLeave` | `packages/app/src/constants/platform.ts`、`packages/app/src/constants/layout.ts`、`docs/hover.md`       | 对目标平台做最窄构建或测试，并检查 DOM 访问有 `isWeb` 边界                           |
| 路由与 UI 专题先读对应文档     | 修改 Expo 启动、路由、工作区恢复、Unistyles、表单、hover 或浮层                                                                                                                          | `docs/expo-router.md`、`docs/unistyles.md`、`docs/forms.md`、`docs/hover.md`、`docs/floating-panels.md` | 变更前读取命中文档，验证对应平台和交互状态                                           |
| 发布走登记的私有 Skill         | beta 或 stable 发布；推送和公开写入仍需明确授权                                                                                                                                          | `.agents/skills/release-beta/SKILL.md`、`.agents/skills/release-stable/SKILL.md`、`docs/release.md`     | 按 Skill 完成清单核对版本、验证、tag 和发布结果                                      |

## 私有技能路由

| Skill             | 精确路径                                 | 触发条件                                                                                          | 不触发条件                                              | 缺失处理                                                        |
| ----------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------- | --------------------------------------------------------------- |
| `paseo`           | `skills/paseo/SKILL.md`                  | 管理 Paseo workspace、workspace scripts、Agent、schedule 或 heartbeat，或需要这些能力的项目内参考 | 普通代码修改且不涉及这些 Paseo 操作                     | 报告并改查 `docs/` 与 CLI 帮助，不伪造命令                      |
| `paseo-advisor`   | `skills/paseo-advisor/SKILL.md`          | 用户明确要求 advisor、second opinion 或某模型提供外部看法                                         | 用户要求当前 Agent 直接完成任务，或未授权调用其他 Agent | 只在用户明确授权委派后加载；失败时保留当前任务所有权并报告      |
| `paseo-committee` | `skills/paseo-committee/SKILL.md`        | 用户明确要求 committee，或明确授权在卡住、循环、视野过窄或困难规划时调用                          | 未授权子智能体，或已有直接可验证的下一步                | 只使用允许的 Codex 原生子智能体能力；汇总结论，不实施超范围方案 |
| `paseo-handoff`   | `skills/paseo-handoff/SKILL.md`          | 用户明确要求 handoff 或转交任务给另一 Agent                                                       | 普通最终总结、换会话或当前 Agent 仍应继续执行           | 转交前核对接收方、范围和上下文；未授权委派时不触发              |
| `release-beta`    | `.agents/skills/release-beta/SKILL.md`   | 用户明确要求 release beta、cut/ship a beta 或调用对应命令                                         | 仅讨论发布、修改版本文件或没有发布授权                  | 加载后遵守发布门禁；远程推送和公开发布按用户授权执行            |
| `release-stable`  | `.agents/skills/release-stable/SKILL.md` | 用户明确要求 release stable、promote、release patch/minor 或调用对应命令                          | beta 发布、仅讨论发布或没有发布授权                     | 加载后遵守发布门禁；远程推送和公开发布按用户授权执行            |

路径必须指向实际 `SKILL.md`；未登记的私有 Skill 不自动加载。
