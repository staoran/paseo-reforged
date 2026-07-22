---
name: manage-project-customizations
description: 管理项目级自定义内容的 skills-aware 加载入口。用户要求新增、迁移或调整项目私有 Skill、项目规则与语言/命名/文档布局、必需外部依赖与缺失动作、Skill override、稳定项目知识、关键逻辑上下文或 Codemap 索引时使用；Initial Project Setup 仍使用 Project Setup 流程，一次性任务事实或未验证猜测不使用。
---

# 项目自定义规范加载器

本 Skill 只为 skills-aware runtime 加载规则包内既有规范，不另行定义流程、状态、检查点或文件职责。

## 加载顺序

1. 读取 `../../core/operating-model.md` 与 `../../core/skill-coordination.md`，确认所选全局 SDD Skill 已加载，以及当前任务深度和批准状态。
2. 读取 `../../workflows/project-customization.md`，选择一个或多个 mode。
3. 按该 workflow 的路由只读取当前 mode 对应的分流规范，不全量加载目录。
4. 读取 `../../project/PROJECT_RULES.md`、技能注册表和目标权威文件；存在相关项目增量时再读取 `../../project/CUSTOM_SKILL_OVERRIDES.md`。
5. 写入、验证和 Reverse Sync 只按已加载 workflow 执行，本 Skill 不生成独立产物。

## 失败处理

| 触发条件 | 一线处理 | 仍失败时 |
| --- | --- | --- |
| 所选全局 SDD Skill、运行模型、技能协调或项目自定义 workflow 不可用 | 全局依赖按注册表停止；bundled 路径报告损坏，不写项目配置 | 安装或修复并重新核验后恢复 |
| mode 无法唯一判定 | 列出候选 mode、目标文件和内容差异 | 等待用户确认，不把内容同时写入多个长期文件 |
| skills-aware runtime 不支持 bundled adapter 自动发现 | 直接读取 INDEX、workflow 和对应分流规范 | 这是同一 bundled 规范的入口切换；若 workflow 缺失则停止并修复规则包 |
| 项目 override 与通用流程冲突 | 按 `AGENTS.md` 优先级引用双方来源 | 无法裁决时不进入写入 checkpoint |

## 禁止事项

- 不用本 Skill 替代 Initial Project Setup；项目仍为 `project-setup-required` 时先完成所需 Project Setup。
- 不把一次性任务记录、未验证猜测或敏感原文提升为项目长期自定义。
- 不递归加载全部项目 Skill，也不把 adapter 加载成功当作目标内容已获批准或验证通过。
- 不在本 Skill 复制分流 workflow、项目模板或外部 Skill 全文。
