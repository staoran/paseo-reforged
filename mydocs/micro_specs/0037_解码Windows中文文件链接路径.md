# 解码 Windows 中文文件链接路径 Micro Spec

## 0. 状态与索引

| 字段               | 值                                                                      |
| ------------------ | ----------------------------------------------------------------------- |
| task_id            | `0037`                                                                  |
| spec layer         | `Feature Spec`                                                          |
| task status        | `已收口`                                                                |
| document status    | `Completed`                                                             |
| depth              | `fast`                                                                  |
| phase              | `Review`                                                                |
| Execution Approval | `Approved`                                                              |
| Approval Source    | `User（2026-08-03：确认 parseAssistantFileLink() seam，批准执行 0037）` |
| file path          | `mydocs/micro_specs/0037_解码Windows中文文件链接路径.md`                |
| parent spec        | `N/A`                                                                   |
| superseded by      | `N/A`                                                                   |
| created / updated  | `2026-08-03 17:37 / 2026-08-03 18:19`                                   |

## 1. 目标与完成契约

- 当前理解：助手 Markdown 链接把 Windows 中文绝对路径作为 percent-encoded href 交给文件链接解析器；当前裸 Windows 路径分支只规范化分隔符，没有像 `file://` 分支一样安全解码，最终 daemon 按字面量打开 `%E5...` 文件名并返回 `ENOENT`。
- 核心目标：在 App 的公共文件链接解析边界还原 percent-encoded Windows 路径，使中文文件链接打开真实文件，同时保持现有 file URL、行号、外部 URL 和非法 percent 输入行为。
- Done Contract：
  1. `parseAssistantFileLink()` 将用户报错中的编码 Windows 路径解析为 `E:/Code/paseo/mydocs/specs/0035_关闭最后标签并回收Provider_Runtime.md`，并保留原始 `raw` 值。
  2. 无效 percent escape 不抛出异常；既有 file URL、Windows/POSIX 路径和行号解析测试保持通过。
  3. 永久回归测试先 RED 后 GREEN；原始未缩减 Vite 探针转绿；App 单文件测试、根级 typecheck 与 lint 通过。

## 2. 范围与事实

- 范围内：助手文件链接的 percent-encoded Windows 绝对路径解析，以及同一公开 seam 的永久回归测试。
- 范围外：daemon/协议解码、文件系统语义、Markdown 渲染重构、`0035` Provider Runtime 功能、commit/branch/PR。
- 当前任务单元：一个解析分支和一个相邻测试文件；不重开已收口的 `0011` 或 `0025`，也不复用其已消耗授权。
- 轻量评估：`足够小；fast`。
- 已确认事实：
  - 最小 Vite 探针稳定复现：`E:\\%E4%B8%AD.md` 实际得到 `E:/%E4%B8%AD.md`，期望 `E:/中.md`。
  - 同一输入改为 `file:///E:/%E4%B8%AD.md` 后会正确得到 `E:/中.md`，说明已有安全解码只覆盖 file URL 分支。
  - `classifyForResolution()` 已收到并转交编码路径，点击后没有再次编码；实际中文文件存在，百分号字面路径不存在。
  - daemon 将协议路径作为文件名原样读取；在服务端无条件解码会破坏名称本身包含 `%xx` 的合法文件，修复边界应留在 App href parser。
- `grilling` 结论（如使用）：`N/A；症状、根因、边界和最小修复均已由可重复探针确认。`
- 风险与未知：合法文件名可包含看似 percent escape 的字面文本；解码必须只发生在 href 解析语义内，并沿用现有 `safeDecodeURIComponent()` 的失败回退，不能下沉到通用文件系统边界。

## 3. 涉及文件与计划

| 文件                                                  | 计划变化                                                                     | 事实源                                       |
| ----------------------------------------------------- | ---------------------------------------------------------------------------- | -------------------------------------------- |
| `packages/app/src/assistant-file-links/parse.test.ts` | 在公开 `parseAssistantFileLink()` seam 加入用户原始编码 Windows 中文路径回归 | 用户报错、稳定 RED 探针、既有 parser 测试    |
| `packages/app/src/assistant-file-links/parse.ts`      | 在 Windows href 路径进入规范化前复用现有安全单次解码，非法 escape 保持原值   | file URL 分支既有 `safeDecodeURIComponent()` |

1. 在已确认 seam 写入用户原始路径测试，运行目标 Vitest 并确认只因路径仍编码而 RED。
2. 只调整 Windows href 解析边界，让该测试 GREEN；不修改 daemon、协议或通用文件读取。
3. 重跑目标 Vitest、原始 Vite 探针、根级 typecheck/lint 和 task-owned diff check，回写证据。

## 4. 执行前检查点

- 当前目标：让百分号编码的 Windows 中文绝对路径在发起文件读取前恢复为真实本地路径。
- 当前进度：诊断、RED→GREEN、原始症状回归和静态验证均已完成。
- 当前动作是否仍服务核心目标：是；改动限定在产生错误路径的公共 parser 边界。
- 下一步：`N/A；进入 Review 收口。`
- 风险与回退：若新增测试表明输入并非单次编码，返回诊断阶段；若需要修改 renderer、daemon 或协议，先更新本 micro-spec 并重新取得授权。
- 验证方式：`rtk npx vitest run packages/app/src/assistant-file-links/parse.test.ts --bail=1`、原始 Vite 探针、`rtk npm run typecheck`、`rtk npm run lint`、task-owned `git diff --check`。
- TDD 判定、测试 seam 与验收行为：`TDD；seam=parseAssistantFileLink()；给定用户原始 percent-encoded Windows 绝对路径，返回中文规范化路径并保留 raw。`
- seam 确认：`User；2026-08-03 明确确认 parseAssistantFileLink() seam。`
- Execution Approval / Source：`Approved / User（2026-08-03：批准执行 0037）`。

## 5. 执行与变更记录

- 实际改动：在 `parseAssistantFileLink()` 的 Windows href 分支复用现有 `safeDecodeURIComponent()` 后再规范化路径；在已确认 seam 加入用户完整编码路径回归测试，验证中文 `path` 与原始 `raw`。
- 偏差与用户决策：无范围偏差；未修改 daemon、协议、renderer 或 `0035`。正确假设为“Windows 裸绝对路径分支绕过已有安全解码”。
- Change Log：`2026-08-03 17:37` 完成诊断并创建 fast micro-spec；`17:42` 用户确认 parser seam 并批准执行；`17:45` 永久回归 RED；`17:46` 最小实现 GREEN；`17:55` 原始路径、格式、typecheck、lint 与清理检查通过并收口；`18:19` 用户授权提交 `0037` 相关代码和文档。

## 6. 验证与完成判断

| 验收项           | 命令或步骤                                                                                                                             | 结果          | 证据                                                                         |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------- | ---------------------------------------------------------------------------- |
| 原始症状复现     | Vite SSR 调用 `parseAssistantFileLink()`                                                                                               | RED           | 返回路径保留 `%E5...`，与用户 ENOENT 一致                                    |
| 最小复现         | 同一探针输入 `E:\\%E4%B8%AD.md`                                                                                                        | RED           | 实际 `E:/%E4%B8%AD.md`，期望 `E:/中.md`                                      |
| 永久回归 RED     | `rtk npx vitest run packages/app/src/assistant-file-links/parse.test.ts --bail=1`                                                      | FAIL，`1/42`  | 唯一差异为 `path` 保留用户报错中的 `%E5...`                                  |
| 永久回归 GREEN   | 同一目标 Vitest 命令                                                                                                                   | PASS，`42/42` | 用户完整编码路径返回中文路径并保留 `raw`                                     |
| 原始症状回归     | Vite SSR 重放用户完整路径                                                                                                              | PASS          | 返回 `E:/Code/paseo/mydocs/specs/0035_关闭最后标签并回收Provider_Runtime.md` |
| 非法 escape 回归 | 同一探针输入 `E:\\repo\\%PATH%\\notes.md`                                                                                              | PASS          | 保持 `E:/repo/%PATH%/notes.md`，未抛异常                                     |
| 格式检查         | `rtk npm run format:check:files -- packages/app/src/assistant-file-links/parse.ts packages/app/src/assistant-file-links/parse.test.ts` | PASS          | 两个文件均符合 `oxfmt`                                                       |
| 根级 typecheck   | `rtk npm run typecheck`                                                                                                                | PASS          | exit `0`；codegen 未留下额外 diff                                            |
| 根级 lint        | `rtk npm run lint`                                                                                                                     | PASS          | `0` warnings，`0` errors；2977 files                                         |
| diff/清理检查    | task-owned `git diff --check`、`[DEBUG-` 与临时文件检索                                                                                | PASS          | 无 whitespace error、调试标记或临时探针文件                                  |

- 未验证项与原因：未操控用户当前正在运行的 Web/Electron 实例；任务已按用户确认的 parser seam 用完整报错路径自动验证，运行中实例仍需加载新构建后才能体现修复。
- 剩余风险：若真实 Markdown renderer 未来对 href 进行双重编码，需要以新的实际输入另建回归；当前错误中的单次 `%E5...` 已覆盖。
- Done Contract 是否由证据满足：`是；永久测试、原始探针、格式、typecheck、lint 和清理检查均通过。`

## 7. 恢复与同步

- 状态说明：`已收口 / Completed / Review`。
- 当前卡点：无。
- 下一步唯一动作：`N/A；等待用户在加载新构建后验收实际点击。`
- Resume / Handoff：无需恢复；若仍出现 ENOENT，先捕获 renderer 传入 `parseAssistantFileLink()` 的实际 href，确认是否为双重编码或另一入口。
- Project Sync Candidates：`无；当前结论属于本次 Feature Spec，尚无新增长期项目事实。`
- 长期文档同步：`N/A`。

### 提交记录

| 提交信息（Commit Message）                            | 提交脚注（Commit Footer） | 关联改动或阶段               | 文档同步状态 | 备注                                                               |
| ----------------------------------------------------- | ------------------------- | ---------------------------- | ------------ | ------------------------------------------------------------------ |
| `fix(app): decode percent-encoded Windows file links` | `N/A`                     | `0037 / parser + regression` | `已同步`     | 根因是裸 Windows href 分支绕过安全解码；用户于 2026-08-03 授权提交 |
