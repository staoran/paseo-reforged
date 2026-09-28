# F24 Windows 文件链接与行号 Micro Spec

## 0. 状态

| 字段               | 值                                      |
| ------------------ | --------------------------------------- |
| task_id            | `0123`                                  |
| 0118 项目          | `F24`，原判放弃，复核后重做             |
| task status        | `已完成`                                |
| document status    | `Implemented`                           |
| depth              | `standard`                              |
| Execution Approval | `Approved`，2026-09-27 用户授权实施     |
| created            | `2026-09-26`                            |
| code baseline      | `work/0118-priority-features@507e66ffb` |

## 1. 目标与完成契约

- 当前理解：助手文本中的 Windows 盘符路径、编码中文路径和行号应指向实际文件与正确行；`file:///...:1` 也应打开文件第 1 行
- 核心目标：恢复历史 `0011/0037` 的路径与行号行为，并补齐 `file:` URL 的 `:行号` 解析
- Done Contract：Markdown 编码后的 Windows 链接打开正确文件与行号；工具卡保留行号；`file:///...:1` 可定位第 1 行；边界输入、typecheck、lint 和格式检查通过

## 2. 历史实现

- `14f8ed70e`、旧 `0011`：浏览器形式 `/E:/...` 按 Windows host workspace root 归一为 `E:/...`；工具卡的行号与助手链接共用解析边界；不因 Web/Electron 客户端平台选择路径语义
- `76bf444bc`、`b81cc1fa4`、旧 `0037`：对已识别的 Windows 绝对链接路径安全解码 `%E4...`；`/E:/...中文.md:1` 经 Markdown 编码后仍打开真实中文文件并指向第 1 行；无效 `%` 不抛异常
- 旧范围明确不把解码下沉到 daemon，不改变 workspace root 的文件访问边界，也不把相对 `%2F...` 提升成绝对路径

## 3. 实施前代码与差异

- `packages/app/src/assistant-file-links/parse.ts` 已支持 Windows/POSIX 盘符、`file:` URL、行号/行范围和相对路径，`parse.test.ts` 覆盖了不少基础样例；0118 的“已有解析器”判断对这些基础场景成立
- 但 `parseAssistantInlinePathLink()` 的绝对路径分支只做 `normalizePathToken()`，不解码 `%xx`；`parseAssistantFileLink()` 先尝试该分支，再走 Windows 裸路径分支。带 `:行号` 的 `/E:/...%E4....md:1` 静态追踪会返回编码字面路径，尚待真实点击确认
- `parseFileProtocolUrl()` 会解码 pathname，但只从 fragment 读取行号；`file:///E:/...md:1` 的 `:1` 留在文件路径中，打开时会查找错误文件。用户已将该形式纳入 F24
- `normalizeInlinePathTarget()` 当前不按 Windows workspace root 还原 `/E:/...`；工具卡打开回调也未先拆出 `:行号`，历史 `0011` 的两项行为需恢复
- 当前测试没有 `%E4` 的 Windows 文件链接用例。当前解析器允许绝对 href 指向 workspace 外文件；本项不改变该既有范围。以上为静态分支追踪，尚未重放真实 Markdown 点击和文件读取

## 4. 已确认行为与验收

1. 用真实 Markdown 链接 `[/E:/...中文.md:1](/E:/...中文.md:1)` 走 MarkdownIt、`classifyForResolution()`、文件打开回调，验证编码后的目标路径和行号；恢复裸盘符、浏览器 slash-drive 和工具卡 `:行号` 的历史行为
2. `file:///E:/docs/%E4%B8%AD.md:1` 解析为文件 `E:/docs/中.md`、`lineStart: 1`；`file:///tmp/notes.md:1` 同样定位第 1 行。原有 `file:///...#L1` 与 `#Lx-Ly` 继续有效，`raw` 保留原输入
3. 覆盖 `:line[:column]`、无效 `%`、编码相对路径和外部 URL；普通文本不能误判为本地文件
4. 对已判定的绝对路径才解码；不在服务端无条件解码，也不改变现有文件访问范围
5. 先在 `parse.test.ts` 固定真实回归输入，再做最小修复；执行目标测试、typecheck、lint 和格式检查

## 5. 决策

- 2026-09-27：用户批准实施，并明确无需真机相关 E2E；恢复旧 `0011/0037` 的路径与工具卡行号，纳入 `file:///...:1`
- 复制链接与跨 workspace 点击不属于本次解析缺口，维持既有行为

## 6. 实施边界与恢复

- 实现：`assistant-file-links/parse.ts` 对已识别绝对路径安全解码；`file:` 无 fragment 时解析路径行号；Windows workspace 下还原 `/E:/...`；工具卡点击共用行号解析入口
- 验证：`parse.test.ts` 46 项、`use-file-link.test.tsx` 7 项通过；`npm run typecheck`、`npm run lint`、目标文件格式检查和 `git diff --check` 通过
- 未验证：未运行真机或浏览器 E2E，也未实际读取磁盘中的目标文件；MarkdownIt、链接打开回调和文件路径归一化分别通过定向测试
- 实施边界：仅修改 App 的文件链接解析、工具卡打开回调与目标测试；未修改 daemon/协议或文件访问范围
- Project Sync Candidates：无
