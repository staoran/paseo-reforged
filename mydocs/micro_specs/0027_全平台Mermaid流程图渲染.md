# 全平台 Mermaid 流程图渲染 Micro Spec

## 0. 状态与索引

| 字段               | 值                                                   |
| ------------------ | ---------------------------------------------------- |
| task_id            | `0027`                                               |
| spec layer         | `Feature Spec`                                       |
| task status        | `已收口`                                             |
| document status    | `Completed`                                          |
| depth              | `deep`                                               |
| phase              | `Review`                                             |
| Execution Approval | `Approved`                                           |
| Approval Source    | `User`                                               |
| file path          | `mydocs/micro_specs/0027_全平台Mermaid流程图渲染.md` |
| parent spec        | `N/A`                                                |
| superseded by      | `N/A`                                                |
| created / updated  | `2026-07-31 23:39`                                   |

## 1. 目标与完成契约

- 当前理解：Paseo 会把带 `mermaid` info string 的 fenced block 当作普通代码块展示。用户要求先固化任务，再选择能在 Web、Electron、iOS 和 Android 离线渲染、且图中文字可选择和复制的方案；Codex 只作为可观察参考，不假定其未公开的内部协议。
- 推荐决策：使用官方 Mermaid 11.x runtime。Web 和 Electron 直接在 DOM 中渲染 Mermaid 返回的 SVG；iOS 和 Android 复用项目现有的离线 WebView bundle/bridge 模式，在 WebView DOM 中渲染同一 SVG。两层共用源码清理、主题、错误与回退合同。
- 文字可选择不等于排除 SVG：Mermaid 输出中的 `text`/`tspan` 可以被浏览器和 WebView 的 Selection API 选中。目标不是转成位图或 React Native 原生路径，而是保留可选的 SVG DOM 文本。
- Done Contract：合法的 Mermaid fenced block 在 Web、Electron、iOS、Android 显示图形而非源码；图中文字可选择并复制；浅色/深色与宽窄视口可用；流式未完成、非法语法、runtime 加载失败或 WebView bridge 失败不会令消息崩溃，并始终能查看/复制原始源码；实现不依赖远程渲染服务；目标单测、Web 浏览器测试、Android/iOS smoke、typecheck 与 lint 提供证据。

## 2. 范围与事实

### 2.1 当前代码事实

- `react-native-markdown-display` 正确保留 fence 的 `sourceInfo: "mermaid"`，问题不是 Markdown 解析或围栏识别。
- `packages/app/src/components/message.tsx` 和共享 `packages/app/src/components/markdown/renderer.tsx` 的 `fence` rule 都无条件交给 `HighlightedCodeBlock`；该组件只做源码高亮和复制，没有生成图形的分支。
- App 当前依赖 `react-native-webview 13.16.1`（package.json 约束为 `^13.16.0`），依赖树没有 `mermaid`。
- 项目已经有可复用的离线 WebView 实现：`packages/app/scripts/build-terminal-webview-html.mjs` 以 esbuild 生成 iOS 15/Chrome 100 目标的 inline HTML，`packages/app/src/components/terminal-emulator.native.tsx` 负责 bridge、watchdog、`textInteractionEnabled` 和进程故障回收。
- 最小根因反馈循环已连续复现：给现有 renderer 一个 `language="mermaid"` fence，输出仍是 `flowchart LR` 文本，DOM 中没有 `svg`；parser token 的 `type=fence, info=mermaid` 正确。
- 相邻任务 `0023` 只处理最终回答 Markdown 排版，明确排除新渲染库；`0027` 独立负责会话内 Mermaid。

### 2.2 Codex 可观察证据

只读检查本机 Codex 安装 `C:\Program Files\WindowsApps\OpenAI.Codex_26.721.11231.0_x64__2p2nqsd0c76g0` 的 `app.asar` 得到：

- 包含 `mermaid 11.14.0`，图组件位于 `webview/assets/mermaid-diagram-78zBOnOJ.js`。
- 组件调用 `mermaid.render()`，用 `template` 解析返回字符串，取出 `svg` 节点后用 `replaceChildren(svgNode)` 插入 DOM。
- 观察到的配置为 `securityLevel: "strict"`、`suppressErrorRendering: true`、`htmlLabels: false`、`flowchart.htmlLabels: false`、`theme: "base"`。
- 组件会剥离或限制 init directives，并删除 `click` 语句；这只能作为安全行为参考，不能当作 Paseo 的私有 API 合同。
- 可观察 UI 保留 Mermaid 源码复制，并提供展开预览和 SVG 下载；本任务首期只承诺源码查看/复制，下载不进入必做范围。
- Codex 使用 SVG 不会与“文字可复制”矛盾；是否可选应以实际 DOM 和平台 smoke 结果为准。

### 2.3 官方能力与 spike 证据

- Context7 解析到的官方 Mermaid 文档（`/mermaid-js/mermaid`）说明：`render` 可返回 SVG；`strict` 会编码 HTML 并禁用点击行为，非 loose 路径会用 DOMPurify 清理 SVG；frontmatter/directives 能覆盖部分 render config，所以应用必须锁定安全配置或明确处理它们。
- Context7 解析到的 `react-native-webview` 文档（`/react-native-webview/react-native-webview`）确认：支持 inline/local HTML、`window.ReactNativeWebView.postMessage` + `onMessage` bridge、`onShouldStartLoadWithRequest` 导航拦截，以及 iOS 14.5+ 的 `textInteractionEnabled`。
- 临时 browser spike 使用 Mermaid `11.16.0`、esbuild `ios15/chrome100` 和 Playwright：bundle 原始大小 `3,453,193 bytes`；`mermaid.render` 返回根节点 `svg`，`foreignObjectCount=0`，`text=7`，`tspan=14`；Selection API 实际选中中文 `是`；截图验证流程图可见。spike 目录已删除，未改动项目依赖或源码。
- npm 调查结果：`react-native-mermaid` 不存在（404）；`@lightenna/react-mermaid-diagram@1.0.22` 是普通 React wrapper，仅声明 React 和 Mermaid peer dependency，不提供 React Native/iOS/Android 承载，因此不能作为跨平台方案。

### 2.4 候选方案比较

| 候选方案                                   | Web/Electron                                 | iOS/Android                                              | 选择结论                |
| ------------------------------------------ | -------------------------------------------- | -------------------------------------------------------- | ----------------------- |
| 各平台直接调用 Mermaid DOM                 | 可行                                         | React Native 没有可依赖的 DOM；原生 SVG 不能保证文字选择 | 排除                    |
| Web DOM + Native 离线 WebView              | 原生 SVG DOM、可选文本                       | 项目已有 bundle/bridge，离线且可选文本                   | **推荐**                |
| 所有平台统一 WebView/HTML runtime          | 可行但给 Web 增加 bridge 和嵌套 WebView 成本 | 可行                                                     | 不采用，扩大 Web 复杂度 |
| Mermaid SVG 交给 `react-native-svg/SvgXml` | 可显示                                       | 不保证系统文本选择/复制，且与用户观察不符                | 排除                    |
| 远程 Mermaid 服务                          | 看似跨平台                                   | 违反 local-first、离线和隐私边界                         | 排除                    |
| daemon/CLI 预渲染 SVG                      | 需要额外运行时、协议或进程                   | 仍需 WebView 才能选字                                    | 排除                    |

## 3. 推荐架构与行为合同

### 3.1 Fence 分发与公共接口

- 新增共享的 Mermaid fence 分发组件，两个现有 renderer 只保留一套识别规则：info string 取第一个空白分隔 token，大小写不敏感地匹配 `mermaid`；其它语言继续走 `HighlightedCodeBlock`。
- 给 Markdown-it parser 增加一次性的 fence closure 标记规则，利用 token 的 `map`/`markup` 记录 `sourceMeta.paseoFenceClosed`。Mermaid 只有在明确闭合时才进入图形渲染；未闭合 fence 直接显示现有源码块，避免流式消息反复渲染半成品。
- 公共组件输入至少包含 `code`、`sourceInfo`、继承文本/盒模型样式、当前主题和 `isClosed`；状态合同为 `source/loading/diagram/error`。渲染状态不得改变原始源码值。
- 成功状态显示图形，并按参考样例提供 `Maximize2` 展开预览与 `Copy` 复制 Mermaid 源码两个图标按钮，使用 tooltip/可访问标签说明动作；需要查看源码时可再展开 `HighlightedCodeBlock`。错误、超时和不支持的输出直接回退到同一源码块，不把 Mermaid 错误 HTML 当作用户内容插入消息。

### 3.2 Web 与 Electron

- 采用 `mermaid-diagram.web.tsx`，按需加载官方 Mermaid，避免首屏同步增加完整 runtime。
- 通过单点 render service 串行化 `initialize + render`，防止 Mermaid 全局 config 在多个图同时切换主题时互相覆盖；每次请求带递增 request id，组件卸载或源码变化后丢弃过期结果。
- 初始化固定 `startOnLoad: false`、`securityLevel: "strict"`、`suppressErrorRendering: true`、`htmlLabels: false`、`flowchart.htmlLabels: false` 和 App 主题变量。不要调用 Mermaid 返回的 bind/click 回调。
- 将返回的 SVG 放入 `template`，校验唯一根 `svg` 后用 DOM node 替换容器子树；不在 React JSX 中直接拼接未校验的 `dangerouslySetInnerHTML`。容器和 SVG 使用 `user-select: text`，宽图允许横向滚动或进入展开预览。

### 3.3 iOS 与 Android

- 采用 `mermaid-diagram.native.tsx`，每个可见 Mermaid block 使用项目已有 `react-native-webview`，加载构建时内联的离线 HTML；不使用远程 URL、CDN 或在线 Mermaid 服务。
- 新增与 terminal 相同风格的 bridge entry 和生成脚本。Native 到 WebView 的消息为 `render(requestId, source, theme)`；WebView 到 Native 至少有 `ready`、`rendered(requestId, height)`、`height(requestId, height)`、`error(requestId, code)`。所有消息先 JSON 解析和 request id 校验。
- WebView 内保留 Mermaid SVG DOM，不把 SVG 转成 `SvgXml` 或位图。设置 `textInteractionEnabled`、`user-select: text`、必要的横向滚动；用 `ResizeObserver` 回传内容高度，Native 容器按高度更新，避免固定高度截断或无限反馈。
- 参考现有 terminal 的 watchdog 和进程终止回收：bridge 未 ready、render 超时、iOS content process 终止或 Android render process gone 时最多重建一次，随后回退源码块。
- 禁止 WebView 导航和弹窗：初始 inline document 之外的请求由 `originWhitelist`/`onShouldStartLoadWithRequest` 拒绝，`setSupportMultipleWindows={false}`、`allowsLinkPreview={false}`；HTML CSP 使用 `connect-src 'none'`，不允许网络、frame、object 或表单。

### 3.4 输入与输出安全边界

- 在调用 Mermaid 前执行公共 `prepareMermaidSource`：拒绝超出有限字符上限的输入；去除或拒绝无法完整解析的 leading frontmatter 和 `%%{...}%%` init/config directives；删除顶层 `click` 行。Paseo 不接受图作者覆写安全级别、HTML labels、启动行为或 App 主题。
- 仍以 Mermaid `strict`/DOMPurify 为第一层清理，并设置不可被图内配置改写的 `secure` keys；不执行 Mermaid 的 bind functions。
- 解析输出后只接受预期 SVG 节点和内部引用；若出现 script、事件属性、iframe/object/embed、外部 href/src、无法验证的 foreignObject 或其它不允许节点，整块回退源码而不是尝试修补。具体允许属性列表在实现时以锁定的 Mermaid 版本和 browser/native smoke 为准。
- 将源码注入 WebView 时沿用 terminal 的 JSON 序列化和 `</script` 转义；不把原始源码拼进 HTML script 字面量。图形 ID 使用受控的稳定前缀和 request id，避免重复 ID 污染同一文档。

### 3.5 主题、尺寸与交互

- Mermaid 主题变量来自 Paseo 当前浅色/深色主题，不读取图内 theme directive；主题改变会触发同一 request 的安全重渲染。
- SVG 默认保留 viewBox、按容器宽度缩放；过宽图不挤压消息布局，允许横向查看或展开预览；高度由真实 SVG/DOM 测量，不使用会导致文字裁切的固定常数。
- 图形渲染成功、展开预览、源码展开、加载中、回退五种状态都保持稳定的外层尺寸和可访问标签。图形失败时用户仍能看到完整源码和现有复制按钮。
- 参考截图的节点标签使用旧式 `<br/>` 换行；由于关闭 HTML labels 是安全合同，实施测试必须证明该输入仍生成正确的多行 `text/tspan`，或者在输入标准化阶段无损转换成 Mermaid 官方支持的 Markdown newline。未经该测试不能宣布参考样例兼容。

### 3.6 流式、错误与并发

- 未闭合 fence、空源码、source policy 拒绝、Mermaid parse/render error、bundle 加载失败和 bridge timeout 都是可预期回退，不抛出到消息树。
- 源码、主题或宽度变化时只接受最新 request；旧 Promise、旧 WebView 消息和旧高度更新不得覆盖新状态。
- 默认不在流式半成品上显示图形；闭合后再渲染。渲染中的图不阻塞其它消息块，且源码回退可复制。

## 4. 执行前检查点

- 当前核心目标：让 Paseo 会话中的 Mermaid fence 在四个平台离线显示可选文本的 SVG，同时保留安全和源码回退；不是修改 Codex 客户端，也不是增加远程渲染服务。
- 当前进度：根因已建立红色反馈循环；Codex 行为、官方 Mermaid/WebView 能力、候选方案、bundle spike 和项目现有 WebView 链路均已核实；两次临时 spike 目录均已清理。
- 当前边界：用户已批准按本 spec 实施；不扩大到 daemon/协议、远程渲染、网站 Markdown 或 Mermaid 之外的图表语法。
- 推荐实施顺序：
  1. 用户确认测试 seam，并明确执行批准。
  2. 建立 fence 分发、source policy 和 WebView bridge 的最小 RED 测试。
  3. 加入 Mermaid 依赖、公共分发组件、Web DOM renderer 和 Native 离线 bundle，完成第一个合法 flowchart 的 GREEN。
  4. 依次补安全拒绝、未闭合/流式回退、主题/尺寸、过期 request 和 WebView 故障测试。
  5. 运行目标 unit/browser/Electron smoke、Android/iOS smoke、bundle size 检查、typecheck 和 lint，并回写本 spec。
- 稳定 TDD seam：`Markdown fence -> Mermaid dispatch`（可观察到合法 fence 不再走代码块）；`Mermaid renderer public result`（合法 source 得到带 `text` 的 SVG，非法 source 得到源码回退）；`Native WebView bridge`（ready/rendered/error/height 和 request id 的用户可见状态）。不测试私有 Mermaid 函数、DOMPurify 内部实现或 WebView vendor internals。
- seam 确认：`User`。用户于 `2026-07-31 17:13` 确认 `Markdown fence -> Mermaid dispatch`、`Mermaid renderer public result`、`Native WebView bridge` 三个 seam。
- Execution Approval / Source：`Approved / User`。用户于 `2026-07-31 17:13` 明确批准执行 `0027`。
- 主要风险：Mermaid full runtime 的 native bundle 原始大小约 3.45 MB；大量同时可见 WebView 的内存、iOS/Android 选择复制、宽图嵌套滚动和某些 Mermaid diagram type 的输出结构仍需平台实证。若任一平台不能稳定选字，保留源码回退并暂停扩大支持范围，不改用远程服务。
- 验证方式：官方源码/文档链接、依赖与生成 bundle 检查、受影响 Vitest/browser 测试、Playwright Web/Electron 测试、Android/iOS smoke、`npm run typecheck`、`npm run lint`。不运行全量本地测试。

## 5. 执行与变更记录

- 实际代码改动：两条 Markdown renderer 共用 fence metadata 与 Mermaid 分发；Web/Electron 使用串行 Mermaid SVG DOM renderer；Native 使用离线 WebView entry、bridge、watchdog 和独立 HTML asset；加入源码安全策略、SVG 输出校验、主题、动态高度、过期请求防护、源码查看/复制和展开预览；依赖锁定为 Mermaid `11.16.0`。
- 实际文档改动：补齐方案、执行和验证证据；将大型 WebView HTML 必须保持独立 Metro asset 的规则同步到 `docs/development.md#generated-app-webview-assets`。
- 偏差与用户决策：用户明确问题在 Paseo 项目内而非 Codex 客户端，方案据此改为项目内 Web/Native 分层。最初把约 3.46 MB HTML 生成为 TypeScript 字符串，Android Hermes bytecode 阶段出现 `LLVM ERROR: out of memory`；实现改为 `.html` asset，并只允许 WebView 加载 `Asset.downloadAsync()` 得到的 `localUri`。用户随后要求停止继续运行 Hermes 等高资源验证；已取得的通过证据保留，不再重复。
- Change Log：`2026-07-31 16:06` 完成方案调研并将任务状态从规划中更新为待批准；`2026-07-31 16:51` 根据参考截图补充展开/复制操作与 `<br/>` 兼容验收；`2026-07-31 17:13` 用户确认三个 TDD seam 并批准执行；`2026-07-31 22:42` 完成实现、自动验证、临时 export 清理与反向同步；`2026-07-31 22:54` 目标 lint 发现并移除禁用的 `useUnistyles`，单个浏览器 smoke 暴露 theme 对象引用导致的重复渲染，按主题标量稳定化；修正后 typecheck/lint 通过，浏览器复验因 Vite optimize reload 未执行到断言，按用户资源限制停止重试；`2026-07-31 22:58` 将 React 稳定化 hook 移出 WebView entry 依赖图，重新生成后 HTML 恢复原体积与哈希，最终 App typecheck 和 20 文件目标 lint 通过；`2026-07-31 23:39` 用户确认 Mermaid 正常显示、源码查看与展开预览均正常，批准回写人工验收并仅提交 0027；长流程图的缩放与拖动作为独立 0030，不扩大本任务范围。

## 6. 验证与完成判断

| 验收项                 | 命令或步骤                                                                                               | 结果    | 证据                                                                                                 |
| ---------------------- | -------------------------------------------------------------------------------------------------------- | ------- | ---------------------------------------------------------------------------------------------------- |
| Markdown renderer seam | `npx vitest run --project browser src/components/markdown/renderer.browser.test.tsx --bail=1`            | PASS    | 主题接入调整前 10/10；闭合/未闭合 fence、可选 SVG 文本、`<br/>` 多行、源码/复制/展开和错误回退       |
| Mermaid source policy  | `npx vitest run src/components/mermaid/mermaid-source.test.ts --bail=1`                                  | PASS    | 4/4；超长、空白、directive 和外部 URI 拒绝                                                           |
| SVG 输出策略           | `npx vitest run --project browser src/components/mermaid/mermaid-svg.browser.test.ts --bail=1`           | PASS    | 5/5；外部引用、可执行/嵌入节点、事件属性和危险 CSS 拒绝                                              |
| Native bridge seam     | `npx vitest run src/components/mermaid/mermaid-webview-bridge.test.ts --bail=1`                          | PASS    | 5/5；ready/rendered/height/error、过期 request 和高度上限                                            |
| WebView entry seam     | `npx vitest run --project browser src/mermaid/webview/mermaid-webview-entry.browser.test.ts --bail=1`    | PASS    | 1/1；真实 Chromium 中 SVG 文本可选择，active request 高度正确                                        |
| HTML asset 生成        | 连续两次 `npm run build:mermaid-webview`                                                                 | PASS    | `3,458,538 bytes`；SHA-256 均为 `99D7E1084AF286759894F55CDFA93958AB5448F902C1504A8320978B2CCB5BF2`   |
| Android 正常 export    | `npx expo export --platform android --output-dir .mermaid-smoke-android --dump-assetmap --max-workers 4` | PASS    | 4,960 modules；25 MB `.hbc`；Mermaid HTML 作为独立 3.46 MB asset                                     |
| iOS 正常 export        | `npx expo export --platform ios --output-dir .mermaid-smoke-ios --dump-assetmap --max-workers 4`         | PASS    | 4,965 modules；25 MB `.hbc`；Mermaid HTML 作为独立 3.46 MB asset                                     |
| App 类型检查           | `npm run typecheck`（`packages/app`）                                                                    | PASS    | asset 迁移与 lint 修正后退出码 0                                                                     |
| 目标 lint              | 根脚本 `npm run lint -- <20 个受影响文件>`                                                               | PASS    | 0 warnings / 0 errors                                                                                |
| 主题稳定化复验         | 单测筛选 `renders a closed Mermaid fence as selectable SVG text`                                         | BLOCKED | 修正前复现引用循环；修正后两次均被 Vite optimize reload/动态模块 URL 失效中断，未执行到 Mermaid 断言 |
| 用户人工验收           | 在项目实际会话中检查 Mermaid 图形、源码查看与展开预览                                                    | PASS    | 用户确认三项行为均正常                                                                               |

- 未继续运行：根目录全 workspace typecheck、重复 Hermes/export、浏览器复验第三次重试和额外 Playwright/Electron smoke；用户因系统资源风险明确要求停止这些验证，提交前不重复运行。
- 剩余风险：用户未逐项报告 iOS/Android 真机文字长按选择、多个同时可见图的内存表现及所有 Mermaid diagram type；长流程图缺少缩放和拖动属于已拆出的 0030 增强，不阻塞 0027 的基础渲染验收。
- Done Contract 是否满足：`满足。目标测试、Android/iOS export、最终静态检查与用户对实际显示、源码查看、展开预览的人工验收共同证明核心行为可交付；资源受限而未重复的验证及长图交互增强已明确记录。`

## 7. 恢复与同步

- 状态说明：`已收口 / Review`。
- 当前恢复锚点：0027 的实现、目标测试、最终 App typecheck/目标 lint、Android/iOS Hermes export 与用户人工验收均已记录；最终主题稳定化的浏览器自动复验仍受 Vite optimize reload 阻塞，不重复高资源构建。
- 下一步唯一动作：无；长流程图缩放和拖动由独立任务 0030 规划与实施。
- Resume / Handoff：保留用户工作区既有改动；临时 `.mermaid-smoke-android` 与 `.mermaid-smoke-ios` 已清理，可按验证表命令重建，但仅在用户再次授权高资源验证后运行。
- Project Sync Candidates：大型离线 WebView HTML 必须作为独立 Metro asset，避免进入 Hermes 主 bundle；该事实已由 OOM 与 Android/iOS 正常 export 双向验证。
- 长期文档同步：已同步 `docs/development.md#generated-app-webview-assets`。

### 提交记录

| 提交信息（Commit Message）                            | 提交脚注（Commit Footer） | 关联改动或阶段            | 文档同步状态 | 备注                |
| ----------------------------------------------------- | ------------------------- | ------------------------- | ------------ | ------------------- |
| `feat(app): render Mermaid diagrams across platforms` | `N/A`                     | `0027 / Execute + Review` | `已同步`     | 用户授权仅提交 0027 |
