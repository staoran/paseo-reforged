# 修复Playwright基线失败 Spec

> 历史迁移说明：本文于 2026-08-02 从 `mydocs/tasks/0004_修复Playwright基线失败/` 迁移为当前规则集的单文件 Heavy Spec。第 0-9 章是当前权威摘要；第 10 章按源文件保存完整历史原文和 SHA-256，仅用于追溯，不构成新的执行授权。

## 0. 状态与索引

| 字段              | 值                                            |
| ----------------- | --------------------------------------------- |
| task_id           | `0004`                                        |
| spec layer        | `Feature Spec`                                |
| task status       | `暂停`                                        |
| mode              | `single_project`                              |
| phase             | `Plan`                                        |
| approval status   | `Pending`                                     |
| approval source   | `User`                                        |
| spec path         | `mydocs/specs/0004_修复Playwright基线失败.md` |
| parent spec       | `N/A`                                         |
| supersedes        | `N/A`                                         |
| current task unit | `历史任务记录迁移与归档`                      |
| created / updated | `2026-07-22 / 2026-08-02`                     |

## 1. 目标、范围与完成契约

- 背景/问题：该任务使用旧规则集的多文件任务包记录，现需迁移为当前单文件 Spec。
- 最终目标：调查并最小修复两个历史 Playwright 基线失败。
- 当前任务单元：无损迁移历史记录并关闭旧路径。
- 范围内：viewed timeline 与 workspace scripts menu 两个测试合同及其专用 helper。
- 范围外：产品 UI 改动、Windows harness 改造、全量 Playwright 和任何提交或发布。
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

- 任务被用户暂停，三处未提交测试修改随后由用户主动清理。
- 旧 diff、reflog 和本 Spec 不得用于重建已清理修改。
- 只有新的 exact-SHA CI 再次命中且重新批准时才能重开调查。

- 未知与开放问题：无影响本次历史迁移的开放问题；动态 refs、外部服务和旧基线只按历史快照理解。
- 风险与约束：恢复旧修改会违反用户明确的暂停与清理决定。
- `grilling` 结论（如使用）：未使用；迁移目标与删除范围已由用户明确。

### 2.3 方案与决策

- 备选方案：保留旧任务包、只写摘要后删除、或在新 Spec 中同时保存摘要和完整原文。
- 已选方案：使用当前模板的 0-9 章保存权威摘要，并在第 10 章无损嵌入全部旧文件。
- 选择理由：消除并行真相源，同时避免删除未提交历史记录造成证据丢失。

历史任务关键决策：

- 保留失败诊断，不保留或重建暂停前实现。
- Windows Playwright 启动兼容另由 0013 处理。

### 2.4 下一步动作

- 下一步唯一动作：N/A；保持暂停，只有新失败证据和新批准才能重开。

## 3. 计划与执行前检查点

### 3.1 文件变化

| 项目/子项    | 文件或子 Spec                                 | 计划变化                     | 原因                     |
| ------------ | --------------------------------------------- | ---------------------------- | ------------------------ |
| 历史任务记录 | `mydocs/tasks/0004_修复Playwright基线失败/`   | 合并到当前单文件 Spec 后删除 | 消除旧规则集多文件真相源 |
| 当前 Spec    | `mydocs/specs/0004_修复Playwright基线失败.md` | 新建                         | 使用当前 Heavy Spec 模板 |

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

| 步骤/子项 | 实际变化或子 Spec 锚点           | 状态   | 偏差与处理                   |
| --------- | -------------------------------- | ------ | ---------------------------- |
| 1         | 完成失败根因和最小测试边界调查。 | 已记录 | 详细时间线见第 10 章原始记录 |
| 2         | 按用户决定暂停并清理实现 WIP。   | 已记录 | 详细时间线见第 10 章原始记录 |
| 3         | 迁移为只读历史记录。             | 已记录 | 详细时间线见第 10 章原始记录 |
| 文档迁移  | 旧任务包完整原文进入第 10 章     | 已完成 | 不改写原始记录               |

## 6. 验证

| 项目/验收项 | 命令或步骤                        | 结果   | 证据           | 未验证原因 |
| ----------- | --------------------------------- | ------ | -------------- | ---------- |
| 诊断        | 失败日志、测试合同与调用方核对    | `PASS` | 历史任务记录   | `N/A`      |
| 实现        | 用户暂停后未保留实现              | `N/A`  | 历史任务记录   | `N/A`      |
| 清理        | 旧测试 WIP 不在当前工作区         | `PASS` | 历史任务记录   | `N/A`      |
| 迁移完整性  | 源文件 SHA-256 与完整内容包含检查 | `PASS` | 第 10.1 节清单 | `N/A`      |

- 集成验证：当前迁移不改变产品代码；历史产品验证结果按上表和第 10 章保留。
- 剩余风险：恢复旧修改会违反用户明确的暂停与清理决定。
- Done Contract 是否由证据满足：否；任务按用户决定暂停，迁移只保存该状态。

## 7. 评审（Review）

| 评审轴             | 结论      | 证据或阻塞问题                             |
| ------------------ | --------- | ------------------------------------------ |
| 目标与 Spec 完成度 | `PARTIAL` | 历史结论和完整原文已迁移                   |
| Spec 与执行一致性  | `PASS`    | 新摘要不扩大旧授权，原文无损保留           |
| 实现质量与风险     | `PARTIAL` | 恢复旧修改会违反用户明确的暂停与清理决定。 |

- Overall Verdict：`FAIL`
- Blocking Issues：用户暂停，Done Contract 未执行完成。
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

- 状态说明：`暂停`
- 当前卡点：`N/A`
- 下一步唯一动作：N/A；保持暂停，只有新失败证据和新批准才能重开。
- Resume / Handoff 锚点：本文第 0 章；详细历史见第 10 章。
- Project Sync Candidates：无；本迁移不从一次性历史记录推导新的长期规则。
- 长期文档同步：仅更新旧任务路径登记，不改变产品知识。

### 提交记录

| 提交信息（Commit Message） | 提交脚注（Commit Footer） | 关联项目 / 改动或阶段 | 文档同步状态 | 备注                       |
| -------------------------- | ------------------------- | --------------------- | ------------ | -------------------------- |
| `N/A`                      | `N/A`                     | `N/A`                 | 已同步       | 该历史任务没有独立产品提交 |

## 10. 历史原始记录

### 10.1 源文件完整性清单

以下哈希按 LF 规范化且去除文件尾空白后计算。

| 源文件    | 规范化字节数 | SHA-256                                                            |
| --------- | -----------: | ------------------------------------------------------------------ |
| `SPEC.md` |        13733 | `eccb950b9aad04b15f6e4512b2218abd0b6935db503eb342f7aa118426005316` |

### 10.2 原 `SPEC.md`

```text
# 修复 Playwright 基线失败 Spec

## 0. 状态

- Task ID: `0004`
- Spec Type: `Feature Spec`
- Lifecycle: `Paused`
- Approval Status: `PAUSED BY USER`
- Baseline Date: `2026-07-22`
- Baseline HEAD: `045dd0cc6d06f6deafb3be5b9bd7f92abd8e10fb`
- Source CI: [run 29901479877](https://github.com/staoran/paseo-reforged/actions/runs/29901479877), attempt 2, `playwright (shard 4/4)`
- Execution Gate: 用户已暂停本任务、返回 Paseo Reforged 发布主线，并于 2026-07-23 主动清除三处未提交测试修改。不得从 reflog、旧 diff 或本 Spec 重建这些修改；后续只有 exact-SHA GitHub `CI` 再次命中两项目标失败且用户重新批准计划时，才能基于最新上游重新调查和实施。

## 1. 目标

以最小测试侧改动修复两项已诊断的 Playwright 基线失败，使测试合同与当前产品行为一致，并保留对最终用户结果的有效约束。

本轮核心目标是完成并验证两项测试侧最小修复，不改变生产行为。

## 2. Done Contract

1. `viewed-agent-timelines.spec.ts` 不再要求已水合历史在重新显示后的首个采样帧就包含隐藏期间的完整结尾，但仍验证聚焦时实时流、隐藏期间完成和重新显示后的最终 catch-up。
2. `workspace-scripts-menu-resize.spec.ts` 等待菜单实际达到“外框增长、内容无溢出、首个子项增长”的稳定后置条件，不使用固定 sleep 或单纯放宽超时。
3. 修复只触及测试及其失去调用者的专用 helper；定向 Playwright、typecheck、lint 和格式检查通过。

以下任一情况仍算未完成：生产 UI 被修改、断言被删除到只剩“文本出现”、菜单溢出被容忍、定向重复运行仍间歇失败，或把 `startup-loading.spec.ts` 顺带纳入。

## 3. 范围

### In Scope

- `packages/app/e2e/viewed-agent-timelines.spec.ts`
- `packages/app/e2e/helpers/timeline-delivery.ts`，仅删除不再有调用者的 `observeLastAssistantFrames`
- `packages/app/e2e/workspace-scripts-menu-resize.spec.ts`

### Out of Scope

- 不修改 `packages/app/src/hooks/use-agent-screen-state-machine.ts`。
- 不修改 `packages/app/src/components/ui/dropdown-menu.tsx` 或 workspace scripts 生产组件。
- 不处理 attempt 1 中单独波动的 `startup-loading.spec.ts`。
- 不运行本地全量 Playwright，不重启端口 `6767` 的主 daemon。
- 不 stage、commit、push、创建 tag 或 Release。

## 4. 已确认事实

### 4.1 Viewed timeline

- CI 两次 attempt 都在 `snapshots[0]` 必须包含 `(end of synthetic stream)` 的断言失败；最终 marker 的可见性断言已经成功。
- `b2139b140` 明确把“已有水合历史的 visibility catch-up”从 blocking overlay 改为 silent，允许旧的部分流内容在 catch-up 期间继续可见。
- 当前 E2E 的首帧原子完整性要求与该行为冲突；生产状态机已有相邻单元测试覆盖 silent UI。
- `observeLastAssistantFrames` 当前只有这一个调用者，若移除首帧断言，应同步删除该专用 helper，避免保留死测试代码。

### 4.2 Scripts menu resize

- attempt 1 通过、attempt 2 失败，失败样本为 `scrollHeight=65`、`clientHeight=44`。
- 测试在看到 `localhost:` 后立即做一次 DOM 测量。
- `useReleaseFixedMenuHeight` 会在内容尺寸变化后经过 `setTimeout(0)` 和下一次 `requestAnimationFrame` 再移除 Reanimated 留下的固定高度；文本可见早于布局稳定是允许的中间状态。
- 需要等待的是无溢出的稳定后置条件，而不是某个实现时长。

## 5. 最小修复方案

### A. 调整 viewed timeline 测试合同

1. 将测试标题从“隐藏 remainder 原子恢复”改为“重新显示后完成 catch-up”，避免继续声明已取消的首帧原子语义。
2. 删除 `observeLastAssistantFrames` 的导入、启动、停止和 `snapshots[0]` 断言。
3. 保留以下行为证据：聚焦时出现 `Cycle 1` 且结尾尚未出现；切换后 daemon 完成；重新选择首个 chat 后最终结尾可见。
4. 重新核对 helper 无其他调用者后，从 `timeline-delivery.ts` 删除 `AssistantFrameState` 与 `observeLastAssistantFrames`；不改 subscription observer。

### B. 等待 scripts menu 的布局后置条件

1. 保留启动前的尺寸基线和 `localhost:` 可见性等待。
2. 用 `expect.poll` 重复执行同一次 DOM 尺寸采样，直到以下三个布尔条件同时成立：
   - menu `height > before.height`
   - `scrollHeight <= clientHeight + 1`
   - first child `height > before.height`
3. 使用短且有界的 poll timeout；不加入固定延迟，不读取或复制生产代码中的 `0 ms`、`150 ms` 等实现常量。
4. 若条件在合理 timeout 内始终不成立，保留失败并转入生产布局诊断，不通过放宽溢出阈值掩盖问题。

## 6. 风险与停止条件

| 风险                            | 控制方式                                               |
| ------------------------------- | ------------------------------------------------------ |
| timeline 断言被过度削弱         | 保留实时 partial、隐藏完成、返回后最终完整三段行为证据 |
| poll 把真实菜单溢出变成偶发通过 | 三个尺寸不变量必须在同一次采样中同时成立               |
| 测试依赖固定动画时长            | 只等待用户可观察的布局后置条件                         |
| 实施时发现生产行为确实错误      | 停止并更新 Spec；不得在本任务内静默修改生产代码        |
| 出现第三项无关 E2E 失败         | 记录为独立基线，不扩大 `0004` 范围                     |

## 7. 验证计划

按以下顺序执行，禁止本地全量 E2E：

1. 定向格式化：`npm run format:files -- packages/app/e2e/viewed-agent-timelines.spec.ts packages/app/e2e/helpers/timeline-delivery.ts packages/app/e2e/workspace-scripts-menu-resize.spec.ts`。
2. 定向 lint：`npm run lint -- packages/app/e2e/viewed-agent-timelines.spec.ts packages/app/e2e/helpers/timeline-delivery.ts packages/app/e2e/workspace-scripts-menu-resize.spec.ts`。
3. 全仓类型检查：`npm run typecheck`。
4. Timeline 文件：`npm run test:e2e --workspace=@getpaseo/app -- e2e/viewed-agent-timelines.spec.ts`。
5. Menu resize 抗抖动：`npm run test:e2e --workspace=@getpaseo/app -- e2e/workspace-scripts-menu-resize.spec.ts --repeat-each=3`。
6. 若后续获准 push，以 GitHub Actions 对应 Playwright shard 作为完整 CI 证据；本 Spec 不授权 push。

## 8. Checkpoint

- 当前理解：两项失败分别是过期测试合同和布局稳定等待不足，不是本轮 Reforged 迁移引入的生产回归。
- 核心目标：只修复两项测试基线，并保持真实行为约束。
- 当前进度：此前三处测试侧修改已被用户清除，当前没有实现 diff；历史诊断和验证仅作为调查证据保留。
- 下一步：保持暂停。只有最新 Reforged exact-SHA CI 重新出现本 Spec 两项目标失败且获得新 `Plan Approved` 后，才按最新源码重新进入 Research/Plan。
- 主要风险：本地仅有 Node `26.4.0`，且使用浏览器 revision `1228` 临时代用 `1208`；本地 E2E 结果不能替代 CI。
- Execution Approval: `Revoked by user cleanup`

## 9. Validation

### 9.1 历史静态与范围验证（对应已清除 diff）

- 定向格式化通过：`npm run format:files -- packages/app/e2e/viewed-agent-timelines.spec.ts packages/app/e2e/helpers/timeline-delivery.ts packages/app/e2e/workspace-scripts-menu-resize.spec.ts`。
- 定向 lint 通过：0 warnings、0 errors。
- `npm run typecheck` 通过。
- `rg "observeLastAssistantFrames"` 无剩余引用；`git diff --check` 通过。
- tracked diff 仅有第 3 节列出的三个测试文件，共 `25 insertions(+), 85 deletions(-)`；未修改生产代码、`startup-loading.spec.ts`，未 stage、commit 或 push。
- 全仓 `npm run format:check` 未作为本任务门禁：当前 Windows checkout 会报告约 2911 个既有格式差异，定向格式化已经通过。

### 9.2 Playwright 证据

- 仓库 npm script 在 PowerShell/cmd 下把 `--project='Desktop Chrome'` 错误拆成项目名 `"'Desktop"`；改用 `npm exec ... "--project=Desktop Chrome"` 后进入 global setup。
- Windows global setup 直接调用 Unix `which` 并 `spawn("npx")`，初始失败为 `which is not recognized` 与 `spawn npx ENOENT`。本轮只用工作区外临时 preload 适配进程启动，没有修改 `global-setup.ts`。
- `.tool-versions` 锁定 Node `22.20.0`，本机只有 Node `26.4.0`。Playwright Chromium `1208` 安装在 15 分钟后仍停滞；本地运行临时把已安装的 revision `1228` 映射为 `1208`，因此结果仅作补充证据。
- Timeline 全文件运行得到 3 pass、1 fail；唯一失败是目标用例首次 `page.goto` 时 Metro 冷编译 4617 个文件耗时约 79.9 秒，耗尽用例的 90 秒总预算，未进入本轮修改的断言。热缓存下单独重跑目标用例通过，退出码 0，耗时约 72.8 秒。
- Menu `--repeat-each=3` 首次在 Windows 缺少 `sh` 时三次均停在 `workspace_setup_progress` 前置等待。将 Git for Windows 的 `sh` 仅加入本次命令 `PATH` 后，两轮各有 2 个 repeat 完整通过，累计 4 次到达并通过新的 5 秒尺寸 poll；其余失败均发生在 poll 前，分别为 Metro 冷启动 `page.goto` 超时或 runner 附件未封口。
- 追加 `--timeout=120000` 的最终诊断没有放宽 5 秒 poll，但 Node 26 环境出现 `spawn UNKNOWN`、Metro 退出、Git 启动失败和随后 `ERR_CONNECTION_REFUSED`；三次均未到达目标断言。
- 结论：没有观察到新的 timeline 最终 catch-up 断言或 menu 尺寸 poll 失败；但第 7 节原始命令在项目锁定环境下的完整通过尚未验证。

## 10. 历史 Change Log / Reverse Sync（实现已清除）

- `viewed-agent-timelines.spec.ts`：测试标题改为重新显示后完成 catch-up；删除首帧原子完整性 observer 和 `snapshots[0]` 断言，保留 focused partial、hidden completion、return final 三段行为证据。
- `timeline-delivery.ts`：删除失去唯一调用者的 `AssistantFrameState` 与 `observeLastAssistantFrames`。
- `workspace-scripts-menu-resize.spec.ts`：把一次性尺寸快照改为 5 秒 `expect.poll`，同一次采样同时要求菜单增长、内容无溢出和首个子项增长。
- 实施未偏离第 5 节代码方案；验证阶段增加的 preload、PATH 和浏览器映射全部位于工作区外，未进入 Git diff。

## 11. Review Verdict

| 评审轴             | 结论      | 证据                                                                                                  |
| ------------------ | --------- | ----------------------------------------------------------------------------------------------------- |
| 需求与 Spec 完成度 | `PARTIAL` | 两项最小修复均已实现；项目锁定环境下的完整定向 Playwright 通过证据仍缺失                              |
| Spec-Code 一致性   | `PASS`    | 三个文件、断言语义、helper 删除与第 5 节逐项一致，无生产代码偏差                                      |
| 代码内在质量       | `PASS`    | 删除专用死 helper；poll 等待用户可观察后置条件且保持 5 秒有界；格式、lint、typecheck、diff check 通过 |

- Overall Verdict: `PARTIAL - implementation accepted, exact-environment Playwright pending`
- Blocking Issues: 仅阻塞“本地完整验证完成”的声明；需要 Node `22.20.0` + Chromium `1208` 的 Linux/CI 运行。当前证据不要求追加测试或生产修改。

## 12. Plan-Execution Diff

- Code Diff: `None`。实际代码修改与第 5 节完全一致。
- Validation Diff: Windows 无法直接执行第 7 节 npm script；为诊断使用了 `npm exec`、工作区外 preload、Git `sh` PATH 和浏览器 revision 临时映射。
- Unverified: 原始 timeline 文件命令和 menu `--repeat-each=3` 尚未在项目锁定运行时/浏览器上获得一次完整绿色退出。

## 13. Resume / Handoff

- 当前状态：`Paused / LOCKED / no implementation diff`。
- 暂停原因：用户要求回到 Paseo Reforged 发布主线，并以远端 CI 结果作为发布门禁；本地 Node/Windows harness 诊断不再继续。
- 保留现场：用户已清除三个 In Scope 测试文件的未提交 diff；当前主工作树没有 tracked E2E 修改。历史方案不是可直接应用的 patch。
- 恢复条件：后续推送的精确候选 SHA 对应 GitHub `CI` 重新报告 `viewed-agent-timelines.spec.ts` 或 `workspace-scripts-menu-resize.spec.ts` 的目标失败，并且用户重新给出 `Plan Approved`。恢复时先以最新 CI/源码更新 Research，不默认沿用旧最小修复。
- 非恢复条件：CI 全绿，或只出现 `startup-loading.spec.ts`、基础设施、其他测试/构建失败；这些结果不改变 `0004` 范围。
- 发布影响：当前没有测试 diff 阻塞发布；Task `0001` 仍使用隔离 clone，且不得恢复本任务旧修改。
- 授权边界：仍不 stage、commit、push，不处理 `startup-loading.spec.ts`。
- Project Sync Candidates: `None`。Windows harness 的兼容性属于独立任务候选，不在 `0004` 内修改或沉淀长期规则。

## 14. 2026-07-23 状态反向同步

- 用户明确说明已清除本地 E2E 相关修改。
- `git status --short` 只剩未跟踪 `mydocs/`，三处 In Scope 路径均无 tracked diff。
- 本次只同步 Spec 状态，没有修改、恢复、stage、commit 或验证测试文件。
- 旧实现/验证记录作为历史证据保留，但不再代表当前代码状态或可直接执行的计划。
```
