# 任务计划：Spec 0084 后续工作拆分为可执行 tickets

## 目标

根据 Spec 0084 当前代码与会话结论，形成可独立执行、可验证、依赖明确的本地 ticket 集合；在用户单独批准后完成 0087 daemon framed selection/pending confirm 最小 GREEN。不创建外部 issue。

## 当前阶段

阶段 14：整理主工作树并发布 `0.4.0-beta.5`

## 各阶段

### 阶段 1：需求与发现

- [x] 读取项目规则、Spec 0084、任务总表和当前工作区状态
- [x] 盘点已完成的 RED/GREEN 与剩余执行清单
- [x] 将发现记录到 findings.md
- **状态：** complete

### 阶段 2：规划与结构

- [x] 按代码边界和依赖拆分 tickets
- [x] 将已创建 tickets 从冲突的 `0086–0095` 顺延，并将最终收口 ticket 避开并行 `0096`，登记为 `0087–0095、0097`
- [x] 更新 Spec 0084 子任务索引、执行顺序和回滚边界
- **状态：** complete

### 阶段 3：实现

- [x] 确认本轮未实施生产代码；实现由后续 ticket 单独授权
- **状态：** not_applicable

### 阶段 4：测试与验证

- [x] 验证 ticket 文档格式、编号、依赖和验收入口
- [x] 确认父 Spec 与任务总表同步
- **状态：** complete

### 阶段 5：交付

- [x] 汇总后续工作内容、ticket 清单和推荐执行顺序
- **状态：** complete

### 阶段 6：0087 Daemon framed selection 与 pending confirm

- [x] 取得 0087 独立执行批准并更新 checkpoint
- [x] 逐条确认 selection 与 pending exact confirm RED 基线
- [x] 实施正式 factory option、selection/ready/confirm 最小 GREEN
- [x] 运行 framed/legacy/crypto/server relay 定向回归与静态门禁
- [x] 回写 0087、父 Spec 与任务总表
- **状态：** complete

### 阶段 7：0095 中继压缩指标与 benchmark

- [x] 恢复并复核 server/client runtime metrics、observer 与 diagnostics 接线
- [x] 验证 daemon diagnostics snapshot 定向测试
- [x] 补齐 realtime 实际路径与 skip/effective reason 语义测试
- [x] RED → GREEN 实现显式真实输入 benchmark CLI
- [x] 运行 0095 定向测试、静态门禁与格式检查
- [x] 回写 0095、父 Spec 与任务总表
- [x] 创建 0095 独立本地 commit（`e4497c45d`）
- **状态：** complete

### 阶段 8：0097 混合版本、真实环境与文档收口

- [x] 审计本机可用的 mixed-version、live relay、弱网、Hermes 与 Desktop 环境
- [x] 执行 mixed-version、live relay、弱网和可用环境验收；Hermes/设备门禁如实记录阻塞
- [x] 同步安全、架构、配置和性能长期文档
- [x] 回写 0097、父 Spec 与任务总表并创建独立本地 commit（`5abef2c87`）
- [x] 统一审查 0087–0095、0097 全部实现
- [x] 创建 review-fix 本地 commit，并对精确 ticket 提交集合执行最终 Standards/Spec 双轴复审（`c9fb23701`）
- **状态：** complete

### 阶段 10：registerSession 事务回滚与 summary 最终时序复审

- [x] 恢复 Spec 0084、项目规则、现有 diff 与公开测试 seam
- [x] 逐条补 registerSession durable/metadata/内存回滚 RED 并转 GREEN
- [x] 补 summary fallback 请求所有权、无 projection 单请求和初始化收口竞态 RED 并转 GREEN
- [x] 复审六个目标文件并运行定向 Vitest、typecheck、lint、format、diff check
- [x] 回写 Spec 0084、findings.md 与 progress.md
- **状态：** complete

### 阶段 11：Spec 0084 剩余真实环境门禁

- [x] 创建状态追平与 registerSession 独立本地 review-fix commit，不 push
- [x] 复核 Hermes、当前 Desktop packaged smoke、并发 realtime p95 与 hosted relay 近 32 MiB 的精确验收合同
- [x] 审计本机真实运行环境和现有 measurement/live relay harness
- [x] 从当前工作树构建 Desktop x64 unpacked artifact 并完成隔离 packaged smoke
- [x] 补 Hermes VM 测量 CLI 并执行 1/4 MiB 门禁；DEBUG/HBC 89 p95 失败，保留 release 真机阻塞
- [x] 补 hosted relay v2 近 32 MiB Base64/binary 门禁；两种表示均 close `1009` 失败
- [x] 补齐 realtime-only 真实 relay profile、订阅、并发负载、报告与失败退出码
- [x] 执行所有当前可运行门禁；缺失环境时保留可复现阻塞证据
- [x] 回写 0097、父 Spec 0084、findings.md 与 progress.md
- **状态：** complete

### 阶段 12：失败门禁后的 framed 发布回滚

- [x] 在 production client/daemon transport seam 补默认不广告/不接受 `framedCiphertextV1` 的 RED，并锁定 legacy hybrid/Base64 可连接收发
- [x] 在 relay core 增加明确的 advertisement/acceptance gate，保留底层 framed 实现供显式 opt-in 验证
- [x] 为 realtime measurement 贯通 client/daemon 显式 framed opt-in，并在采样前断言实际 negotiated mode，禁止静默退回 legacy
- [x] 运行 client、server、relay 受影响单文件 Vitest 与对应 typecheck、目标 lint、format、diff check
- [x] 同步长期文档中的 production 发布状态，并回写 0084、0097、任务总表与恢复记录，保持失败门禁和剩余真机/外部 relay 阻塞
- **状态：** complete

### 阶段 13：Windows / Android 人工验收包交付与 Spec 0085 状态说明

- [x] 核对 Windows NSIS 与 Android production-apk 构建入口、当前源码边界和远端认证
- [x] 从当前工作树生成 Windows x64 安装程序并执行隔离 packaged smoke
- [x] 用户取消临时 APK 构建分支方案，改为由正式 beta tag 触发远端 Android 构建
- [x] 精确说明 0085 自动化已完成、仍等待真实 Codex kill/restart 手工验收
- **状态：** complete

### 阶段 14：整理主工作树并发布 `0.4.0-beta.5`

- [x] 收口 0101 使用量展示、0084/0097 framed 发布门禁与任务记录，保持 0102 merge 半成品隔离
- [ ] 更新并独立提交 `CHANGELOG.md`，明确状态追平修复、usage 展示及 production framed gate 关闭
- [ ] 运行 format、lint、typecheck、ACP drift 与 release prepare 门禁，吸收可能的 lockfile 变动
- [ ] 执行 `npm run release:beta:next`，原子 push `main` 与不可变 `v0.4.0-beta.5` tag
- [ ] 确认 Desktop、Android APK、Release Notes Sync 已触发；等待发布资产并提供 APK/Windows 下载链接
- **状态：** in_progress

## 关键问题

1. 哪些剩余工作必须保持在同一 wire/relay core ticket 中，避免产生第二份协议真相源？
2. 哪些验证需要真实 relay、弱网或 Hermes 环境，不能被本地 GREEN 误判为完成？

## 已做决策

| 决策                                                    | 理由                                                                                                     |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| 使用本地 Spec/micro-spec 作为 tickets，不创建外部 issue | 项目任务总表要求正式任务先登记；用户未授权公开写入 GitHub                                                |
| 保留 0084 为父 Spec，子 ticket 使用 `0087–0095、0097`   | 0084 是唯一 wire/配置真相源；`0086` 与 `0096` 已由并行正式任务占用，独立执行单元用本地文档索引和依赖约束 |
| 先拆 relay core，再拆 runtime/classification/UI/验证    | framed selection、envelope、限额和 FIFO 是所有后续消费者的前置契约                                       |
| beta.5 有意保留当前 ACP package-runner pins             | drift 检出 8 个新 registry 版本；临发版升级会扩大状态追平、usage 与 relay 修复之外的行为范围             |

## 遇到的错误

| 错误                                                                        | 尝试次数 | 解决方案                                                                             |
| --------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------ |
| 未发现仓库内现成 `/to-tickets` 命令或模板                                   | 1        | 按项目 `mydocs/specs` / `mydocs/micro_specs` 规则落成本地 ticket 文档                |
| 首个新 ticket 与并行任务 `0086_退出时活跃会话标记` 冲突                     | 1        | 保留正式 `0086`，本批 10 份 ticket 整体顺延为 `0087–0096`                            |
| 顺延后最终 ticket 与新并行任务 `0096_Supervisor日志容错与语音下载清理` 冲突 | 1        | 保留并行 `0096`，仅将最终收口 ticket 改为 `0097`                                     |
| 批量 `rtk rg` 中无匹配项以退出码 1 中止聚合调用                             | 1        | 改用独立或 `Promise.allSettled` 检查；无匹配按“编号未占用”处理                       |
| Windows 缺少独立 `wc`，`rtk wc` 无法启动                                    | 1        | 不再重试；需要行数时改用 `rtk proxy powershell`                                      |
| 全库绝对唯一检查命中既有 Heavy/Light 同号 `0035/0050`                       | 1        | 按项目允许的升级互链规则，改为检查本批编号唯一性及并行编号保留                       |
| 首版索引校验正则只匹配 Markdown 表格中的单空格分隔                          | 1        | 按格式化后的可变列宽改为 `\s+`，重跑后 10/10 通过                                    |
| PowerShell 枚举局部 `AGENTS.md` 时 `$_` 被外层展开                          | 1        | 改用 RTK 原生 `rg --files` 或无脚本变量的 PowerShell 表达式                          |
| 首次续接文档补丁的 Spec 锚点包含多余转义符，未匹配实际文本                  | 1        | 改用 `rg -F` 定位后以精确原文和小补丁重试                                            |
| 根 `build:desktop` 未向内层 npm 透传 `--win --x64 --dir`                    | 1        | 按既有脚本拆为 app export、server/main build 与直接 electron-builder                 |
| 首次记录构建错误的补丁误用 progress 表格行作为 task_plan 锚点               | 1        | 读取两份文件尾部后使用各自精确锚点                                                   |
| PowerShell `Get-Content` 未显式指定 UTF-8 导致中文切片显示乱码              | 1        | 不再用该输出判断内容；改用 `rtk read`/`rtk rg` 获取 UTF-8 原文                       |
| Hermes 脚本预检报 nested ternary，定向 tsgo 的第二个 `--types` 覆盖 Node    | 1        | 改为显式 if/else、稳定收窄；静态命令只传单一 `--types node`                          |
| hosted 近上限首跑超时后重试 TLS 失败掩盖首因，并产生未消费 rejection        | 1        | waiter 监听两端 close/error 并清理；边界场景取消自动重试                             |
| 首次收紧 live waiter 的大补丁锚点未匹配格式化后单行函数签名                 | 1        | 读取三个精确片段后拆分小补丁，不重复整块匹配                                         |
| live 全文件二跑在大帧前遇到连续 TLS 建连失败                                | 1        | DNS/TCP 仍可达；改为测试名过滤，只运行近上限场景                                     |
| 表示拆分组合补丁再次被 Markdown 表格列宽锚点阻断                            | 1        | 将测试代码与任务记录完全拆开应用                                                     |
| realtime 实现补丁首次含同文件多操作/无 hunk 锚点而被拒绝                    | 2        | 改为同一 Update File 下的独立精确 hunk                                               |
| 当前 npm 两种 workspace script 写法都只打印 npm 自身帮助                    | 2        | 不再重试；按 package.json 直接使用登记的 `tsx --tsconfig` 入口                       |
| realtime 首次目标 lint 报 resolve shadow 与 Promise always-return           | 1        | import 改名并显式返回后 lint、format、typecheck 和 Vitest 全绿                       |
| hosted realtime 单轮仅报 `Transport closed (code 0)`，无法定位阶段          | 1        | 增加 profile/phase/wire 错误上下文后再执行，不原样重试                               |
| phase wrapper 闭包捕获可空 cleanup client，server typecheck 拒绝            | 1        | 保留不可变 connected client 常量，nullable 引用只用于 finally cleanup                |
| measurement client 未声明 `appVersion`，mock Agent 被旧客户端 gate 隐藏     | 1        | 复用当前 package version；真实 daemon RED→GREEN 并检查 seed 终态                     |
| realtime 正式 5 轮在第二档 relay client connect 收到 close code 0           | 1        | 增加 control-ready 有界等待与逐 wire 建连阶段，不把无报告失败算作 p95                |
| measurement Node `ws` close 参数被误当作标准 CloseEvent                     | 1        | wrapper 补 `addEventListener/removeEventListener`，以 `1013/reason` 回归锁定真实诊断 |
| `build:client` 首次读取到重建前的 relay 声明                                | 1        | 先执行 `build:relay`，再重跑 `build:client`，两项均退出 0                            |
| Android 首次本地构建的双层 PowerShell 提前展开 `$env:*`                     | 1        | Gradle 因 SDK location missing 退出；改用单引号保护内层命令并显式传 production 环境  |
| 用户中断后仍残留本地 Gradle 构建树                                          | 1        | 精确核对命令行后只停止该三进程树，并删除一次性镜像 init；不再本地编译 APK            |
| GitHub CLI/curl 的 Windows TLS 通道间歇性 EOF/握手失败                      | 1        | 改用 Python 标准 HTTPS 通道完成只读 API 核验；未触发任何远端写入                     |
| 已有远端 APK 与当前 review-fix 源码不一致                                   | 1        | `android-v0.4.0-beta.4` 指向 `87a2e33`；`c9fb237` 未在远端，等待临时构建 ref 授权    |
| 阶段 13 记录补丁含未转义 Markdown 反引号，脚本解析失败                      | 1        | 改用逐行字符串组装补丁，不重复原写法                                                 |
| Android 记录与重启构建的工具编排脚本含 Markdown 字面量导致语法错误          | 1        | 无文件或进程副作用；拆分为独立补丁与独立构建调用                                     |
| Android 第二次构建被残缺 NDK 27.0 目录阻断                                  | 1        | 项目要求的 27.1 完整存在；定位环境或 `.cxx` 旧引用后只重置生成态，不删除 SDK         |
| SDK 隔离父目录首次用 `New-Item -LiteralPath`，当前 PowerShell 不支持        | 1        | 父目录和移动均未发生；改用精确 `-Path` 创建后再以 `Move-Item -LiteralPath` 移动      |
| Android 第三次构建的 Gradle 依赖下载 TLS 握手失败                           | 1        | NDK 配置已通过；`react-native-webview` 的旧 AGP 依赖未缓存，先检查网络/缓存/镜像     |
| Android 镜像构建命令的 `-Dorg.gradle.parallel=false` 被解析为任务名         | 1        | 未进入源码任务；去掉重复命令行属性，保留 `GRADLE_OPTS` 与 `--max-workers=1`          |

## 备注

- 阶段 1–5 只写任务文档和索引；阶段 6 在用户独立批准后实施生产代码。
- 大量工作区 dirty 状态属于用户/并行任务改动，保持不动。
- 阶段 6 仅修改 0087 归属的 relay 握手生产代码、公开类型、临时测试 cast 和任务事实源；未实现后续 parser/compression/runtime/UI。
- realtime 正式门禁只再执行一次：先补齐 observation、两路 state-sync、stress turn 与 client/control/data 生命周期诊断；若仍中断，按真实门禁失败记录，不关闭心跳或放宽阈值。
- 阶段 12 未重跑 hosted near-limit 或 realtime 正式 5 轮；历史外部结果保留，当前 production wire 明确为 legacy Base64/hybrid。
- 阶段 14 的远端 CI 代码检测不作为发布阻塞条件；Desktop/APK/Release Notes 三条发布 workflow 的产物仍属于本次交付，需等待并核验。
