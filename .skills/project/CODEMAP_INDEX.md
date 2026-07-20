# Paseo CodeMap 索引

初始化日期：`2026-07-20`

## 总图

| 名称           | 路径                                                                                                         | 覆盖范围                                            | 事实源                                                                             | 最后核对     | 漂移信号                                                                  |
| -------------- | ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------- | ---------------------------------------------------------------------------------- | ------------ | ------------------------------------------------------------------------- |
| Paseo 项目总图 | [`mydocs/codemap/2026-07-20_01-47_Paseo项目总图.md`](../../mydocs/codemap/2026-07-20_01-47_Paseo项目总图.md) | monorepo 包边界、入口、核心能力、数据与跨模块主流程 | 根 `package.json`、`docs/architecture.md`、`docs/data-model.md`、各 package 主入口 | `2026-07-20` | workspace 列表、package 责任、daemon/app/CLI 入口、部署模型或验证命令变化 |

## 功能地图

| 功能/链路                              | 路径                                                                                                                                                             | 入口                                                                                     | 主要依赖                                                                                                           | 最后核对     | 漂移信号                                                                                                               | 关联 spec                       |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------ | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| Agent 创建、执行与 Timeline 同步       | [`mydocs/codemap/2026-07-20_01-47_Agent创建执行与Timeline同步功能.md`](../../mydocs/codemap/2026-07-20_01-47_Agent创建执行与Timeline同步功能.md)                 | App composer、CLI `run`、MCP `create_agent`                                              | protocol、DaemonClient、Session、AgentManager、provider adapter、timeline reducers                                 | `2026-07-20` | `create_agent_request`、workspace intent、provider stream、timeline epoch/seq、selective delivery 或 catch-up 规则变化 | `N/A`（按用户要求不创建任务包） |
| Workspace、Worktree 与归档恢复         | [`mydocs/codemap/2026-07-20_01-47_Workspace-Worktree与归档恢复功能.md`](../../mydocs/codemap/2026-07-20_01-47_Workspace-Worktree与归档恢复功能.md)               | App/CLI workspace create、open、archive、recovery                                        | project/workspace registries、provisioning、worktree、archive、recovery services                                   | `2026-07-20` | workspace schema、opaque ID/placement、archive scope、worktree ownership、restore capability 或 RPC 变化               | `N/A`（按用户要求不创建任务包） |
| Terminal、Binary Frame 与 Backpressure | [`mydocs/codemap/2026-07-20_09-20_Terminal-Binary-Frame与Backpressure功能.md`](../../mydocs/codemap/2026-07-20_09-20_Terminal-Binary-Frame与Backpressure功能.md) | App terminal attach、`DaemonClient.subscribeTerminal()`、terminal binary input/resize    | protocol frame codec、TerminalSessionController、worker/headless xterm、client slot router、App emulator runtime   | `2026-07-20` | opcode/header/slot、两级 coalescer、pressure threshold、snapshot revision/replay、resize ownership或性能验证入口变化   | `N/A`（按用户要求不创建任务包） |
| Relay 配对、E2E 加密与远程连接         | [`mydocs/codemap/2026-07-20_09-20_Relay配对E2E加密与远程连接功能.md`](../../mydocs/codemap/2026-07-20_09-20_Relay配对E2E加密与远程连接功能.md)                   | Connection Offer、App scan/link、`startRelayTransport()`、relay v2 client/server sockets | protocol offer schema、daemon keypair、encrypted channel/crypto、relay routing、client transport、App host runtime | `2026-07-20` | offer/key storage、crypto/wire format、hello/ready、v2 control/data routing、pre-open queue、reconnect或部署拓扑变化   | `N/A`（按用户要求不创建任务包） |

## 读取规则

- 陌生任务先读项目总图；命中已有功能链时再读对应 Feature CodeMap。
- CodeMap 只负责“去哪里读、为什么读”。行为真相仍由当前源码、测试、日志和当前 Spec 决定。
- 每张 map 的 `confirmed` 表示本次已由源码、测试入口或仓库文档复核；`inferred` 和 `unknown` 不可直接作为实现前提。
- 修改入口、模块边界、数据流、外部依赖、协议 schema、持久化位置或验证入口后，按表中漂移信号复核。
- 地图之外的问题不顺手实现；需要改变行为时另建 Spec 并通过项目 execution gate。
