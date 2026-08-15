# 修复 Windows Lefthook PATH Micro Spec

## 0. 状态与索引

| 字段               | 值                                                        |
| ------------------ | --------------------------------------------------------- |
| task_id            | `0073`                                                    |
| spec layer         | `Feature Spec`                                            |
| task status        | `已收口`                                                  |
| document status    | `Completed`                                               |
| depth              | `standard`                                                |
| phase              | `Review`                                                  |
| Execution Approval | `Approved`                                                |
| Approval Source    | `User；2026-08-15 当前消息批准修复 Windows Lefthook PATH` |
| file path          | `mydocs/micro_specs/0073_修复Windows_Lefthook_PATH.md`    |
| parent spec        | `N/A`                                                     |
| superseded by      | `N/A`                                                     |
| created / updated  | `2026-08-15`                                              |

## 1. 目标与完成契约

- 当前理解：Windows PowerShell 中 `node/npm` 可用，但 Lefthook 2.1.6 经 Git Bash `sh.exe -c` 执行 pre-commit 命令时，子环境无法解析 `node` 与 `npm`
- 核心目标：让项目 pre-commit hook 在当前 Windows 安装方式下可靠找到 workspace 的 Node/npm，同时保持 Linux/macOS 行为与既有 format/typecheck/lint 合同
- Done Contract：建立可在数秒内复现精确症状的 staged fixture；定位 PATH 丢失边界；项目内最小修复后原反馈循环 Green；不写入机器绝对路径、不要求修改全局用户配置，并完成目标格式/静态合同验证

## 2. 范围与事实

- 范围内：Lefthook 配置、项目内 Node/npm 解析 helper、必要的静态合同或脚本测试、本任务记录
- 范围外：全局 PATH、Node/npm/Git Bash 重装或升级、用户 shell rc、发布版本、Git 历史重写与 PR
- 当前任务单元：真实 pre-commit 与带空格 staged 文件名回归均已完成
- 轻量评估：`升级 standard；涉及 Windows shell 边界、跨平台兼容与提交门禁`
- 已确认事实：同一 PowerShell 父环境可直接运行 npm；实际 pre-commit 在 Windows Lefthook 子环境报 `"node" is not recognized` 与 `'npm' is not recognized`
- 已确认事实：Context7 对 Lefthook 官方源码的检索显示 Windows 命令由 Git Bash `sh.exe -c` 执行，进程环境来自 `os.Environ()`，并支持通过项目配置/rc 在 hook 前准备环境
- 已确认根因：Git Bash 能解析 POSIX `node/npm`，但 Lefthook 子环境由 MSYS 转换给原生 Node 的 PATH 在 Node 安装目录之前截断；npm lifecycle 回到 `cmd.exe` 后因此无法解析 `node/npm`
- `grilling` 结论（如使用）：`N/A；目标与安全边界明确`
- 风险与未知：最小修复必须安全传递带空格的 staged 文件名，并确保 Linux/macOS/WSL 仍调用原生 `npm`

## 3. 涉及文件与计划

| 文件                                      | 计划变化                            | 事实源                     |
| ----------------------------------------- | ----------------------------------- | -------------------------- |
| Lefthook 配置与项目 hook helper（待定位） | 最小化 Windows Node/npm PATH 归一化 | 实际生成 hook 与红反馈循环 |
| 既有 hook/配置测试（待定位）              | 固化 Windows 子 shell 解析合同      | 现有测试模式               |
| `mydocs/todolist.md`、本 micro-spec       | 回写诊断、执行与验证证据            | 项目任务记录规则           |

1. [完成] 创建并暂存可触发 pre-commit 的临时 TypeScript fixture，运行 `npx lefthook run pre-commit` 取得可重复 Red，再完整清理 fixture/index
2. [完成] 读取实际 Lefthook 配置与生成 hook，提出可证伪假设并用单变量命令定位根因
3. [完成] 实施项目内最小修复，重复原反馈循环并验证带空格 staged 文件名、目标格式与静态合同

## 4. 执行前检查点

- 当前目标：修复 Lefthook 子 shell 中 Node/npm 不可解析，而不是绕过 hook
- 当前进度：实现、真实 Windows 回归、功能提交与远端 `main` 核验均已完成
- 当前动作是否仍服务核心目标：是
- 下一步：无；0073 进入收口
- 风险与回退：fixture 和 index 变更必须在每轮后清理；不得覆盖用户工作区或固化本机绝对路径
- 验证方式：原始 `npx lefthook run pre-commit` staged-fixture loop、目标测试、精确 format、`git diff --check`
- TDD 判定、测试 seam 与验收行为：`N/A；正确 seam 是真实 Lefthook + Git index + Windows shell 集成，先用可回收 fixture 验收；若发现既有稳定静态 seam，再补普通回归合同`
- seam 确认：`N/A；不进入 TDD skill 循环`
- Execution Approval / Source：`Approved / User`

## 5. 执行与变更记录

- 实际改动：三个 Lefthook job 统一经 `scripts/run-npm-hook.sh` 调用 npm；Windows 分支动态解析 `node/npm`，把 Node 目录前置到 POSIX PATH 后直接用 `node.exe` 启动 npm JS 入口，避免 MSYS PATH 截断和 `.cmd` 对带空格参数的二次解析；Linux/macOS/WSL 保持裸 `npm`
- 偏差与用户决策：初版直接选择 `npm.cmd` 只能修复 npm 启动；前置 Node 后普通文件回归 Green，但 `.cmd` 在带空格参数下把 `C:\Program Files` 拆开，最终改为 `node.exe + npm-cli.js`
- Change Log：
  - `2026-08-15`：用户批准修复；登记 0073，确认不修改全局环境且不创建 commit/push
  - `2026-08-15`：临时 staged `.ts` fixture 连续两次在 3 秒内复现 typecheck/lint/format 的 `node/npm is not recognized`，取消暂存后 hook 全部跳过；fixture/index 已清理
  - `2026-08-15`：直接 Git Bash 的 `node --version`、`npm --version`、`cmd.exe where node/npm` 均成功，排除 PATH 值缺失、键大小写和生成 hook/并行执行
  - `2026-08-15`：不经 Lefthook 的 Git Bash `npm run format:check:files` 同样 Red，而 `npm.cmd run ...` Green；根因为 Windows Git Bash 选择 POSIX npm shim 后，npm lifecycle 无法启动本地 Windows bin shim
  - `2026-08-15`：真实 Lefthook 探针确认原生 Node 收到的 PATH 在 Node 安装目录之前截断；前置动态解析的 Node 目录后，普通 staged fixture 的 format/lint/typecheck 全绿
  - `2026-08-15`：带空格 staged 文件名证伪直接 `.cmd` 调用；改为 `node.exe + npm-cli.js` 后三个 job 再次全绿，fixture、暂存状态与调试输出均已清理
  - `2026-08-15`：用户明确批准提交并推送 0073 到 `main`；远端同步检查确认本地与 `origin/main` 均为 `6b660c2fb`
  - `2026-08-15`：功能提交 `e955a7d26` 已快进推送到 `main`；`git ls-remote` 与 GitHub API 均确认远端 SHA 为 `e955a7d266059de7e21846de7bc9636ee54eb07b`

## 6. 验证与完成判断

| 验收项       | 命令或步骤                                                                                  | 结果 | 证据                                                                               |
| ------------ | ------------------------------------------------------------------------------------------- | ---- | ---------------------------------------------------------------------------------- |
| 红反馈循环   | staged fixture + `npx lefthook run pre-commit`                                              | 通过 | 连续两次稳定 Red；三个 job 均报 `node/npm is not recognized`；fixture/index 已清理 |
| 根因探针     | 单变量 shell/PATH/command 解析检查                                                          | 通过 | 裸 `npm run` Red；同环境 `npm.cmd run` Green；PATH 与直接 `.cmd` shim 均正常       |
| 原反馈回归   | 修复后暂存合法 TypeScript fixture，运行 `npx lefthook run pre-commit`                       | 通过 | lint、format、全 workspace typecheck 均 Green，退出码 `0`                          |
| 空格参数回归 | 暂存 `scripts/lefthook path probe.ts` 后重复真实 pre-commit                                 | 通过 | 三个 job 均 Green，退出码 `0`；临时文件与 index 已清理                             |
| 目标合同     | `sh -n scripts/run-npm-hook.sh`；`npx lefthook validate`；目标 format 与 `git diff --check` | 通过 | shell/config/格式/空白检查均通过，无调试探针残留                                   |
| 远端 main    | push 后执行 `git ls-remote` 与 GitHub ref API                                               | 通过 | 两个事实源均返回完整 SHA `e955a7d266059de7e21846de7bc9636ee54eb07b`                |

- 未验证项与原因：未在 Linux/macOS runner 执行 hook；非 Windows 分支仍是原有 `exec npm "$@"`，以静态检查覆盖
- 剩余风险：Windows Node 管理器若不把 npm JS 入口放在 `command -v npm` 同目录的 `node_modules/npm/bin/`，helper 会明确失败；当前全局 npm 与标准 Node 安装布局已验证
- Done Contract 是否由证据满足：`是`

## 7. 恢复与同步

- 状态说明：`已收口 / Review / Completed`
- 当前卡点：无
- 下一步唯一动作：无；如 CI 出现新失败，另建独立任务处理
- Resume / Handoff：功能提交 `e955a7d26` 已进入 `main`；所有临时 fixture、index 与 `[DEBUG-0073]` 输出均已清理
- Project Sync Candidates：`无；项目内 helper 与配置已承载稳定约束`
- 长期文档同步：`不需要`

### 提交记录

| 提交信息（Commit Message）                       | 提交脚注（Commit Footer） | 关联改动或阶段 | 文档同步状态 | 备注        |
| ------------------------------------------------ | ------------------------- | -------------- | ------------ | ----------- |
| `fix: stabilize Windows Lefthook npm resolution` | `N/A`                     | `0073`         | `已同步`     | `e955a7d26` |
