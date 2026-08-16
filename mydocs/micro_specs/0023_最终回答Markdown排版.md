# 最终回答 Markdown 排版 Micro Spec

## 0. 状态与索引

| 字段               | 值                                                |
| ------------------ | ------------------------------------------------- |
| task_id            | `0023`                                            |
| spec layer         | `Feature Spec`                                    |
| task status        | `已收口`                                          |
| document status    | `Completed`                                       |
| depth              | `deep`                                            |
| phase              | `Review`                                          |
| Execution Approval | `Approved`                                        |
| Approval Source    | `User`                                            |
| file path          | `mydocs/micro_specs/0023_最终回答Markdown排版.md` |
| parent spec        | `N/A`                                             |
| superseded by      | `N/A`                                             |
| created / updated  | `2026-07-29 / 2026-08-16 13:16`                   |

## 1. 目标与完成契约

- 当前理解：assistant 最终回答的普通段落、完成时间和文件链接行号已完成 Web 验证；用户进一步指出无序列表的相邻条目仍过密，需要增加列表项之间的纵向间距。
- 核心目标：保持普通正文 22px 行高和已收紧的段落节奏，仅增加 Markdown 有序/无序列表的条目间距，让密集流程清单更易扫描。
- Done Contract：`**strong**` computed weight 为 bold/700；16px prose 行高为 22px (`1.4`)；同一段及单个列表项内部自动换行遵循 22px 行高，相邻列表项基线额外增加 8px 间距；跨 Markdown 段落的基线增量大于 22px 且不超过 40px；11/24 边界字号自动换行不裁切；heading 仍大于正文；inline/fenced code 与 table 不继承 prose spacing；字符间距保持 0；带单行/行范围目标的文件超链接在原标签未呈现行号时追加 `(line N)` / `(lines N-M)`，同时保持原 `href` 与点击定位；回复底部同时常显耗时和本地化完成时间。

## 2. 范围与事实

- 范围内：Markdown styles、assistant block spacing、shared renderer paragraph style 传递、三平台 paragraph wrapper、assistant 文件链接可见标签、turn footer 元信息、现有 style test/E2E。
- 范围外：全局 workspace typography、Composer/普通控件字距、Markdown parser 替换、新渲染库。
- 当前任务单元：最终回答 Markdown 排版；`parent spec=N/A`。
- 轻量评估：`deep`；根因横跨 style inheritance 与 Web/Android/iOS paragraph layout。
- 已确认链路：assistant final -> `AssistantMessage` -> `MarkdownRenderer` -> `createMarkdownStyles` -> `markdown-text.*`。
- 粗体根因：`markdown-styles.ts:136` 显式把 `strong` 设置为 `theme.fontWeight.medium` (`500`)，parser/rule 本身正常。
- 语义字号根因：通用叶子 `text` 重写 `fontFamily/fontSize`，renderer 按 `[inheritedStyles, styles.text]` 合并，可能把 heading/table 继承值压回 base。
- 行高现状：prose 为 `round(base*1.4)`，16px 得 22px；共享 `list_item` 当前使用 `theme.spacing[1]`，相邻条目只有 4px 额外间距。
- 历史实现线索：`paragraphTextStyle={styles.body}`、Android 单个 Text、iOS 根 UITextView 可解决 wrap/clipping；原记录引用的提交 `8cc5b15be` 不存在于当前对象库，只作为实现提示，不作为验证证据。
- 已选方案：strong 保持 bold；prose 行高由 `1.5` 收回 `1.4`；缩小 assistant Markdown block 的额外间距但保留块边界；共享 `list_item` 的条目间距由 4px 增至 8px，不改变列表项内部行高；通用 `text` 不覆盖语义 family/size；恢复最小 paragraph text style path；含图片段落继续 View fallback；文件链接组件只追加缺失的可见行号；turn footer 同时渲染 duration/completedAt。
- 字距决定：`letterSpacing` 保持 `0`，不向跨平台 Markdown 引入正字距；可读性由真实 bold、行高和段落间距改善，code/table 显式保持 0。
- 风险与未知：自定义 workspace 字体若没有 bold face，computed 700 仍可能视觉较弱；先用系统字体验收。

## 3. 涉及文件与计划

| 文件                                                                    | 计划变化                                                 | 事实源                                |
| ----------------------------------------------------------------------- | -------------------------------------------------------- | ------------------------------------- |
| `packages/app/src/styles/markdown-styles.ts`、`markdown-styles.test.ts` | bold、1.4 行高、列表项间距、继承和 spacing reset         | 当前直接根因                          |
| `packages/app/src/components/markdown-text.web.tsx`                     | paragraph text style prop parity                         | 平台接口                              |
| `packages/app/src/components/markdown-text.android.tsx`                 | text-only paragraph 单 Text，图片保留 View               | 当前平台组件                          |
| `packages/app/src/components/markdown-text.ios.tsx`                     | body text style 进入根 UITextView                        | 当前平台组件                          |
| `packages/app/src/components/markdown/renderer.tsx`                     | shared paragraph 传 `styles.body`                        | 当前 shared renderer                  |
| `packages/app/src/components/message.tsx`                               | assistant paragraph、block spacing 与 turn footer 元信息 | assistant custom rules / timing owner |
| `packages/app/src/assistant-file-links/link.tsx`                        | 给缺失行号的文件链接标签追加 line/range 文本             | `useFileLink()` 的既有解析目标        |
| `packages/app/e2e/appearance-typography.spec.ts`                        | rich Markdown density/link label/footer metadata         | 现有 appearance E2E                   |

1. 扩展 rich Markdown fixture，让列表项内部 22px line-height 与条目间 8px 额外间距先 RED。
2. 最小修改共享 `list_item` spacing，不改变 prose 行高、parser 或列表 marker。
3. 验证 Web/Electron 截图、Android/iOS text-only 与 image paragraph、11/24 字号。
4. 运行目标测试、typecheck、lint、格式与 diff check。

## 4. 执行前检查点

- 当前目标：按用户新截图增加密集 Markdown 列表的条目间距，同时保持普通段落已经验收的紧凑节奏。
- 当前进度：原三项 Web 验证已完成；共享列表样式定位到 `list_item.marginBottom=4px`，准备补公开 UI seam 的 RED。
- 当前动作是否仍服务核心目标：是；只调整最终回答 Markdown 列表的可扫描性。
- 下一步：给 rich Markdown fixture 增加自动换行列表，确认旧实现因条目间仅 4px 而 RED；再把共享间距调整为 8px 并复跑。
- 风险与回退：不能把列表项内部的自动换行也放大；有序/无序列表共用样式，需同时保持 marker 对齐；Native 单 Text/image fallback 不变。
- 验证方式：style unit、rich Markdown E2E 与截图、typecheck、lint、Android/iOS smoke。
- TDD 判定、测试 seam 与验收行为：`TDD；沿用用户已确认的真实 assistant rich Markdown seam，新增列表项内部换行与相邻条目基线间距行为。`
- seam 确认：`User；2026-07-31 15:28 当前请求明确要求增加截图所示列表行距。`
- Execution Approval / Source：`Approved / User`。

## 5. 执行与变更记录

- 实际改动：首轮将 `strong` 改为 bold、正文/代码/表格字距显式为 0，叶子 `text` 不再覆盖语义字号；shared/assistant renderer 将 `styles.body` 传入段落；Android 纯文字段落使用单 `Text`、iOS 根 `UITextView` 合并正文样式，含图片段落继续使用 `View`。后续把正文行高由 `1.5` 收紧为 `1.4`、assistant Markdown block 额外间距收紧为 4px、footer 同时常显耗时与完成时间，并给缺少可见行号的文件链接追加 `(line N)` / `(lines N-M)`。本次把共享 `list_item.marginBottom` 从 4px 增至 8px，使有序/无序列表增加条目间距而不改变条目内部行高。
- 偏差与用户决策：本任务独立于 Interface 字号任务 `0022`；使用 workspace typography，不设父子关系。带行号文件链接只验证现有渲染样式，不修改任务 `0025` 所属解析逻辑。
- 收口决定：`2026-08-16` 用户确认任务已完结并要求收口，接受未补 Android/iOS smoke 的验证例外与剩余 Native 字体风险。
- Change Log：`2026-07-29` 完成只读调查并建档；`2026-07-30` 用户提供参考截图并授权执行，确认 rich Markdown seam；`2026-07-31 04:41` 完成首轮实现、Web 截图与验证，转 Review 等待 Native smoke；`2026-07-31 09:49` 用户对比截图后要求常显完成时间、显示链接行号并收紧段落行距；`2026-07-31 15:28` 用户要求增加密集列表的条目间距，复用原 seam 进入 Execute；`2026-08-16` 按用户确认收口。

## 6. 验证与完成判断

| 验收项                | 命令或步骤                                                                    | 结果      | 证据                                                                                                                    |
| --------------------- | ----------------------------------------------------------------------------- | --------- | ----------------------------------------------------------------------------------------------------------------------- |
| style RED/GREEN       | `rtk npx vitest run packages/app/src/styles/markdown-styles.test.ts --bail=1` | PASS，5/5 | RED 确认旧 19px 字号得到 29px 行高；GREEN 覆盖 1.4 行高、bold、继承与 spacing。                                         |
| list rhythm RED/GREEN | 复用 `8081/6768` 执行 rich Markdown Playwright 用例                           | PASS，1/1 | RED：相邻列表项基线差 26px；GREEN：条目内换行 22px、相邻条目基线差 30px。                                               |
| parser/rule 路径      | 追踪 strong token 到自定义 renderer                                           | PASS      | parser 未丢 strong；修改前根因定位到 style 500。                                                                        |
| rich Markdown UI      | 复用 `8081/6768` 执行 `playwright ... --grep "renders final answer Markdown"` | PASS，1/1 | 960x900：22px wrap、段落与列表节奏、`target.ts (line 42)`、原 `href`、耗时/完成时间及 overflow；截图位于 test-results。 |
| 窄屏 Web smoke        | 应用内浏览器 `390x844`                                                        | PASS      | `document.scrollWidth=390`，无横向溢出；`12:32` 完成时间位于视口内，footer 未遮挡。                                     |
| typecheck             | `rtk npm run typecheck`                                                       | PASS      | 根级类型检查通过。                                                                                                      |
| targeted lint         | `rtk npm run lint -- <0023 files>`                                            | PASS      | 0 warnings / 0 errors。                                                                                                 |
| full lint             | `rtk npm run lint`                                                            | BLOCKED   | 无关 `sidebar-workspace-list.test.tsx` 既有 5 errors。                                                                  |
| format                | `rtk npm run format:check:files -- <0023 files>`                              | PASS      | 9 个目标文件格式正确。                                                                                                  |
| Native smoke          | Android/iOS                                                                   | 例外接受  | 未补设备证据；用户于 2026-08-16 确认完结并接受该验证例外。                                                              |

- 未验证项与原因：Android/iOS text-only 与 image paragraph smoke 未补跑；用户于 2026-08-16 确认完结并接受验证例外。
- 剩余风险：自定义字体缺少 bold face 时视觉可能弱于系统字体；Native 测量缺少设备证据，用户已接受。
- Done Contract 是否由证据满足：`Web 合同已满足；Native smoke 作为用户接受的验证例外保留，任务收口。`

## 7. 恢复与同步

- 状态说明：`已收口 / Review`。
- 当前卡点：无；Native smoke 验证例外已由用户接受。
- 下一步唯一动作：N/A。
- Resume / Handoff：N/A；任务已完结，不再补跑 Native smoke。
- Project Sync Candidates：`无`。
- 长期文档同步：`N/A`。

### 提交记录

| 提交信息（Commit Message）                           | 提交脚注（Commit Footer） | 关联改动或阶段  | 文档同步状态 | 备注              |
| ---------------------------------------------------- | ------------------------- | --------------- | ------------ | ----------------- |
| `fix(app): improve final answer markdown typography` | `N/A`                     | `0023 / Review` | `N/A`        | 用户已授权 commit |
| `docs: close remaining local tasks`                  | `N/A`                     | `0023 / Review` | `已同步`     | 用户确认完结      |
