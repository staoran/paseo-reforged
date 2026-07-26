# New Workspace 页导入会话入口任务计划

## Spec 绑定

| 字段           | 值                                                                      |
| -------------- | ----------------------------------------------------------------------- |
| task_id        | `0008`                                                                  |
| 需求与决策权威 | `SPEC.md#new-workspace-页导入会话入口-feature-spec`                     |
| Done Contract  | `SPEC.md#done-contract`                                                 |
| Parent Spec    | [0002/M-22](../0002_fork改进与主线覆盖总控/SPEC.md#12-子-spec-抽取合同) |

## 当前状态

- 阶段：`Review Complete / READY TO COMMIT`
- 执行门：`OPEN`
- 所需授权：已于 `2026-07-25` 收到精确 `Plan Approved`；`2026-07-26` 完成 P1 修复与 staged review，用户随后明确延后 Linux E2E
- 最近进度：`progress.md#2026-07-26-windows-主场景提交裁决`

## Checklist

- [x] 核对 New Workspace route、选中 project、source directory、Host 和 client context。
- [x] 核对三种现有导入入口的 cwd、workspace target 和导航差异。
- [x] 核对当前 project 会话列表的 provider/server 双层 cwd 筛选。
- [x] 核对 untargeted import 的 fresh workspace 与 active project root 复用规则。
- [x] 区分 `0005/M-21` 可复用标题链路与 M-22 必须新增的 App 入口。
- [x] 把父 `0002/M-22` 从组合回归改为页面入口缺口。
- [x] T1：新增 colocated import entry，并接入 New Workspace 当前 context 与成功导航。
- [x] T2：新增 entry 定向测试并复跑既有 sheet/provisioning 回归。
- [x] T3：运行 typecheck、lint、格式、diff 和 desktop/compact smoke。
- [x] T4：完成 Review，回写实际偏差、验证和父表状态。
- [x] T5：修复 Host cache identity、回调失败可见性和验证文档漂移，重新完成 Review。
- [x] T6：让 `onImported` 等待异步 Home 完成回调，完成 failure UI 回归、静态检查与 staged review；Linux E2E 经用户明确延后，不作为当前 Windows 主场景提交门禁。

## 依赖与顺序

| 任务 | 依赖                                             | 完成证据                                                               |
| ---- | ------------------------------------------------ | ---------------------------------------------------------------------- |
| T1   | 用户 `Plan Approved`；当前 `084dca00b` M-21 提交 | `PASS`：页面打开 current-project sheet；未传 `workspaceId`             |
| T2   | T1                                               | `PASS`：entry `3/3`、sheet `19/19`、provisioning `32/32`               |
| T3   | T2                                               | `PASS`：typecheck/lint/format/diff 与两个 viewport smoke               |
| T4   | T1-T3                                            | `PASS`：Spec/progress/父表已同步；Windows E2E 限制已明确记录           |
| T5   | 最终 diff 审查                                   | `PASS`：两条新增回归先 RED 后 GREEN；定向测试合计 `54/54`              |
| T6   | P1 异步 Home completion                          | `PASS`：定向回归 `96/96`、static 与 staged review PASS；Linux E2E 延后 |

## 执行约束

- T1-T5 已获用户明确授权；只允许修改批准的 App 入口、定向测试和任务记录。
- server、protocol、persistence 和 routing 默认零改动；正常 exact-root 行为不成立时停止并重新审批。
- 不改变 Home 或 Workspace import 入口，不建立共享导入策略抽象。
- 不运行全量测试，不触碰主 daemon `6767`，不 commit 或 push。
