# 工作区字体与字号进度

执行、验证与实际收口时间线唯一来源。当前状态读 `task_plan.md`；合同读 `SPEC.md`；调查读 `findings.md`。

## 任务绑定

| 字段     | 锚点                           |
| -------- | ------------------------------ |
| task_id  | `0009`                         |
| 任务合同 | [SPEC.md](./SPEC.md)           |
| 当前状态 | [task_plan.md](./task_plan.md) |
| 调查记录 | [findings.md](./findings.md)   |

## 实现说明

| 时间/阶段          | Spec 锚点                                          | 类别     | 说明、原因与影响/待确认                                                                     |
| ------------------ | -------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------- |
| 2026-07-26 Execute | [SPEC.md#reuse-contract](./SPEC.md#reuse-contract) | 设计决策 | 保持 Spec 已批准的复用合同；不新增 settings store、theme effect 或 workspace 专用渲染框架。 |
| 2026-07-26 Review  | [SPEC.md#reuse-contract](./SPEC.md#reuse-contract) | 范围修正 | 保留 `useSettings()` 显式 App 字段白名单；仅提取新增两字段满足复杂度规则，不透传未知字段。  |

## 2026-07-26 执行准备

- 动作/实际变更：记录用户执行批准；经额外 checkpoint 在依赖注册表登记 `$karpathy-guidelines` 与 `$tdd`。
- 结果/验证表锚点：见下方“验证”。
- 失败/阻塞：`.skills/` 被仓库格式脚本忽略；改用字段、route 与安装路径定向检查，当前无阻塞。
- 残余风险/下一步：从 settings storage 的相邻行为 seam 开始逐个 red/green slice。

## 2026-07-26 实现与验证

- 动作/实际变更：新增 `workspaceFontFamily` / `workspaceFontSize` 的兼容持久化、独立 theme token、外观设置行、八种 locale、Web `data-pworkspace` marker、Native workspace 样式和 consumer 迁移；字体变化沿用现有 appearance effect 清理 Markdown 高度缓存；新增单文件 Playwright 场景。
- 结果/验证表锚点：见下方“验证”。
- 失败/阻塞：根 lint 首轮发现聚合函数复杂度 22，已仅提取新增两项 workspace 字段筛选并复跑通过。Windows Playwright harness 未能启动完整 E2E 环境，详见验证表。
- 残余风险/下一步：在 Linux/CI 运行新增 E2E，并在 iOS/Android 对 11px/24px、长消息滚动锚点和无裁切做 smoke。

## 验证

| 验收项                    | 命令/步骤                                                                                       | 结果     | 证据或未执行原因                                                                          | findings 锚点             |
| ------------------------- | ----------------------------------------------------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------- | ------------------------- |
| 依赖能力登记              | route、注册表、Skill 主文件及命中/缺失场景干跑                                                  | 通过     | 本任务命中时加载两 Skill；假设缺失时按 `stop-and-install` 停止，不使用本地替代            | N/A                       |
| Settings 持久化           | `npx vitest run packages/app/src/hooks/use-settings/storage.test.ts --bail=1`                   | 通过     | 36/36；覆盖旧值初始化、独立保存、默认与 clamp                                             | N/A                       |
| Theme patch               | `npx vitest run packages/app/src/screens/settings/appearance/apply-appearance.test.ts --bail=1` | 通过     | 12/12；覆盖三轴独立和重复 patch 不累乘                                                    | N/A                       |
| Markdown typography       | `npx vitest run packages/app/src/styles/markdown-styles.test.ts --bail=1`                       | 通过     | 4/4；prose 使用 workspace，code 保持 mono                                                 | N/A                       |
| 高度缓存失效              | `npx vitest run packages/app/src/utils/assistant-message-height-estimate.test.ts --bail=1`      | 通过     | 3/3；appearance 变化后旧 Markdown 测量不可复用                                            | [findings](./findings.md) |
| Locale parity             | `npx vitest run packages/app/src/i18n/resources.test.ts --bail=1`                               | 通过     | 32/32；八种 locale key 对齐                                                               | N/A                       |
| Typecheck                 | `npm run typecheck`                                                                             | 通过     | 根级检查通过                                                                              | N/A                       |
| Lint                      | `npm run lint`                                                                                  | 通过     | 修正白名单函数复杂度后 `0 warnings / 0 errors`                                            | N/A                       |
| 本任务格式                | `npm run format:files -- <task files>` 与定向 check                                             | 通过     | 代码、测试、文档均按仓库 formatter 处理                                                   | N/A                       |
| 全仓格式基线              | `npm run format:check`                                                                          | 未通过   | 报告约 2870 个既有文件；未做全仓写入式格式化，避免覆盖并行修改                            | N/A                       |
| Playwright test discovery | 新增 spec 的 `--list`                                                                           | 通过     | 发现 1 个测试                                                                             | N/A                       |
| Playwright runtime        | 只运行 `appearance-typography.spec.ts`                                                          | 环境阻塞 | Windows 参数引用、POSIX `which tsx` / `spawn("npx")` 与 `dev-daemon.sh` 阻止 harness 启动 | [findings](./findings.md) |
| 临时进程清理              | 检查 PID 676 与端口 6768                                                                        | 通过     | PID 676 已退出，6768 未监听；6767 主 daemon 未操作                                        | N/A                       |
| iOS/Android 视觉 smoke    | 11px/24px、Markdown/Composer/code、长列表锚点                                                   | 未运行   | 当前无可用目标端运行环境                                                                  | [findings](./findings.md) |

## 收口与同步

| 收口项            | 结果/证据                                                                    |
| ----------------- | ---------------------------------------------------------------------------- |
| 任务索引同步      | `N/A`（项目禁用任务索引）                                                    |
| Project Sync Scan | 三轴语义与运行时规则已同步 `docs/design.md`、`docs/unistyles.md`             |
| 能力登记同步      | `$karpathy-guidelines`、`$tdd` 已同步 `.skills/project/DEPENDENCY_SKILLS.md` |
| 提交关联          | `N/A`（未 stage、commit 或 push）                                            |
