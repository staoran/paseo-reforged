# 合并 upstream 0.7 基线到 Reforged Spec

## 0. 状态与索引

| 字段              | 值                                                    |
| ----------------- | ----------------------------------------------------- |
| task_id           | `0102`                                                |
| spec layer        | `Feature Spec`                                        |
| task status       | `执行中`                                              |
| mode              | `single_project`                                      |
| phase             | `Execute`                                             |
| approval status   | `Approved`                                            |
| approval source   | `User / Plan Approved / 2026-08-29`                   |
| spec path         | `mydocs/specs/0102_合并upstream_0.7基线到Reforged.md` |
| parent spec       | `N/A`                                                 |
| supersedes        | `N/A`                                                 |
| current task unit | `完成 typecheck、lint、定向回归并产出 merge commit`   |
| created / updated | `2026-08-29 / 2026-09-02`                             |

## 1. 目标、范围与完成契约

- 背景/问题：fork 自上游 `v0.4.0`（`b44bb63cf`，2026-08-13）分叉，本地 `main` 已演进 191 个提交（ReplicaCache/持久化 Timeline/中继加密压缩等 Heavy 成果，见 0038–0101）。上游已推进至 0.7 基线。前次 `v0.4.0` 合并由 0065 完成；本次 `v0.6.1` 差异分析（会话级，未落盘）确认冲突规模后，用户指定改以更新后的远端提交为基准。
- 最终目标：将上游基准提交 `463415ae846cbcfef0df691e413a1a73a9213757`（`upstream/main` 顶端，2026-08-29，已含 `v0.7.0-beta.1` 及其后 17 个提交）合并进本地主线，保留 fork 品牌与既有 fork 特性，不引入行为回归。
- 当前任务单元：在专用工作树中执行 merge，按本 spec 第 3.1 组顺序解冲突，完成验证并产出 merge commit。
- 范围内：
  - 分支 `merge/upstream-463415ae8`（基于本地 `main` HEAD `b27b093e8`）与工作树 `E:\Code\paseo-upstream-merge`（merge 进行中）；
  - 147 个冲突文件 / 407 个冲突块的解析；
  - 合并后 lockfile、nix hash 重建与受影响验证。
- 范围外：
  - 不 push、不打 tag、不发布（需另行授权）；
  - 不把 `main` 上已独立提交的 0101、0084/0097 与 beta.5 发布改动混入本 merge；
  - 不顺手修复范围外缺陷，发现的写入 todolist 候选待办；
  - fork 许可证身份变更（见 2.2 决策点 D2）不在本任务内实施，仅登记决策结果。
- Done Contract：
  1. merge commit 存在于 `merge/upstream-463415ae8`，包含基线 `463415ae8` 全部内容；
  2. 407 个冲突块全部按第 2.3 组策略解析，无残留冲突标记（`rg '^<<<<<<<'` 为空）；
  3. `npm run typecheck`、`npm run lint` 通过；受影响 Vitest 单文件 `--bail=1` 通过；
  4. `packages/protocol` 双向兼容审查通过（旧 daemon 解析新客户端、新客户端接受旧 daemon 两个方向），`messages.wire-compat.test.ts` 通过；
  5. `npm install` 后 lockfile 与 workspace 一致；nix hash 与 lockfile 一致（或记录 Windows 无法验证的例外）；
  6. fork 品牌（`Paseo Reforged`、`mydocs/`、fork 专属 release 流程）完整保留。
- 失败或回炉方式：冲突解析破坏不可修复时 `git merge --abort` 后按组重做；深度语义冲突（D 组）无法在单分支收敛时，拆分子 spec 并在本 spec 3.3 登记。

### 1.1 最小任务单元判断

- 为什么当前任务单元足够小：merge 本身是一个原子 git 操作；冲突按 A–F 组拆解，每组内冲突块同质（同文件簇、同解法），可独立验证。
- 验证证据：`git merge-tree --write-tree` 模拟（tree `007bce80f`）产出确定性的冲突清单与分组，见 2.2。
- 模型可自主决定的范围：A 组机械取上游、B 组保留本地、C 组双侧接合的代码级取舍；E/F 组接受上游删除/替代实现。
- 拆分决定：`Accepted`（不拆父子 spec；D 组若执行中失控再升级拆分）。

## 2. 上下文与调研

### 2.1 上下文来源

- 需求来源：用户 2026-08-29 指令——从最新提交建分支与工作树，以远端提交 `463415ae8` 为基准梳理差异与冲突并形成本 spec；允许沿用 2026-08-28 会话对 `v0.6.1` 的分析做增量。
- 项目事实源：`git merge-tree` 模拟树 `007bce80f8ea8a89e3db9d98d6ccd4d941e15216`；上游 CHANGELOG（`v0.6.1`、baseline 两个版本面）；`docs/protocol-validation.md`、`docs/architecture.md`；todolist 0065/0055/0060 合并先例。
- Codemap：`N/A`
- Codemap Mode：`N/A`
- Context Bundle：`N/A`
- Context Bundle Level：`N/A`
- 关联任务记录：0065（`v0.4.0` 合并，已收口）、0101（已由 `6004fb55b` 收口）、0084/0085/0086/0097（独立任务，不受本 merge 影响）。

### 2.2 调研结论

已确认事实：

1. **基准身份**：`463415ae8` = `upstream/main` 顶端，`fix(providers): tolerate slow Pi and OMP RPC startup (#4008)`，2026-08-29；是 `v0.7.0-beta.1` 的后代但不在任何 tag 内（正式 0.7.0 未发）。
2. **规模**（合并基仍为 `b44bb63cf` = `v0.4.0`）：

   | 方向                         | 提交数 | 文件 | 行变化           |
   | ---------------------------- | ------ | ---- | ---------------- |
   | 上游独有（`main..baseline`） | 295    | 1482 | +121657 / −27462 |
   | 本地独有（`baseline..main`） | 191    | 881  | +103398 / −7797  |
   | 同改文件                     | —      | 247+ | —                |

3. **冲突模拟**（`git merge-tree --write-tree main 463415ae8`）：**147 文件 / 407 块**；构成：142 content + 4 modify/delete + 1 add/add。
4. **相对 `v0.6.1` 分析的增量**：129 个旧冲突全部保留、0 个消失；新增 18 个冲突文件（+1 新 modify/delete、+1 add/add）；深冲突块数增长：`agent-manager.ts` 12→13、`session.ts` 3→5、`websocket-server.ts` 4→5、`view.tsx` 10→12、`messages.ts` 1→2。新增冲突集中在上游 SSH 远程 daemon（#3989）重构的 `packages/desktop/src/daemon/*` 与 `packages/app/src/desktop/daemon/*`。
5. **上游变更记录**（`v0.4.0 → baseline`，按 CHANGELOG）：
   - **0.5.0**（主体）：本地插件体系 + `@getpaseo/plugin` workspace、插件主题、Side panel、浏览器式 New tab、active-turn steering（`activeTurnBehavior`）、workspace labels、composer 活跃变更计数、Command Center 动作、CLI `paseo project`/`paseo reload`、Host skill 管理、MiniMax/Android Studio/Nix/Svelte 支持、Hub 引导式自托管；timeline 持久化重构（移除全量转录磁盘重写 #3647、缓存恢复 #3259）；CJK IME、provider usage 凭证覆盖等 20+ 修复。
   - **0.5.1/0.5.2**：多行 composer 与 Android 平板修复、设置重置修复（#3787）。
   - **0.6.0**：恢复 Explorer 侧边栏、New tab/拖拽、独立 diff 标签、自定义 Windows/Linux 窗口控件（#3826）、OpenCode 就绪修复。
   - **0.6.1**：Command Center 乱序匹配排序、侧边标签落位、Escape、auto-archive 修复。
   - **0.7.0-beta.1**：**许可证改为 Apache-2.0（#3944，重写 LICENSE 874 行）**、插件 Git 安装（#3920）、插件 timeline 变换与渲染（#3940）、匀速文本流（#3612）、rewind 不重放（#3642）、F-Droid 元数据、GitLab/Gitea check 状态。
   - **beta 后 17 个提交**：SSH 远程 daemon（#3989，本次新冲突主源）、Pi/OMP RPC 容错（#4008）、PR 状态轮询限流、Git 队列响应性、reconciliation 循环、ACP steering、西语翻译、`next` 分支并回 main。
   - 增量（`v0.6.1..baseline`）：60 提交 / 507 文件 +26803 / −6472。
6. **新增冲突文件双侧性质**（`base..main` vs `base..baseline` 行数）：
   - `desktop/src/daemon/local-transport.ts`：本地 51/8 vs 上游 462/99（上游 SSH 重构主导，以上游为基线）；
   - `desktop/src/daemon/local-transport.test.ts`：**add/add**，本地 86 行 vs 上游 204 行（双方各自新建）；
   - `relay/src/encrypted-channel.ts`：本地 1262/93 vs 上游 18/24（fork 主导，上游小改并入）；
   - `protocol/src/messages.wire-compat.test.ts`：本地 360/2 vs 上游 23（fork 主导）；
   - `app/src/stores/session-store.ts`：本地 194 vs 上游 37/73；`client/src/index.ts`：本地 28 vs 上游 91/5。
7. **许可证**：`LICENSE` 文件本地从未修改，上游 Apache-2.0 重写将**自动合入、不冲突**；但 fork 的 3 个 `package.json` 仍声明 `AGPL-3.0-or-later`（2 个）与 `MIT`（1 个），与上游 `Apache-2.0` 不一致。
8. 既有冲突组的双方对比与解法沿用 2026-08-28 `v0.6.1` 会话分析结论（版本号、品牌、i18n content-size、agent-manager/agent-stream 架构级冲突等），详见第 3.1 组表。

未知与开放问题：

- D 组深冲突（agent-manager/agent-stream）在合并后的实际可编译性，需 Execute 阶段验证；
- `local-transport.test.ts` add/add 中 fork 的 86 行断言有多少仍适用上游 204 行结构；
- fork e2e 变体（opaque workspace id 等）在上游重写后的 spec 上是否仍有 daemon 行为支撑。

风险与约束：

- **R1 深度语义冲突**：`agent-manager.ts`（13 块）与 `agent-stream/*`（~28 块）双方都重写了 timeline 持久化/渲染管线，约占合并工作量六成以上；解法必须"以上游新架构为基线迁移 fork 特性"，禁止反向保留本地旧架构。
- **R2 协议兼容**：上游新增 plugin/SSH/labels/steering 等 schema；合入必须遵守新字段 optional+default 的双向兼容规则，`wire-compat` 双方测试都要保留。
- **R3 许可证身份（决策点 D2，已决）**：用户选择跟随上游统一 Apache-2.0；该决定已在 merge 工作树落实，最终仍需由验证和 diff 复核确认无遗漏。
- **R4 工作树隔离**：0101 与 beta.5 改动已在主工作树独立提交；merge 继续只在专用工作树推进，不进入本次 beta.5 发布，完成后再单独决定如何回写 `main`。
- **R5 Nix**：`nix/npm-deps.hash` 需合并后重算；Windows 环境无 Nix 构建能力时记录例外（0031 先例：Nix 风险接受）。

`grilling` 结论：N/A（未触发；关键边界 merge 目标与基准均已由用户明确指定）。

### 2.3 方案与决策

- 备选方案：
  1. merge `v0.6.1`（tag 稳定，但上游已越过，短期需二次合并）；
  2. merge `463415ae8`（用户指定；含 0.7.0-beta.1 全部 + beta 后修复，冲突 +18 文件但一次到位）；
  3. rebase 本地 191 提交（重写历史，191 次冲突重放，否决）。
- 已选方案：方案 2——在专用分支/工作树 merge 基准 `463415ae8`。
- 选择理由：用户明确指定该基准；一次吸收 0.7 全部变更避免近期二次合并；0065 已验证 merge（非 rebase）流程在本 fork 可行；专用工作树隔离 0101 未提交改动。
- 冲突解析总策略：**以上游新架构为基线（尤其是 agent-manager、agent-stream、desktop daemon transport），把 fork 特性迁移到上游结构上**；fork 品牌与 fork 专属文件保留本地；机械/版本/生成物取上游或重建；协议遵守双向兼容。

### 2.4 下一步动作

- 下一步动作 1：在 `E:\Code\paseo-upstream-merge` 继续清零 typecheck，并运行 lint 与受影响定向回归。
- 下一步动作 2：全部门禁通过后创建 merge commit；不将该隔离工作树的半成品纳入 `0.4.0-beta.5`。

## 3. 计划与执行前检查点

### 3.1 文件变化（按冲突组，147 文件 / 407 块）

| 组       | 文件簇                                                                                                                                                                                            | 冲突性质（双方对比）                                                                                                                                                                      | 计划变化 / 解法                                                                                                |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| A 机械   | 11 个 workspace `package.json`                                                                                                                                                                    | 版本 `0.4.0-beta.4` vs `0.6.1`+依赖版本                                                                                                                                                   | 取上游                                                                                                         |
| A 机械   | 根 `package.json`（2 块）                                                                                                                                                                         | 本地定制 `release:check` vs 上游新增 plugin workspace 与 `release:publish*` 脚本                                                                                                          | 上游为基线，重放 fork release 脚本差异                                                                         |
| A 机械   | `package-lock.json`（13 块）                                                                                                                                                                      | 版本连锁                                                                                                                                                                                  | 其余冲突解完后 `npm install` 重建，不手工解                                                                    |
| A 机械   | `nix/npm-deps.hash`、`nix/desktop-package.nix`                                                                                                                                                    | 哈希不同；本地结构重排 vs 上游 runtime path                                                                                                                                               | hash 取上游后重算；nix 文件接合双方                                                                            |
| A 机械   | `CHANGELOG.md`                                                                                                                                                                                    | fork 0.4.0-beta.x 段 vs 上游 0.5.0–0.7.0-beta.1 段                                                                                                                                        | 两段都保留                                                                                                     |
| B 品牌   | `CLAUDE.md`、`docs/release.md`                                                                                                                                                                    | 本地中文规则/Docker 非发布流程 vs 上游英文文档索引/npm 发布流程                                                                                                                           | 保留本地；上游段落仅在与 fork CI 一致时吸收                                                                    |
| B 品牌   | `website/src/routes/hub.tsx`、`llms.ts`                                                                                                                                                           | fork "Paseo Reforged/upstream Paseo" 改写 vs 上游 self-host 新文案                                                                                                                        | 保留品牌，叠加上游文案块                                                                                       |
| B 品牌   | `desktop/src/main.ts`                                                                                                                                                                             | 本地 `APP_NAME="Paseo Reforged"` vs 上游 `DESKTOP_WINDOW_CHROME_MODE`                                                                                                                     | 两者都保留                                                                                                     |
| C 接合   | `websocket-server.ts`（5）、`bootstrap.ts`（3）                                                                                                                                                   | 本地 importSessionTransactionStore/relay vs 上游 pluginRuntime/orchestrationSkills/workspaceLabels/attachPluginSocket                                                                     | import 与构造参数双侧合并                                                                                      |
| C 接合   | `session.ts`（5）                                                                                                                                                                                 | 本地 `canonicalRunOptions` vs 上游 `activeTurnBehavior`/`clearPendingPermissions`（steering）                                                                                             | 双侧合并                                                                                                       |
| C 接合   | `protocol/src/messages.ts`（2）                                                                                                                                                                   | 仅 import 合并（本地 agent-goal vs 上游 workspace-labels）                                                                                                                                | 合并 import；schema 主体已自动合并，合入后做双向兼容审查                                                       |
| C 接合   | `client/src/daemon-client.ts`、`client/src/index.ts`                                                                                                                                              | 本地 timeline 投影类型 vs 上游 plugin 类型 + `daemonConfigReload` COMPAT gate                                                                                                             | 合并；保留上游 COMPAT 登记                                                                                     |
| C 接合   | `app/src/i18n/resources/*.ts`（8 文件各 1 块；`ru.ts` 11 块）                                                                                                                                     | 本地 `workspaceFont/Size` 文案 vs 上游 `contentSize` 三键（#3637）；`ru.ts` 加 #3586 俄语修正                                                                                             | 取上游新键结构，折入 fork 文案；新增 `i18n/resources.test.ts` 冲突同法                                         |
| C 接合   | `hooks/use-settings/storage.ts`                                                                                                                                                                   | 上游改名 `uiBaseFontSize`+平台默认（#3787） vs 本地默认 16                                                                                                                                | 取上游结构，折入 fork 默认值                                                                                   |
| C 接合   | `runtime/replica-cache/index.ts`（9）、`theme.ts`、`postinstall-patches.mjs`、`contexts/session-context.tsx`（3）、`daemon-config-store.ts`、`persisted-config.ts`、`e2e/support/global-setup.ts` | 双侧独立演进                                                                                                                                                                              | 以上游结构为基线重放本地改动；patches 双条目都保留；global-setup 双 Windows 修复合成                           |
| D 深冲突 | `server/agent/agent-manager.ts`（13 块）                                                                                                                                                          | 本地 `stageRows`/`hubExecutionContract`/`loadLastMessageAtRecoveryRows` vs 上游 `historyPrimed`/`startPendingForegroundTurn`/`loadCommittedTimelineSeed`/`bulkInsert`（#3647/#3259 重构） | **以上游持久化架构为基线**，迁移 `hubExecutionContract` 与 `stageRows` 语义到 `bulkInsert`/committed-seed 之上 |
| D 深冲突 | `agent-stream/{view.tsx(12),layout.ts(9),model.ts(4),strategy-web.tsx(3),strategy.ts,web-virtualization.ts}`                                                                                      | 上游紧凑时间线 #3716+New tab #3715+`use-stream-history-window`+匀速流 #3612+插件 timeline 变换 #3940 vs 本地 `activityFolds`/`completedTurnItemIds`/workspace 字体                        | **以上游渲染管线为基线**，把 fork 特性落到新 `StreamLayoutItem` 上                                             |
| D 深冲突 | 9 个 e2e browser spec + 3 个 e2e helper                                                                                                                                                           | 上游为新功能重写 vs fork 变体                                                                                                                                                             | 取上游版本，fork 场景仍成立才补回                                                                              |
| E 删改   | `turn-footer.test.tsx`（modify/delete）                                                                                                                                                           | 上游删测试（覆盖移入 `layout.test.ts`/`footer-spacing.test.ts`）                                                                                                                          | 接受删除；fork 断言并入上游测试                                                                                |
| E 删改   | `workspace-empty-draft-seed.{ts,test.ts}`（modify/delete）                                                                                                                                        | 上游以 `workspace-draft-agent-config.ts`+`workspace-draft-pane-focus.ts` 替代                                                                                                             | 采用上游替代实现，迁移 fork 定制                                                                               |
| F 新增   | `desktop/src/daemon/local-transport.ts`（5）+`daemon-manager.ts`+`app/src/desktop/daemon/*`（6 文件）                                                                                             | 上游 SSH 重构（#3989）462 行 vs 本地 51 行小改                                                                                                                                            | 以上游 SSH 架构为基线，重放本地小改（含 Windows 相关）                                                         |
| F 新增   | `desktop/src/daemon/local-transport.test.ts`（add/add）                                                                                                                                           | 本地 86 行 vs 上游 204 行                                                                                                                                                                 | 取上游，确认 fork 断言后补回                                                                                   |
| F 新增   | `relay/src/encrypted-channel.ts`（1）                                                                                                                                                             | 本地 1262 行（0084 加密压缩成果）vs 上游 18/24                                                                                                                                            | 保留本地为主，把上游小改并入                                                                                   |
| F 新增   | `messages.wire-compat.test.ts`（1）、`session-store.ts`（1）、`sidebar-workspace-list.test.tsx`、`omp/agent.test.ts`、`docs/terminal-performance.md`                                              | 双侧小改                                                                                                                                                                                  | 逐块接合                                                                                                       |
| F 新增   | `contexts/session-context.service-status.test.ts`（modify/delete）                                                                                                                                | 上游删除、本地修改                                                                                                                                                                        | 核实上游删除原因；fork 断言仍有效则迁入上游对应测试，否则接受删除                                              |

### 3.2 签名与契约

| 项目/子项           | 接口、类型或签名                                                     | 计划变化                          | 兼容性                                                                                     |
| ------------------- | -------------------------------------------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------ |
| `packages/protocol` | message schema（plugin/SSH/labels/steering/`activeTurnBehavior` 等） | 吸收上游新增字段                  | 新字段必须 optional+default；wire schema 禁 transform/catch/preprocess；双向兼容两方向审查 |
| `packages/client`   | daemon-client 方法面                                                 | 吸收上游 plugin/configReload 能力 | 旧 daemon 调用需 COMPAT gate（沿用上游 `COMPAT(daemonConfigReload)` 登记）                 |

### 3.3 子 Spec 索引

`N/A`（单项目未拆分；D 组失控时再升级拆分并在本节登记）

### 3.4 执行清单

- [ ] 1. 确认 `main` 工作树 0101 未提交改动的隔离前提成立（仅隔离，不处理其内容）
- [ ] 2. 在 `E:\Code\paseo-upstream-merge` 执行 `git merge 463415ae846cbcfef0df691e413a1a73a9213757`
- [ ] 3. 解 A 组机械冲突（版本/脚本/CHANGELOG/nix 文件），暂缓 lockfile 与 npm-deps.hash 重建
- [ ] 4. 解 B 组品牌/文档冲突（保留 fork 身份）
- [ ] 5. 解 C 组双侧接合冲突（i18n、server 接线、client、settings、replica-cache 等）
- [ ] 6. 解 F 组新增冲突（SSH transport 取上游、relay/本地加密保留为主、wire-compat 合并）
- [ ] 7. 解 D 组深冲突（agent-manager → agent-stream → e2e，以上游为基线迁移 fork 特性）
- [ ] 8. 解 E/F 组 modify/delete 与 add/add（核实删除原因后取舍）
- [ ] 9. `npm install` 重建 lockfile；重算/核对 `nix/npm-deps.hash`
- [ ] 10. 验证（见第 6 章）；`rg '^<<<<<<<'` 确认无残留标记
- [ ] 11. 登记许可证决策点 D2 的用户结论；发现范围外问题写入 todolist 候选待办
- [ ] 12. 产出 merge commit（提交需用户授权；不 push、不 tag）

### 3.5 执行前检查点

- 当前目标与任务单元：merge 基准 `463415ae8` 并按组解冲突至 Done Contract。
- 当前 phase：`Execute`；147 个冲突路径已解析并暂存，merge 尚未提交。
- approval status / source：`Approved / User / Plan Approved / 2026-08-29`。
- 下一步：清零 typecheck，运行 lint、定向 Vitest 与 wire compatibility 回归后再创建 merge commit。
- 风险与回退：R1–R5；回退 = `git merge --abort`，工作树与分支可整体丢弃重建。
- 验证方式：typecheck、lint、受影响 Vitest 单文件（`--bail=1`）、wire-compat 双向审查、残留冲突标记扫描。
- TDD 判定、测试 seam 与验收行为：`N/A`（合并任务无新行为；验收以既有测试与兼容审查为准）。
- seam 确认：`N/A`。

## 4. 跨项目扩展

`N/A`

## 5. 执行记录

| 步骤/子项                   | 实际变化或子 Spec 锚点                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | 状态 | 偏差与处理                                                          |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ------------------------------------------------------------------- |
| 3.4-2 merge 发起            | worktree E:\Code\paseo-upstream-merge，branch merge/upstream-463415ae8；实际冲突 147 文件（142 UU + 4 UD + 1 AA），与模拟一致                                                                                                                                                                                                                                                                                                                                                                                                                                        | 完成 | 无                                                                  |
| 用户决策                    | D1=A（ActivityFold 移植上游管线）；D2=A（Apache-2.0）；D3/D4 默认                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | 完成 | 已录入                                                              |
| A 组机械                    | 11 个 package.json（上游基线+fork 增量重放：desktop e2e 脚本、fflate、codemirror-lang-csharp、server typecheck/measure、build:lib 不打包私有 skills、fork release 链不发布 npm、品牌字段）；license 全部 Apache-2.0（expo-two-way-audio 保持上游自身 MIT）；CHANGELOG 双向保留（fork 4 个独有章节追加尾部）；nix/npm-deps.hash 取上游待重算；nix/desktop-package.nix 保 fork 精简结构                                                                                                                                                                                | 完成 | 无                                                                  |
| B 组品牌文档                | CLAUDE.md/release.md 取本地；architecture 3 块（上游表+fork agent-storage 行为段+fork 目录树）；design/unistyles/terminal/community/skills 联合；hub.tsx 保 fork 品牌；llms.ts fork 事实+Apache-2.0；desktop main.ts 双方（Reforged 名+chrome mode）                                                                                                                                                                                                                                                                                                                 | 完成 | docs polish 候选已记录                                              |
| C 组 server/protocol/client | messages.ts（goal import+workspace-labels+fork 字段+上游 COMPAT）、client index（goal+上游 9 个可读字段）、daemon-client（类型联合+双方法）、bootstrap/websocket-server（参数联合+fork relay 块）、session.ts（5 块：fork serializeTimelineProjectionEntries 保用于补 turnId）、daemon-config-store（**上游 patch 架构为基**，移植 fork relay transport/compression 嵌套合并到 mergeMutableDaemonPatch+SupportedMutableConfigPatch+pickSupportedPatchFields）、persisted-config/worktree(OURS)/terminal test/codex transport/agent/mock/daemon-executions 联合或择侧 | 完成 | daemon-config-store 与 session.ts 需类型检查复核                    |
| C 组 i18n/settings          | 9 语言 1 键块+ru 11 块（上游键优先+fork-only 键保留+多行值回填）；resources.test 并存；storage.ts（上游 uiBaseFontSize/contentFontSize 命名+fork workspaceFontSize 轴+fork SidebarRowItemsSchema/toolCallDetailLevel 解析保留）；theme.ts（上游 FONT_SIZE+fork WORKSPACE_FONT_SIZE ramp）；use-settings/index 六处联合；appearance-section（上游 state 架构+按其模式新挂 workspace 字体族/字号行）；apply.ts（rename/rename：上游路径，scaleFontSize+fork scaleWorkspaceFontSize 双 ramp，fontFamily 含 workspace）                                                  | 完成 | 字体三轴模型：uiBaseFontSize/contentFontSize/workspaceFontSize 并存 |
| 偏离决策 R6                 | replica-cache index/index.test 取 **fork 基线**（0041-0046 六个 Heavy spec 承载；上游 deferred persist/row-store 为性能改进，损失登记为候选后续）                                                                                                                                                                                                                                                                                                                                                                                                                    | 完成 | 偏离 spec 原定"上游基线"，理由：避免 fork 核心功能覆盖              |
| E/F modify-delete           | turn-footer.test、workspace-empty-draft-seed×2、session-context.service-status.test 按上游删除（#3715/#3716/#3907 替代实现）；fork 断言迁移在验证阶段核对                                                                                                                                                                                                                                                                                                                                                                                                            | 完成 | 待类型检查确认                                                      |
| 其他已解                    | relay/encrypted-channel 保 fork（0087/0088 防重握手）；session-store/stream.ts/viewed-timeline-sync/wire-compat 联合或 ours；postinstall-patches 双条目并存                                                                                                                                                                                                                                                                                                                                                                                                          | 完成 | 无                                                                  |
| **冲突解析收口**            | 147/147 个冲突路径均已解析并暂存；`git diff --name-only --diff-filter=U` 为空                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | 完成 | typecheck、lint、定向回归与 merge commit 仍未完成                   |

## 6. 验证

| 项目/验收项   | 命令或步骤                                                                   | 结果   | 证据     | 未验证原因 |
| ------------- | ---------------------------------------------------------------------------- | ------ | -------- | ---------- |
| 无未合并路径  | `git diff --name-only --diff-filter=U`（merge 工作树）                       | 通过   | 输出为空 |            |
| 类型检查      | `npm run typecheck`                                                          | 待执行 |          |            |
| Lint          | `npm run lint`                                                               | 待执行 |          |            |
| 协议兼容      | `npx vitest run packages/protocol/src/messages.wire-compat.test.ts --bail=1` | 待执行 |          |            |
| 深冲突区测试  | 受影响 Vitest 单文件（agent-manager、agent-stream layout/model 等，逐文件）  | 待执行 |          |            |
| lockfile 一致 | `npm install` 后 `git diff --exit-code package-lock.json`                    | 待执行 |          |            |
| fork 品牌     | 检查 `APP_NAME`、`hub.tsx`、`CLAUDE.md`、`mydocs/` 完整性                    | 待执行 |          |            |

- 集成验证：typecheck/lint 之前如报跨 workspace 类型错，先按 `docs/development.md` 重建 `build:client`/`build:server` 再复现。
- 剩余风险：见 2.2 R1–R5。
- Done Contract 是否由证据满足：待 Execute 后判定。

## 7. 评审（Review）

| 评审轴             | 结论   | 证据或阻塞问题 |
| ------------------ | ------ | -------------- |
| 目标与 Spec 完成度 | 未进入 |                |
| Spec 与执行一致性  | 未进入 |                |
| 实现质量与风险     | 未进入 |                |

- Overall Verdict：未进入
- Blocking Issues：冲突路径虽已全部解析并暂存，但 typecheck、lint、定向回归与 merge commit 尚未完成
- Cross-project consistency：`N/A`

### 7.1 回归风险

| project_id | Regression risk                  | 依据                                                                |
| ---------- | -------------------------------- | ------------------------------------------------------------------- |
| paseo      | `High`（合并前）→ Execute 后复评 | 147 文件 / 407 块冲突；agent-manager 与 agent-stream 架构级双方重写 |

### 7.2 Touched Projects

| project_id | Files Changed | Reason     |
| ---------- | ------------- | ---------- |
| `N/A`      | `N/A`         | 单项目任务 |

- Orphan changes：`None`（预期；执行中发现时如实登记）

## 8. 偏差、变更与反向同步

- Plan-Execution Diff：（待执行）
- Change Log：
  - 2026-08-29：创建本 spec；完成基准 `463415ae8` 的增量差异与冲突分析（沿用 2026-08-28 `v0.6.1` 会话分析为基线增量）。
- 2026-08-29：用户 `Plan Approved`；启动 Execute，先发起 merge 并输出冲突决策点清单，解冲突待用户确认决策项后继续。
- 2026-08-29：用户决策 D1=A/D2=A/D3=D4 默认；该日检查点完成 67/147 个冲突路径，后续已推进至 147/147 全部解析并暂存。
- 用户决策：D2=A，跟随上游统一 Apache-2.0；merge commit 在 typecheck、lint 与定向回归通过后再处理。
- Spec 反向同步结果：todolist 已同步为 0102 `执行中 / 已同步`，并记录验证与 merge commit 尚未完成。

## 9. 恢复、长期知识与提交关联

### 9.1 Execute 检查点(2026-08-30,第十二次)

- 冲突:147/147 已解析并暂存;lockfile 已按新依赖重建并暂存;build:protocol ✅、build:client ✅、build:server ✅(经三轮修复:TOOL_CALL_ICON_NAMES 导入恢复、AgentTimelineStore 接口补 getLastItem/getLastAssistantMessage/getLatestCommittedSeq 并在两个实现类落地、fetchCommittedPage 签名还原、duplicate deleteCommittedTimeline 去重、archiveNativeSessionBestEffort 回迁)。
- 待办(app 包 typecheck 尚有 ~419 错,全部为 union 脚本对多行 JSX/import 的拍平损伤):
  - 重做进度:✅ agent-panel.tsx(checkout -m 后 10 块重解,import 块禁用拍平 union,补 streamItems 收尾括号)、✅ pair-device-section.tsx(单块:上游 securityWarning Alert + fork RelayTransportSettings 并存)、✅ types/stream.ts(并集)。
  - 待重解(已 checkout -m 恢复标记,逐块手工解):screens/workspace/workspace-screen.tsx(8 块)、screens/settings-screen.tsx、timeline/viewed-timeline-sync.ts(4 块,h1 接口方法并集)、components/file-actions-menu.tsx、hooks/use-settings/storage.test.ts、tool-calls/detail-level/overview/view.tsx、assistant-file-links/link.tsx、appearance/apply.test.ts、agent-stream/view.tsx(1 块)、runtime/host-runtime.ts(1 块)、panels/diff-panel.tsx(1 块)、hooks/sidebar-workspaces-view-model.ts(1 块)、timeline/viewed-timeline-sync.test.ts(1 块);daemon/local-transport.ts 的 checkout -m 失败(app 侧该文件标记已被上轮解掉,若 typecheck 仍报错则手工核)。
  - 注意:checkout -m 后标记为小写 `<<<<<<< ours` / `>>>>>>> theirs`(rename 情形);解析循环正则须含 ours/HEAD 两种,split 用非捕获组。
  - 已修:styles/theme.ts(FONT_SIZE 补 xs:12 与收尾)、ui/menu/menu-surface.tsx、sidebar/workspace-meta-row/index.tsx(签名重建)、agent-manager/daemon-client/websocket-server/apply/mock/strategy-web.test 语法。
  - 教训:union 脚本禁用于多行 JSX/import;此类冲突须 checkout -m 后手工解。
- 之后的步骤:npm run typecheck 清零 → npm run lint → 受影响 vitest(layout/model/agent-manager/wire-compat)→ merge commit(需用户授权)→ todolist/spec 回写。
- **第九次检查点(同日,接第八次)**:typecheck 227(本轮 318→227)。file-actions-menu 已清零。
  - 各文件具体修法(均已核实):
    - storage.ts(12):fork 版 pickTypographySettings(439-530 区域)引用旧名——MIN_UI_FONT_SIZE→MIN_UI_BASE_FONT_SIZE、MAX_UI_FONT_SIZE→MAX_UI_BASE_FONT_SIZE、settings.uiFontSize→uiBaseFontSize、parseSidebarChecksDisplay→parseStoredSidebarChecksDisplay、VALID_THEMES→上游主题常量名(查 grep VALID);或直接删 fork 版 pickTypographySettings(确认上游 normalizeAppSettings 的 Object.assign(pickTypographySettings(stored)) 调用改用上游版)。AppSettings 粘连行已拆;schema 字段已补。
    - apply.ts(9):头部补 `FONT_SIZE, WORKSPACE_FONT_SIZE` 导入(from "@/styles/theme"——现只有 WORKSPACE_FONT_SIZE);FONT_SIZE.xs 缺失已由 theme.ts xs:12 修复。
    - ru.ts(7):fork 的 ru 翻译缺上游新键——按 en.ts 对应键补俄语翻译(searchRequiresUpgrade、mermaid 组 6 键、archive 删多余键、kicker 等),对照 en.ts 与错误行号。
    - view.ts(9)/task-list(7)/split-container(7)/strategy 等:同类字体键与 props 对齐,逐错误行处理。
  - 修复节奏建议:每文件修完即 oxfmt --check + git add,全部清零后 lint → 受影响 vitest → 出包。
- **第十二次检查点(2026-08-30,接第十一次)**:typecheck 178→约160。fork 全文批量已落(split-container/control-geometry/workspace-trailing/search-field/explorer-sidebar/skill-selection-sheet/layout.test);tree-primitives 补 fork 两导出(TreeIndentGuides/WORKSPACE_FILE_ROW_TRAILING_PADDING——merged 版是上游系,TreeRail 在独立模块 tree-rail.ts);strategy/web-virtualization 去重完成。
  - 下一轮的依赖链清单(均为"fork 文件引用其自身模块成员,需连带移植"):
    1. explorer-sidebar(fork)需:panel-store 的 explorerWidth/setExplorerWidth/closeDesktopFileExplorer 成员+selectIsFileExplorerOpen 的 index 再导出+desktop-sidebar-layout 的 resolveDesktopExplorerWidth(从 fork 版 desktop-sidebar-layout.ts 提取)。
    2. diff-pane(fork)需:ChangesSurface 导出(给 compact-explorer-sidebar/diff-panel)、panel-store 的 diffExpandedPathsByWorkspace/setDiffExpandedPathsForWorkspace、workspace-layout-store 的 openTabFocused、use-changes-preferences 的 viewMode+modeScope(从 fork 版 use-changes-preferences.ts 补)。diff-panel 已取上游 ChangesPanel——两侧 API 对齐:fork diff-pane 恢复后,将 diff-panel 改回 fork 版(direct)。
    3. skill-selection-sheet/search-field 等若仍报缺符号,同法从 fork 对应模块提取。
  - 剩余小项:ru.ts 俄语新键、workspace-screen 的 open-target-planner 导入、view 6 错(ThoughtStatus 类型+activeHistoryPagination)、layout.test 6。
- **第十一次检查点(2026-08-30,接第十次)**:typecheck 198→178。
  - 确立的高效模式:重灾小文件直接取 fork 全文(git show main: > 路径)——本轮 file-actions-menu.tsx、task-list/index.tsx 均此法清零;调用方 props 随 fork 签名回退。
  - 待修 178 错的同类处理清单:split-container.tsx 7(重复 WorkspacePaneContentModel 导入+duplicate ownsWindowTopEdge JSX 属性+useStableTabDescriptorMap 缺失——建议取 fork 全文+上游 RetainedPanel 结构)、explorer-sidebar.tsx 5(恢复的 fork 文件引用 tree-primitives 缺失导出——需从 fork 版 tree-primitives 补 TreeIndentGuides/WORKSPACE_FILE_ROW_TRAILING_PADDING 或文件取 fork)、skill-selection-sheet.tsx 4(同)、search-field.tsx 4、control-geometry.ts 5(fork resolvedControlHeights vs 上游 CONTROL_HEIGHTS——建议 fork 全文)、workspace-trailing 5(同)、diff-pane 8(需 fork 版 tree-primitives+panel-store 的 diffExpandedPaths 成员+ChangesPreferences.viewMode——即 fork 版 use-changes-preferences)、pane-context 5、desktop-daemon-transport 5、appearance-section 7(uiFont 引用——fork 的 useFontFamilyDraft 变量在我重写时被上游 useState 替代,需把 838-841 行改用 uiFontDraft 或补映射)、ru.ts 7(俄语新键)、view 6、layout.test 6、workspace-screen 6(open-target-planner 导入+tooltip 样式键+fork panel-store 成员已移植但 tree 相关的在 panel-layout)。
  - **建议批量策略**:下一轮对上述 fork 重灾文件统一"fork 全文为基",一次脚本批处理;typecheck 清零后 lint+vitest+出包。typecheck 227→198。
  - 已完成:storage.ts 清零(pickTypographySettings 字段名迁移、补 VALID\_\* 枚举集合与 parseSidebarRowItems/parseAppLanguage/parseSidebarChecksDisplayValue、LegacyRendererSettingsSchema 移位)、agent-stream/view.tsx(7 错:layout/inset 导入拆分、activeHistoryPagination 补回与默认值)、agent-panel 清零、session-context 清零。
  - 待修 198 锁定分布:file-actions-menu 16(header 解构补后新暴露 openInEditorAction 所需的 onOpenInEditor/editorTargetName 变量——它们在 useFileActions 返回值里,查 fork 的解构形态补)、diff-pane 8、appearance-section 7、ru.ts 7(俄语新键按 en.ts 补)、task-list 7、split-container 7、workspace-screen 6(余 open-target-planner 导入(resolveSideFileOpenPlacement/openWorkspaceChildTabFocused——文件已恢复,补 import)+tooltip 样式键)、view 6、layout.test 6、pane-context 5、desktop-daemon-transport 5、control-geometry 5、workspace-trailing 5、其余散点。
  - 全部为小修,每文件 1-3 处;修完即 oxfmt+git add。
- **第八次检查点(同日,接第七次)**:typecheck 272→227。
  - 已修复:panel-store ExplorerPanelIntent 接口+两动作+selector 移植完成;session-store 补 SessionReplica/SessionReplicaTimeline 类型与 restoreSessionReplica 接口声明;replica-cache readTimeline/commitTimeline 重写为读 session-store 投影(selectAgentTimelineState)实现;agent-panel 清零(setText→agentInputDraft.replaceText、workspaceId 去重、SubagentsTrack 块删除(上游 AgentTracks 已覆盖,登记特性差异)、两处 AgentStreamSection 调用补 props、AgentTaskList 改 tasks 派生(agentTasks.get(agentId)))、file-actions-menu 补 FileActionGroup/optionalFileAction/openInEditorAction/header 解构、search-field/menu-overlay 重复导入块清除。
  - 待修 227 错分布(重跑 npm run typecheck 对照):workspace-screen 12(explorerToggleLabel/Tooltip 组已移植,余 styling/tooltip keys 与 openInSidePane 相关)、storage 12、apply 9、view 9、diff-pane 8、appearance-section 7、ru.ts 7、task-list 7、split-container 7、layout.test 6、pane-context 5、desktop-daemon-transport 5、其余散点。file-actions-menu 已清零。
  - 下一步:逐文件继续(每文件先 npm run typecheck 对照该文件错误行,修完 oxfmt --check 验语法)。typecheck 284→272。
  - 已完成:agent-stream/layout.ts 删上游重复字段(toolSequence/isFirst/Last 等 4 行,保留 fork fold-aware 版)、删上游直取 input 的 auxiliaryTurnFooter(保留 fork flattenRows 适配版);strategy.ts getNeighborItem 恢复 fork 泛型签名 <T>(修复 getRowBelowEdgeItem rows 传参,3 错清零);agent-panel Button 重复导入删除;host-runtime ReplicaCache 构造参数修正(AsyncStorage)。
  - **replica-cache/index.ts 的问题**:我插入的 readTimeline/commitTimeline 落在了 ReplicaCache 类内(564 行起,插入点 723),但实现用了错误 API(has/getRows 是 agent-timeline-store 的,不是 ReplicaCache 的)。修正方向:①先恢复 session-store 的 fork 成员——SessionReplica 导出与 restoreSessionReplica 动作在合并时丢失(replica-cache 660 行引用),从 git show main:packages/app/src/stores/session-store.ts 提取补回;②readTimeline 用 fork ReplicaCache 自己的 timeline 读取 API 重写(查该类的 timeline 持久化方法名);③CachedTimeline 类型在文件 349 行已存在。当前这两个方法在 723-741 行,直接改写方法体即可。
  - 待修 272 错分布:agent-panel 19(1284 onRetry→onRetryLoad、1338/1499 workspaceId 重复、1476-1518 setText→replaceText、1542/1577 两处 props 缺失:AgentStreamSection 需补 hasActiveComposer/hasVisibleAgentTracks/editLastUserMessageController/onEditLastUserMessageEffect)、file-actions-menu 14、search-field 13、workspace-screen 12、storage 12、menu-overlay 12、apply 9、view 9、diff-pane 8、appearance-section 7、ru 7、task-list 7、split-container 7、其余散点。
- **第六次检查点(同日,接第五次)**:typecheck 318→284,host-runtime.ts 清零。
  - 已完成:panel-store 移植(ExplorerPanelIntent 接口+openFileExplorerForCheckout/toggleFileExplorerForCheckout 动作+selectIsFileExplorerOpen 选择器)、session-context 补 getSendingClientMessageIds 导入/setAgentStreamState/setAgentTimelineHasNewer/setAgentTimelineCursor 选择器/agentStreamReducerQueue 实例、host-runtime 清零(projectIconCache/createTimelineReplica/ViewedTimelineOwner 导入,DirectorySync 第三参去掉)、ReplicaCache 补 readTimeline/commitTimeline(readTimeline 读 fork 内存 rows,commitTimeline no-op——fork 自己的 stageRows/commit 已负责持久化)。
  - 待修 284 错:agent-panel 19、file-actions-menu 14(取了 fork 基线后上游 helper/类型引用残留)、search-field 13、workspace-screen 12、storage 12、menu-overlay 12、agent-stream/layout 10(h5/h8/h9 union 重复键+auxiliaryTurnFooter 重声明+rows/items)、appearance/apply 9(makeInput 字段名)、view 9、replica-cache/index 8(新增两方法与 fork 类的其他成员签名冲突?待查)、diff-pane 8、appearance-section 7、ru.ts 7、task-list 7、split-container 7、strategy 6、layout.test 6、其余 1-5 错散点。快照重跑 npm run typecheck 即得。
- **第五次检查点(同日,接第四次)**:
  - 重大发现:merge 的 rename 检测吞掉 37 个 fork 独有文件(diff-flat-items、diff-scroll×2、explorer-sidebar、workspace-pins×10、github-refs、diff-highlighter、height-mirror×3、auto-attach×2、skills-snapshot×2、apply-appearance/apply-root-font×4、session-workspace-scripts、open-target-planner×2、use-hide-finished-provider-subagents 等)。已从 main 恢复 37 个(4 个按上游删除的除外)。
  - 已修复:diff-pane 重建为 fork 全文+TreeRail(257→8 错);storage.ts 去重 schema(上游 looseObject 为准+补 workspaceFontFamily/workspaceFontSize/restoreLastWorkspaceOnLaunch/autoExpandActivity 字段)、恢复 parseToolCallDetailLevel;theme.ts FONT_SIZE 补 xs;menu-surface/meta-row 重建;agent-panel 导入去重+onRetryLoad;host-runtime 去 row-store 依赖+变量名统一+TimelineReplica 导入;workspace-screen 补 panel-store 选择器与 seed 工具。typecheck 635→318。
  - 待修(318 错,逐文件):workspace-screen 25(需把 fork 的 isExplorerOpen/toggleFileExplorerForCheckout 成员移植进上游版 panel-store/index.ts,加 auto-open 常量与 ref)、agent-panel 19、session-context 18(fork 的 setAgentStreamState/setAgentTimelineHasNewer/agentStreamReducerQueue 等 store 成员与队列实例需从 fork 版 session-store 移植)、host-runtime 16(test 重复函数+projectIconCache/createTimelineReplica 导入)、file-actions-menu 14、search-field 13、storage 12、menu-overlay 12、agent-stream layout 10(h5/h8/h9 union 的重复键与 auxiliaryTurnFooter 重声明)、appearance/apply 9、ru.ts 7、task-list 7、split-container 7、strategy 6。
  - 已确认教训:union 脚本勿用于多行结构;merge 后必须核对 fork 独有文件是否被 rename 检测吞掉(comm main 树与工作树文件清单)。
- **第四次检查点(同日)**:13 个损伤文件全部重解完成(除 storage.test 取上游全量、diff-panel 取上游全量、file-actions-menu 取 fork 基线,上游分组改进登记候选);desktop local-transport 用脚本干净重建(正则经 new RegExp 规避转义);typecheck 快照见 worktree 根 typecheck-errors-snapshot.txt(635 错,全部语义级)。核心矛盾:agent-stream 的 fork rows 管线(model/layout/view)与上游 item 辅助函数(resolveAuxiliaryTurnFooter/getTurnTiming/footer-spacing 等)的类型调和,预估半天——方案:layout.ts 的上游辅助函数改为接受 rows 或在调用处展平 items;upstream 新测试文件(footer-spacing/layout.test 部分段)按合并后模型改写。另有零星:daemon-websocket-gate.test 期望 upsertLatestHeldMessage 导出、host-runtime DirectorySync 第三参 replicaCache 需满足 DirectoryCheckpointStorage、test-stub 取 fork 版后与上游色值断言的核对。用户要求:typecheck/lint/vitest 达标后本地构建 Windows 安装包与 APK 供其测试,merge commit 待测试后决定。
- 关键决策落实状态:D1=A(ActivityFold 保留于 rows 管线,上游 historyStart/turnTiming 已接入);D2=A(Apache-2.0 全部落位);replica-cache fork 基线(R6);desktop transport 三 transport 并存(local-transport.ts 手术完成,app 侧 input 模型统一)。

- 状态说明：Plan 已批准并进入 Execute；147 个冲突路径已解析并暂存，merge commit 尚未创建。
- 当前卡点：合并结果仍需清零 typecheck，并完成 lint、定向回归与 wire compatibility 验证。
- 下一步唯一动作：在 `E:\Code\paseo-upstream-merge` 继续修复 typecheck，再按门禁顺序验证并提交 merge。
- Resume / Handoff 锚点：分支 `merge/upstream-463415ae8`（基于 `b27b093e8`）；工作树 `E:\Code\paseo-upstream-merge`；基准 `463415ae846cbcfef0df691e413a1a73a9213757`；合并基 `b44bb63cf`。
- Project Sync Candidates：无（若"以上游为基线迁移 fork 特性"的合并策略被验证为可复用，候选同步到 `docs/` 或 0065 类合并 spec 的经验区）。
- 长期文档同步：合并完成后如产生新的稳定事实（如上游架构迁移要点），写入 `docs/` 对应文档。

### 提交记录

| 提交信息（Commit Message） | 提交脚注（Commit Footer） | 关联项目 / 改动或阶段  | 文档同步状态 | 备注                                 |
| -------------------------- | ------------------------- | ---------------------- | ------------ | ------------------------------------ |
| `<待提交>`                 | `N/A`                     | `paseo / merge commit` | `待验证`     | typecheck、lint 与定向回归通过后创建 |
