# 导入会话真实标题传递任务计划

本文件只保存任务索引、依赖、操作性阻塞和当前状态。完整合同见 `SPEC.md`，调查证据见 `findings.md`，实际动作与验证见 `progress.md`。

## Spec 绑定

| 字段                 | 值                                                           |
| -------------------- | ------------------------------------------------------------ |
| task_id              | `0005`                                                       |
| 记录根               | `mydocs/tasks/0005_导入会话标题传递/`                        |
| 任务索引锚点         | `N/A`                                                        |
| 需求、范围与决策权威 | `SPEC.md#导入会话真实标题传递-feature-spec`                  |
| Done Contract 锚点   | `SPEC.md#done-contract`                                      |
| Parent Spec          | `../0002_fork改进与主线覆盖总控/SPEC.md#12-子-spec-抽取合同` |

## 当前操作状态

- 当前阶段：`Review / closed`
- 当前责任：无；等待用户决定是否提交、同步 upstream 或创建 PR
- 执行状态：`COMPLETED`
- 最后更新：`2026-07-24`
- 最近 progress 锚点：`progress.md#2026-07-24-t4-与-review-收口`

## 阶段索引

| 阶段     | Spec/progress 锚点                                           | 依赖                         | 所有者           | 当前状态          |
| -------- | ------------------------------------------------------------ | ---------------------------- | ---------------- | ----------------- |
| Research | `findings.md#调查事实与来源`                                 | 当前源码、父 M-21、fork 证据 | Codex            | completed         |
| Plan     | `SPEC.md#方案与文件影响`、`SPEC.md#实施顺序与原子-checklist` | Research 完成                | Codex / 用户审批 | completed         |
| Execute  | `SPEC.md#实施顺序与原子-checklist`                           | 精确 `Plan Approved`         | Codex            | completed / T1-T4 |
| Review   | `SPEC.md#review-verdict`                                     | Execute 完成                 | Codex            | completed / PASS  |

## 子任务与依赖

| id  | 完整合同路径                                                                        | 所有者 | 依赖                             | 共享资源负责人                   | 当前状态  |
| --- | ----------------------------------------------------------------------------------- | ------ | -------------------------------- | -------------------------------- | --------- |
| T1  | `SPEC.md#字段签名`：Protocol/client optional field、capability schema 与 wire tests | Codex  | `Plan Approved`                  | protocol/client owner 顺序       | completed |
| T2  | `SPEC.md#三态语义`：server normalization、provisioning、agent title 与 tests        | Codex  | T1 通过定向测试和 `build:client` | server import/provisioning owner | completed |
| T3  | `SPEC.md#版本兼容矩阵`：App gate、真实 title 传参、sidebar label 与 tests           | Codex  | T1；capability key 固定          | App import/sidebar owner         | completed |
| T4  | `SPEC.md#验收与验证计划`：构建、静态门禁、范围检查与父 Spec 反向同步                | Codex  | T2、T3                           | task `0005` progress             | completed |

## 操作性阻塞引用

| ID  | findings/progress 锚点           | 影响阶段/子任务               | 所有者/动作                              | 当前状态/升级条件                             |
| --- | -------------------------------- | ----------------------------- | ---------------------------------------- | --------------------------------------------- |
| G1  | `SPEC.md#checkpoint`             | Execute / T1-T4               | 用户回复精确字样 `Plan Approved`         | resolved；`2026-07-24` 已批准                 |
| G2  | `findings.md#未验证假设与待查项` | 不阻塞 M-21；可能影响现场解释 | 用户或后续独立调查读取 Title/Branch 设置 | non-blocking；普通新建 UI 复现成立时另建 Spec |
