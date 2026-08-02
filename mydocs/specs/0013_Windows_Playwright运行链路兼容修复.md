# Windows_Playwright运行链路兼容修复 Spec

> 历史迁移说明：本文于 2026-08-02 从 `mydocs/tasks/0013_Windows_Playwright运行链路兼容修复/` 迁移为当前规则集的单文件 Heavy Spec。第 0-9 章是当前权威摘要；第 10 章按源文件保存完整历史原文和 SHA-256，仅用于追溯，不构成新的执行授权。

## 0. 状态与索引

| 字段              | 值                                                        |
| ----------------- | --------------------------------------------------------- |
| task_id           | `0013`                                                    |
| spec layer        | `Feature Spec`                                            |
| task status       | `已收口`                                                  |
| mode              | `single_project`                                          |
| phase             | `Review`                                                  |
| approval status   | `Plan Approved`                                           |
| approval source   | `User`                                                    |
| spec path         | `mydocs/specs/0013_Windows_Playwright运行链路兼容修复.md` |
| parent spec       | `N/A`                                                     |
| supersedes        | `N/A`                                                     |
| current task unit | `历史任务记录迁移与归档`                                  |
| created / updated | `2026-07-27 / 2026-08-02`                                 |

## 1. 目标、范围与完成契约

- 背景/问题：该任务使用旧规则集的多文件任务包记录，现需迁移为当前单文件 Spec。
- 最终目标：让 App Playwright 从 Windows 正式 npm 入口启动，不依赖临时 preload、shim 或系统浏览器。
- 当前任务单元：无损迁移历史记录并关闭旧路径。
- 范围内：Metro/daemon 启动命令、tsx argv、npm project 引号、Chromium prerequisite、CLI supervision 回归。
- 范围外：产品 UI、Provider 行为、CI 改造、全量 E2E 或主 daemon 6767。
- Done Contract：当前摘要覆盖任务状态、关键事实、方案、执行、验证、风险和提交；全部旧 Markdown 原文及内容哈希保存在第 10 章；旧目录仅在迁移验证通过后删除。
- 失败或回炉方式：任一源文件未被完整嵌入、哈希不符或格式检查失败时，保留旧目录并重新生成，不以不完整的新 Spec 替代源记录。

### 1.1 最小任务单元判断

- 为什么当前任务单元足够小：单个 task_id 只生成一份对应 Spec，不合并不同任务的事实或授权。
- 验证证据：源文件清单、SHA-256、完整内容包含检查和 Markdown 格式检查。
- 模型可自主决定的范围：章节重组、历史摘要和附录顺序；不得改写历史授权或扩大任务结论。
- 拆分决定：`Accepted`

## 2. 上下文与调研

### 2.1 上下文来源

- 需求来源：用户要求将历史文档转为新规则集格式后删除旧文档。
- 项目事实源：`PROJECT.md`、Git 历史、当前源码以及第 10 章保存的旧任务包。
- Codemap：`N/A`
- Codemap Mode：`N/A`
- Context Bundle：`N/A`
- Context Bundle Level：`N/A`
- 关联任务记录：`N/A`

### 2.2 调研结论

已确认事实：

- Node 直接执行 Expo CLI，并用 process.execPath --import tsx 启动 TypeScript supervisor。
- Windows npm script 能正确解析 Desktop Chrome，Playwright 1.58.2 Chromium 1208 由显式 prerequisite 提供。
- 实现和文档进入 7bc87b12c；旧 progress 中未提交描述是提交前快照。

- 未知与开放问题：无影响本次历史迁移的开放问题；动态 refs、外部服务和旧基线只按历史快照理解。
- 风险与约束：需要真实 Provider 的另一个 E2E 当时被本机缺少 opencode 阻断，不属于启动链失败。
- `grilling` 结论（如使用）：未使用；迁移目标与删除范围已由用户明确。

### 2.3 方案与决策

- 备选方案：保留旧任务包、只写摘要后删除、或在新 Spec 中同时保存摘要和完整原文。
- 已选方案：使用当前模板的 0-9 章保存权威摘要，并在第 10 章无损嵌入全部旧文件。
- 选择理由：消除并行真相源，同时避免删除未提交历史记录造成证据丢失。

历史任务关键决策：

- 不使用 shell:true、npx spawn、which tsx、系统浏览器 fallback 或 revision 映射。
- 保持现有生命周期与清理逻辑，只替换跨平台 command/argv。

### 2.4 下一步动作

- 下一步唯一动作：N/A；任务已提交。

## 3. 计划与执行前检查点

### 3.1 文件变化

| 项目/子项    | 文件或子 Spec                                             | 计划变化                     | 原因                     |
| ------------ | --------------------------------------------------------- | ---------------------------- | ------------------------ |
| 历史任务记录 | `mydocs/tasks/0013_Windows_Playwright运行链路兼容修复/`   | 合并到当前单文件 Spec 后删除 | 消除旧规则集多文件真相源 |
| 当前 Spec    | `mydocs/specs/0013_Windows_Playwright运行链路兼容修复.md` | 新建                         | 使用当前 Heavy Spec 模板 |

### 3.2 签名与契约

| 项目/子项 | 接口、类型或签名     | 计划变化 | 兼容性         |
| --------- | -------------------- | -------- | -------------- |
| 文档迁移  | 运行时接口与数据契约 | 无变化   | 仅迁移历史记录 |

### 3.3 子 Spec 索引

N/A；该历史 task_id 迁移为单个 Spec。

### 3.4 执行清单

- [x] 1. 读取并归档旧任务包全部 Markdown 文件。
- [x] 2. 建立当前模板要求的状态、目标、上下文、执行、验证和提交摘要。
- [x] 3. 记录源文件 SHA-256 并验证完整内容已嵌入。
- [x] 4. 在新 Spec 验证通过后删除旧目录。

### 3.5 执行前检查点

- 当前目标与任务单元：历史任务单文件迁移。
- 当前 phase：`Review`
- approval status / source：`Plan Approved / User`；用户已明确授权转换并删除旧文档。
- 下一步：验证格式、内容哈希和旧路径引用。
- 风险与回退：验证失败时不删除旧目录；Git 可恢复原 tracked 文件，未跟踪源内容已完整嵌入第 10 章。
- 验证方式：生成器内容包含检查、格式检查、旧路径检索和 Git 范围审查。
- TDD 判定、测试 seam 与验收行为：`N/A`；当前改动只迁移历史文档，不改变运行时行为。
- seam 确认：`N/A`

## 4. 跨项目扩展

N/A；单项目历史文档迁移。

## 5. 执行记录

| 步骤/子项 | 实际变化或子 Spec 锚点                              | 状态   | 偏差与处理                   |
| --------- | --------------------------------------------------- | ------ | ---------------------------- |
| 1         | 修复 Expo、daemon 和 isolated daemon 启动链。       | 已记录 | 详细时间线见第 10 章原始记录 |
| 2         | 修复 npm project 引号并记录 Chromium prerequisite。 | 已记录 | 详细时间线见第 10 章原始记录 |
| 3         | 修正 CLI supervision 断言并完成最终审查。           | 已记录 | 详细时间线见第 10 章原始记录 |
| 文档迁移  | 旧任务包完整原文进入第 10 章                        | 已完成 | 不改写原始记录               |

## 6. 验证

| 项目/验收项 | 命令或步骤                             | 结果   | 证据           | 未验证原因 |
| ----------- | -------------------------------------- | ------ | -------------- | ---------- |
| Windows npm | --list 列出 300 个 Desktop Chrome 测试 | `PASS` | 历史任务记录   | `N/A`      |
| 目标 E2E    | workspace-model-restart 1 passed       | `PASS` | 历史任务记录   | `N/A`      |
| CLI         | daemon launch supervision 4/4          | `PASS` | 历史任务记录   | `N/A`      |
| 静态门禁    | typecheck、lint、format、diff check    | `PASS` | 历史任务记录   | `N/A`      |
| 迁移完整性  | 源文件 SHA-256 与完整内容包含检查      | `PASS` | 第 10.1 节清单 | `N/A`      |

- 集成验证：当前迁移不改变产品代码；历史产品验证结果按上表和第 10 章保留。
- 剩余风险：需要真实 Provider 的另一个 E2E 当时被本机缺少 opencode 阻断，不属于启动链失败。
- Done Contract 是否由证据满足：是

## 7. 评审（Review）

| 评审轴             | 结论   | 证据或阻塞问题                                                                  |
| ------------------ | ------ | ------------------------------------------------------------------------------- |
| 目标与 Spec 完成度 | `PASS` | 历史结论和完整原文已迁移                                                        |
| Spec 与执行一致性  | `PASS` | 新摘要不扩大旧授权，原文无损保留                                                |
| 实现质量与风险     | `PASS` | 需要真实 Provider 的另一个 E2E 当时被本机缺少 opencode 阻断，不属于启动链失败。 |

- Overall Verdict：`PASS`
- Blocking Issues：None
- Cross-project consistency：`N/A`

### 7.1 回归风险

| project_id | Regression risk | 依据                              |
| ---------- | --------------- | --------------------------------- |
| `paseo`    | `Low`           | 当前只迁移 Markdown，不改变运行时 |

### 7.2 Touched Projects

N/A。

- Orphan changes：`None`

## 8. 偏差、变更与反向同步

- Plan-Execution Diff：历史任务的计划与执行偏差按第 10 章原记录保存；本迁移不重新裁决。
- Change Log：2026-08-02 将旧多文件任务包迁移为当前单文件 Heavy Spec。
- 用户决策：转换历史文档，验证后删除旧目录；0031 由其他会话处理，不在本迁移范围。
- Spec 反向同步结果：第 0-9 章成为当前权威摘要，第 10 章保存只读历史原文。

## 9. 恢复、长期知识与提交关联

- 状态说明：`已收口`
- 当前卡点：`N/A`
- 下一步唯一动作：N/A；任务已提交。
- Resume / Handoff 锚点：本文第 0 章；详细历史见第 10 章。
- Project Sync Candidates：无；本迁移不从一次性历史记录推导新的长期规则。
- 长期文档同步：仅更新旧任务路径登记，不改变产品知识。

### 提交记录

| 提交信息（Commit Message）                                                                            | 提交脚注（Commit Footer） | 关联项目 / 改动或阶段                | 文档同步状态 | 备注           |
| ----------------------------------------------------------------------------------------------------- | ------------------------- | ------------------------------------ | ------------ | -------------- |
| `fix(app): make Playwright E2E startup work on Windows`（`7bc87b12cb1049b0d268a6bd4d97540fedba8ba0`） | `N/A`                     | `paseo / Windows Playwright harness` | 已同步       | 历史提交已存在 |

## 10. 历史原始记录

### 10.1 源文件完整性清单

以下哈希按 LF 规范化且去除文件尾空白后计算。

| 源文件         | 规范化字节数 | SHA-256                                                            |
| -------------- | -----------: | ------------------------------------------------------------------ |
| `SPEC.md`      |        10031 | `c2dc4c50511fbcf18a69ed3074f734ce11c6c7b3a1e51fd83e7a121bd6a1bc61` |
| `findings.md`  |         8071 | `f9fed0bfb9e98910bc2d96ab02d48432f8a7769a19c7b08a0d03e9513d25f557` |
| `progress.md`  |         9680 | `cb122ab082b6e65086f3682cd5db8a133608b4a5d66fa4220d7e43fc23acb605` |
| `task_plan.md` |         2905 | `b63ce1a3542a363f4cbdc77cb1122697ff28c741bfe3e4652d1860bb18270b2e` |

### 10.2 原 `SPEC.md`

```text
# Spec: Windows Playwright 运行链路兼容修复

## Status

- Task ID: `0013`
- Lifecycle: `Completed`
- Approval Status: `Approved`
- Execution Gate: 用户已于 `2026-07-27` 批准 Proposed Plan，允许修改计划内 harness、安装 Chromium 并执行定向 E2E；最终 diff 审查发现 CLI supervision 回归断言过期后，用户又明确批准修复该断言、运行单测并重新审查。
- Source: `0012` 本地 E2E 验证，以及 `0007`、`0008`、`0009`、`0011` 中重复出现的 Windows Playwright 启动阻塞。

## Goal

- 让 App Playwright E2E 能从 Windows PowerShell 使用仓库正式配置启动，不再依赖临时 `NODE_OPTIONS` preload、替代 config、revision 映射或硬编码系统 Edge。
- 消除裸 `spawn("npx")` 和 POSIX `which tsx` 对 Windows 的阻塞，同时保持 Linux/macOS/CI 行为不回退。
- 明确并验证 Playwright 默认 Chromium 的安装或预检合同，使缺失浏览器不再需要任务级 workaround。

## Done Contract

- Windows 上通过仓库正式 npm script 和 `packages/app/playwright.config.ts` 启动一个定向 App E2E，完成隔离 daemon、Metro、relay、浏览器、测试与清理的完整生命周期。
- E2E 运行链路不直接调用裸 `spawn("npx")` 或 POSIX-only `which tsx`；仓库内同类 E2E helper 一并使用同一跨平台解析方式。
- 默认 Chromium 的供给方式可重复：依赖已满足时直接运行，缺失时给出项目声明的确定恢复动作；不得通过伪造 revision 或硬编码个人机器浏览器路径通过。
- 主 daemon `6767` 不被连接或重启；失败路径不残留 daemon、Metro、relay 或浏览器进程。
- 定向回归、`npm run typecheck`、`npm run lint` 和目标文件格式检查通过；Linux/CI 的现有 Playwright 入口保持兼容。
- 既有 `packages/cli/tests/26-daemon-launch-supervision.test.ts` 验证新的 Node/tsx supervisor 启动合同并通过。

以下任一情况仍算未完成：只修 `global-setup.ts` 而保留其他 E2E `which tsx` 阻塞、使用 `shell: true` 绕过可执行文件解析、要求开发者长期维护本地 shim/config、或只改善错误文案但正式 Windows E2E 仍无法启动。

## Scope

### In Scope

- `packages/app/e2e/global-setup.ts` 中 Metro 与 daemon 的进程启动。
- `packages/app/e2e/helpers/isolated-host-daemon.ts`、`packages/app/e2e/workspace-model-restart.spec.ts` 等 E2E 范围内的 `which tsx` 调用点。
- `packages/app/playwright.config.ts`、App E2E npm script，以及 Playwright Chromium 安装/预检所需的最小项目文档或脚本。
- `packages/cli/tests/26-daemon-launch-supervision.test.ts` 中与 App E2E daemon 启动形状直接绑定的回归断言。
- Windows 失败清理与单个定向 smoke 证据。

### Out of Scope

- 产品 UI、agent/provider 行为和普通工具调用逻辑。
- 0012 的 reasoning 展开语义与回归测试内容。
- 重启或改造端口 `6767` 的主 daemon。
- 顺带修复无关 E2E 断言、测试时序或生产功能。

## Confirmed Facts

- `packages/app/e2e/global-setup.ts` 的 `startMetro` 当前执行 `spawn("npx", ...)`，Windows Node 子进程解析为 `ENOENT`。
- 同文件的 `startDaemon` 执行 `execSync("which tsx")`；`isolated-host-daemon.ts` 和 `workspace-model-restart.spec.ts` 是其余两个同类调用点，App E2E 范围内没有第四处。
- 仓库已有多处 `process.execPath + ["--import", "tsx", ...]`，App E2E 的 `daemon-update.ts` 也已通过 `fork(..., { execArgv: ["--import", "tsx"] })` 使用同一模式；tsx 官方文档确认该调用适用于 Node 20.6+。
- Expo 包的 `bin/cli` 是可由 Node 直接执行的 JavaScript 入口；本机用 `node node_modules/expo/bin/cli --version` 成功输出 `54.0.23`。当前 npm hoist 布局只有根 `node_modules/expo/bin/cli`，因此实现应使用模块解析，不硬编码 `packages/app/node_modules`。
- `packages/app/package.json` 的 `--project='Desktop Chrome'` 在 Windows `cmd.exe` 被拆成项目 `"'Desktop"`；`--list` 已在进入 global setup 前稳定复现失败。
- 当前 lockfile 安装 Playwright `1.58.2`，期望 Chromium/headless shell revision `1208`；本机只有另一个 Playwright `1.61.0` 使用的 revision `1228`，不能互换。
- Playwright `1.58.2` 官方文档说明 npm 安装不会下载浏览器，推荐在依赖安装后显式执行 `npx playwright install`；仓库 CI 已在两个相关 job 中执行 `npx playwright install chromium`。
- 0012 曾用工作区内临时 preload 把 Metro 改为 Node 直启、把 `tsx.cmd` 交给 shell，并用临时 config 指向系统 Edge；该方案只用于取证，已删除且不应产品化。
- 临时 `shell: true` 运行 `tsx.cmd` 会触发 Node 的参数拼接安全警告，不应作为正式修复。
- 0004 的范围是两项历史 Playwright 断言基线，且明确把 Windows harness 兼容性排除为独立任务，因此本任务不恢复或改写 0004。

## Proposed Plan

### 1. 进程启动

1. 在 `global-setup.ts` 通过 Node 模块解析取得 `expo/bin/cli`，以 `process.execPath` 直接启动该 JavaScript 入口；保留现有参数、cwd、env、stdio、输出缓冲和 cleanup。
2. 将三处 supervisor 启动统一为 `process.execPath` 加 `--import tsx` 和现有 TypeScript entrypoint；只替换 command/argv，保留各调用点已有的生命周期和错误输出，不新增共享 resolver。
3. 将 App E2E npm script 的项目名改为 Windows 与 POSIX 都能正确分组的 JSON 转义双引号；不引入 shell wrapper。

### 2. Chromium 供给

1. 保持 `playwright.config.ts` 使用 Playwright 管理的默认 Chromium，不设置 `channel`、`executablePath` 或系统浏览器 fallback。
2. 采用显式前置依赖合同：fresh `npm ci` 后或 Playwright lock 版本变化后执行仓库 CI 已使用的 `npx playwright install chromium`；在 `docs/testing.md` 记录该命令和触发时机。
3. 不把浏览器下载加入根 `postinstall` 或每次 E2E 自动前置，不增加 `@playwright/browser-chromium`，也不维护 revision 映射。缺失时以 Playwright 原生启动错误和项目文档中的同一条恢复命令收口。
4. 现有 CI 已满足该合同，不计划修改 CI browser install step。

### 3. 最窄实现与验证

1. 修改三个 E2E 启动文件、App package script、`docs/testing.md`，并同步与新启动形状直接绑定的 CLI supervision 回归断言；其他范围扩张仍需先更新 Spec 并重新请求批准。
2. 用 CLI supervision 单测验证新启动合同，用 `npm run test:e2e --workspace=@getpaseo/app -- --list` 验证 Windows 项目参数解析，再用 `worktree-restore-after-restart.spec.ts` 与 `workspace-model-restart.spec.ts` 覆盖 global stack 和三处 TS daemon 启动。
3. 验证成功与失败清理、端口 `6767` guard、typecheck、lint 和目标文件格式；Linux 行为由未改语义的 Node 入口及后续 CI 证明。

## Risks / Decisions

- 浏览器供给已选定为显式 E2E prerequisite，不进入通用 npm install 生命周期；这是 Playwright 官方推荐方式，也与现有 CI 一致。
- 直接执行 `.cmd` 需要 shell 且存在参数转义风险；方案改为执行当前 Node 二进制和 JavaScript/TypeScript 入口，不解析 `.bin` shim。
- Expo CLI 必须通过模块解析取得，不能假设依赖物理存在于 `packages/app/node_modules`。
- 不使用 `chromium.executablePath()` 加单文件 `existsSync` 自制预检：Playwright `1.58.2` 的默认 headless 启动实际依赖独立的 headless-shell 路径，单路径检查可能误判。
- 当前 shell 中 Node 为 `26.4.0`，项目锁定 `22.20.0`；Research 已用 Node `22.20.0` 官方文档和仓库现有调用模式确认合同，最终 E2E 仍需在项目锁定版本或 CI Node 22 上证明。
- global setup 管理多个子进程，任何启动调整都必须保留当前超时、输出缓冲和 cleanup 行为。
- 若修复要求修改 CI 浏览器缓存、安装流程或引入自动下载 hook，先更新本 Spec 并重新通过 execution checkpoint。

## Validation Plan

1. 在项目锁定依赖下执行 `npx playwright install chromium`；确认安装的是当前 Playwright 期望的 revision，不复用其他版本缓存。
2. Windows PowerShell 下运行 `npm run test:e2e --workspace=@getpaseo/app -- --list`，确认 `Desktop Chrome` 被作为完整项目名解析且不启动 global setup。
3. 运行 `worktree-restore-after-restart.spec.ts`，覆盖正式 global setup 的 Metro、primary daemon、relay、Chromium 与 `isolated-host-daemon.ts`。
4. 运行 `workspace-model-restart.spec.ts`，覆盖其内联 restart daemon 启动；不得运行本地全量 Playwright。
5. 对成功和人为失败路径检查无残留监听端口或子进程，且 `6767` guard 保持生效。
6. `npm run typecheck`、`npm run lint`、目标文件格式检查；获准 push 后以现有 Linux CI 为跨平台最终证据。
7. 直接运行 `packages/cli/tests/26-daemon-launch-supervision.test.ts`，确认回归断言接受新的 `process.execPath --import tsx` 启动合同，同时继续拒绝直接 worker 入口。

## Checkpoint / Resume

- 当前理解：这是反复阻断多个功能 E2E 的共享 Windows harness 问题，不属于任何单个产品功能。
- 核心目标：正式、可重复地启动 Windows App Playwright E2E，同时不削弱其他平台和进程清理。
- 当前进度：实现、审查修复与最终 Review 已完成；实际变更、验证和残余风险见 `progress.md#2026-07-27-回归断言修复与最终重审`。
- 下一步：本任务范围内无待执行项；获准 push 后由现有 Linux CI 提供补充跨平台证据。
- 当前卡点：无 Done Contract 阻塞；本机缺少真实 `opencode` provider，仅阻止一项测试继续执行其业务断言，不影响已完成的 harness 证据。
- Project Sync：显式 Chromium prerequisite 已写入 `docs/testing.md`；无需同步 CodeMap、项目规则或依赖注册表。
```

### 10.3 原 `findings.md`

```text
# Windows Playwright 运行链路兼容修复调查发现

本文件只记录进程启动与 Chromium 供给的 Research 证据。已采纳方案与验收合同见 `SPEC.md`，当前状态见 `task_plan.md`，执行时间线见 `progress.md`。

## 任务绑定

| 字段     | 锚点                                               |
| -------- | -------------------------------------------------- |
| task_id  | `0013`                                             |
| 任务合同 | `SPEC.md#spec-windows-playwright-运行链路兼容修复` |
| 当前状态 | `task_plan.md#当前操作状态`                        |

## F1 - Windows 不兼容调用点已穷举

| 位置                                               | 当前调用                         | 影响                                                | 结论                                       |
| -------------------------------------------------- | -------------------------------- | --------------------------------------------------- | ------------------------------------------ |
| `packages/app/e2e/global-setup.ts`                 | `spawn("npx", ["expo", ...])`    | Windows Node 不解析 npm 的 `.cmd` shim，报 `ENOENT` | 改为当前 Node 直接执行 Expo JavaScript CLI |
| `packages/app/e2e/global-setup.ts`                 | `execSync("which tsx")` 后 spawn | Windows 没有 POSIX `which`                          | 改为当前 Node 加 `--import tsx`            |
| `packages/app/e2e/helpers/isolated-host-daemon.ts` | 同上                             | 二级 host daemon 无法启动                           | 使用同一 Node/tsx argv                     |
| `packages/app/e2e/workspace-model-restart.spec.ts` | 同上                             | restart daemon 无法启动                             | 使用同一 Node/tsx argv                     |
| `packages/app/package.json`                        | `--project='Desktop Chrome'`     | Windows `cmd.exe` 把项目名拆成 `"'Desktop"`         | JSON 中使用跨平台双引号                    |

定向 `rg` 只发现上述一处裸 `spawn("npx")` 和三处 `which tsx`。`npm run test:e2e --workspace=@getpaseo/app -- --list` 已复现项目名解析失败，尚未进入 global setup。

## F2 - 选定的进程启动合同

| 证据                                                                                | 可信度                        | 对方案的约束                                                         |
| ----------------------------------------------------------------------------------- | ----------------------------- | -------------------------------------------------------------------- |
| tsx 官方文档：`node --import tsx ./file.ts`                                         | 高，Context7 返回官方仓库文档 | Node 20.6+ 可直接运行 TS entrypoint，无需解析 `tsx` shim             |
| Node `22.20.0` 官方 `child_process` 文档                                            | 高，Context7 返回官方版本文档 | Windows `.cmd` 不能无 shell 直启；本任务不得用 `shell: true` 绕过    |
| 仓库中 `packages/app/e2e/helpers/daemon-update.ts`、CLI/Server/Desktop 多处现有用法 | 高，当前源码                  | `process.execPath` 与 `--import tsx` 是已有项目模式，不新建 resolver |
| `node_modules/expo/bin/cli` 内容为 `require('@expo/cli')`                           | 高，当前锁定依赖源码          | Metro 可由 Node 直接执行 Expo CLI JavaScript 入口                    |
| `node node_modules/expo/bin/cli --version` 输出 `54.0.23`                           | 高，本机实际命令              | 直接 Node 入口可运行                                                 |
| 当前 hoist 只有根 `node_modules/expo/bin/cli`                                       | 高，本机文件系统              | 用模块解析定位入口，不硬编码 workspace 物理安装位置                  |

采纳方案只替换 command/argv，保留每个调用点的 cwd、env、stdio、timeout、日志缓冲与 cleanup。没有足够重复复杂度支撑新 helper；真实定向 E2E 是最小回归证据。

## F3 - 选定的 Chromium 供给合同

| 证据                                                                             | 可信度                          | 对方案的约束                                   |
| -------------------------------------------------------------------------------- | ------------------------------- | ---------------------------------------------- |
| Playwright `1.58.2` 官方文档：v1.38+ npm install 不自动下载浏览器                | 高，Context7 返回官方版本文档   | 不把“已 npm ci”等同于“浏览器已供给”            |
| 官方推荐显式 `npx playwright install`；只需 Chromium 时只安装 Chromium           | 高，官方文档                    | 使用 `npx playwright install chromium`         |
| `.github/workflows/ci.yml` 两个相关 job 已执行同一命令                           | 高，当前仓库                    | 本地文档与 CI 使用同一合同，无需改 CI          |
| 当前 Playwright 为 `1.58.2`，期望 Chromium/headless shell `1208`                 | 高，lockfile 与 `browsers.json` | 浏览器 revision 跟随安装的 Playwright 版本     |
| `playwright install --list` 仅显示 `1.61.0` 的 Chromium `1228`                   | 高，本机实际命令                | 其他项目的新 revision 不能替代当前 revision    |
| 当前 headless launch 缺少 `chromium_headless_shell-1208`，原生错误提示安装浏览器 | 高，本机实际命令                | 复用 Playwright 原生缺失检测，不自制单路径探针 |

采纳“显式 E2E prerequisite”：fresh `npm ci` 后或 Playwright lock 版本变化后运行 `npx playwright install chromium`，并在实施阶段写入 `docs/testing.md`。不加入根 `postinstall`、测试自动下载 hook、浏览器依赖包、系统 Chrome/Edge fallback 或 revision 映射。

## 否定结果与待验证项

| 项目                                               | 当前结论                                                                                   | 下一步                                     |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------ |
| `chromium.executablePath()` 加 `existsSync`        | 不采纳；它指向 full Chromium，而默认 headless launch 缺失的是独立 headless-shell，可能误判 | 依赖官方 install/launch 合同               |
| `shell: true` 或直接执行 `tsx.cmd`                 | 不采纳；跨平台参数语义和转义风险不符合合同                                                 | Node 直接运行 TS entrypoint                |
| 根 `postinstall` 或 `@playwright/browser-chromium` | 不采纳；影响所有安装流程，且官方把显式 CLI 安装列为推荐路径                                | 仅在 E2E prerequisite 中供给               |
| Node `22.20.0` 本机实际 E2E                        | Research 未执行；当前 shell 为 Node `26.4.0`                                               | Execute 获批后用锁定版本或 CI Node 22 验证 |
| Chromium revision `1208` 安装                      | Research 未执行；会下载并修改用户级 Playwright cache                                       | Execute 获批后执行官方命令                 |

## 外部来源

- [Playwright v1.58.2 browser installation](https://github.com/microsoft/playwright/blob/v1.58.2/docs/src/library-js.md)
- [Playwright v1.58.2 release notes](https://github.com/microsoft/playwright/blob/v1.58.2/docs/src/release-notes-js.md)
- [Node.js v22.20.0 child_process](https://github.com/nodejs/node/blob/v22.20.0/doc/api/child_process.md)
- [tsx Node CLI integration](https://github.com/privatenumber/tsx/blob/master/docs/dev-api/node-cli.md)
```

### 10.4 原 `progress.md`

```text
# Windows Playwright 运行链路兼容修复进度

执行、验证与实际收口时间线唯一来源。当前状态读 `task_plan.md`；合同读 `SPEC.md`；调查证据读 `findings.md`。

## 任务绑定

| 字段     | 锚点                                               |
| -------- | -------------------------------------------------- |
| task_id  | `0013`                                             |
| 任务合同 | `SPEC.md#spec-windows-playwright-运行链路兼容修复` |
| 当前状态 | `task_plan.md#当前操作状态`                        |
| 调查记录 | `findings.md#f1-windows-不兼容调用点已穷举`        |

## 2026-07-27 Research 收口

- 做了什么：穷举 App E2E 的裸 `npx`、POSIX `which tsx` 和 npm project 参数调用点；核对仓库既有 `process.execPath --import tsx` 模式、Expo CLI 实际入口、Playwright `1.58.2` 浏览器 revision、当前本机 cache 与 CI 安装步骤；通过 Context7 回读 Playwright、Node `22.20.0` 和 tsx 官方文档。
- 为什么：为进程启动和 Chromium 供给各选一个可删除 workaround、无需 shell、与 CI 一致的合同，避免实现时继续试错。
- 结果：进程启动选定 Node 直接执行 Expo/tsx entrypoint；Chromium 选定显式 `npx playwright install chromium` prerequisite，不进入 postinstall、自动 test hook 或系统浏览器 fallback。Proposed Plan 已更新。
- 证据：`findings.md#f1-windows-不兼容调用点已穷举`、`findings.md#f2-选定的进程启动合同`、`findings.md#f3-选定的-chromium-供给合同`。
- 未执行：没有修改源码、package script、CI 或长期项目文档；没有安装 Chromium、启动 daemon/Metro/relay、运行 E2E 或接触端口 `6767`。
- 阻塞：execution checkpoint 尚未批准；本机 Playwright `1.58.2` 需要的 Chromium/headless shell `1208` 尚未安装。
- 残余风险：当前 shell 为 Node `26.4.0`，最终必须在项目锁定 Node `22.20.0` 或 CI Node 22 上完成行为证据；global cleanup 只能在实施后通过定向 E2E 验证。
- 下一步：用户批准 `SPEC.md#proposed-plan` 后，按最窄文件范围实施并运行两项定向 E2E；未批准前保持无代码变更。

## 2026-07-27 执行批准

- 授权：用户明确回复“批准 0013 方案并开始实现”，Proposed Plan 的五个目标文件、Chromium 安装和两项定向 E2E 已通过 execution checkpoint。
- 当前边界：不修改 Playwright config、CI、产品代码或无关测试；不连接或重启端口 `6767`。
- 下一步：先替换跨平台进程 command/argv 与 npm project 引号，再补 `docs/testing.md` 的浏览器 prerequisite，最后安装 Chromium 并按 Validation Plan 验证。

## 2026-07-27 Chromium 安装首次失败

- 已验证：`npm run test:e2e --workspace=@getpaseo/app -- --list` 成功列出 `Desktop Chrome` 的 300 个测试，Windows npm project 参数解析已通过，且未进入 global setup。
- 失败：获批命令 `npx playwright install chromium` 轮询下载源时最高到 10%，随后以 `Download failure, code=1` 结束；Playwright 清理了未完成的 `chromium-1208`。
- 影响：浏览器供给仍阻塞两项定向 E2E，已批准的显式 prerequisite 方案不变。
- 诊断：完整日志显示官方 CDN 重定向到 Google Storage 后连接被重置；同一 artifact 用 `curl` 经本机 Mihomo HTTP 代理可达，但当前 Node `26.4.0` 的 Playwright 下载进程经该代理仍在 TLS 建立前被重置。
- 第二次尝试：为单次命令临时设置本机 HTTP 代理和 120 秒连接超时，官方安装命令仍失败，未写入项目配置。
- 解决：从 Node 官方发行地址取得仓库锁定的 Node `22.20.0`，核对官方 SHA-256 后在任务临时目录运行；该版本通过本机 HTTP 代理执行 Playwright `1.58.2` 安装入口，成功安装 `chromium-1208` 与 `chromium_headless_shell-1208`。
- 边界：临时 Node、代理和下载超时均未写入仓库、依赖或系统 PATH；没有引入系统浏览器 fallback 或 revision 映射。
- 首次 E2E 调用偏差：命令把 Windows 反斜杠路径交给 Playwright 的正则过滤器，global setup 成功启动 Metro、relay 与 daemon 后因 `No tests found` 进入失败清理；这不是测试断言或实现失败。
- 清理证据：该失败路径的四个随机监听端口、daemon PID 和临时 `PASEO_HOME` 均已消失；所选端口不是 `6767`。
- 定向 E2E 结果：`worktree-restore-after-restart.spec.ts` 已成功启动 Node 直启的 Metro、primary daemon、relay 和 Chromium，随后在业务准备阶段失败于共享 `createIdleAgent` 的既有真实 `opencode` 前置；本机没有 `opencode` 命令，trace 定位到 `helpers/archive-tab.ts:59`，与本次启动/浏览器改动无关。
- 定向 E2E 结果：`workspace-model-restart.spec.ts` 在 Node `22.20.0` 与 Chromium `1208` 下通过，覆盖正式 global stack、Chromium、内联 restart daemon 和浏览器交互，结果为 `1 passed (1.6m)`。
- 清理证据：通过用例的 daemon PID、四个随机监听端口和临时 `PASEO_HOME` 均已消失；所选端口不是 `6767`。
- 下一步：不安装或伪造 agent provider；执行目标文件格式检查、根 typecheck 与 lint，再复核最终 diff 和任务合同。

## 2026-07-27 实施验证收口

- 实际变更：`global-setup.ts` 用当前 Node 直接执行解析后的 Expo CLI，并用 `--import tsx` 启动 primary daemon；`isolated-host-daemon.ts` 与 `workspace-model-restart.spec.ts` 使用同一 Node/tsx argv；App 的两个 `Desktop Chrome` npm script 改用跨平台双引号；`docs/testing.md` 记录显式 Chromium prerequisite。
- 保持不变：`playwright.config.ts`、CI、产品代码、依赖与 lockfile、主 daemon 配置均未修改；没有 `shell: true`、系统浏览器 fallback、自动安装 hook、revision 映射或新抽象。
- Chromium 证据：Playwright `1.58.2` 的安装列表包含 `chromium-1208` 与 `chromium_headless_shell-1208`，另一个项目的 `1.61.0` revision `1228` 保持独立。
- npm 入口证据：Windows PowerShell 下 `npm run test:e2e --workspace=@getpaseo/app -- --list` 成功列出 `Desktop Chrome` 的 300 个测试；正式 npm script 定向运行 `workspace-model-restart.spec.ts` 通过，结果 `1 passed (1.5m)`。
- 启动覆盖：正式 npm 用例覆盖 Metro、primary daemon、relay、Chromium、内联 restart daemon、测试与成功清理；`worktree-restore-after-restart.spec.ts` 的 `beforeEach` 成功覆盖 `isolated-host-daemon.ts`，之后仅因本机缺少真实 `opencode` provider 停在业务准备阶段。
- 静态验证：九个目标源码/文档格式检查通过，根 workspace typecheck 通过，根 lint 为 `0 warnings / 0 errors`，`git diff --check` 通过。
- 清理与安全：成功和失败路径的新 daemon PID、随机监听端口及临时 `PASEO_HOME` 均已清理；所有选定 daemon 端口均不是 `6767`，没有连接或重启主 daemon。任务临时 Node `22.20.0` 目录已删除，Playwright 管理的 Chromium `1208` 缓存按供给合同保留。
- 未验证：缺少 `opencode` 导致 `worktree-restore-after-restart.spec.ts` 未继续执行其业务断言；未运行本地全量 Playwright，未 push，因而没有本轮 Linux CI 结果。global setup 既有的可选 `which gh` 探测仍会在 Windows 输出被捕获的命令缺失提示，属于本任务进程启动范围外的非阻塞噪声。
- Project Sync：已将稳定的 Chromium 安装合同同步到 `docs/testing.md`；本次不改变产品/架构入口，无 CodeMap、项目规则、依赖能力或关键上下文同步项。
- Git：未 stage、commit 或 push；工作树中的其他用户改动保持不变。

## 2026-07-27 最终 diff 审查修复批准

- 审查发现：`packages/cli/tests/26-daemon-launch-supervision.test.ts` 仍精确匹配旧的 `spawn(tsxBin, ...)`，直接运行在第 69 行稳定失败；该测试由 CLI `run-all.ts` 自动发现并进入 CI。
- 用户授权：明确批准修复该过时断言、运行对应单测并重新审查 0013 最终 diff。
- 当前边界：只修改该回归断言，不改生产代码；完成后运行单测、目标静态检查，并以 `HEAD` 为基线重审全部 0013 实现文件。

## 2026-07-27 回归断言修复与最终重审

- 实际修复：将 CLI supervision 测试中绑定旧 `spawn(tsxBin, ...)` 格式的断言替换为格式无关的正则，要求同一次启动使用 `process.execPath`、`--import tsx`、`scripts/supervisor-entrypoint.ts` 和 `--dev`；原有禁止直接 worker 入口的断言保持不变。
- 单测：`node --import tsx packages/cli/tests/26-daemon-launch-supervision.test.ts` 通过，四项 supervision 检查全部成功；当前 Node `26.4.0` 仅输出 `module.register()` 弃用警告，不影响退出码。
- 静态验证：目标文件 lint 为 `0 warnings / 0 errors`，根 `npm run typecheck` 通过，目标格式检查和完整 `git diff --check` 通过；typecheck 未留下额外生成差异。
- 最终审查：以 `HEAD` `14f8ed70e5bae181be0a47a584c2034ab61fe65e` 为基线，审查六个实现/回归文件；Standards 轴与 Spec 轴均为 `0 findings`，此前 P1 已关闭。
- 未重复执行：已报告通过的 Windows 定向 Playwright E2E、`--list`、Chromium 安装与清理证据没有重复运行；未运行本地全量测试或 Linux CI。
- Project Sync：没有新增跨任务长期知识；Chromium prerequisite 仍由 `docs/testing.md` 承载，无需修改 CodeMap、项目规则或依赖注册表。
- Git：未 stage、commit 或 push；工作树中的其他用户改动保持不变。
```

### 10.5 原 `task_plan.md`

```text
# Windows Playwright 运行链路兼容修复任务计划

本文件只保存任务索引、依赖、操作性阻塞和当前状态。完整合同见 `SPEC.md`，调查证据见 `findings.md`，实际动作与验证见 `progress.md`。

## Spec 绑定

| 字段                 | 值                                                      |
| -------------------- | ------------------------------------------------------- |
| task_id              | `0013`                                                  |
| 记录根               | `mydocs/tasks/0013_Windows_Playwright运行链路兼容修复/` |
| 任务索引锚点         | `N/A`                                                   |
| 需求、范围与决策权威 | `SPEC.md#spec-windows-playwright-运行链路兼容修复`      |
| Done Contract 锚点   | `SPEC.md#done-contract`                                 |

## 当前操作状态

- 当前阶段：`Review / completed`
- 当前责任：Codex 已修复过时 CLI supervision 断言、完成验证并重新审查完整 diff
- 执行状态：`COMPLETE`
- 最后更新：`2026-07-27`
- 最近 progress 锚点：`progress.md#2026-07-27-回归断言修复与最终重审`

## 阶段索引

| 阶段     | Spec/progress 锚点                          | 依赖                         | 所有者           | 当前状态              |
| -------- | ------------------------------------------- | ---------------------------- | ---------------- | --------------------- |
| Research | `findings.md#f1-windows-不兼容调用点已穷举` | 当前源码、锁定依赖、官方文档 | Codex            | completed             |
| Plan     | `SPEC.md#proposed-plan`                     | Research 完成                | Codex / 用户审批 | completed / approved  |
| Execute  | `SPEC.md#proposed-plan`                     | 明确 execution approval      | Codex            | completed             |
| Review   | `SPEC.md#validation-plan`                   | Execute 与定向验证完成       | Codex            | completed；0 findings |

## 操作性阻塞引用

| ID  | findings/progress 锚点                    | 影响阶段       | 所有者/动作                                  | 当前状态/解除条件                  |
| --- | ----------------------------------------- | -------------- | -------------------------------------------- | ---------------------------------- |
| G1  | `SPEC.md#checkpoint--resume`              | Execute        | 用户批准 Proposed Plan                       | resolved；`2026-07-27` 已批准      |
| G2  | `findings.md#否定结果与待验证项`          | Review         | 在 Node `22.20.0` 或 CI Node 22 验证         | resolved；已在 Node `22.20.0` 验证 |
| G3  | `findings.md#f3-选定的-chromium-供给合同` | E2E validation | 获批后安装 Playwright `1.58.2` 所需 Chromium | resolved；revision `1208` 已安装   |
```
