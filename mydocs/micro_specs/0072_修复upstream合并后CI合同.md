# 修复 Upstream 合并后 CI 合同 Micro Spec

## 0. 状态与索引

| 字段               | 值                                                                |
| ------------------ | ----------------------------------------------------------------- |
| task_id            | `0072`                                                            |
| spec layer         | `Feature Spec`                                                    |
| task status        | `已收口`                                                          |
| document status    | `Completed`                                                       |
| depth              | `standard`                                                        |
| phase              | `Review`                                                          |
| Execution Approval | `Approved`                                                        |
| Approval Source    | `User；2026-08-15 当前消息要求精确 main CI 全绿后提交并发布 beta` |
| file path          | `mydocs/micro_specs/0072_修复upstream合并后CI合同.md`             |
| parent spec        | `N/A`                                                             |
| superseded by      | `N/A`                                                             |
| created / updated  | `2026-08-15`                                                      |

## 1. 目标与完成契约

- 当前理解：0070 的两个 Playwright 红项已独立修复；首次推送合并后的完整 `main` 后，精确 run `31875103628` 又暴露出 formatter、三个 Vitest seam 与四个 Playwright oracle 不一致
- 核心目标：只修复 upstream `0.4.0` 合并后遗留的格式和测试合同，使精确 `main` 的 CI workflow 全绿，不改变产品行为
- Done Contract：7 个 formatter 红项消失；Mermaid、quota 与 Hub resume 三个定向反馈环由 Red 转 Green；四个 Playwright 定向反馈环由 Red 转 Green；format/typecheck/lint 通过；新精确 main CI 全绿

## 2. 范围与事实

- 范围内：CI run `31875103628` 的 `format`、`app-tests`、Linux/Windows `server-tests` 与失败 Playwright shard；对应最小测试 seam、任务记录和独立提交
- 范围外：产品功能重构、全局超时放宽、Android 构建、release 内容、Nix GitHub App 与 Cloudflare 凭证
- 当前任务单元：本地反馈环、静态门禁与精确 main hosted CI 已全部 Green
- 轻量评估：`升级 standard`
- 已确认事实：`npm run format:check` 精确列出 7 个 upstream 合并文件；Mermaid 截图已绘制 SVG，但旧测试仍从父 DOM 查询 iframe 内部；quota 测试未 spy 真实 `pino.debug`；Hub resume 测试仍 stub 旧 `findByPersistenceHandle`，实现已调用 `listByProviderSession`
- 已确认 Playwright Red：Changes 显式/右键菜单的 `Copy path` 严格 locator 命中两个节点；tree mode 文件 toggle 因保留文件图标而有 2 个 SVG；web context menu passthrough 不再渲染 backdrop；typography reload 后 live commentary 被 canonical final answer 替换
- 风险与未知：修复必须保持 fork 的文件图标、web 原生右键透传和 canonical timeline 行为，不通过删除产品行为或扩大 timeout 让测试变绿

## 3. 涉及文件与计划

| 文件                                                             | 计划变化                                              | 事实源                                |
| ---------------------------------------------------------------- | ----------------------------------------------------- | ------------------------------------- |
| `CHANGELOG.md` 与 6 个 app 文件                                  | 仅应用当前 oxfmt 输出                                 | 本地/hosted `format:check` Red        |
| `packages/app/src/components/markdown/renderer.browser.test.tsx` | 按 sandbox iframe 的公开宿主状态更新集成 oracle       | 本地 Red、失败截图、runtime 单元测试  |
| `packages/server/src/services/quota-fetcher/service.test.ts`     | 显式 spy `logger.debug`                               | Linux/Windows CI 与本地 Red           |
| `packages/server/src/server/session.workspaces.test.ts`          | stub 当前 `listByProviderSession` 查询 seam           | Linux/Windows CI 与本地 Red           |
| `packages/app/e2e/browser/changes-pane.spec.ts`                  | 精确限定菜单 action，并同步 tree 文件图标数量 oracle  | CI 与本地定向 Red                     |
| `packages/app/e2e/browser/file-explorer-context-actions.spec.ts` | 以菜单外右键替代已移除的 backdrop                     | CI 与本地定向 Red、菜单实现           |
| `packages/app/e2e/browser/appearance-typography.spec.ts`         | 用稳定 final answer 定位正文，并以 code 展开 activity | CI 与本地定向 Red、canonical timeline |
| `mydocs/todolist.md`、本 micro-spec                              | 回写根因、验证与提交                                  | 项目任务记录规则                      |

1. 对四个已确认 Playwright oracle 实施最小修复，逐测试完成 Red/Green
2. 复核三个已 Green 的 Vitest 文件，运行 format/typecheck/lint
3. 创建独立 CI 合同提交并推送，等待精确 main CI 全绿

## 4. 执行前检查点

- 当前目标：清除 0070 之外、由 upstream 合并暴露的真实 CI 合同红项
- 当前进度：实现、独立提交、推送与精确 main hosted CI 均已完成
- 当前动作是否仍服务核心目标：是
- 下一步：无；0072 已完成 Review
- 风险与回退：不因 iframe 隔离删除产品级覆盖，不把外部凭证缺失伪装成代码成功，不扩大 timeout
- 验证方式：三个单文件 Vitest、四个 Playwright 定向命令、`npm run format:check`、`npm run typecheck`、`npm run lint`、GitHub CI
- TDD 判定、测试 seam 与验收行为：`N/A；现有 hosted 与本地失败已是 Red，本轮只维护合并后过期的既有测试合同`
- seam 确认：`N/A；沿用 CI 真实失败 seam`
- Execution Approval / Source：`Approved / User`

## 5. 执行与变更记录

- 实际改动：对 hosted formatter 点名的 7 个文件应用 oxfmt；更新 Mermaid iframe、quota logger、Hub resume storage 三个测试 seam；修复 Changes、Explorer 与 Typography 的四个过期 Playwright oracle
- 偏差与用户决策：`无`
- Change Log：
  - `2026-08-15`：精确 main run `31875103628` 暴露 0070 之外的 formatter、app 与 server 红项，建立独立任务避免污染 shard 1 修复
  - `2026-08-15`：三个单文件反馈环已本地 Red；差异分析定位为 sandbox iframe、真实 pino logger 与 storage 查询 API 的测试 seam 漂移
  - `2026-08-15`：formatter 与三个 Vitest seam 已修复并本地 Green；完整 CI 日志确认 Playwright shard 1/2 共四个过期 oracle，并以单测试命令全部复现
  - `2026-08-15`：Changes 菜单 locator 修复后，原反馈环继续暴露 dropdown 与 context menu 叠层需分别按 `Escape` 关闭；补齐清理步骤，未改产品行为
  - `2026-08-15`：Typography 首次修复越过旧 commentary locator 后仍在 reload 后丢失 code；失败快照证实 canonical response 会重置 activity fold，改用既有 WebSocket gate 显式同步缓存态与 canonical 态
  - `2026-08-15`：canonical 同步后用例继续到 24px fit 检查；确认 `getByText` 命中内联 glyph box 而非 line box，改为测量包含稳定 final answer 的 Markdown workspace surface
  - `2026-08-15`：workspace surface 仅是字体族边界、字号仍由 Markdown body 继承；将 assistant seam 精确到包含 final answer 的 Markdown 段落块，以同时测量继承字号与真实 line box
  - `2026-08-15`：段落块实际只承担盒模型、内联 Text 承担字号；最终将 typography 与 layout oracle 分离，分别测稳定 final Text 和其 Markdown 段落祖先
  - `2026-08-15`：Typography 单文件 4/4 Green；`format:check`、`typecheck` 与 `lint` 全部通过，本地 CI 合同闭环完成
  - `2026-08-15`：提交 `fc9c97515 test: align upstream CI contracts` 推送到 main；精确 CI run `31880050156` 的 18 个 job 全绿，含 Playwright shard 1-4 与 Linux/Windows server jobs

## 6. 验证与完成判断

| 验收项                   | 命令或步骤                                                                                                                                                             | 结果  | 证据                                                |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | --------------------------------------------------- |
| formatter                | `npm run format:check`                                                                                                                                                 | Green | `3838` 个文件格式正确                               |
| Mermaid renderer browser | `npx vitest run --project browser src/components/markdown/renderer.browser.test.tsx --bail=1`                                                                          | Green | `10/10`                                             |
| quota fetcher            | `npx vitest run src/services/quota-fetcher/service.test.ts --bail=1`                                                                                                   | Green | `71/71`                                             |
| Hub resume               | `npx vitest run src/server/session.workspaces.test.ts --bail=1`                                                                                                        | Green | `112 passed / 4 skipped`                            |
| Changes 菜单定位         | `npx playwright test --project=browser e2e/browser/changes-pane.spec.ts -g "changes file actions share an explicit kebab and pointer-anchored context menu"`           | Green | 显式菜单与 context menu 分别关闭，定向命令退出 `0`  |
| Changes tree 图标        | `npx playwright test --project=browser e2e/browser/changes-pane.spec.ts -g "changes diff switches between flat and tree file lists"`                                   | Green | 保留文件图标后的 2 个 SVG oracle 通过               |
| Explorer 菜单关闭        | `npx playwright test --project=browser e2e/browser/file-explorer-context-actions.spec.ts -g "creates, renames, copies, and deletes entries through the file explorer"` | Green | 菜单外右键关闭 passthrough context menu             |
| Typography reload        | `npm run test:e2e -- e2e/browser/appearance-typography.spec.ts`                                                                                                        | Green | 单 worker `4/4`，cached/canonical timeline 门控通过 |
| TypeScript               | `npm run typecheck`                                                                                                                                                    | Green | 退出 `0`                                            |
| lint                     | `npm run lint`                                                                                                                                                         | Green | `3516` 个文件，`0` warnings / `0` errors            |
| 精确 main CI             | GitHub Actions run `31880050156`                                                                                                                                       | Green | SHA `fc9c97515`，18 个 job 全绿                     |

- 未验证项与原因：无；本任务要求的本地与 hosted CI 合同均已验证
- 剩余风险：Nix Update Hash 与 Deploy Website 的既有凭证门禁不属于本任务和 beta 发布合同
- Done Contract 是否由证据满足：`是`

## 7. 恢复与同步

- 状态说明：`已收口 / Review / Completed`
- 当前卡点：无
- 下一步唯一动作：无；由 0071 继续 beta 发布
- Resume / Handoff：本任务完成证据为提交 `fc9c97515` 与 CI run `31880050156`
- Project Sync Candidates：`无；一次性 upstream 合并事实留在任务记录`
- 长期文档同步：`不需要`

### 提交记录

| 提交信息（Commit Message）          | 提交脚注（Commit Footer） | 关联改动或阶段 | 文档同步状态 | 备注                                                |
| ----------------------------------- | ------------------------- | -------------- | ------------ | --------------------------------------------------- |
| `test: align upstream CI contracts` | `N/A`                     | `0072`         | `已同步`     | upstream runtime/formatter 合同与旧测试 oracle 漂移 |
