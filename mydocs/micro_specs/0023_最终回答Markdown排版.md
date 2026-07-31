# 最终回答 Markdown 排版 Micro Spec

## 0. 状态与索引

| 字段               | 值                                                |
| ------------------ | ------------------------------------------------- |
| task_id            | `0023`                                            |
| spec layer         | `Feature Spec`                                    |
| task status        | `待验证`                                          |
| document status    | `Active`                                          |
| depth              | `deep`                                            |
| phase              | `Review`                                          |
| Execution Approval | `Approved`                                        |
| Approval Source    | `User`                                            |
| file path          | `mydocs/micro_specs/0023_最终回答Markdown排版.md` |
| parent spec        | `N/A`                                             |
| superseded by      | `N/A`                                             |
| created / updated  | `2026-07-29 / 2026-07-31 04:41`                   |

## 1. 目标与完成契约

- 当前理解：assistant 最终回答的 Markdown 至少存在粗体不明显、自动换行行距过密和语义字号被压平的问题。
- 核心目标：修复 shared Markdown typography 与 paragraph text path，使最终回答在 Web/Native 都保持真正粗体、舒适行高和正确 heading hierarchy。
- Done Contract：`**strong**` computed weight 为 bold/700；16px prose 行高为 24px (`1.5`)；同一段内自动换行遵循 24px 行高，Markdown 段落/块之间保留独立且更大的间距；11/24 边界字号自动换行不裁切；heading 仍大于正文；inline/fenced code 与 table 不继承 prose spacing；字符间距保持 0；普通超链接和带行号文件链接可见、可点击且保持链接色。

## 2. 范围与事实

- 范围内：Markdown styles、shared renderer paragraph style 传递、三平台 paragraph wrapper、现有 style test/E2E。
- 范围外：全局 workspace typography、Composer/普通控件字距、Markdown parser 替换、新渲染库。
- 当前任务单元：最终回答 Markdown 排版；`parent spec=N/A`。
- 轻量评估：`deep`；根因横跨 style inheritance 与 Web/Android/iOS paragraph layout。
- 已确认链路：assistant final -> `AssistantMessage` -> `MarkdownRenderer` -> `createMarkdownStyles` -> `markdown-text.*`。
- 粗体根因：`markdown-styles.ts:136` 显式把 `strong` 设置为 `theme.fontWeight.medium` (`500`)，parser/rule 本身正常。
- 语义字号根因：通用叶子 `text` 重写 `fontFamily/fontSize`，renderer 按 `[inheritedStyles, styles.text]` 合并，可能把 heading/table 继承值压回 base。
- 行高现状：prose 为 `round(base*1.4)`，16px 得 22px。
- 历史实现线索：`paragraphTextStyle={styles.body}`、Android 单个 Text、iOS 根 UITextView 可解决 wrap/clipping；原记录引用的提交 `8cc5b15be` 不存在于当前对象库，只作为实现提示，不作为验证证据。
- 已选方案：strong 改 bold；prose 行高改 `1.5`；通用 `text` 不覆盖语义 family/size；恢复最小 paragraph text style path；含图片段落继续 View fallback。
- 字距决定：`letterSpacing` 保持 `0`，不向跨平台 Markdown 引入正字距；可读性由真实 bold、行高和段落间距改善，code/table 显式保持 0。
- 风险与未知：自定义 workspace 字体若没有 bold face，computed 700 仍可能视觉较弱；先用系统字体验收。

## 3. 涉及文件与计划

| 文件                                                                    | 计划变化                                        | 事实源                 |
| ----------------------------------------------------------------------- | ----------------------------------------------- | ---------------------- |
| `packages/app/src/styles/markdown-styles.ts`、`markdown-styles.test.ts` | bold、1.5 行高、继承和 spacing reset            | 当前直接根因           |
| `packages/app/src/components/markdown-text.web.tsx`                     | paragraph text style prop parity                | 平台接口               |
| `packages/app/src/components/markdown-text.android.tsx`                 | text-only paragraph 单 Text，图片保留 View      | 当前平台组件           |
| `packages/app/src/components/markdown-text.ios.tsx`                     | body text style 进入根 UITextView               | 当前平台组件           |
| `packages/app/src/components/markdown/renderer.tsx`                     | shared paragraph 传 `styles.body`               | 当前 shared renderer   |
| `packages/app/src/components/message.tsx`                               | assistant paragraph 传 `styles.body`            | assistant custom rules |
| `packages/app/e2e/appearance-typography.spec.ts`                        | rich Markdown weight/line-height/hierarchy/wrap | 现有 appearance E2E    |

1. 扩展 style test 与 rich Markdown fixture，让 bold/line-height/paragraph spacing/hierarchy/link RED。
2. 先修 styles，再恢复最小 paragraph text style 传递。
3. 验证 Web/Electron 390px、Android/iOS text-only 与 image paragraph、11/24 字号。
4. 运行目标测试、typecheck、lint、格式与 diff check。

## 4. 执行前检查点

- 当前目标：修复最终回答的真实排版根因，而不是给单个 callsite 加局部补丁。
- 当前进度：实现、样式 RED/GREEN、Web rich Markdown E2E、截图与静态检查完成。
- 下一步：在 Android/iOS 真机或模拟器完成 text-only 与 image paragraph smoke。
- 风险与回退：若 Native 单 Text 回归图片/选择，保持 image View fallback；失败则回到平台 wrapper 计划审查。
- 验证方式：style unit、rich Markdown E2E、Android/iOS smoke。
- TDD 判定、测试 seam 与验收行为：`TDD；真实 assistant rich Markdown 的 weight/line-height/paragraph spacing/hierarchy/inline code/link。`
- seam 确认：`User`。
- Execution Approval / Source：`Approved / User`。

## 5. 执行与变更记录

- 实际改动：正文行高改为 `1.5`，`strong` 改为 bold，正文/代码/表格字距显式为 0，叶子 `text` 不再覆盖语义字号；shared/assistant renderer 将 `styles.body` 传入段落；Android 纯文字段落使用单 `Text`、iOS 根 `UITextView` 合并正文样式，含图片段落继续使用 `View`；新增真实 final-answer rich Markdown E2E。
- 偏差与用户决策：本任务独立于 Interface 字号任务 `0022`；使用 workspace typography，不设父子关系。带行号文件链接只验证现有渲染样式，不修改任务 `0025` 所属解析逻辑。
- Change Log：`2026-07-29` 完成只读调查并建档；`2026-07-30` 用户提供参考截图并授权执行，确认 rich Markdown seam；`2026-07-31` 完成实现、Web 截图与验证，转 Review 等待 Native smoke。

## 6. 验证与完成判断

| 验收项           | 命令或步骤                                                                    | 结果      | 证据                                                          |
| ---------------- | ----------------------------------------------------------------------------- | --------- | ------------------------------------------------------------- |
| style RED/GREEN  | `rtk npx vitest run packages/app/src/styles/markdown-styles.test.ts --bail=1` | PASS，5/5 | 覆盖 1.5 行高、bold、继承与 spacing。                         |
| parser/rule 路径 | 追踪 strong token 到自定义 renderer                                           | PASS      | parser 未丢 strong；修改前根因定位到 style 500。              |
| rich Markdown UI | `playwright ... --grep "renders final answer Markdown"`                       | PASS      | 960x900：wrap/block rhythm、粗体、code、两类链接及 overflow。 |
| typecheck        | `rtk npm run typecheck`                                                       | PASS      | 根级类型检查通过。                                            |
| targeted lint    | `rtk npm run lint -- <0023 files>`                                            | PASS      | 0 warnings / 0 errors。                                       |
| full lint        | `rtk npm run lint`                                                            | BLOCKED   | 无关 `sidebar-workspace-list.test.tsx` 既有 5 errors。        |
| format           | `rtk npm run format:check:files -- <0023 files>`                              | PASS      | 9 个目标文件格式正确。                                        |
| Native smoke     | Android/iOS                                                                   | PENDING   | 当前 Windows 环境未运行。                                     |

- 未验证项与原因：Android/iOS text-only 与 image paragraph 需真机或模拟器 smoke；当前 Windows 环境未运行。
- 剩余风险：自定义字体缺少 bold face 时视觉可能弱于系统字体；Native 测量仍待 smoke。
- Done Contract 是否由证据满足：`Web 已满足；全平台合同待 Native smoke。`

## 7. 恢复与同步

- 状态说明：`待验证 / Review`。
- 当前卡点：`Android/iOS smoke 未执行`。
- 下一步唯一动作：在 Native 运行 rich Markdown fixture，确认纯文字/含图片段落无裁切或选择回归。
- Resume / Handoff：先回读第 6 节验证证据，再执行 Android/iOS smoke。
- Project Sync Candidates：`无`。
- 长期文档同步：`N/A`。

### 提交记录

| 提交信息（Commit Message）                           | 提交脚注（Commit Footer） | 关联改动或阶段  | 文档同步状态 | 备注              |
| ---------------------------------------------------- | ------------------------- | --------------- | ------------ | ----------------- |
| `fix(app): improve final answer markdown typography` | `N/A`                     | `0023 / Review` | `N/A`        | 用户已授权 commit |
