# 更新 Universal Agents Kit Spec

## 状态

`completed`

## 目标

将 Paseo 安装的 Universal Agents Kit 升级到源仓库冻结提交
`10b25cbae3dc83cf39643bd2f66154728866f345`，保留项目事实和工作树中的既有修改，
并完成一次最小 Project Setup 复核。

## 基线

- 目标提交：`679d7131f7afcf4b11fba7a927dd579ac014f83c`
- 已安装 revision：`content-sha256:e3dc4a9c4da5d7a9a9dc0eb2c0d52251dfb2efde1104d97d4c9c0aa395782119`
- 源 runtime hash：`content-sha256:b14275faea99b84bef3a771422992fda5a2085f5ea508fd29aa9a8b67ff9bc18`
- 目标 Kit 路径在执行前无未提交修改；仓库其他未提交修改不属于本任务。
- 执行末尾源仓库新增 source-only 未跟踪任务目录；runtime hash 未变化，因此最终
  revision 按 dirty-source 规则记录 content hash，而不伪称 clean commit。

## 范围

- 替换 21 个未被项目修改的 bundled 文件，保留 29 个未变化 bundled 文件。
- 内容合并 `CLAUDE.md`、`PROJECT_RULES.md` 和 `DEPENDENCY_SKILLS.md`。
- 将三个空 project-owned 文件标题中的 `Bootstrap` 迁移为 `Project Setup`；保持
  `CODEMAP_INDEX.md` 不变。
- 保持 `task_index_mode=disabled`，补齐四个已确认的 `docs/` 入口。
- 验证通过后最后更新 `kit_revision` 与本次命中的 capability evidence。

## 非范围

- 不修改 Universal Agents Kit 源仓库。
- 不扩张 repository package map，不同步尚在活动任务中的 Paseo Reforged 身份迁移。
- 不运行完整测试套件，不重启 daemon，不 stage、commit 或 push。

## Done Contract

1. 21 个 bundled 文件与冻结 loader tree 一致，mixed/project-owned 内容保留 Paseo 事实。
2. Project Setup 状态仍为 initialized，`task_index_mode=disabled`，四个文档入口可解析。
3. Kit 静态检查、目标路径检查、格式检查、typecheck 和 lint 均已运行并记录结果。
4. 只有前三项满足后，`kit_revision` 才更新为冻结 runtime revision；失败时保留旧 revision 并记录恢复入口。

## 批准与回退

- 用户于 `2026-07-22` 明确批准 checkpoint 中的完整更新和 Project Setup 复核。
- scoped preimage 可从目标提交恢复；任何回退只处理本任务路径，不触碰其他工作树修改。
