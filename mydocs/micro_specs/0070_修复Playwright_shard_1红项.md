# 修复 Playwright Shard 1 红项 Micro Spec

## 0. 状态与索引

| 字段               | 值                                                       |
| ------------------ | -------------------------------------------------------- |
| task_id            | `0070`                                                   |
| spec layer         | `Feature Spec`                                           |
| task status        | `已收口`                                                 |
| document status    | `Completed`                                              |
| depth              | `standard`                                               |
| phase              | `Review`                                                 |
| Execution Approval | `Approved`                                               |
| Approval Source    | `User；2026-08-15 当前消息明确要求单独修复 shard 1 红项` |
| file path          | `mydocs/micro_specs/0070_修复Playwright_shard_1红项.md`  |
| parent spec        | `N/A`                                                    |
| superseded by      | `N/A`                                                    |
| created / updated  | `2026-08-15`                                             |

## 1. 目标与完成契约

- 当前理解：当前远端 `main` 唯一 CI 红项是 Playwright shard 1；失败集中在 `agent-consecutive-turns.spec.ts:795` 与 `appearance-reasoning.spec.ts:80`，且父提交已有同样失败
- 核心目标：单独定位并修复这两个现有失败，不把 Android cache 或 upstream merge 的行为变化混入修复
- Done Contract：两个精确失败能在最窄本地命令中 Red；根因由可证伪探针确认；最小修复后原始两个测试稳定 Green；目标回归、typecheck、lint、format 通过；精确 main 的 shard 1 与全 CI 变绿

## 2. 范围与事实

- 范围内：两个失败 E2E、其直接 helper/产品 seam、必要的最小回归断言、本任务记录
- 范围外：其他 shard、Android workflow、无关 UI 重构、测试超时的全局放宽
- 当前任务单元：两个独立 Red/Green、静态门禁与精确 main hosted CI 均已完成
- 轻量评估：`升级 standard`
- 已确认事实：CI run `31864025981` / job `94962094953` 报告 appearance 期望源码文本 count 0、实际 3；consecutive-turns 的倒数第二帧未绘制首个 prompt footer 与 working spinner
- 风险与未知：两项可能分别是选择器过宽与帧采样时序假设，也可能暴露真实渲染回归；在 Red 前不选实现方案
- appearance 排序假设：`H1` 折叠工具保留隐藏 DOM、count 断言错误；`H2` reasoning setting 错误展开普通 Read；`H3` reload 后 retained view 留下隐藏副本；`H4` timeline hydration 在 active stream 重复 Read 内容。分别由匹配元素可见性/折叠祖先、Read expanded 状态、所属 panel 与 badge 数量证伪
- appearance 根因：可见性探针确认普通 Read 源码详情真实可见；`autoExpandReasoning=true` 按已批准行为同时展开 thinking 与普通工具详情，末尾 `count=0` 合同已过时。Playwright 官方文档确认多匹配 locator 的单元素操作为 strict，表达“至少一个可见匹配”应对可见集合取 `.first()` 后使用 `toBeVisible()`
- consecutive-turns 排序假设：`H1` oracle 把首次 prompt 原子转场扩展到后续流式内容；`H2` 产品遗漏 near-bottom 自动滚动；`H3` authoritative hydration 改变 prompt/附件几何；`H4` CSS 可见性探针误判。frame record 排除 `H3/H4`，原始 PR 意图与受控 timeline probe 确认 `H1`
- consecutive-turns 根因：frame `38-40` footer/spinner 已绘制；frame `41` assistant block 从 `264px` 增到 `286px`，footer 被推到滚动视口外，而 prompt 与附件 rect 保持不变。测试目标是 hydration 期间 prompt 不跳动，不应混入无关 assistant token 增长

## 3. 涉及文件与计划

| 文件                                                                   | 计划变化                                        | 事实源                       |
| ---------------------------------------------------------------------- | ----------------------------------------------- | ---------------------------- |
| `packages/app/e2e/browser/appearance-reasoning.spec.ts` 及直接 seam    | 复现 count 3，确认是否为选择器/fixture/产品泄漏 | CI 失败日志与定向 Playwright |
| `packages/app/e2e/browser/agent-consecutive-turns.spec.ts` 及直接 seam | 复现 frame 绘制失败并固定实际状态序列           | CI 失败日志与定向 Playwright |
| `mydocs/todolist.md`、本 micro-spec                                    | 记录假设、探针、根因和验证                      | 项目任务记录规则             |

1. 运行两个精确测试并最小化到可重复 Red
2. 列出 3-5 个排序且可证伪的假设，用单变量探针确认根因
3. 实施最小修复并重跑原始反馈环、相关回归和静态门禁

## 4. 执行前检查点

- 当前目标：消除当前 main shard 1 的两个真实失败
- 当前进度：实现、独立提交、推送与精确 main hosted CI 均已完成
- 当前动作是否仍服务核心目标：是
- 下一步：无；0070 已完成 Review
- 风险与回退：不通过扩大 timeout 或弱化可观察行为掩盖失败；探针若需临时日志统一标记并在收尾删除
- 验证方式：两条精确 Playwright 命令、相关受影响测试、typecheck、lint、format、GitHub shard 1
- TDD 判定、测试 seam 与验收行为：`N/A；现有失败 E2E 已是正确 public seam，本轮修复既有 Red，不新增预设测试`
- seam 确认：`N/A；沿用 CI 真实失败 seam`
- Execution Approval / Source：`Approved / User`

## 5. 执行与变更记录

- 实际改动：appearance 测试改为验证 activity 展开后至少一个普通工具源码详情可见，并使测试名匹配真实合同；first-prompt 测试在 hydration 采样窗口内用既有 WebSocket gate 暂停 live `agent_stream`，截获 authoritative timeline response 并裁到最后一个 `user_message` 后释放，保留 prompt、附件、footer、spinner、composer、tab 与 interrupt 的原子转场断言
- 偏差与用户决策：`无`
- Change Log：
  - `2026-08-15`：建立独立诊断任务并确认执行授权
  - `2026-08-15`：按 CI 前置步骤构建 app/server 后，本地复现 appearance 精确 Red；匹配数量在 CI/本地为 `1-3`，可见性探针确认是展开的真实普通工具详情
  - `2026-08-15`：本地复现 consecutive-turns 精确 Red；仅抑制 `assistant_message` 的首轮方案仍被 reasoning/commentary 输出证伪，改为受控 canonical hydration 后原 oracle 连续 Green
  - `2026-08-15`：提交 `e1827453f test: stabilize Playwright shard 1` 推送到 main；精确 CI run `31880050156` 的 Playwright shard 1-4 与全部 18 个 job 全绿

## 6. 验证与完成判断

| 验收项                      | 命令或步骤                                                                                                                                                                                                                                            | 结果 | 证据                                                                               |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ---------------------------------------------------------------------------------- |
| appearance Red/Green        | `npm run test:e2e --workspace=@getpaseo/app -- e2e/browser/appearance-reasoning.spec.ts --grep "keeps activity folding" --workers=1 --reporter=line`                                                                                                  | 通过 | 原合同 Red；修正后 `1 passed (3.2m)`                                               |
| consecutive turns Red/Green | `$env:PASEO_NODE_INSPECT='0'; npm run test:e2e --workspace=@getpaseo/app -- e2e/browser/agent-consecutive-turns.spec.ts --grep "keeps the first prompt" --workers=1 --repeat-each=2 --reporter=line`                                                  | 通过 | 原夹具 frame `41/42` 与 `49-53` Red；受控 canonical hydration 后 `2 passed (2.9m)` |
| 两项合并回归                | `$env:PASEO_NODE_INSPECT='0'; npm run test:e2e --workspace=@getpaseo/app -- e2e/browser/appearance-reasoning.spec.ts e2e/browser/agent-consecutive-turns.spec.ts --grep "keeps activity folding\|keeps the first prompt" --workers=1 --reporter=line` | 通过 | `2 passed (3.1m)`；同一 worker daemon 正常回收                                     |
| 定向 workflow 合同          | `node --test --test-name-pattern="Android APK build observability" scripts/ci-workflow.test.mjs`                                                                                                                                                      | 通过 | `1/1`；cache key 与 Android 构建合同保持 Green                                     |
| 格式与 diff 检查            | `npm run format:files -- <0070 spec> <两个 E2E 文件>`；`git diff --check`                                                                                                                                                                             | 通过 | 仅目标文件；无格式或空白错误                                                       |
| TypeScript                  | `npm run typecheck`                                                                                                                                                                                                                                   | 通过 | 全 workspace 退出码 `0`，耗时 `65.7s`                                              |
| lint                        | `npm run lint`                                                                                                                                                                                                                                        | 通过 | `0 errors / 0 warnings`，扫描 `3516` 个文件                                        |
| main CI                     | GitHub Actions run `31880050156`                                                                                                                                                                                                                      | 通过 | SHA `fc9c97515`，Playwright shard 1-4 与全部 18 个 job 全绿                        |

- 未验证项与原因：无；本任务要求的本地与 hosted seam 均已验证
- 剩余风险：上游当前 main 保留同一过宽夹具，未来同步可能重新引入；本任务不修改上游仓库
- Done Contract 是否由证据满足：`是`

## 7. 恢复与同步

- 状态说明：`已收口 / Review / Completed`
- 当前卡点：无
- 下一步唯一动作：无；由 0071 继续 beta 发布
- Resume / Handoff：本任务完成证据为提交 `e1827453f` 与 CI run `31880050156`
- Project Sync Candidates：`无；本次为既有 E2E 合同修复`
- 长期文档同步：`不需要`

### 提交记录

| 提交信息（Commit Message）           | 提交脚注（Commit Footer） | 关联改动或阶段 | 文档同步状态 | 备注        |
| ------------------------------------ | ------------------------- | -------------- | ------------ | ----------- |
| `test: stabilize Playwright shard 1` | `N/A`                     | `0070`         | `已同步`     | `e1827453f` |
