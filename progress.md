# 进度日志

## 会话：2026-09-02（直接发布 beta.5）

### 阶段 14：整理主工作树并发布 `0.4.0-beta.5`

- **状态：** in_progress
- 用户取消临时 APK 构建分支，明确授权整理并提交 `main` 工作树后直接发布新测试版。
- 已删除临时 APK 构建分支与对应隔离工作树；该分支从未 push。当前 `main` 比 `origin/main` 领先四个已审查提交，0102 的 upstream merge 工作树继续独立保留。
- 已复核 release-beta 流程、远端地址、GitHub 权限和不可变 tag：当前版本为 `0.4.0-beta.4`，同基线已占用 `beta.1` 至 `beta.4`，下一版为 `0.4.0-beta.5`。
- 已重新确认 adopted upstream merge `0aa4e1039` 的第二父提交版本为 `0.4.0`；不会把独立工作树 `E:\Code\paseo-upstream-merge` 中未完成的 0.7 merge 纳入本次 beta。
- 用户明确不等待远端代码检测；本地 release 门禁仍执行，tag 触发的 Desktop、Android APK 与 Release Notes 构建属于本次交付并需核验产物。
- 同基线限制：已安装裸版 `0.4.0` 的客户端需要手动安装一次 `0.4.0-beta.5`，进入 beta 线后后续 ordinal 才能正常升级。
- 主工作树已形成四个独立实现/文档提交：`c9fb23701`（状态追平与 registerSession）、`6004fb55b`（权威 usage 展示）、`559c6502b`（关闭 production framed gate）、`2183e242a`（长期文档同步）。
- 0101 已收口；0084/0097 保持未完成/待手工验收，因为 Hermes release 真机仍阻塞且 hosted near-limit 两种表示均返回 `1009`。
- 0102 隔离工作树的 147 个冲突路径均已解析并暂存，但 typecheck、lint、定向回归与 merge commit 尚未完成，不进入 beta.5。
- 最终静态检查已有一轮通过证据：`npm run format`、`npm run lint`（0 warnings / 0 errors）、`npm run typecheck` 与 `git diff --check` 均退出 0；任务记录收口后仍会重跑对应门禁。
- ACP drift 检出 cline、dimcode、dirac、factory-droid、fast-agent、gemini、glm-acp-agent、qoder 共 8 个新 registry 版本；本次有意保留当前 pins，避免临发版扩大行为范围。

## 会话：2026-08-19

### 阶段 1：需求与发现

- **状态：** complete
- **开始时间：** 2026-08-19
- 执行的操作：
  - 读取项目规则、Spec 0084、任务总表和相关 relay/server/client 入口。
  - 核对 RED-3 结果、剩余执行清单和工作区 dirty 边界。
- 创建/修改的文件：
  - `task_plan.md`
  - `findings.md`
  - `progress.md`

### 阶段 2：规划与结构

- **状态：** complete
- 执行的操作：
  - 已按依赖拆出 10 份本地 tickets。
  - 发现并行正式任务已占用 `0086`，先顺延本批；随后 `0096` 又被并行正式任务占用，最终登记范围调整为 `0087–0095、0097`。
  - 已同步 Spec 0084 的子任务索引、执行波次、Review/恢复入口和任务总表。
- 创建/修改的文件：
  - `mydocs/micro_specs/0087_daemon_framed_selection与pending_confirm.md` 至 `0095_中继压缩指标与benchmark.md`
  - `mydocs/micro_specs/0097_混合版本真实环境与文档收口.md`
  - `mydocs/specs/0084_跨端中继二进制加密与状态追平压缩.md`
  - `mydocs/todolist.md`

### 阶段 4：测试与验证

- **状态：** complete
- 执行的操作：
  - 15 份本轮 Markdown 文件格式化及格式检查通过。
  - 本批 10 个 task_id 各自唯一；并行 `0086/0096` 各保留一份。
  - 父 Spec 索引、链接、metadata、Pending 状态与任务总表 10/10 一致；依赖图无环。
  - ticket 中列为现有入口的 relay/server/client/Desktop/docs 路径均存在。

### 阶段 5：交付

- **状态：** complete
- 执行的操作：
  - 已形成后续工作清单与推荐执行顺序；所有子 ticket 保持待批准。

### 阶段 6：0087 最小 GREEN

- **状态：** complete
- 执行的操作：
  - 用户批准 0087；已确认公开 seam、最小范围、回退与验证方式。
  - `createDaemonChannel` 增加正式 encoding option；实现确定性 framed selection、legacy fallback、saved ready、pending exact confirm、同 key retry、握手 FIFO 与 fail-closed。
  - 删除测试的第四参数 cast，并从 relay `index`/`e2ee` 入口导出正式类型。
  - 协议错误先将 channel 标记 closed，reserved confirm replay 后 `isOpen()` 与物理 close 一致。
  - 逐名确认完整 framed 基线为 `42 GREEN / 5 RED`；5 条后续 RED 保留给 0088/0090。

## 测试结果

| 测试              | 输入                                           | 预期结果                          | 实际结果                           | 状态 |
| ----------------- | ---------------------------------------------- | --------------------------------- | ---------------------------------- | ---- |
| RED-3 基线        | `framed-ciphertext.test.ts`                    | 20 GREEN / 27 预期 RED            | 已在上一阶段完成并记录于 Spec 0084 | 通过 |
| 旧 channel 回归   | `encrypted-channel.test.ts`                    | 15/15                             | 15/15                              | 通过 |
| 文档格式          | 15 份本轮 Markdown                             | 全部符合项目格式                  | 15/15                              | 通过 |
| 编号与并行保护    | 本批及 `0086/0096`                             | 本批唯一、并行项不覆盖            | 10/10 + 2/2                        | 通过 |
| 索引与依赖        | 父 Spec/子 ticket/任务总表                     | 链接存在、metadata 一致、DAG 无环 | 10/10                              | 通过 |
| 代码入口          | ticket 中现有文件路径                          | 均存在                            | relay/server/client/app/docs 通过  | 通过 |
| 0087 scoped GREEN | daemon selection/pending/replay                | 27/27                             | 27/27                              | 通过 |
| framed 既有 GREEN | client/payload/replay                          | 15/15                             | 15/15                              | 通过 |
| framed 后续 RED   | selection/opcode/opening FIFO                  | 5 条继续可归因失败                | 5/5 保持 RED                       | 通过 |
| relay 回归        | channel / crypto / server relay                | 15/15、8/8、6/6                   | 15/15、8/8、6/6                    | 通过 |
| 静态门禁          | relay/server typecheck + 目标 lint/format/diff | 全部通过                          | 全部通过                           | 通过 |

## 错误日志

| 时间戳     | 错误                                             | 尝试次数 | 解决方案                                      |
| ---------- | ------------------------------------------------ | -------- | --------------------------------------------- |
| 2026-08-19 | 未找到专用 `/to-tickets` 命令/模板               | 1        | 按项目任务总表和本地 Spec 规则拆分            |
| 2026-08-19 | 新建 `0086` ticket 与并行正式任务冲突            | 1        | 保留并行任务，本批整体顺延为 `0087–0096`      |
| 2026-08-19 | 顺延后的 `0096` 与新并行正式任务冲突             | 1        | 保留并行任务，仅将最终收口 ticket 改为 `0097` |
| 2026-08-19 | 批量 `rtk rg` 因无匹配退出码 1 中止              | 1        | 改用独立或 all-settled 查询                   |
| 2026-08-19 | `rtk wc` 在 Windows 缺少 `wc` 可执行文件         | 1        | 不再使用；必要时通过 PowerShell 读取行数      |
| 2026-08-19 | 全库唯一检查命中既有 Heavy/Light 同号 0035/0050  | 1        | 改用符合项目规则的本批 scoped uniqueness 检查 |
| 2026-08-19 | 首版索引正则未接受格式化表格的可变空格           | 1        | 放宽列间空格后重跑，10/10 通过                |
| 2026-08-19 | 完整 framed 文件先停在 0088 的既有 selection RED | 1        | 改为逐名运行 0087 子集并单独核对剩余 RED      |
| 2026-08-19 | 定向格式检查发现 `encrypted-channel.ts` 未格式化 | 1        | 只格式化 4 个本轮 relay 文件并重跑门禁        |

## 五问重启检查

| 问题           | 答案                                                            |
| -------------- | --------------------------------------------------------------- |
| 我在哪里？     | 0087 已完成并收口，父 Spec 仍在 Execute                         |
| 我要去哪里？   | 等待 0088 独立执行批准，继续 framed parser/解码安全             |
| 目标是什么？   | 完成 0084 的分阶段 wire、压缩、runtime 和真实环境合同           |
| 我学到了什么？ | daemon 握手可在无额外 RTT 下 exact confirm；剩余 5 RED 边界清晰 |
| 我做了什么？   | 完成 0087 生产实现、27 scoped GREEN、回归与事实源同步           |

## 会话：2026-08-20

### 阶段 7：0095 中继压缩指标与 benchmark

- **状态：** complete
- 执行的操作：
  - 从既有工作树恢复 server/client relay metrics、observer、diagnostics 和 pending byte 观测实现。
  - 定向验证 daemon diagnostics 的最后一次 WebSocket runtime snapshot，`1/1` 通过。
  - 检索 `WebSocketRuntimeDiagnosticSnapshot` fixture；当前 daemon-session fixture 已包含 `relayTransport`。
  - 将 `effectiveCompressionCount` 收紧为活动连接 gauge，覆盖 enabled、legacy-mode、peer-unsupported 和热更新后的 configured-disabled。
  - 通过真实 framed 握手与发送路径证明大 realtime payload 使用 identity、compression attempt 为 0，state-sync 仍采用 deflate。
  - 新增显式四类输入的 benchmark CLI；完成 stdout 隐私/矩阵首条 RED → GREEN，并修复 Node Buffer 池化 backing store 导致的 benchmark 解密失败。
- 当前结果：server/client metrics、observer、diagnostics、固定容量样本、显式真实输入 benchmark 与 level 1/3/6 聚合已完成，并以 `e4497c45d` 独立本地提交。
- 提交钩子因 `mydocs/todolist.md` 同时含其他任务工作树改动而首次格式失败；随后只格式化索引中的 `HEAD + 0095` 版本，钩子期间临时映射并按字节恢复用户工作树，未把其他任务内容纳入提交。

### 阶段 8：0097 混合版本、真实环境与文档收口

- **状态：** in_progress
- 执行结果：hosted relay framed Base64/binary 与默认 Codex workflow `3/3`；shaped relay 2 Mbps/150 ms、10 Mbps/80 ms 各 5 轮通过，timeline/file 改善分别为 `90–94%`/`87–90%`。
- 文档结果：`SECURITY.md`、`docs/architecture.md`、`docs/terminal-performance.md`、`public-docs/configuration.md`、website config schema、0097/0084/todolist 已同步；schema 由 Zod 4.4.3 权威生成器重建，存在可复现的既有格式漂移，未手工修补。
- 未验证/阻塞：无 Android SDK/adb/Hermes CLI 或当前版本 Desktop packaged artifact；并行 realtime p95 未在 OS 级弱网环境执行。不能将这些门禁标为通过。
- 当前下一步：0097 已以 `5abef2c87` 独立本地提交；统一审查的 correctness 轴 P1 已完成 RED→GREEN，等待 standards 轴和最终精确提交集合复审。

## 会话：2026-08-21（0097 收口）

### 新增测试结果

| 测试                                        | 结果                                                                                                |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `live-relay.real.e2e.test.ts`               | `3/3` passed：framed Base64、framed binary、默认 Codex workflow                                     |
| `scripts/measure-live-relay-performance.ts` | 显式 CLI 两档 profile 各 5 次完成；timeline/file SHA-256 完整性通过，所有 p50/p95 改善达到 20% 门禁 |
| 性能首版 RED                                | 2 Mbps 小 todo timeline 仅改善 18%；未放宽门禁，改用 1,000,000-byte 完成态 timeline item 后重测通过 |
| 性能测试静态                                | server typecheck、目标 lint、format、默认 skip Vitest 均通过                                        |

### 阶段 9：统一审查修复

- **状态：** in_progress
- correctness 预复审发现 prepared reservation 在外层 FIFO 调用 `sendPreparedFrame` 前释放，而真实 channel 内层 FIFO 尚未开始物理发送；三个 22 MiB 帧可形成 69,206,016 bytes 的未完整计账窗口。
- RED：新增公开 encrypted socket seam + 双层 FIFO 回归，当前实现下第三帧保持 pending、socket 未关闭、terminate 为 0，精确失败。
- GREEN：`sendPreparedFrame` 增加保持旧 frame 调用兼容的 options overload；prepared reservation 只在内层 FIFO 即将同步调用物理 `transport.send` 时移交。encrypted socket `14/14`、framed contract `91/91`、根 typecheck 通过。
- 测试缺口：现有 hosted relay `3/3` 未发送近 32 MiB 帧；只证明 Base64/binary opaque 转发、默认 workflow 和实际 `deflate-raw`。该外部边界继续标为未验证。
- 当前下一步：收取 standards 预复审、修复真实 findings、完成格式/lint，创建 review-fix commit 后对 10 个 ticket SHA 加修复提交做最终双轴复审。

### 环境审计

- production relay TCP 可达；未修改外部 relay。
- WSL 无可用发行版；Docker context 为外部 `tencent-ssh`，未用于本地 shaping。
- 未发现 Android SDK、adb、Hermes CLI；Desktop release 仅有旧 `0.2.0-beta.1` artifact，不能作为当前 wire 证据。

## 新增测试结果

| 测试                   | 输入                                                                                                          | 预期结果               | 实际结果        | 状态 |
| ---------------------- | ------------------------------------------------------------------------------------------------------------- | ---------------------- | --------------- | ---- |
| diagnostics relay 聚合 | `daemon-session.test.ts -t "diagnostics includes the last flushed websocket runtime metrics"`                 | snapshot 可格式化      | 1 passed        | 通过 |
| effective reason gauge | `runtime-metrics.test.ts -t "reports current effective compression reasons for active relay connections"`     | 活动连接按当前策略聚合 | 1 passed        | 通过 |
| realtime 实际路径      | `relay-transport.test.ts -t "keeps actual realtime sends out of the compressor while compressing state sync"` | realtime attempt 0     | 1 passed        | 通过 |
| benchmark stdout       | `scripts/benchmark-relay-frame-codec.test.ts`                                                                 | 矩阵完整且不泄露输入   | 1 passed        | 通过 |
| metrics boundedness    | server/client runtime metrics 单文件                                                                          | 每序列最多 2,048 样本  | 8/8、2/2        | 通过 |
| benchmark structured   | Codex session JSONL 与 Paseo timeline segment                                                                 | 显式解析且不泄露内容   | 3/3             | 通过 |
| 0095 static            | relay/client/server typecheck、benchmark tsgo、目标 oxlint                                                    | 全部退出码 0           | 0 warning/error | 通过 |

## 新增错误日志

| 时间戳     | 错误                                                        | 尝试次数 | 解决方案                                                         |
| ---------- | ----------------------------------------------------------- | -------- | ---------------------------------------------------------------- |
| 2026-08-20 | PowerShell 枚举 `AGENTS.md` 时 `$_` 被外层 shell 展开       | 1        | 不再重试同一写法；改用 RTK 原生命令或无 `$` 的 PowerShell 表达式 |
| 2026-08-20 | benchmark 将池化 Node Buffer 的完整 backing store 交给解密  | 1        | 所有 zlib/Base64 输出复制为 exact-length `ArrayBuffer`           |
| 2026-08-20 | benchmark event-loop sampler 使用 10 ms，无法核验 5 ms 门禁 | 1        | 改为 1 ms，并在环境行输出 `eventLoopResolutionMs=1` 后复测       |
| 2026-08-20 | benchmark 定向 tsgo 首次缺少 `--ignoreConfig` / Node types  | 2        | 使用 `--ignoreConfig --types node`，第三次退出码 0               |

## 会话：2026-08-31（状态追平续接）

### 阶段 10：registerSession 事务回滚与 summary 最终时序复审

- **状态：** in_progress
- 已恢复 Spec 0084、项目规则、相关代码、既有 252/252 Vitest 基线和 dirty worktree 边界。
- 已确认测试 seam：Server 观察注册失败后的 live Agent/session/storage/timeline；App 观察 summary helper 请求次数及 viewed-timeline owner 收口。
- 当前下一步：先写 durable active 已切换但 metadata revision 写入失败的 RED，再逐条完成 metadata CAS、安装前内存 timeline 回滚和 summary owner 竞态。

### 续接 checkpoint：文件存储首次注册 CAS

- `FileAgentTimelineStore` 新增“空磁盘 + `expectedCurrent.exists=false`”公开 seam 回归；修复前稳定因 `undefined !== null` 拒绝首次 stage。
- 将 active/working pointer 比较统一归一化为 `null` 后，定向 Vitest `1/1` 通过。
- 当前下一步：用真实文件存储补 `working_manifest`、`active_pointer`、既有 working generation 与安装前异常四类注册回滚证据。

### 续接 checkpoint：summary/fetch-once 最终时序

- App 初始化、summary、viewed sync、response ownership、stream reducer 五个目标 Vitest 文件共 `170/170` 通过；App `tsc --noEmit` 退出码为 0。
- `fetch-agent-timeline-once.test.ts` 已改用两个独立但 wire 等价、含相同显式 `requestId` 的请求对象，定向 Vitest `1/1` 通过。
- 当前下一步：复核 direct 请求顺序完成后 timeline reducer 是否先将状态置为 `synced`，从而阻止 viewed catch-up 发出第二次 canonical RPC；随后完成 Server 与静态门禁。

### 阶段 10 收口：registerSession 原子回滚与 summary 最终复审

- **状态：** complete
- registerSession 已覆盖 hydration、初始/final snapshot、`working_manifest`、`active_pointer`、timeline revision persist 失败，以及已有 working generation、安装前内存 timeline、并发 metadata revision/foreign generation marker 保护。
- summary 最终复审确认：无 projection 为单次 canonical response；竞争 fallback 至多一个 canonical RPC；旧 request/generation/cleanup 无法继续分页或收口替换后的初始化。
- 静态门禁首次发现 5 项：App canonical reducer complexity 27，内存 restore complexity 29 与 bad-comparison-sequence，文件 restore callback complexity 40，import complexity 21。通过 canonical commit、共享 ownership、文件 mutation 与 import preflight helper 收口，未增加 lint 豁免。
- 最终 Standards 与 Spec/correctness 双轴均为 `PASS`；0084 仍因 Hermes、当前 Desktop packaged smoke、并发 realtime p95、hosted relay 近 32 MiB 单帧边界而保持总体未完成。

### 阶段 10 最终验证

| 验证                       | 结果                       |
| -------------------------- | -------------------------- |
| App 定向 Vitest            | 6 files / 171 tests passed |
| Server 定向 Vitest         | 4 files / 291 tests passed |
| App / Server typecheck     | 两侧退出码 0               |
| 13 个目标文件 lint         | 0 warnings / 0 errors      |
| 13 个目标文件 format check | 全部符合格式               |
| `git diff --check`         | 退出码 0                   |

### 阶段 10 错误记录

| 时间戳     | 错误                                                | 尝试次数 | 解决方案                                            |
| ---------- | --------------------------------------------------- | -------- | --------------------------------------------------- |
| 2026-08-31 | 目标 lint 报 4 个 complexity 与 1 个 bad comparison | 1        | 提取行为等价 helper 并复跑 462 条定向回归与静态门禁 |
| 2026-08-31 | PowerShell 读取切片时 `$lines` 被外层展开           | 1        | 改用 RTK 定点检索或直接索引表达式，不重复失败命令   |

## 会话：2026-08-31（真实环境门禁续接）

### 阶段 11：Spec 0084 剩余真实环境门禁

- **状态：** in_progress
- 已将状态追平、summary owner 与 `registerSession` 原子回滚整理为独立本地 review-fix commit `c9fb23701`；提交包含 23 个精确文件，pre-commit lint、format 与全 workspace typecheck 通过，未 push。
- 当前下一步：按 0097 与父 Spec 的精确合同重新审计 Hermes、当前 Desktop packaged artifact、并发状态追平 realtime p95 及 hosted relay 近 32 MiB Base64/binary 边界；只执行有真实环境证据的门禁。
- Desktop 首次构建尝试 `npm run build:desktop -- --win --x64 --dir` 被根 npm 以 `EUNKNOWNCONFIG` 拒绝，三个 electron-builder 参数未透传；不重复该命令，改按现有脚本内容拆分执行 app export、server/main build 和直接 electron-builder。
- 首次错误记录补丁误用另一文件的表格行作为锚点而未应用；已读取文件尾部并改用精确锚点。
- Desktop 构建拆分步骤全部通过：`build:app-deps:clean`、Electron web export、`build:server:clean`、desktop `build:main`、electron-builder `--win --x64 --dir`。
- 当前 x64 unpacked artifact 的隔离 packaged smoke 通过：真实 renderer/preload bridge、desktop-managed daemon、bundled CLI status 与 terminal hook workflow 均成功；临时 daemon 使用 `127.0.0.1:61505` 并在结束时停止。
- 已将 Desktop packaged 证据回写 0097 与父 Spec 0084，并从当前阻塞清单移除；artifact 含并行 dirty UI 改动的归因边界已明确记录。
- 当前剩余门禁收窄为 Hermes CLI/真机、并发状态追平 realtime p95，以及 hosted relay 近 32 MiB Base64/binary 单帧边界。
- Hermes 环境复核纠正恢复摘要：仓库内 `hermesc.exe -exec` 实际不可用，仅能编译。已从官方 Hermes v0.12.0 release 下载 Windows VM asset 到 ignored `artifacts/`，归档 SHA-256 为 `2284DE5235160CAC2080C111B727D1985F5C8AB67349DAAA97356E2035DDC9E0`；解压后的 `hermes.exe` 报 DEBUG/HBC 89。
- 新增 `scripts/measure-hermes-relay-decode.ts` 及 Vitest CLI 合同，固定 1/4 MiB level-1 raw DEFLATE、p95、双校验和、长度与完成顺序；报告明确标记为 CLI 补充证据，不替代真机 release 门禁。
- Hermes 测量 CLI 的定向 Vitest `3/3` 通过；真实官方 v0.12.0 DEBUG VM 以 `--runs 20` 执行，40 个 measured frame 正确且有序，但 1 MiB/4 MiB p95 为 `354/1465 ms`，门禁按设计非零失败。保留 RN 0.81 release 真机阻塞和现有 Hermes codec guard。
- hosted relay v2 首跑：既有小型加密交换通过；近上限场景约 120 秒后失败，自动重试的 TLS 断开覆盖了首个帧阶段，同时旧 `waitForConnected` 留下未消费 rejection。已收紧 waiter 以捕获 sender/receiver close/error、统一清理，并取消边界自动重试后再测。
- 收紧后单独运行近上限场景，Base64 `33,554,428` wire bytes 在 9.5 秒内被 hosted relay 以 close `1009` 拒绝。将 Base64/binary 改为两个独立测试，下一步只执行 binary，避免重复已确认的失败帧。
- binary 独立场景以 `33,554,431` wire bytes 执行，也在约 3.1 秒内收到 hosted relay close `1009`。近 32 MiB Base64/binary 外部门禁均失败；保留 0084 阻塞和 framed advertisement 的发布回滚要求。

### realtime p95 harness checkpoint（2026-09-01）

- `measure-live-relay-performance.ts` 已接入 `--realtime-only` 的真实 hosted relay 执行路径：mock canonical seed、PTY echo、selective timeline/terminal 订阅、两路并发 state-sync、32 条唯一增量事件，以及 legacy/framed 交替采样。
- 报告包含两档 profile 的 terminal/agent-stream p95、允许上限、失败指标和总 verdict；失败时先输出 JSON，再设置非零退出码。
- 定向 Vitest `3/3`、server typecheck、目标 oxlint `0/0`、format check 与 CLI help 均通过；下一步先执行 hosted `--runs=1`，链路正确后再执行 5 轮。
- hosted 单轮首跑约 19 秒后以 `Transport closed (code 0)` 退出且无报告；资源已回收。当前错误不含所属阶段，先补 profile/phase/wire 诊断上下文，不按相同条件盲重试。
- 已确认首跑根因不是 hosted relay 或 mock turn 本身：measurement client 未声明 `appVersion`，daemon 按旧客户端规则隐藏 `mock` provider，`waitForFinish()` 因而误报 Agent disappeared。真实隔离 daemon RED 精确复现；direct/relay client 统一使用当前 package version、seed turn 显式检查终态后，定向 Vitest `5/5`、server typecheck、lint/format/diff check 全绿。
- 修复后 hosted `--runs=1 --realtime-only` 生成完整 PASS 报告：2 Mbps/150 ms legacy→framed terminal p95 `13448.83→964.01 ms`、agent-stream p95 `13014→554 ms`；10 Mbps/80 ms 为 `4309.32→642.30 ms`、`3961→513 ms`。单样本只证明完整链路与报告可执行，不替代 5 轮正式门禁。
- 首个正式 `--runs=5` 在首档完成后、第二档 `relay client connect` 阶段以 `Transport closed (code 0)` 退出，未输出 aggregate 报告，不能判为 p95 PASS/FAIL。进程退出码 1 且资源已回收；下一步补 daemon relay control readiness 的有界等待和 wire-specific 建连阶段，再重新执行一次正式 5 轮。
- 续接后确认 measurement wrapper 只暴露 Node `on`，共享 transport 因此把 close `(code, reason)` 错当作单个事件对象；新增本地 `ws` 以 `1013 / relay overloaded` 关闭的 RED 回归。
- wrapper 已补标准 `addEventListener/removeEventListener` 并保持 Node listener 兼容；定向 Vitest `7/7` GREEN，真实 close code/reason 现可穿透到 client/E2EE 诊断。下一步补四路并发分支与 control/data 生命周期摘要后，仅再执行一次 hosted 5 轮门禁。
- 四路并发分支标签和有界 client/liveness/control/data 生命周期诊断已 RED→GREEN；最终定向 Vitest `8/8`、Server typecheck、目标 lint `0/0`、format check 与 `git diff --check` 通过。
- 按约定只执行一次最终 hosted `--runs=5 --realtime-only`，进程退出码 0 且资源回收。2 Mbps/150 ms legacy→framed terminal p95 `14341.68→1007.01 ms`、agent-stream p95 `13749→527 ms`；10 Mbps/80 ms 为 `5479.82→617.25 ms`、`5060→307 ms`；两档 verdict 均为 `PASS`。
- 阶段 11 当前可运行门禁与文档回写完成。0084 保持 `进行中`：Hermes release 真机仍阻塞，hosted near-limit Base64/binary 均 close `1009`；未 push，也未为门禁 harness 创建额外 commit。

### 阶段 12 checkpoint：发布回滚后的测量真实性

- production client/daemon 已默认关闭 `framedCiphertextV1` advertisement/acceptance，底层协议只保留显式 opt-in。
- 新发现：`measure-live-relay-performance.ts` 仍只用 `stripFramedCapability` 区分两组；在 production gate 关闭后，所谓 framed 组会静默协商成 legacy，使未来门禁产生假 PASS。
- 已确认测试 seam：measurement 专用 client/daemon opt-in，以及采样前对 client 观察到的 authenticated negotiated mode 做 fail-closed 断言。
- 连接级静默 fallback RED 已转 GREEN：`connect()` 成功但 authenticated observer 返回 legacy 时，framed measurement 会在业务请求前失败。
- measurement client 现显式组装 physical WebSocket + E2EE transport，legacy/framed 分别关闭/开启 validation gate；isolated daemon 只经 test dependency 接受 framed。普通生产 client/daemon 不受影响。
- 最终定向回归为 measurement `10/10`、client transport `4/4`、server relay transport `9/9`、relay runtime `3/3`、framed contract `91/91`。`build:relay`、`build:client`、relay/client/server typecheck、15 文件 lint、26 文件 format check 与 `git diff --check` 均通过。
- production gate 绕过复审未发现 persisted config、RPC、CLI、env、Desktop/App 或普通 `DaemonClientConfig` 开启路径；四份长期文档、0084、0097 与任务总表已同步。
- 本阶段未重跑 hosted near-limit 或 realtime 正式 5 轮。0084 继续 `进行中`：production 保持 legacy Base64/hybrid；下一外部动作仍是 Hermes release 真机与 hosted relay 限额对齐后重验。

## 会话：2026-09-01（Windows / Android 人工验收包）

- 已核对交付边界：不发布、不建 tag、不 push；Windows 使用现有 x64 NSIS，Android 使用现有 `production-apk` 合同。
- EAS CLI 当前未登录，环境也没有 `EXPO_TOKEN` / `EAS_ACCESS_TOKEN`；GitHub Android workflow 只能从已存在的远端 tag 构建并写入 Release，不能代表当前 dirty 工作树。
- Windows 当前工作树已完成 app Electron export、server/CLI clean build、Desktop main build 与 x64 NSIS 打包。
- `packages/desktop/release/Paseo-Reforged-Setup-0.4.0-beta.4-x64.exe` 对应的 `win-unpacked` 隔离 packaged smoke PASS：renderer/preload、desktop-managed daemon、bundled CLI 和 terminal 回显均通过；临时 daemon 使用 `127.0.0.1:61769` 并已停止，未接触 `6767`。
- 下一步：固定 Windows 大小/SHA-256/签名证据；核对本机 Android SDK/Gradle 条件，优先本地生成当前工作树 APK，避免为远端构建扩大 push/发布授权。
- Windows 安装包为 116,640,347 bytes，SHA-256 `9339985A669F5E80621158EFA2CF985E34ECC66BC645485CEECA47C34AB76031`；系统 PowerShell Security 模块无法加载，改用 electron-builder 缓存的 `signtool.exe` 复核。
- 本机实际已有 `D:\\Android\\Sdk`，含 platform/build-tools 36、NDK 27.1.12297006 与 platform-tools；Java 21、Gradle 8.14.3 缓存和 release 使用的仓库 debug keystore 均存在。
- Android 首次命令因外层 PowerShell 提前展开 `$env:*`，Gradle 在配置后以 `SDK location not found` 退出；未生成 APK。下一次改用单引号保护的内层 PowerShell并显式设置 production/arm64 环境。
- Android 第二次构建已正确解析 SDK 36 / NDK 27.1 / production arm64，但 `react-native-unistyles` 配置读取到残缺的 `D:\\Android\\Sdk\\ndk\\27.0.12077973` 并因缺少 `source.properties` 退出；先定位环境变量或 `.cxx` 旧缓存，不删除该 SDK 目录。
- NDK 27.0 残缺目录已可恢复地移至 `D:\\Android\\Sdk\\ndk-incomplete\\27.0.12077973`；Gradle 自动补装完整 27.0 后继续配置。
- Android 第三次本地构建已越过 SDK/NDK 配置，但在 `react-native-webview` 的 AGP 7.0.4 classpath 解析阶段因 `plugins.gradle.org` / Maven Central TLS `Remote host terminated the handshake` 失败；未生成 APK。下一步检查 Java 网络、代理和 Gradle 缓存，尝试 offline/镜像路径。
- 一次性镜像 init 首次重跑已成功完成 included Gradle plugins 和 Expo 配置，但命令行 `-Dorg.gradle.parallel=false` 在任务选择阶段被解析成 `.gradle.parallel=false`；未进入 app 编译，去掉该参数后重试。
- 用户明确要求停止本地 APK 构建并改用远端能力；已核对并仅停止残留的 `packages/app/android` Gradle 三进程树，删除 ignored 的 `artifacts/gradle-mirror.init.gradle`，本地未生成 APK。
- GitHub 只读核验确认：远端 `main` 与 `android-v0.4.0-beta.4` 均为 `87a2e33f9`；本轮 review-fix `c9fb23701` 只存在本地且是其直接后继。`v0.4.0-beta.4` Release 已有两个 APK，但对应 run `33241345399` / `33242504772` 均不包含 `c9fb23701`，不能作为本轮状态追平验收包。
- 正式 `.github/workflows/android-apk-release.yml` 只接收已有 tag，并会创建或修改 GitHub Release；历史 `build/0048-android-apk` 上的 `Build 0048 Test APK` 只上传 14 天 artifact，但源码固定为旧 SHA `b727d18`。当前没有可在“不上传当前源码 ref”前提下构建 `c9fb23701` 的既有远端入口。
- 当前最小可靠方案是创建可回收的临时构建分支：以 `c9fb23701` 为源码，仅追加 artifact-only workflow，GitHub runner 使用 `production-apk` 构建并验证签名、`sh.paseo.reforged`、`0.4.0-beta.4` 与 `arm64-v8a`；该动作需要用户明确允许 push 临时 ref，且不修改 `main`、tag 或 Release。
- Windows 安装包经 electron-builder 缓存的 Windows 10 x64 `signtool.exe verify /pa /v` 复核，结果为 `No signature found`；该人工验收包可本地安装，但 Windows 会显示未签名发布者警告，不能作为已签名正式发布物。
