# Spec: 工作区字体与字号

状态：`Proposed`
任务分类：`standard`
创建日期：`2026-07-25`

## Goal

- 要解决什么问题：当前 `uiFontFamily` 与 `uiFontSize` 同时控制应用界面和工作区正文，用户无法分别调节操作界面密度与阅读/输入体验。
- 最终目标：在“设置 -> 外观 -> 字体”增加全局客户端偏好“工作区字体”和“工作区字号”，建立互不串扰的界面、工作区、代码三条字体轴。
- 本轮核心目标：固化语义边界、持久化兼容方案、主题 token 方案、消费面和验收证据；本轮不改业务代码。
- 验收结果：实现后，修改界面字体/字号不会改变工作区正文，修改工作区字体/字号不会改变界面 chrome 或代码表面，修改代码字体/字号也不会改变前两者。

## Done Contract

- 完成定义：新增设置可持久化、重启后恢复，并在 Web、Electron、iOS、Android 的目标工作区文本上即时生效；三条字体轴相互独立。
- 证明来源：设置归一化与主题补丁单测、Markdown 样式单测、定向 App Playwright、桌面与移动端人工 smoke，以及根级 typecheck/lint。
- 仍未完成：任一字体轴会串改另一轴；旧用户升级后工作区外观无意变化；长会话在字号切换后出现裁切、重叠、错误滚动锚点或陈旧虚拟高度。

## Scope

### In

- 新增全局客户端设置：
  - `workspaceFontFamily: string`
  - `workspaceFontSize: number`
- 在“设置 -> 外观 -> 字体”按“界面、工作区、代码”顺序展示字体与字号。
- 将工作区的自然语言内容迁移到独立的工作区字体 token。
- 兼容已有 AsyncStorage 设置，并保留升级前的工作区视觉结果。
- 更新所有受支持 locale 的设置文案和可访问性文案。
- 覆盖 Web/Electron 的 CSS 字体优先级、Native 的显式字体 token，以及消息虚拟化高度失效。

### Out

- 不增加 daemon、protocol、workspace registry 或服务端配置。
- 不做“每个 workspace 单独配置”；该设置是当前客户端上对所有 workspace 生效的外观偏好。
- 不加载或分发自定义字体文件；字体族输入继续只引用平台已经可用的字体。
- 不改变代码字体、终端字体、语法主题或系统无障碍字体缩放策略。
- 不在本轮新增字体预览；现有 Syntax 预览继续只预览代码字体与语法配色。

### 任务单元评估

- 该任务会触及设置、主题与多个工作区渲染面，但边界和现有运行时补丁路径明确，按单项目 `standard` 任务推进即可，无需升级 `deep`。

## Typography Contract

| 语义轴 | 应控制                                                                                                                                     | 不应控制                                                                      |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| 界面   | 导航、侧栏、workspace header/tab、按钮、表单标签、状态、时间戳、菜单与设置页                                                               | 用户/Agent 正文、Composer 输入、代码与终端                                    |
| 工作区 | 用户消息、Agent Markdown 正文与标题、Markdown 文件/变更请求内容、计划/问题/Todo 正文、tool call 的自然语言正文、Composer 输入与排队 prompt | 导航和控件 chrome、状态元数据、代码块、diff、终端、原始预格式化输出、嵌入网页 |
| 代码   | inline/fenced code、diff、源文件、终端与原始预格式化 tool output                                                                           | 界面 chrome 与工作区自然语言正文                                              |

优先级为“代码 > 工作区 > 界面”：工作区内容中的代码子树仍使用代码字体；工作区内的按钮、标签和时间戳仍使用界面字体。

## Facts / Constraints

### Confirmed Facts

- `packages/app/src/hooks/use-settings/storage.ts` 以 AsyncStorage 保存客户端设置，并通过 `normalizeAppSettings()` 对缺失/非法值回退；无需 wire schema 或服务端迁移。
- `packages/app/src/screens/settings/appearance/apply-appearance.ts` 当前把 `uiFontSize` 按 `FONT_SIZE.base = 16` 缩放成整套 `theme.fontSize`，工作区正文因此随界面字号一起变化。
- `applyAppearance()` 会补丁全部六个 Unistyles theme key；新方案必须继续从 canonical token 构造结果，不能基于已补丁主题重复缩放。
- Web 的 `apply-root-font.web.ts` 使用高 specificity 根规则强制界面字体，并用 `data-pmono` 排除代码子树；只增加 `theme.fontFamily.workspace` 而不调整该规则，在 Web 上不会可靠生效。
- Native 不支持从普通 `View` 继承字体族；工作区正文必须显式消费工作区字体 token，不能只依赖 Web dataset 边界。
- `AppearanceStyleBoundary` 会按外观 token remount Markdown/tool detail 等解析树；它需要纳入工作区 token。
- Web 长会话使用测量值与 `assistant-message-height-estimate.ts` 缓存做部分虚拟化。字号/字体变化后必须清理陈旧 Markdown 高度并让已挂载行重新测量。
- 自定义字体族行当前只在非 Native 平台展示；工作区字体族沿用该平台门禁，工作区字号在所有平台展示。
- 所有新增客户端文案必须在 `en`、`zh-CN`、`ar`、`es`、`fr`、`ja`、`pt-BR`、`ru` 中保持 key parity。

### Constraints

- 保持跨平台默认实现，不引入 Electron-only 或 daemon capability gate。
- 优先扩展或参数化现有字体设置链路；只有现有边界无法表达工作区语义时才增加最小新 token/marker，不建立平行设置模型、第二个主题应用器或重复 UI primitive。
- 不通过 React Context 在整棵 workspace tree 高频订阅设置；继续使用现有 Unistyles runtime patch 路径。
- 不用 transform 缩放整块 workspace，也不依赖 Web CSS `font-size` 继承来模拟 Native 行为。
- 所有工作区 line-height 必须随工作区字号派生；不得保留会在 11-24 px 范围内裁字的固定正文行高。
- 代码子树必须继续携带 `data-pmono`，并在 CSS 与 Native 样式上覆盖工作区字体。

## Reuse Contract

实现应把现有 appearance 功能当作模板和唯一主链路。Review 时逐项核对：

| 现有实现                                                                                             | 本功能如何复用或模仿                                                                                 | 禁止新增的平行实现                                                               |
| ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `AppearanceSection` 内的 `FontFamilyRow`、`FontSizeRow`                                              | 直接渲染工作区两行；沿用相同布局、border、draft、blur/submit commit、accessibility 和 Native gate    | 新建 workspace 专用 row/component 或另一种交互                                   |
| `sanitizeFontFamily()`、`parseClampedFontSize()`                                                     | 新字段使用同一校验函数；只增加语义独立的默认值与 min/max 常量                                        | 复制一份 workspace parser/sanitizer                                              |
| `AppSettings`、`DEFAULT_CLIENT_SETTINGS`、`normalizeAppSettings()`、`saveAppSettings()`              | 在同一对象和读写路径追加字段；兼容初始化发生在现有 normalization boundary                            | 新 storage key、新 query、workspace registry 或 daemon setting                   |
| `scaleFontSize()`                                                                                    | 将现有纯函数最小泛化为可分别构建 UI/workspace ramp 的 helper；code absolute size 仍由同一 apply 组装 | 复制第二套缩放函数或从 live theme 二次缩放                                       |
| `applyAppearance()` 与 `ALL_THEME_KEYS`                                                              | 在同一个 updater 中补丁 `ui/workspace/mono` 三轴和全部 theme key                                     | `applyWorkspaceAppearance()`、额外 effect 或 per-component settings subscription |
| `applyRootUiFont()` / `.web.ts`                                                                      | 扩展同一 no-op/web platform pair，使一个静态 stylesheet 管理 UI/workspace CSS 变量与优先级           | 第二个 style tag、依赖注入顺序的零散 CSS                                         |
| `CODE_SURFACE_DATASET`                                                                               | workspace marker 模仿其“共享稳定常量 + dataSet 边界”模式；code marker 继续作为最高优先级覆盖         | callsite 内联 `{ pworkspace: "" }` 或散落 selector 特例                          |
| `AppearanceStyleBoundary`                                                                            | 扩展现有 appearance key，使解析内容在 workspace token 变化时走同一 remount 机制                      | 新建 workspace-only boundary 或给每个 Markdown callsite 传 revision prop         |
| `clearAssistantMessageHeightEstimateCache()`                                                         | 在 workspace typography 变化路径调用现成清理入口；先验证现有 ResizeObserver 重测是否已充分           | 第二份高度缓存、仅为字体变化复制 virtualizer                                     |
| 相邻 `storage.test.ts`、`apply-appearance.test.ts`、`markdown-styles.test.ts` 与 settings E2E helper | 按现有 fixture、断言风格和目标文件扩展测试                                                           | 新测试 harness、JSDOM component test 或全套 E2E 重跑                             |

允许增加的最小新概念只有：两个持久化字段、一个 workspace font family token、一个 workspace size ramp，以及一个共享 workspace dataset marker。若实现需要更多长期抽象，先回写 spec 并重新 checkpoint。

## Proposed Solution

### 1. Settings And Compatibility

- 在 `AppSettings` 与 `DEFAULT_CLIENT_SETTINGS` 增加 `workspaceFontFamily`、`workspaceFontSize`。
- 默认值：字体族空字符串（平台默认 UI stack），字号 `16px`；独立命名的范围常量初始与界面字号一致，为 `11..24`。
- 字体族复用 `sanitizeFontFamily()`，字号复用 `parseClampedFontSize()`，但保留工作区专用常量名称，允许以后独立调整边界。
- `AppearanceSection` 直接复用现有 `FontFamilyRow`、`FontSizeRow`；第三条相同 commit 路径出现后，只在本文件内做能真实消除重复的最小参数化，不抽出新的通用表单层。
- 读取旧设置时，若新字段不存在：
  - `workspaceFontFamily` 从旧的已归一化 `uiFontFamily` 初始化；
  - `workspaceFontSize` 从旧的已归一化 `uiFontSize` 初始化。
- 归一化结果必须立刻包含两个具体工作区值；之后只修改 `ui*` 时仍保留该结果，不再继续跟随界面设置。这样旧用户升级时视觉不跳变，首次修改后两轴即独立持久化。
- 兼容分支按仓库规则添加 `COMPAT(workspaceTypographySettings)` 注释；实现时填写实际落地版本和目标移除日期，不在 spec 中猜测发布版本。
- `useSettings()` 的 renderer/desktop 聚合路径必须显式转发两个新字段；Reset 恢复两项默认值。

### 2. Theme Model

- 保留现有 `theme.fontSize` 作为界面字号阶梯，并保留 `theme.fontSize.code` 作为代码字号。
- 新增独立的 `theme.workspaceFontSize` 阶梯，键与非代码 `FONT_SIZE` 阶梯一致：`xs` 到 `4xl`。
- 扩展 `theme.fontFamily` 为 `{ ui, workspace, mono }`；工作区默认 stack 与平台 UI 默认 stack 相同，但值独立保存和补丁。
- 最小泛化现有 `scaleFontSize()`，继续从 canonical `FONT_SIZE` 构建结果；分别用 `uiFontSize / 16` 与 `workspaceFontSize / 16` 构建两个阶梯，保证重复 apply 不累乘。
- 工作区正文 line-height 从对应 `workspaceFontSize` token 派生；代码 line-height 继续由 `codeFontSize` 派生。

### 3. Runtime Application

- 扩展现有 `AppearanceInput`、`applyAppearance()` 调用和 `ProvidersWrapper` 依赖列表，任何工作区字体设置变化仍由同一个 effect 补丁全部注册主题。
- 扩展现有 `applyRootUiFont` platform pair，而不是新增第二个根字体应用器；Web 实现同时设置 `--paseo-ui-font` 与 `--paseo-workspace-font`。
- 新增稳定的 workspace 文本 dataset marker；Web 规则满足：
  - 普通文本使用 UI 变量；
  - workspace marker 自身与其自然语言子树使用 workspace 变量；
  - `data-pmono` 自身及其子树始终排除在前两条规则之外。
- Portal 到 `#overlay-root` 的 workspace 内容必须在自身根节点重新携带 workspace marker，不能依赖已经断开的祖先。
- Native 由目标 `Text` / `TextInput` 样式显式设置 `theme.fontFamily.workspace` 与 `theme.workspaceFontSize.*`。
- `AppearanceStyleBoundary` 的 key 加入完整 workspace family/size 阶梯；不再把 UI 字体变化当作工作区解析内容的必要 remount 依据。
- 工作区 typography 改变时清理 assistant Markdown 高度估算缓存；已挂载 Web virtual rows 由现有 ResizeObserver/measureElement 路径重新测量，并验证底部锚点不跳失。

### 4. Settings UI And Copy

- 字体组顺序：界面字体、界面字号、工作区字体、工作区字号、代码字体、代码字号。
- 将界面字体提示从“用于整个应用”收窄为“用于导航、控件和标签”；新增工作区提示，明确用于消息、Markdown 和输入区；代码提示保持代码/diff/终端语义。
- 字体族输入沿用现有 sanitize、blur/submit commit 和非法值回滚交互；字号沿用数字 draft、clamp 和 commit 交互。
- 非 Native 展示三种字体族输入；Native 仅展示三种字号，保持现有平台能力边界。

### 5. Consumer Migration

先按语义迁移，不按目录或“物理上在 workspace 内”批量替换：

- `styles/markdown-styles.ts`：所有 prose、heading、list、quote、table 正文改用 workspace 阶梯；inline/fenced code 继续使用 mono/code。
- `components/message.tsx`：用户正文、自然语言 message/todo/compaction 内容使用 workspace；timestamp、action 与 stream metadata 保持 UI。
- `composer/index.tsx`：可编辑 prompt 与 queued prompt 使用 workspace；按钮、tooltip、错误 chrome 保持 UI。
- `components/tool-call-details.tsx`：plain text/result narrative 使用 workspace；group header、section label 保持 UI；shell/JSON/diff 保持 code。
- `agent-stream/view.tsx`、`question-form-card.tsx`、`plan-card.tsx`：问题、选项正文、计划正文等工作内容使用 workspace；控件标签和状态保持 UI。
- `MarkdownRenderer` 的其他现有消费者（文件预览、变更请求评论/评审）自然获得 workspace typography；嵌入网页不受影响。

实现前用 `rg` 对 workspace 内容链中的 `theme.fontSize.*`、`theme.fontFamily.ui` 和固定 `lineHeight` 再做一次审计；未能明确分类的文本不得机械替换。

## Rejected Alternatives

- 让 `workspace*` 缺失时永久动态跟随 `ui*`：仍然耦合，且用户何时真正获得独立值取决于偶然的保存时机。
- 把整个 `WorkspacePaneContent` 一律切成 workspace 字体：会把 tab、按钮、状态等 chrome 错误归为工作内容，并造成 Web/Native 行为差异。
- 只在 Web 根节点加 CSS：无法覆盖 Native，也无法可靠处理字号阶梯与行高。
- 新建设置 Context 并让每个消息组件订阅：与现有运行时主题补丁重复，增加热路径订阅与渲染负担。
- 为工作区复制一套 settings rows、校验、theme updater、root style tag 或 appearance boundary：短期看似隔离，实际形成两条会漂移的实现链，违反本任务的复用合同。

## Expected Touch Points

- 设置与持久化：`packages/app/src/hooks/use-settings/storage.ts`、`index.ts` 及相邻测试。
- 主题与应用：`packages/app/src/styles/theme.ts`、`screens/settings/appearance/apply-appearance.*`、`apply-root-font.*`、`app/_layout.tsx`、`components/appearance-style-boundary.tsx`。
- 设置 UI/i18n：`appearance-section.tsx`、八个 locale resource、`i18n/resources.test.ts`。
- 工作区内容：`markdown-styles.*`、`message.tsx`、`tool-call-details.tsx`、`composer/index.tsx`、`agent-stream/view.tsx`、计划/问题内容组件。
- 虚拟化：`utils/assistant-message-height-estimate.*`，必要时补充 `agent-stream/strategy-web.*` 的显式重测入口。
- 用户流程：定向 Appearance settings Playwright spec/helper。

## Acceptance Criteria

1. 新安装默认界面与工作区均为平台默认字体、16px；代码仍为平台 mono、12px。
2. 旧设置仅含自定义 `uiFontFamily/uiFontSize` 时，升级后的首次工作区渲染与升级前一致。
3. 同一运行会话内修改界面字体/字号后，settings/sidebar/tab/control computed style 变化，消息、Markdown 与 Composer computed style 不变。
4. 修改工作区字体/字号后，用户消息、Agent Markdown、Markdown 文件/评论、工作内容卡片与 Composer 变化，界面 chrome 和代码表面不变。
5. 修改代码字体/字号后，inline/fenced code、diff 与 terminal 变化，界面和工作区 prose 不变。
6. 工作区字号在 `11` 与 `24` 两端均无正文裁切、按钮挤压、重叠或横向溢出；Markdown heading 层级仍成立。
7. 长会话切换工作区字号后，已挂载内容重新测量，未挂载行不使用旧高度，底部锚点与滚动位置行为保持正确。
8. 设置重启恢复、Reset、非法字体族回滚、字号 clamp 和 locale key parity 均有验证证据。
9. Web、Electron、iOS、Android 语义一致；Native 不承诺输入任意未安装字体族。
10. Review 能证明新增行为沿用 Reuse Contract 中的现有入口；不存在第二个 settings store/theme apply effect、重复 parser、重复设置行 primitive 或 workspace-only 渲染框架。

## Validation Plan

- Unit:
  - `npx vitest run packages/app/src/hooks/use-settings/storage.test.ts --bail=1`
  - `npx vitest run packages/app/src/screens/settings/appearance/apply-appearance.test.ts --bail=1`
  - `npx vitest run packages/app/src/styles/markdown-styles.test.ts --bail=1`
  - `npx vitest run packages/app/src/utils/assistant-message-height-estimate.test.ts --bail=1`
  - `npx vitest run packages/app/src/i18n/resources.test.ts --bail=1`
- App E2E：只运行新增/修改的 Appearance settings Playwright spec，验证三轴 computed styles、持久化与长消息重测；不运行完整 Playwright suite。
- Static：`npm run typecheck`、`npm run lint`、`npm run format:check`。
- Manual smoke：Electron/Web 宽屏与 390x844；iOS/Android 检查 workspace 字号最小/最大、Markdown/Composer、代码覆盖和无裁切。

## Risks And Mitigations

- Web 根字体规则 specificity 可能覆盖 workspace/mono：用明确 dataset 优先级和 computed-style E2E 证明，不依赖 stylesheet 顺序。
- Portal 丢失 workspace 祖先：内容型 overlay 自身携带 marker，并覆盖 tool detail sheet 场景。
- 固定 line-height 在大字号裁字：迁移工作区正文时同步审计 line-height，按 workspace token 派生。
- 虚拟化缓存陈旧造成滚动跳动：字体变化时清缓存，验证 mounted row 重测与 bottom anchor。
- “工作区”被按物理位置误解：严格按本 spec 的文本角色表迁移，不批量替换整个 pane。
- 改动面较广导致漏项：实现前和 Review 时各执行一次定向 `rg` 审计，并用三轴高对比值做视觉 smoke。

## Open Questions

- 无阻塞问题。执行批准同时表示接受本 spec 对“工作区文本”的语义定义，以及 Native 继续隐藏任意字体族输入的既有平台边界。

## Restated Understanding

- 我理解当前任务是：增加独立的工作区字体和工作区字号，修复工作区正文受界面字体设置牵连的问题。
- 当前核心目标是：按已批准合同完成三轴 typography，实现 `Code > Workspace > Interface` 的独立配置与渲染优先级。
- 当前边界是：客户端全局外观偏好和 App 渲染层；不触及 daemon/protocol，也不是 per-workspace 配置。
- 暂不处理：提交、发布、新的字体加载能力和测试 harness 的跨平台改造。

## Goal Alignment Check

- 当前动作是否仍服务于核心目标：是；实现复用既有 settings、runtime theme patch、dataset marker、appearance boundary 和高度缓存入口。
- 当前路径是否仍在用户边界内：是；改动限定在 App 外观设置、主题与工作内容消费者，并同步对应项目文档。
- 是否出现更合适的路径：否；Review 已将 settings 聚合恢复为显式白名单，仅提取新增两项 workspace 字段筛选以满足复杂度规则。
- 是否需要调整本轮目标或范围：否。

## Checkpoint Summary

- 当前任务理解：在外观设置中增加独立工作区字体/字号，并保证三轴不串扰。
- 当前核心目标：完成实现与证据收口。
- 当前进度：Settings、Theme、UI、消费者、缓存失效、i18n 和定向 E2E spec 已实现；unit、typecheck 和 lint 已通过。
- 下一步 1：在 Linux/CI 可用的 App E2E 环境运行 `appearance-typography.spec.ts`。
- 下一步 2：补 iOS/Android 的 11px/24px 人工 smoke，确认 Native 裁切与滚动行为。
- 涉及模块：App settings、Unistyles theme、Web root font CSS、workspace content、i18n、virtualization。
- 主要风险：Windows 本地 Playwright harness 不能启动完整环境；Native 视觉结果尚未实测。
- 验证方式：定向 unit/E2E、根 typecheck/lint/format check、跨平台视觉 smoke。
- Execution Approval: `Approved`（用户于 2026-07-26 明确批准本 spec 并要求开始实现）

## Change Log

- 2026-07-25：创建 spec；采纳“界面 / 工作区 / 代码”三轴模型，记录旧设置保形迁移和虚拟化失效要求。
- 2026-07-25：完成 spec 定向格式化、根级 typecheck 与 lint；记录全仓 format baseline 失败。
- 2026-07-25：根据用户反馈新增 Reuse Contract；明确直接复用或最小泛化现有 appearance/settings/virtualization 入口，禁止平行实现。
- 2026-07-26：用户批准更新后的 spec，并授权开始功能实现。
- 2026-07-26：用户批准登记并应用 `$karpathy-guidelines` 与 `$tdd`；对应能力已写入项目依赖注册表。
- 2026-07-26：完成 settings 兼容初始化、三轴 theme patch、设置 UI、Web marker、Native 显式样式、消费者迁移、Markdown 高度缓存失效、八种 locale 和定向 E2E spec。
- 2026-07-26：Review 将 `useSettings()` 保持为显式 App 字段白名单；只提取新增的两项 workspace 字段筛选，未采用其余字段透传。同步 `docs/design.md` 与 `docs/unistyles.md`。

## Validation

- Self-check：Review 已核对 settings schema/聚合白名单、runtime theme patch、Web `data-pworkspace` / `data-pmono` 优先级、Markdown/消息/Composer/工作内容卡片消费者、Portal marker 和高度缓存失效入口。
- Unit：`storage.test.ts` 36/36、`apply-appearance.test.ts` 12/12、`markdown-styles.test.ts` 4/4、`assistant-message-height-estimate.test.ts` 3/3、`resources.test.ts` 32/32，均通过。
- Static：根 `npm run typecheck` 通过；根 `npm run lint` 通过，`0 warnings / 0 errors`；本任务文件定向格式检查通过。
- Format baseline：根 `npm run format:check` 未通过，报告约 2870 个既有文件格式问题；未执行全仓写入式格式化，避免覆盖并行工作树。
- E2E discovery：Playwright `--list` 成功发现新增单测试。
- E2E runtime：未执行成功。Windows harness 的 project 参数引用、global setup 中 POSIX `which tsx` / `spawn("npx")` 和 `dev-daemon.sh` 阻止本地环境启动；尝试产生的 PID 676 已退出，6768 未监听，主 daemon 6767 从未操作。
- Human confirmation：Typography Contract、执行范围及 `$karpathy-guidelines` / `$tdd` 登记均已获用户批准。
- 结果汇总：功能实现及 unit/static 证据完成；Linux/CI Playwright 与 iOS/Android 视觉 smoke 尚待执行。
- 核心目标是否已由证据证明完成：独立配置、迁移和主题模型已由 unit/static 证明；完整跨平台用户可见验收尚未由运行时证据完全证明。
- 剩余风险：CSS computed-style、长列表滚动锚点和 Native 11px/24px 裁切仍需目标环境 smoke。

## Resume / Handoff

- 当前状态：Implementation complete，runtime validation pending。
- 当前卡点：Windows 本地 App Playwright harness 不可用；代码本身无已知阻塞。
- 下一步唯一动作：在 Linux/CI 运行 `packages/app/e2e/appearance-typography.spec.ts`，失败时按 computed style 或滚动证据回到对应 consumer 修正。
- 下一轮核心目标：补齐三轴 E2E 与 Native 边界字号证据后完成 Review。

## Project Sync Candidates

- 是否发现可复用项目事实：`Yes`。
- 候选事实：Interface / Workspace / Code 三轴语义、Web marker 优先级、workspace token 和 parsed-content remount/cache 规则。
- 建议与实际落点：设计语义写入 `docs/design.md`；运行时与 Unistyles 约束写入 `docs/unistyles.md`；必需能力登记写入 `.skills/project/DEPENDENCY_SKILLS.md`。
- 同步状态：`Synced`。
