# 工作区协作指南

本文件仅用于拥有多个独立子项目的父级目录。它不替代子项目根目录的 `AGENTS.md`。

## 项目 Registry

| project_id | 路径 | 类型 | 角色 | marker | 本地 AGENTS |
| --- | --- | --- | --- | --- | --- |
| `<id>` | `<path>` | `<type>` | Provider/Consumer/Observer/Shared | `<marker>` | `<path>` |

## 工作区配置

- `workspace_docs`：`UNCONFIGURED`；初始化后填写父级任务文档根、证据来源和核验日期。
- `sdd_harness`：全局 `$sdd-riper-one`；父级跨项目任务必须完整加载，缺失时 `stop-and-install`。
- `cross_project_workflow`：`.skills/workflows/cross-project.md`

在 `workspace_docs` 未配置、目标目录不存在或授权范围不明确时，只能调查当前已授权项目并请求补充配置；不得创建父级任务包或修改相邻项目。

开始父级跨项目任务前，先确认当前 runtime 可加载全局 `$sdd-riper-one` 并完整读取其主说明，再读取 `cross_project_workflow`。任一依赖缺失时停止并提示安装或修复；父级文件和 bundled cross workflow 不得充当本地 SDD Harness。

## 默认边界

- 默认 `change_scope=local`，只修改当前被授权的项目。
- 跨项目任务必须明确列出参与项目、Provider/Consumer、契约、执行顺序和验证。
- 父级目录只保存跨项目 registry、契约、任务包和总图；具体实现规则仍在各子项目。

## 跨项目任务目录

`<workspace-docs>/cross_projects/<编号>_<任务标题>/`

编号来源、标题语言和字符清理规则在父级 workspace 配置中声明。目录名不追加项目集合、状态、负责人或日期；这些信息写入父级 Spec 的项目注册表与 task plan/progress。

开始前先读取 `.skills/workflows/cross-project.md`。使用 `.skills/templates/cross-project-spec.md` 建立主控记录；`observe-only` 只保存调查授权、证据和结论；`cross-lite` 至少保存 `SPEC.md`；`cross-full` 再分别使用 `.skills/templates/task-plan.md`、`.skills/templates/findings.md` 和 `.skills/templates/progress.md`，交接时追加 `.skills/templates/handoff.md`。

## 禁止事项

- 不因共享父目录默认修改所有子项目。
- 不将子项目业务实现 spec 写入父级总控目录来替代本地施工 spec。
- 不在没有 Provider/Consumer 契约和授权范围时开始跨项目实现。
