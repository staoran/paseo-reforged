# 工作区字体与字号任务计划

本文件只保存索引、依赖、负责人、操作性阻塞、当前操作状态和锚点。执行结果、验证证据和下一步只见 `progress.md`。

## Spec 绑定

| 字段                 | 值                                               |
| -------------------- | ------------------------------------------------ |
| task_id              | `0009`                                           |
| 记录根               | `mydocs/tasks/0009_工作区字体与字号/`            |
| 任务索引锚点         | `N/A`                                            |
| 需求、范围与决策权威 | [SPEC.md](./SPEC.md)                             |
| Done Contract 锚点   | [SPEC.md#done-contract](./SPEC.md#done-contract) |

## 当前操作状态

- 当前阶段：`Review`
- 当前责任：补齐三轴 E2E 与 Native 视觉证据
- 最后更新：`2026-07-26`
- 最近 progress 锚点：[progress.md#2026-07-26-实现与验证](./progress.md#2026-07-26-实现与验证)

## 阶段索引

| 阶段     | Spec/progress 锚点                                         | 依赖           | 所有者 | 当前状态    |
| -------- | ---------------------------------------------------------- | -------------- | ------ | ----------- |
| Research | [SPEC.md#facts--constraints](./SPEC.md#facts--constraints) | 无             | Codex  | completed   |
| Plan     | [SPEC.md#proposed-solution](./SPEC.md#proposed-solution)   | Research       | Codex  | completed   |
| Execute  | [progress.md](./progress.md)                               | Plan、用户批准 | Codex  | completed   |
| Review   | [SPEC.md#validation-plan](./SPEC.md#validation-plan)       | Execute        | Codex  | in progress |

## 子任务与依赖

| id  | 完整合同路径                                                                   | 所有者 | 依赖  | 共享资源负责人 | 当前状态    |
| --- | ------------------------------------------------------------------------------ | ------ | ----- | -------------- | ----------- |
| T1  | [SPEC.md#1-settings-and-compatibility](./SPEC.md#1-settings-and-compatibility) | Codex  | 无    | Codex          | completed   |
| T2  | [SPEC.md#2-theme-model](./SPEC.md#2-theme-model)                               | Codex  | T1    | Codex          | completed   |
| T3  | [SPEC.md#4-settings-ui-and-copy](./SPEC.md#4-settings-ui-and-copy)             | Codex  | T2    | Codex          | completed   |
| T4  | [SPEC.md#5-consumer-migration](./SPEC.md#5-consumer-migration)                 | Codex  | T2    | Codex          | completed   |
| T5  | [SPEC.md#validation-plan](./SPEC.md#validation-plan)                           | Codex  | T1-T4 | Codex          | in progress |

## 操作性阻塞引用

| ID      | findings/progress 锚点                                             | 影响阶段/子任务 | 所有者/动作                                 | 当前状态/升级条件                          |
| ------- | ------------------------------------------------------------------ | --------------- | ------------------------------------------- | ------------------------------------------ |
| E2E-WIN | [progress.md#验证](./progress.md#验证)                             | Review / T5     | 在 Linux/CI 运行新增 Playwright spec        | open；出现产品失败时回到对应 consumer 修正 |
| NATIVE  | [findings.md#未验证假设与待查项](./findings.md#未验证假设与待查项) | Review / T5     | iOS/Android 执行 11px/24px 与滚动锚点 smoke | open；出现裁切时修正 workspace line-height |
