# 项目私有技能目录

本目录用于目标项目稳定、可复用且有明确触发边界的私有技能。运行时只通过 `.skills/project/DEPENDENCY_SKILLS.md` 或项目登记的等价唯一注册表发现技能，不递归加载整个目录。

## 目录约定

```text
project-skills/
├── README.md
├── _template/
│   └── SKILL.template.md
└── <skill-name>/
    └── SKILL.md
```

`_template/SKILL.template.md` 故意不使用 `SKILL.md` 文件名，避免被运行时发现为真实技能。由 Agent 创建或修改 Skill 时，使用 `.skills/workflows/project-customization.md` 的 `project-skill` mode；skills-aware runtime 可调用 `$manage-project-customizations`。先检查长期复用价值、名称/capability 冲突、触发/不触发样例和 invocation，获批后再初始化、登记、验证和 Reverse Sync。

创建或修改项目 Skill 必须使用已登记的 `$skill-creator`、`$writing-great-skills` 与 `$darwin-skill`；任一缺失时停止并提示安装，不以本模板或本地摘要替代。三者分别负责初始化/基础校验、可预测性/裁剪、九维对照实测/棘轮。本模板只提供项目 schema 参考，生成内容必须重写 `name`、`description`、触发/不触发条件、输入、工作流、输出、验证、失败处理和反模式，并在 `DEPENDENCY_SKILLS.md` 登记 invocation、路径、test-prompts、测试模式、judge evidence 与 missing action。`project-skill` workflow 负责创建事务和 invocation 决策；模板的“生成约束”负责 frontmatter schema 与 runtime 映射。

## 边界

- 可以记录稳定的项目工作流、架构模式、生成协议和工具接入事实。
- 一次性任务事实进入 spec/findings，不进入技能。
- 密钥、个人数据、生产连接串和未脱敏内部信息不得进入技能。
- 项目增量调整进入 `CUSTOM_SKILL_OVERRIDES.md`，不要复制外部技能全文。
- 普通项目 Skill 只通过 `DEPENDENCY_SKILLS.md` 路由；只有每个工程任务都必须读取的 always-on 安全或路由能力，才在根 `AGENTS.md` 加最小入口。
