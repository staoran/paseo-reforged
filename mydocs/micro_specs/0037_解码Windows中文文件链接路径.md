# 解码 Windows 中文文件链接路径 Micro Spec

## 0. 状态与索引

| 字段               | 值                                                       |
| ------------------ | -------------------------------------------------------- |
| task_id            | `0037`                                                   |
| spec layer         | `Feature Spec`                                           |
| task status        | `已收口`                                                 |
| document status    | `Completed`                                              |
| depth              | `fast`                                                   |
| phase              | `Review`                                                 |
| Execution Approval | `Approved`                                               |
| Approval Source    | `User（2026-08-05：批准按审阅后的方案继续执行 0037）`    |
| file path          | `mydocs/micro_specs/0037_解码Windows中文文件链接路径.md` |
| parent spec        | `N/A`                                                    |
| superseded by      | `N/A`                                                    |
| created / updated  | `2026-08-03 17:37 / 2026-08-05 15:45`                    |

## 1. 目标与完成契约

- 当前理解：`0037` 已修复不带行号的裸 Windows href，但真实助手链接使用 `/E:/...中文.md:1`。MarkdownIt 将中文编码为 `%E4...`，随后 `parseAssistantInlinePathLink()` 因 `:1` 抢先命中并保留编码路径，绕过已修复的 Windows 裸路径分支，最终 daemon 仍按字面量打开 `%E4...` 文件名并返回 `ENOENT`。
- 核心目标：在 App 的公共文件链接解析边界还原 percent-encoded Windows 路径，使中文文件链接打开真实文件，同时保持现有 file URL、行号、外部 URL 和非法 percent 输入行为。
- Done Contract：
  1. `parseAssistantFileLink()` 将 `/E:/Code/paseo/mydocs/micro_specs/0048_%E4...%B9.md:1` 解析为中文浏览器盘符路径，保留原始 `raw`，并返回 `lineStart: 1`。
  2. 无效 percent escape 不抛出异常；既有 file URL、Windows/POSIX 路径和行号解析测试保持通过。
  3. 永久回归测试先 RED 后 GREEN；原始 Markdown→MarkdownIt→parser→workspace 归一化→文件读取探针转绿；App 单文件测试、根级 typecheck 与 lint 通过。

## 2. 范围与事实

- 范围内：助手文件链接的 percent-encoded Windows 绝对路径，以及带 VS Code 风格行号的浏览器盘符路径解析；同一公开 seam 的永久回归测试。
- 范围外：daemon/协议解码、文件系统语义、Markdown 渲染重构、`0035` Provider Runtime 功能、branch/PR/push。
- 当前任务单元：一个解析分支和一个相邻测试文件；不重开已收口的 `0011` 或 `0025`，也不复用其已消耗授权。
- 轻量评估：`足够小；fast`。
- 已确认事实：
  - 最小 Vite 探针稳定复现：`E:\\%E4%B8%AD.md` 实际得到 `E:/%E4%B8%AD.md`，期望 `E:/中.md`。
  - 同一输入改为 `file:///E:/%E4%B8%AD.md` 后会正确得到 `E:/中.md`，说明已有安全解码只覆盖 file URL 分支。
  - `classifyForResolution()` 已收到并转交编码路径，点击后没有再次编码；实际中文文件存在，百分号字面路径不存在。
  - daemon 将协议路径作为文件名原样读取；在服务端无条件解码会破坏名称本身包含 `%xx` 的合法文件，修复边界应留在 App href parser。
  - 2026-08-05 的原始助手 Markdown 是 `[0048 micro-spec](/E:/Code/paseo/mydocs/micro_specs/0048_侧边栏相对时间Hermes兼容.md:1)`；不是双重编码输入。
  - MarkdownIt 将该 href 规范化为 `/E:/Code/paseo/mydocs/micro_specs/0048_%E4...%B9.md:1`；`parseAssistantInlinePathLink()` 在 Windows 裸路径分支前命中并保留 `%E4...`。
  - 临时 Vitest 按原始 Markdown 重放完整路径，两次均稳定得到用户报告的 `E:\Code\paseo\mydocs\micro_specs\0048_%E4...%B9.md` ENOENT；诊断探针已删除。
- `grilling` 结论（如使用）：`N/A；症状、根因、边界和最小修复均已由可重复探针确认。`
- 风险与未知：合法文件名可包含看似 percent escape 的字面文本，且同一 parser 也处理 raw inline-code；解码必须只发生在已被当前规则判定为绝对路径的 assistant inline path 上，沿用 `safeDecodeURIComponent()` 的失败回退，不能把 `%2Ftmp/...` 等编码相对路径提升为绝对路径，也不能下沉到通用文件系统边界。

## 3. 涉及文件与计划

| 文件                                                  | 计划变化                                                              | 事实源                                         |
| ----------------------------------------------------- | --------------------------------------------------------------------- | ---------------------------------------------- |
| `packages/app/src/assistant-file-links/parse.test.ts` | 在公开 `parseAssistantFileLink()` seam 加入真实 href 回归及分类保护   | 原始 Markdown、稳定 RED 探针、既有 parser 测试 |
| `packages/app/src/assistant-file-links/parse.ts`      | 保持原绝对路径判定后，只安全解码已提取行号的 path，再规范化并复核绝对 | 真实命中分支、既有 `safeDecodeURIComponent()`  |

1. 获得执行批准后，先在已确认的 `parseAssistantFileLink()` seam 补两条保持 GREEN 的特征保护：非法 `%PATH%` + `:line` 不抛错且保留 path；`%2Ftmp/...:line` 仍按 workspace 相对路径处理，不提升为 `/tmp/...`。
2. 写入真实 Markdown 产生的完整编码 href + `:1` 测试，只断言公开返回值中的中文 `path`、`lineStart: 1` 和原始 `raw`，运行目标 Vitest 并确认该测试 RED。
3. 在 `parseAssistantInlinePathLink()` 中先按现有规则规范化并确认编码 path 本来就是绝对路径，再安全解码 path、重新规范化并复核绝对；保留先分离行号、后解码 path 的顺序，并用短注释固定该非显然约束，让目标测试 GREEN。
4. 重跑目标 Vitest、原始 Markdown 完整探针、根级 typecheck/lint 和 task-owned diff check，回写证据；不修改 Markdown renderer、daemon、协议或通用文件读取。

方案审阅结论：`通过，带约束`。

- 选择当前方案：它在已确认的 public seam 修复真实命中分支，单次解码语义与 file URL、裸 Windows href 的既有契约一致，不新增公开选项或跨层依赖。
- 拒绝“先解码完整 value 再解析行号”：这会让编码分隔符改变语法，并扩大本轮行为面。
- 拒绝“解码后再判断是否绝对”：这会把编码相对路径提升为绝对路径，绕过 workspace 相对解析边界。
- 拒绝把解码下沉到 `normalizeInlinePathTarget()`、daemon 或文件系统：这些层同时接收非 href 路径，无法安全区分字面 `%xx` 文件名。
- 不新增 MarkdownIt 集成测试：原始链路已由诊断探针证实，永久测试保持在用户确认的 parser seam；完整链路作为修复后的外部反馈循环复跑。

## 4. 执行前检查点

- 当前目标：让 MarkdownIt 产生的 percent-encoded 浏览器盘符路径在保留 `:line` 语义的同时恢复真实中文路径。
- 当前进度：二轮分类保护、永久 RED→GREEN、原始 Markdown 完整链路回归、格式、typecheck、lint 和清理检查均已完成。
- 当前动作是否仍服务核心目标：是；拟议改动仍限定在公共 parser 边界，但命中分支和输入形态不同于首轮授权。
- 下一步：`N/A；进入 Review 收口，等待用户加载包含本次未提交改动的构建做实际点击验收。`
- 风险与回退：先保持当前 absolute/relative 分类，再只解码 `parseInlinePathToken()` 已分离出的 path；若需要修改 renderer、daemon、协议或公开 parser 选项，再次更新本 micro-spec 并重新取得授权。
- 验证方式：`rtk npx vitest run packages/app/src/assistant-file-links/parse.test.ts --bail=1`、原始 Markdown 完整链路探针、`rtk npm run typecheck`、`rtk npm run lint`、task-owned `git diff --check`。
- TDD 判定、测试 seam 与验收行为：`TDD；seam=parseAssistantFileLink()；给定真实 Markdown AST 产生的 /E:/...%E4...md:1 href，返回中文 path、lineStart: 1，并保留 raw。`
- seam 确认：`User；2026-08-05 明确确认 parseAssistantFileLink() 二轮 seam，并要求先审阅方案。`
- Execution Approval / Source：`Approved / User（2026-08-05：批准按审阅后的方案继续执行 0037）`。

## 5. 执行与变更记录

- 实际改动：首轮在 Windows 裸 href 分支复用 `safeDecodeURIComponent()`；二轮在 `parseAssistantInlinePathLink()` 已解析行号并确认原 path 为绝对路径后，单次安全解码 path、重新规范化并复核绝对。永久测试覆盖真实编码浏览器盘符 href、非法 percent 字面量和编码相对路径不得提升为绝对路径。
- 偏差与用户决策：首轮修复对裸 Windows href 正确，但未覆盖带 `:line` 的浏览器盘符 href；2026-08-05 依据用户复测重开，仍不修改 daemon、协议或 renderer。
- Change Log：`2026-08-03 17:37` 完成首轮诊断并创建 fast micro-spec；`17:42` 用户确认 parser seam 并批准执行；`17:45` 永久回归 RED；`17:46` 最小实现 GREEN；`17:55` 原始路径、格式、typecheck、lint 与清理检查通过并收口；`18:19` 用户授权提交；`2026-08-05 14:41` 捕获原始 Markdown，完整链路连续两次精确复现 ENOENT，定位 inline path 分支并重开；`14:52` 用户确认二轮 seam，方案审阅补齐绝对/相对分类与非法 percent 保护；`15:22` 用户批准按审阅后的方案继续执行；`15:23` 两条分类保护 `44/44` GREEN，真实输入永久测试精确 RED；`15:24` 最小实现后 `45/45` GREEN；`15:29` 原始完整链路 `1/1` GREEN 并删除临时探针；`15:31` typecheck、lint、格式与清理检查通过。

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
| 二轮原始输入     | 会话记录中的 `0048` 最终回复                                                                                                           | CAPTURED      | href 为原始中文 `/E:/...0048_侧边栏相对时间Hermes兼容.md:1`                  |
| 二轮完整复现     | 临时单文件 Vitest：MarkdownIt→parser→workspace 归一化→`readFile`，连续运行两次                                                         | RED / RED     | 两次均精确得到用户报告的 `%E4...` ENOENT；临时测试已删除                     |
| 二轮分类保护     | 目标 Vitest；新增非法 percent 与编码相对路径特征测试                                                                                   | PASS，`44/44` | `%PATH%` 保持字面量；`%2Ftmp/...` 仍位于 workspace 下                        |
| 二轮永久 RED     | `rtk npx vitest run packages/app/src/assistant-file-links/parse.test.ts --bail=1`                                                      | FAIL，`1/45`  | `raw` 与 `lineStart` 正确，唯一差异是 path 保留 `%E4...`                     |
| 二轮永久 GREEN   | 同一目标 Vitest 命令                                                                                                                   | PASS，`45/45` | 真实 href 返回中文 path、`lineStart: 1` 和原始 `raw`                         |
| 二轮完整回归     | 临时单文件 Vitest：原始 Markdown→MarkdownIt→parser→workspace 归一化→`readFile`                                                         | PASS，`1/1`   | 得到中文 workspace 相对路径并成功读取 `0048`；临时测试已删除                 |
| 二轮格式检查     | `rtk npm run format:check:files --` 四个任务所属文件                                                                                   | PASS          | 全部符合 `oxfmt`                                                             |
| 二轮 typecheck   | `rtk npm run typecheck`                                                                                                                | PASS          | exit `0`；协议 codegen 未留下额外 diff                                       |
| 二轮 lint        | `rtk npm run lint`                                                                                                                     | PASS          | `0` warnings，`0` errors；2992 files                                         |
| 二轮 diff/清理   | task-owned `git diff --check`、`[DEBUG-` 与临时文件检索                                                                                | PASS          | 无 whitespace error、调试标记、临时探针或额外生成物                          |

- 未验证项与原因：未操控用户当前运行的 Web/Electron 实例；自动完整链路已覆盖真实 Markdown 与磁盘读取，实际点击仍需用户加载包含本次未提交改动的构建后验收。
- 剩余风险：全部有效的字面 `%xx` 文件名在 href 语义下仍会单次解码；这与 file URL、裸 Windows href 的既有行为一致。双重编码不在本次真实输入范围内。
- Done Contract 是否由证据满足：`是；永久测试、原始完整链路、格式、typecheck、lint 和清理检查均通过。`

## 7. 恢复与同步

- 状态说明：`已收口 / Completed / Review`。
- 当前卡点：无；二轮代码与文档纳入本次提交，未 push。
- 下一步唯一动作：用户在加载包含本次改动的构建后复测原始 `0048` 链接。
- Resume / Handoff：无需恢复；若实际点击仍出现 ENOENT，捕获新的原始 Markdown 与 parser 输入，不重复扩大 decode 次数。
- Project Sync Candidates：`无；当前结论属于本次 Feature Spec，尚无新增长期项目事实。`
- 长期文档同步：`N/A`。

### 提交记录

| 提交信息（Commit Message）                            | 提交脚注（Commit Footer） | 关联改动或阶段               | 文档同步状态 | 备注                                                               |
| ----------------------------------------------------- | ------------------------- | ---------------------------- | ------------ | ------------------------------------------------------------------ |
| `fix(app): decode percent-encoded Windows file links` | `N/A`                     | `0037 / parser + regression` | `已同步`     | 根因是裸 Windows href 分支绕过安全解码；用户于 2026-08-03 授权提交 |
| `fix(app): decode line-suffixed Windows file links`   | `N/A`                     | `0037 / inline path + line`  | `已同步`     | 二轮代码与文档已验证；用户于 2026-08-05 授权提交，未 push          |
