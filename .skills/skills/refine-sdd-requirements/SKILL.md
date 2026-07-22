---
name: refine-sdd-requirements
description: 为已按通用 operating model 判定为 complex 或 cross，且仍有会改变方案、范围、契约、归属、迁移、失败语义或验收的决策歧义的编码任务加载 SDD-Grill 路由。用户明确要求 grill、挑战设计或完善需求且任务属于 complex/cross 时也使用；zero、micro、standard、可从源码调查的技术事实或已有可验收 spec 不使用。
---

# SDD-Grill 路由加载器

本 Skill 只提供 skills-aware runtime 的加载入口，不定义工作流、字段、状态或检查点。

## 加载顺序

1. 读取 `../../core/operating-model.md`。任务不是 `complex` 或 `cross` 时退出本 Skill，继续该文件判定的原路由。
2. 由已加载的全局 SDD Research 先调查可从源码、配置和测试确认的事实，并将其与决策歧义分开；该调查未完成时不得宣称 Grill 命中。
3. 读取 `../../customizations/sdd-grill-bridge.md`。只有调查后仍存在 bridge 命中的决策歧义时才读取 `../../workflows/grill-me.md`；未命中时返回已加载的全局 SDD Harness。
4. 项目存在对应增量时，最后读取 `../../project/CUSTOM_SKILL_OVERRIDES.md`。

执行、回写和停止点以已加载的全局 SDD Skill 与这些文件为准。本 Skill 不生成独立产物。

## 失败处理

| 触发条件 | 一线处理 | 仍失败时 |
| --- | --- | --- |
| 所选全局 SDD Skill、operating model、bridge 或 Grill workflow 不可用 | 全局依赖按注册表停止；bundled 路径报告损坏，不进入 Grill | 安装或修复并重新核验后恢复 |
| skills-aware runtime 不支持 bundled adapter 自动发现 | 直接读取 `../../core/operating-model.md` 与 `../../customizations/sdd-grill-bridge.md`；只有 bridge 命中时才读取 `../../workflows/grill-me.md` | 这是同一 bundled 规范的入口切换；任一路径缺失时停止并报告规则包损坏 |
| 项目 override 与通用流程冲突 | 按 `AGENTS.md` 优先级引用双方来源 | 无法裁决时不进入 Plan 或 Execute |

## 禁止事项

- 不为 `zero`、`micro` 或 `standard` 任务启动本 Skill；普通澄清不升级为完整 Grill。
- 不把可查技术事实改成用户问答。
- 不在本 Skill 重述 workflow 的步骤、输出表、状态机或 checkpoint。
- 不把 Skill 加载成功当作需求已确认、spec 已批准或验证已完成。
