# 修复 Playwright Shard 1 红项 Micro Spec

## 0. 状态与索引

| 字段               | 值                                                       |
| ------------------ | -------------------------------------------------------- |
| task_id            | `0070`                                                   |
| spec layer         | `Feature Spec`                                           |
| task status        | `执行中`                                                 |
| document status    | `Active`                                                 |
| depth              | `standard`                                               |
| phase              | `Execute`                                                |
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
- 当前任务单元：先建立两个独立 Red 反馈环，再按各自根因做最小修复
- 轻量评估：`升级 standard`
- 已确认事实：CI run `31864025981` / job `94962094953` 报告 appearance 期望源码文本 count 0、实际 3；consecutive-turns 的倒数第二帧未绘制首个 prompt footer 与 working spinner
- 风险与未知：两项可能分别是选择器过宽与帧采样时序假设，也可能暴露真实渲染回归；在 Red 前不选实现方案

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
- 当前进度：CI Red 证据已取得，本地反馈环尚未运行
- 当前动作是否仍服务核心目标：是
- 下一步：整合 main 后安装/核对依赖，分别运行两个 test title/file 的最窄命令
- 风险与回退：不通过扩大 timeout 或弱化可观察行为掩盖失败；探针若需临时日志统一标记并在收尾删除
- 验证方式：两条精确 Playwright 命令、相关受影响测试、typecheck、lint、format、GitHub shard 1
- TDD 判定、测试 seam 与验收行为：`N/A；现有失败 E2E 已是正确 public seam，本轮修复既有 Red，不新增预设测试`
- seam 确认：`N/A；沿用 CI 真实失败 seam`
- Execution Approval / Source：`Approved / User`

## 5. 执行与变更记录

- 实际改动：`待执行`
- 偏差与用户决策：`无`
- Change Log：`2026-08-15 建立独立诊断任务并确认执行授权`

## 6. 验证与完成判断

| 验收项                      | 命令或步骤           | 结果   | 证据 |
| --------------------------- | -------------------- | ------ | ---- |
| appearance Red/Green        | 精确 Playwright test | 待执行 |      |
| consecutive turns Red/Green | 精确 Playwright test | 待执行 |      |
| main CI                     | GitHub Actions       | 待执行 |      |

- 未验证项与原因：尚未执行
- 剩余风险：尚未执行
- Done Contract 是否由证据满足：`否`

## 7. 恢复与同步

- 状态说明：已完成任务登记和执行前检查点
- 当前卡点：无
- 下一步唯一动作：合并 main 后运行两个精确 Playwright Red
- Resume / Handoff：从第 3 节动作 1 继续
- Project Sync Candidates：`无；根因确认后再判断`
- 长期文档同步：`待判断`

### 提交记录

| 提交信息（Commit Message） | 提交脚注（Commit Footer） | 关联改动或阶段 | 文档同步状态 | 备注 |
| -------------------------- | ------------------------- | -------------- | ------------ | ---- |
| `<待提交>`                 | `N/A`                     | `0070`         | `待回写`     |      |
