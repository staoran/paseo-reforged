# 发现与决策

## 2026-09-02 beta.5 发布决策

- 用户已用“直接发版”替代先前的临时 APK 分支方案；发布目标是 `0.4.0-beta.5`，通过不可变 tag 触发远端 Desktop 与 Android 产物。
- 当前采用的上游三段版本基线仍是 `0.4.0`：merge commit `0aa4e1039` 的上游父提交 `package.json` 为 `0.4.0`；未完成的 0102/0.7 merge 位于独立工作树，不属于本次发布。
- 本地和远端 tag 已占用 `v0.4.0-beta.1` 至 `v0.4.0-beta.4`；`v0.4.0-beta.5` 尚未占用，不能移动或复用已有 tag。
- `origin` 精确为 `https://github.com/staoran/paseo-reforged.git`，GitHub CLI 当前账户具备 `repo` 与 `workflow` 权限。
- 用户取消远端代码检测等待，但没有取消发布资产交付；普通 CI 不阻塞，Desktop Release、Android APK Release 和 Release Notes Sync 仍需确认触发并等待产物。
- changelog 顶部仍错误声称 framed binary transport 已面向用户启用；production advertisement/acceptance gate 已关闭，发布前必须删除该可用性声明并在 Known limitations 中说明。
- `npm run acp:version-drift:check` 检出 cline、dimcode、dirac、factory-droid、fast-agent、gemini、glm-acp-agent、qoder 共 8 个新 registry 版本；这些升级与本轮状态追平、usage 和中继发布无关，决定在 beta.5 有意保留当前 pins。

## 需求

- 用户要求根据 Spec 0084 会话结论和当前代码列出后续工作，并拆分为 tickets。
- 初始范围是任务规划与登记；用户随后独立批准 0087 生产实现。

## 研究发现

- 已完成：config/capability/persistence GREEN-1、client framed identity GREEN-2、GREEN-3 入站/FIFO/重复 ready/exact confirm，以及 RED-3 的 daemon selection/pending confirm/payload/opcode 测试合同。
- 当前证据：0087 后 `packages/relay/src/framed-ciphertext.test.ts` 47 case 中 42 GREEN、5 个后续预期 RED；`encrypted-channel.test.ts` 15/15、`crypto.test.ts` 8/8、server relay transport 6/6；relay/server typecheck 与目标 lint/format/diff 已通过。
- 生产 relay core 仍集中在 `packages/relay/src/encrypted-channel.ts`；daemon factory 已提供正式 ciphertext policy option，test-only cast 已删除。
- `packages/server/src/server/websocket/encrypted-relay-socket.ts` 仍按 `outboundWireByteLength()` 预估高水位，尚无异步 prepared-frame reservation 或入站 budget。
- 业务分类、terminal/file hint、压缩 adapter、runtime resolver、client fflate、Desktop 控件、metrics/benchmark 和真实环境门禁仍未实现或验证。
- 外部 production relay 不在本仓范围；只需 live 透明转发验证。
- `0086` 已被并行任务 `mydocs/micro_specs/0086_退出时活跃会话标记.md` 正式占用；本批初次顺延后又出现并行 `0096_Supervisor日志容错与语音下载清理.md`，因此最终编号为 `0087–0095、0097`，保留两个并行任务不动。

## 技术决策

| 决策                                                                | 理由                                                                                                     |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| 0084 保留为父 Spec，拆出本地子 ticket                               | wire、兼容矩阵和 Done Contract 必须只有一个真相源；独立模块可单独执行和恢复                              |
| ticket 采用 Light micro-spec，按最小可验证边界拆分                  | 当前均为单项目、已批准方向下的执行单元；避免复制完整父 Spec                                              |
| daemon selection/pending confirm 先于 compression/runtime           | 连接模式和 confirm 未锁定时，压缩、表示和高水位实现没有稳定 seam                                         |
| envelope/codec safety 与 send/receive queue 分开                    | 编解码契约可在平台无关层验证；异步顺序、reservation 和物理 socket 高水位需要独立集成验证                 |
| classification 与 terminal/file propagation 在 0092 内分成两组 seam | 两者共享 `RelayTrafficHint` 所有权，但结构化 JSON 与 binary session 入口、失败模式和回归应分别 RED→GREEN |
| metrics/benchmark/真实环境作为收尾 ticket                           | 性能阈值和 Hermes/live relay 不能由本地单测替代，且需要前置实现稳定后再测                                |
| pending confirm 不新增未定义的本地 deadline                         | 父 Spec 未定义时长；transport close/error 已 fail closed，本地超时常量需先定义重连与兼容语义             |

## 遇到的问题

| 问题                                     | 解决方案                                                                    |
| ---------------------------------------- | --------------------------------------------------------------------------- |
| 工作区存在大量无关 dirty changes         | 只读取相关文件；ticket 文档和父 Spec 索引采用最小追加，不回退或吸收其他改动 |
| 未找到 `/to-tickets` 专用实现            | 使用项目正式任务登记规则代替，明确不创建外部 issue                          |
| 创建 tickets 后出现并行编号占用          | 保留并行 `0086`，按高编号到低编号顺延本批文件，随后同步内部引用与总表基线   |
| 顺延过程中 `0096` 被另一并行任务正式占用 | 保留并行 `0096`，只将本批最终验收 ticket 改为 `0097`，避免无谓重排前九项    |

## 资源

- `mydocs/specs/0084_跨端中继二进制加密与状态追平压缩.md`
- `mydocs/todolist.md`
- `packages/relay/src/encrypted-channel.ts` 与 `framed-ciphertext.test.ts`
- `packages/server/src/server/websocket/encrypted-relay-socket.ts`

## 视觉/浏览器发现

- N/A；本轮不涉及 UI 实现或浏览器操作。

## 2026-08-31 registerSession 与 summary 续接发现

- `registerSession` 现在先捕获 metadata transaction、内存 timeline、durable active/working/page 基线，严格持久化稳定后才发布 Agent/provider child；hydration、snapshot、`working_manifest`、`active_pointer` 或 timeline revision persist 失败均关闭本次 session 并撤销半注册状态。
- durable stage/commit 使用 baseline selection 与 operation-owned generation ID 做 CAS；两个 timeline store 共享 active/working/invalid-generation ownership 判定。已有 working generation 在 mutation 前失败；首次注册空 pointer 归一化为 `null`。
- metadata transaction 只回滚本注册持有的 record revision；并发较新 revision 或 foreign generation 会令 rollback fail closed，而不会被旧注册覆盖。内存 timeline 无论 Agent 是否已安装都会恢复到注册前快照。
- 无 `projectionPayload` 的 summary 响应本身就是 canonical capability fallback，只产生一个 RPC；summary 安装竞争失败最多换代一次 request owner 并发出一个 canonical fallback。
- `onCanonicalFallback()` 后以及 summary 安装后的每个收口副作用前都重新核对 viewed generation、response owner 和 deferred；旧响应、旧 continuation 与旧 cleanup 不能继续分页或收口新初始化。
- `fetchAgentTimelineOnce()` 使用两个独立分配、结构等价且携带同一显式 `requestId` 的对象时仍只发出一次 RPC（Vitest `1/1`）。
- direct 请求先完成、viewed catch-up 在 subscription ACK 后再发 tail 是用于封闭订阅建立前事件窗口的独立同步，不是同一初始化的重复请求；DaemonClient 的 handler 先于 waiter resolve，canonical 状态会在 owner 释放前安装。
- 最终六文件时序复审未发现残余 P1；App `171/171`、Server `291/291`，两侧 typecheck、目标 lint/format 与 diff check 均通过。

## 0095 恢复发现（2026-08-20）

- server/client runtime metrics、content-free observer、pending bytes 与 diagnostics 接线已经在工作树中；现有定向测试和 workspace typecheck 证据来自上一轮恢复摘要。
- daemon diagnostics 的 relay 聚合输出定向测试已重新执行并通过；当前 fixture 已显式提供 `relayTransport`。
- 提交前仍需用真实 realtime frame 路径证明 compression attempt 为 0，并核对 `configured-disabled`、`legacy-mode`、`peer-unsupported` 的实际统计入口。
- benchmark 已实现并要求操作者显式提供四类输入；terminal/tool-call 的结构化格式也必须显式选择，不扫描 home、workspace 或 `$PASEO_HOME`。
- `effectiveCompressionCount` 应是连接级 gauge：由活动 negotiated connection 与当前 configured policy 计算，才能覆盖 legacy/peer-unsupported，并在 compression 热更新后即时反映 configured-disabled；逐帧实际 codec 进入仍由 `compressionAttemptCount` 表示。
- benchmark v1 使用 JSON 256 KiB、terminal 256 B/1 KiB/4 KiB、file 256 KiB、tool-call 64 KiB 的固定研究 framing；deflate 行报告候选比率和 v1 门禁后的实际 adopted/wire，terminal 始终标为 runtime ineligible，避免把研究压缩率误解为运行时行为。
- 实施后真实结果：JSON level 1 framed binary wire 为 legacy 的 `19.03%`，UTF-8 文件为 `24.99%`，completed tool-call 为 `54.34%` 且仅 `1/9` 采用；terminal 三种 framing 均 `adoptedFrames=0`，identity envelope wire 为 legacy 的 `102.70% / 100.75% / 100.19%`。
- event-loop sampler 初版 10 ms 无法核验 5 ms 门禁，已收紧为 1 ms 并加入环境输出合同；复测 JSON level 1 binary p99 为 `10.633 ms`，只作为 0097 真实并发交互门禁信号，不能由 0095 宣称上线通过。
- Recent metrics 对每个 percentile series 只保留 2,048 个样本，避免密集 realtime 流量使 server/client metrics 常驻内存无界增长；帧数与字节总量仍完整累计。

## 统一审查发现（2026-08-21）

- Zod 4.4.3 生成器与生成脚本均未变化；相对上次生成结果，除 relay transport 外还包含自上次生成后积累的 44 处权威 schema 内容漂移及根 `$ref/definitions` 展平。生成物不得手改，因此保留完整确定性生成结果并将范围风险交给双轴复审。
- correctness P1：外层 encrypted socket 在调用 `channel.sendPreparedFrame` 前释放 prepared reservation；真实 channel 还有第二层 Promise FIFO，导致物理 `transport.send` 开始前出现未计账窗口。三个 22 MiB frame 可让第三帧越过 64 MiB admission。
- P1 RED/GREEN：公开 socket seam 下新增真实双层 FIFO 回归；handoff callback 在内层 FIFO 即将同步调用物理 transport 时只转移计数，不调用 observer，旧 `sendPreparedFrame(frame)` API 由 overload 保留。
- hosted relay `3/3` 没有近 32 MiB frame，只能证明 framed Base64/binary 透明转发、默认 workflow 与实际压缩；父 Spec 和 0097 已把 hosted 单帧边界恢复为未验证。
- 根 typecheck 和 lint 已在 review-fix 阶段通过；Hermes、Desktop packaged smoke、realtime p95 及 hosted 近 32 MiB 边界仍是外部环境门禁。

## 2026-08-31 剩余真实环境门禁

- Desktop 当前源码门禁已有可执行环境：按现有构建脚本拆分完成 app Electron export、server/CLI、desktop main 与 electron-builder x64 unpacked build，产物为 `packages/desktop/release/win-unpacked`。
- `packaged-app-smoke.js` 使用隔离 user-data、`PASEO_HOME` 和临时 daemon/CDP 端口通过；真实 renderer/preload bridge、renderer 启动的 desktop-managed daemon、bundled CLI daemon status、terminal create/list/send/capture/kill 与 daemon stop 均成功。daemon 监听 `127.0.0.1:61505`，未使用主端口 `6767`。
- 根 `build:desktop` 的附加 electron-builder 参数没有透传，npm 以 `EUNKNOWNCONFIG` 拒绝；拆分执行与仓库脚本语义一致，且最终 artifact 来自本轮重新构建，不复用旧产物。
- `node_modules/react-native/sdks/hermesc/win64-bin/hermesc.exe` 的帮助文本列出 `-exec`，但实际执行明确报 `hermesc does not support -exec`；它是 compiler-only binary，不能用于解码测量。官方 Hermes v0.12.0 Windows CLI release 另含 `hermes.exe` VM，可作为补充证据，但其 DEBUG/HBC 89 runtime 仍不能替代 RN 0.81 当前 Hermes commit（本地 compiler HBC 96）或 Android/iOS release 真机的 OOM、GC、耗电和 UI stall。
- hosted relay 近 32 MiB 必须沿现有 v2 control/data socket 或公开 daemon/client seam 发送单帧，并对接收长度与独立 SHA-256 做断言；现有 live `3/3` 只覆盖普通 payload。
- realtime 门槛是并发状态追平或 `bulk-live` 时 terminal echo 与增量 `agent_stream` 的端到端 p95 相对 legacy 不超过 `max(2 ms, 5%)`，内部 queue/event-loop 指标只能作为诊断，不能代替结果。
- 官方 Hermes v0.12.0 Windows `hermes.exe -O`（DEBUG/HBC 89）20 次/尺寸补充测量完成：1 MiB p95 `354 ms`、4 MiB p95 `1465 ms`，均超过 `50/150 ms` 门槛；40 个 measured frame 的长度、双校验和与完成顺序全部正确。该 runtime 与 RN 0.81 当前 compiler 的 HBC 96 不一致且不是 release 真机，因此结论是“CLI 补充环境失败、真机门禁仍阻塞”，不能据此开启 Hermes codec，也不需要额外关闭当前已由 `isHermesRuntime()` 禁用的 advertisement。
- hosted relay v2 的近上限 Base64 文本在 `MAX_FRAMED_WIRE_BYTES - 4 = 33,554,428` wire bytes 时由 sender 侧收到 WebSocket close `1009`（空 reason），未到 daemon data socket；这是真实外部门禁失败。测试已按表示拆成独立连接，以便 binary 结果不被 Base64 close 短路。
- 独立 binary 场景同样失败：`MAX_FRAMED_WIRE_BYTES - 1 = 33,554,431` binary wire bytes 在约 3.1 秒内收到 sender close `1009`（空 reason）。因此 hosted relay 近 32 MiB 两种表示门禁均为真实 `FAIL`；当前证据不确定外部实际阈值，只能确定它低于两条本地 exclusive-cap 边界，不能通过放宽/降低本地断言或切回 v1 绕过。
- realtime-only harness 现在通过真实 `DaemonClient`、hosted relay 与本地 shaper 测量：两端显式订阅目标 Agent 和 PTY，每个样本先并发发出 2 个至少 512 KiB 的 canonical tail，再触发唯一 terminal marker 与 32 条 activity `agent_stream`；两种 wire 每轮交替先后。
- realtime 报告按父 Spec 的 `max(legacy + 2 ms, legacy * 1.05)` 分别判 terminal echo 和 agent stream p95，JSON 输出后失败返回非零；纯汇总 Vitest `3/3`、server typecheck、目标 lint/format 与 CLI help 已通过。
- measurement client 若不声明 `appVersion`，daemon 会按低于 `0.1.45` 的旧客户端处理并隐藏 `mock` provider；真实 Agent 已 idle 且仍在 manager 中时，公开 `waitForFinish()` 仍会因最终快照不可见而返回 `Agent ... disappeared while waiting`。direct/relay 两种测量连接必须统一声明仓库当前 package version，seed turn 也必须检查 `idle + final`，不能静默吞掉初始化失败。
- 修复上述版本声明后，hosted realtime 单轮两档均通过且 framed p95 明显低于 legacy；正式 5 轮则在第二档 daemon/client 新连接建立阶段收到 close code 0，未产出报告。该结果是 harness/外部连接就绪失败，不是 p95 回归；每个新 profile 必须在 daemon 收到 hosted relay 的首个有效 control message 后再建立 measurement client。
- `createWebSocketTransportFactory()` 优先选择 `addEventListener`；measurement wrapper 原先只暴露 Node `on`，使 `ws` 的 close `(code, reason)` 首参被 E2EE adapter 当成 CloseEvent，最终退化为 `{code: 0, reason: ""}`。本地 `1013 / relay overloaded` RED 精确复现，补标准 EventTarget 监听及对称卸载后 GREEN。
- close 适配只修复测量诊断，不改变生产 relay、E2EE wire 或 liveness 策略；正式 hosted 运行前仍需为四个并发分支和 daemon control/data 生命周期补有界诊断。
- 四个并发分支现分别标记为 `observation`、`state-sync 1`、`state-sync 2`、`stress turn`，失败会附带 `getConnectionState()`、`lastError`、最近 liveness RTT 以及无 connection ID/payload 的 control/data 生命周期摘要；定向 Vitest 最终 `8/8`。
- 最后一次正式 hosted `--runs=5 --realtime-only` 完整退出 0：2 Mbps/150 ms legacy→framed terminal/agent-stream p95 为 `14341.68→1007.01 ms` / `13749→527 ms`；10 Mbps/80 ms 为 `5479.82→617.25 ms` / `5060→307 ms`。两档均低于 `max(legacy + 2 ms, legacy * 1.05)` 上限，realtime 门禁为 `PASS`。
- Spec 0084 最终可运行门禁矩阵：Desktop packaged `PASS`；realtime `PASS`；Hermes CLI 补充环境 `FAIL` 且 release 真机仍阻塞；hosted near-limit Base64/binary 均 `FAIL (1009)`。因此 Done Contract 继续为 `No`，不可发布 Hermes `deflate-raw` 或 `framedCiphertextV1` advertisement。
- 发布回滚复审确认 production client/daemon 均以本地常量默认关闭 framed advertisement/acceptance；validation override 只从内部 client transport factory 与 daemon dependency injection 进入测试/measurement。persisted config、RPC、CLI、env、Desktop/App 配置和普通 `DaemonClientConfig` 均没有开启路径。
- measurement 原先的 `stripFramedCapability` 分组在 production gate 关闭后可能把 framed 样本静默测成 legacy。连接级 RED 已锁定该失真；当前 helper 必须先等待 authenticated observer，并在任何 inventory、timeline/file、subscription 或 probe 前精确断言 `legacy-hybrid` 或 `framed-v1-binary + deflate-raw`。
- measurement client 通过显式 `transportFactory` 组装 physical WebSocket + E2EE，未再向 `DaemonClient` 传 `e2ee`，因此不存在二次包装。isolated daemon 只在 measurement 创建处注入 validation acceptance。
- 阶段 12 验证：measurement `10/10`、client transport `4/4`、server relay transport `9/9`、relay runtime `3/3`、framed contract `91/91`；relay/client/server typecheck、15 文件 lint、26 文件 format check 与 `git diff --check` 均退出 0。

## 2026-09-02 Windows / Android 人工验收包

- Windows x64 NSIS 已从当前工作树生成并通过隔离 packaged smoke；文件为 `packages/desktop/release/Paseo-Reforged-Setup-0.4.0-beta.4-x64.exe`，大小 `116,640,347` bytes，SHA-256 `9339985A669F5E80621158EFA2CF985E34ECC66BC645485CEECA47C34AB76031`。
- 该 Windows EXE 未包含 Authenticode 签名；`signtool verify /pa /v` 返回 `No signature found`。它是人工验收包，不应表述为已签名发行产物。
- 用户要求 APK 不再本地编译；残留 Gradle 构建树已按命令行精确停止，一次性镜像 init 已删除，`android/app/build/outputs` 没有可交付 APK。
- GitHub Release 上的 beta.4 APK 是旧源码产物：`android-v0.4.0-beta.4 -> 87a2e33f9`，而本轮状态追平/registerSession review-fix 位于后续提交 `c9fb23701`。旧 APK 下载链接可用，但不能验证本轮修复。
- 正式 Android workflow 只能构建已有 tag 并写 Release；历史 artifact-only workflow 固定旧 source SHA。要远端构建 `c9fb23701`，必须先上传一个临时 source ref，并使用 artifact-only workflow；在获得明确 push 授权前不得执行。
