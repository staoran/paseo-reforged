# Mermaid 展开视图缩放与拖动 Micro Spec

## 0. 状态与索引

| 字段               | 值                                                     |
| ------------------ | ------------------------------------------------------ |
| task_id            | `0030`                                                 |
| spec layer         | `Feature Spec`                                         |
| task status        | `已收口`                                               |
| document status    | `Completed`                                            |
| depth              | `standard`                                             |
| phase              | `Review`                                               |
| Execution Approval | `Approved`                                             |
| Approval Source    | `User`                                                 |
| file path          | `mydocs/micro_specs/0030_Mermaid展开视图缩放与拖动.md` |
| parent spec        | `N/A`                                                  |
| superseded by      | `N/A`                                                  |
| created / updated  | `2026-08-01 20:06`                                     |

## 1. 目标与完成契约

- 当前理解：0027 已让 Mermaid 在会话内正常显示，并支持源码查看与展开预览；长流程图在展开后仍按容器整体缩小，缺少检查细节所需的缩放和拖动。
- 核心目标：仅增强 Mermaid 展开视图，提供跨 Web、Electron、iOS 和 Android 的响应式预览空间、缩放、适应窗口、重置与拖动平移，同时保留 SVG 文字选择/复制能力；会话内图表继续使用 0027 的自适应展示。
- Done Contract：展开弹窗的宽高按宿主窗口比例变化，不受固定像素最大宽度截断；展开视图打开时先适应窗口；用户可通过按钮放大、缩小、适应窗口和重置，可在拖动模式中用鼠标/单指平移，并在桌面滚轮/触控板或移动端双指手势中缩放；切换到选择模式后可选择和复制 SVG 文字且不会触发平移；关闭重开、源码或主题变化、容器 resize 后状态可预测；Web/Electron 与 Native WebView 使用同一 DOM pan/zoom 核心，过期 Native 命令被忽略；任何失败都不影响关闭预览或回到源码。

## 2. 范围与事实

- 范围内：Mermaid 展开 modal 的响应式尺寸与工具栏、SVG viewport、DOM pan/zoom 控制器、Native WebView 命令桥接、手势冲突处理、相应 i18n/测试和 WebView asset 重建。
- 范围外：会话内 Mermaid 卡片的缩放工具栏、非 Mermaid 图片/代码预览、下载 SVG、编辑 Mermaid 源码、daemon/协议、远程渲染，以及 0027 基础渲染逻辑的重做。
- 当前任务单元：一个独立的展开预览交互增强，不拆父子 Spec。
- 轻量评估：`standard`；边界清楚，但同时覆盖浏览器 DOM、移动 WebView、触摸手势和文字选择冲突，不能按纯 UI 按钮的 fast 任务处理。
- 已确认事实：
  - `mermaid-diagram.tsx` 的展开 modal 当前只有关闭按钮；展开与会话内视图都复用同一个 `MermaidSurface`。
  - Web surface 把 SVG 设置为 `maxWidth: 100%`，Native WebView entry 同样设置 `max-width: 100%`，这是长图始终整体缩小的直接行为来源；两端均没有 viewport transform。
  - Native surface 已有 request id、注入消息、watchdog 与过期消息防护，可在不新增 daemon 协议的情况下扩展当前本地 bridge。
  - Context7 `/timmywil/panzoom` 对应官方 `@panzoom/panzoom`：可初始化在 `SVGElement`，提供 `zoomWithWheel`、`setOptions`、`disablePan`/`disableZoom`、`reset`、`bind` 和 `destroy`；适合打包进 Web 与离线 WebView。实际依赖版本在执行时由 npm 解析并锁入 lockfile，不在规划阶段猜测版本。
- 推荐决策：引入 `@panzoom/panzoom` 作为直接依赖，在纯 DOM 模块中封装尺寸计算、命令、模式和清理；Web surface 与 Mermaid WebView entry 均调用该模块，不手写触摸矩阵，也不使用只能控制 React Native 外层而无法控制 WebView 内 SVG 的原生手势库。
- 风险与未知：iOS/Android WebView 的一指拖动、双指缩放和系统文字选择可能竞争；交互模式下必须移除 SVG 的 `max-width: 100%` 并按 viewBox/实际尺寸计算 fit scale；嵌套滚动与 wheel 不能把图拖到完全不可恢复；新增依赖会进入独立 Mermaid HTML asset，但不得重新放回 Hermes 主 bundle。

## 3. 涉及文件与计划

| 文件                                                                               | 计划变化                                                             | 事实源                          |
| ---------------------------------------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------- |
| `packages/app/package.json`、`package-lock.json`                                   | 增加并锁定 `@panzoom/panzoom`                                        | npm workspace 与官方 Panzoom 包 |
| `packages/app/src/components/mermaid/mermaid-diagram.tsx`                          | 仅在展开 toolbar 增加缩放、fit、reset、拖动/选择模式控件             | 当前展开 modal                  |
| `packages/app/src/components/mermaid/mermaid-surface-types.ts`                     | 增加最小的展开 viewport 模式与命令合同                               | Web/Native 同名 surface         |
| `packages/app/src/components/mermaid/mermaid-surface.tsx`                          | 在展开模式接入共享 DOM controller，inline 行为不变                   | 当前 SVG DOM renderer           |
| `packages/app/src/components/mermaid/mermaid-surface.native.tsx`                   | 将模式和命令带 request id 注入 WebView；展开时使用稳定 viewport 高度 | 当前本地 WebView bridge         |
| `packages/app/src/mermaid/panzoom/mermaid-pan-zoom.ts`                             | 新增共享 DOM pan/zoom 控制器、fit 计算、模式切换与 cleanup           | 官方 Panzoom API                |
| `packages/app/src/mermaid/webview/mermaid-webview-entry.ts`                        | 展开模式初始化同一 controller，处理命令与 resize                     | 当前离线 WebView entry          |
| `packages/app/src/components/mermaid/mermaid-webview-bridge.ts`                    | 校验 viewport 命令/状态，忽略过期 request                            | 0027 bridge 合同                |
| `packages/app/src/components/mermaid/*test*`、`packages/app/src/mermaid/**/*test*` | 覆盖三个稳定 seam 与交互回归                                         | 项目 Vitest browser/unit 入口   |
| `packages/app/src/i18n/resources/*.ts`、测试 stubs                                 | 增加工具栏可访问标签和所需图标 stub                                  | 现有 message actions            |
| `packages/app/src/mermaid/webview/mermaid-webview.html`                            | 由现有脚本重建，不直接手改                                           | `build:mermaid-webview`         |

1. 先以 RED 测试固定展开 toolbar -> viewport command、DOM controller 和 Native bridge 三个 seam，并证明 inline Mermaid 没有新增交互层。
2. 引入 Panzoom 并实现共享 controller：以 SVG 固有 viewBox/尺寸为 100%，初始 fit 不强制放大；提供有界的 zoom in/out、fit、100% reset、居中和 resize 重新 fit。
3. Web/Electron 直接控制已校验 SVG；Native 通过现有本地 bridge 将同样的命令送入 WebView，所有命令绑定当前 request id。
4. 展开默认进入拖动模式；拖动模式启用鼠标/单指平移、桌面 focal wheel/trackpad 与移动双指缩放。选择模式禁用会 `preventDefault` 的 pan/zoom 手势，但保留工具栏缩放，恢复 `user-select: text`。
5. 在既有 `ExpandedDiagram` 浏览器组件 seam 中，以两个父窗口宽度固定“弹窗按比例增长且不存在固定像素上限”的回归行为，再移除固定尺寸约束；这不是新的 TDD seam。
6. 重建独立 HTML asset，运行受影响的最窄 unit/browser 测试、App typecheck、目标 lint 和人工 Web/Native smoke；不运行 Hermes、Expo export、全量测试或重型 Playwright，除非用户另行授权。

## 4. 执行前检查点

- 当前目标：让长 Mermaid 图在展开预览中可读、可定位、可恢复，同时不牺牲 0027 已验收的文字选择与源码回退。
- 当前进度：展开弹窗固定 `1400px` 最大宽度已通过同一浏览器 seam 的 RED -> GREEN 修复；针对用户“inline 可选、expanded 不可选”的反馈，原始 Playwright 鼠标对照证明 inline 可拖选、pan 模式不产生 Selection、select 模式可拖选，实际 `ExpandedDiagram` 点击“选择文字”后也能对 Mermaid 可见标签产生受信任 Selection。尚需用户确认反馈发生在默认 pan 模式还是已切 select 模式。
- 当前动作是否仍服务核心目标：是；0030 不修改会话内图表，也不扩大到其它媒体预览。
- 下一步：用户确认当时是否已点击工具栏的鼠标箭头“选择文字”；若仍在默认 pan 模式，则当前行为符合批准契约；若已切 select 仍失败，再按 Electron 实体层差异继续复现。随后复验响应式弹窗和至少一个 iOS/Android WebView 手势。
- 风险与回退：若 Panzoom 在目标 WebView 的选择模式或 pinch 行为不稳定，先保留按钮缩放与拖动模式并回写偏差，不手写一套触摸引擎；任何回归可通过不向 inline surface 传入展开 viewport 配置来隔离。
- 验证方式：三个目标 Vitest seam、`build:mermaid-webview` 的确定性 hash/体积检查、App typecheck、目标 lint、Web/Electron 鼠标与滚轮 smoke，以及至少一个 Native WebView 的拖动/双指/文字选择 smoke；遵守用户的高资源验证限制。
- TDD 判定、测试 seam 与验收行为：`TDD`；
  - `Expanded toolbar -> viewport command`：按钮与拖动/选择模式只作用于展开 surface，关闭重开回到初始 fit + 拖动模式，inline surface 不变。
    - 同一 `ExpandedDiagram` 浏览器组件 seam 补充响应式弹窗断言：改变父窗口宽度时弹窗按相同比例增长，不在固定像素宽度停止；不新增 seam。
  - `DOM Mermaid pan/zoom controller`：用真实 SVG/viewBox 和 viewport 尺寸验证 fit、100% reset、有界缩放、平移、resize、mode 与 destroy；选择模式允许 Selection API 选中文字。
    - 同一 seam 补充受信任指针拖选：pan 模式不产生文字 Selection，切换 select 模式后从一个 SVG `<text>` 拖到另一个 `<text>` 必须产生非空 Selection；不新增 seam。
  - `Native WebView viewport bridge`：合法当前 request 的 mode/zoom/fit/reset 命令生效，过期或畸形命令被忽略，rendered/height/error 原合同不回归。
- seam 确认：`User`；用户于 `2026-08-01 00:59` 明确确认上述三个 seam。
- Execution Approval / Source：`Approved / User`；用户于 `2026-08-01 00:59` 明确批准执行 0030。

## 5. 执行与变更记录

- 实际改动：锁定 `@panzoom/panzoom@4.6.2`；在展开 modal 增加 zoom out/in、fit、100% reset、拖动和选择模式；新增共享 DOM controller，并分别接入 Web surface 与 Native 离线 WebView；扩展 request-bound viewport bridge、8 种语言、测试 stubs 和生成 asset。inline Mermaid 保持 0027 行为。`2026-08-01 17:04` 用户验收反馈展开弹窗存在固定最大尺寸；根因是既有 `modalContent.maxWidth: 1400` 在宽窗口下截断弹窗，现已删除该固定上限并保留 `width: "100%"` 与外层 padding，使其跟随宿主窗口可用宽度。`2026-08-01 17:56` 的文字选择反馈未触发产品行为修改；只将原 Selection API 证据增强为 controller 与实际展开组件的受信任浏览器选择回归。
- 交互边界：初始 fit 不强制放大，缩放范围为 `0.125x–4x`；至少保留 40px 可恢复边缘；选择模式解除 Panzoom 指针绑定并恢复 `user-select: text`；关闭重开恢复 fit + pan。
- 偏差与用户决策：用户决定先独立提交 0027，再把长图缩放/拖动作为 0030，不在 0027 内追加范围。真实 Web smoke 发现根 `<svg>` 被 Panzoom 按 HTML 的 `50% 50%` 原点处理，原实现的左上角坐标导致 fit 越界和 focal 漂移；通过 RED 几何断言统一中心原点换算，并用单次 `reset()` 消除 zoom/pan 两帧竞态。
- 临时验证夹具：仅在隔离 `6768` daemon 中使用 development-only mock provider 生成 Mermaid 会话；临时源码和 seed 脚本已撤销，worker 已重启到干净源码，`packages/server` 无相关 diff。
- 文字选择诊断夹具：临时 `.dev/0030-selection-smoke.mjs` 直接打包当前 controller 并使用 Playwright `page.mouse` 做 inline/pan/select 三态拖选；结果取得后已删除，不进入任务产物。
- Change Log：`2026-08-01 00:18` 完成现状核对、官方 Panzoom 能力确认、范围与三个 TDD seam 设计，任务进入待批准；`2026-08-01 00:59` 用户确认三个 TDD seam 并批准执行，任务进入 Execute；`2026-08-01 02:43` 完成实现、两项真实 Web 反馈修复、自动验证和 Reverse Sync，进入待手工验收；`2026-08-01 17:04` 收到弹窗固定最大尺寸的验收反馈，保持原授权与 seam，切回 Execute；`2026-08-01 17:18` 固定最大宽度回归完成 RED -> GREEN，typecheck、lint 和目标格式检查通过，返回待手工验收；`2026-08-01 17:56` 用户确认 inline 可选但 expanded 无法选择，现以同一 TDD seam 切回 Execute；`2026-08-01 18:14` 受信任拖选与展开组件选择回归通过，未复现 select 模式缺陷，返回待手工确认模式；`2026-08-01 18:22` 用户确认默认 pan 不选择文字、切换 select 后可选择的交互符合预期，并批准按已记录的 Native 真机剩余风险收口、准备提交；`2026-08-01 19:06` 创建 `feat(app): add Mermaid pan and zoom controls` commit；`2026-08-01 20:06` 用户授权 amend 当前 commit，完成最终状态与提交记录回写。

## 6. 验证与完成判断

| 验收项                  | 命令或步骤                                                                                                             | 结果    | 证据                                                                                                                                                                          |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 任务登记                | 核对总表编号、文件名、正文 `task_id` 与状态                                                                            | PASS    | `0030` 保持既有编号；总表基线和 `0031` 不变                                                                                                                                   |
| 方案事实                | Context7 查询 `/timmywil/panzoom` 官方文档                                                                             | PASS    | 根 `<svg>` 按 HTML 使用 `50% 50%` 原点；`origin`、wheel focal zoom、reset、bind 与 destroy 行为已核实                                                                         |
| 展开 toolbar seam       | `npm run test:browser --workspace=@getpaseo/app -- src/components/mermaid/mermaid-diagram.browser.test.tsx --bail=1`   | PASS    | `3/3`；仅 expanded surface 响应命令，响应式尺寸、按钮映射、关闭重开及 select 模式实际 Mermaid 受信任文字选择通过                                                              |
| 弹窗响应式尺寸          | 同一 `mermaid-diagram.browser.test.tsx` 浏览器 seam：父容器从 `1000px` 增至 `2000px`                                   | PASS    | 新断言在修复前稳定 RED：宽度恰好停在 `1400px`；移除固定上限后 GREEN，弹窗超过旧上限且宽度占比保持一致；目标文件现为 `3/3`                                                     |
| DOM controller seam     | `npm run test:browser --workspace=@getpaseo/app -- src/mermaid/panzoom/mermaid-pan-zoom.browser.test.ts --bail=1`      | PASS    | `4/4`；覆盖 fit、focal wheel、边界、resize、mode 与 cleanup；受信任双击证明 inline/select 可选而 pan 不选；临时原始 mouse drag 得到同样三态结果                               |
| Native bridge seam      | `npm run test --workspace=@getpaseo/app -- src/components/mermaid/mermaid-webview-bridge.test.ts --bail=1`             | PASS    | `6/6`；当前 request、过期/畸形命令和既有 rendered/height/error 合同通过                                                                                                       |
| WebView entry seam      | `npm run test:browser --workspace=@getpaseo/app -- src/mermaid/webview/mermaid-webview-entry.browser.test.ts --bail=1` | PASS    | `1/1`；viewport 初始化、命令去重、stale/畸形消息和选择模式通过                                                                                                                |
| 离线 asset 确定性       | 连续两次及收口时再次运行 `npm run build:mermaid-webview --workspace=@getpaseo/app`                                     | PASS    | 构建脚本均报告 `3,471,920`（实际是 `html.length` 字符单元），磁盘 UTF-8 为 `3,472,061` bytes；SHA-256 均为 `51bb7e08bb2c32221751c8b39130e2d3b20c8084762537e62de2f25a16ed2aa8` |
| 静态与格式检查          | `npm run typecheck`；`npm run lint`；受影响文件的 `format:check:files`                                                 | PASS    | 最终 typecheck 退出码 0；lint `0 warnings / 0 errors`；本轮源码、测试、micro-spec 与总表格式检查通过                                                                          |
| Web/Electron 核心 smoke | 隔离 `6768` 真实会话中执行 toolbar、wheel、drag、select mode、reset、关闭重开和截图                                    | PASS    | fit `0.41857x` 完整居中；wheel 到 `0.462591x` 且焦点漂移 `<0.01px`；拖动 `(-100,+40)`；select wheel 不变；reset/重开中心误差 `<0.1px`                                         |
| 实体弹窗响应式复验      | 在宽窄 Web/Electron 宿主窗口中比较展开弹窗尺寸                                                                         | PASS    | 组件级响应式 RED/GREEN 通过；用户在固定最大宽度修复后确认弹窗行为无问题并批准收口                                                                                             |
| Web 实体文字拖选        | select 模式下以浏览器控制层拖选 SVG 文字，并用 inline 作对照                                                           | PASS    | 自动证据：inline=`Selectable/Through here`、pan=`空`、select=`Selectable/Through here`；用户确认默认 pan 与切换 select 后可选择的模式契约符合预期                             |
| Native 真机 smoke       | iOS/Android WebView 单指拖动、双指缩放、选择模式和关闭回退                                                             | NOT RUN | 当前 Windows 环境无 iOS/Android 运行时或真机；用户批准在保留该剩余风险的前提下收口，不声明为 PASS                                                                             |
| 差异卫生                | 源码路径与完整生成物的 `git diff --check`                                                                              | PARTIAL | 源码路径通过；生成的 `mermaid-webview.html` 含 bundler 第三方代码的 5 处尾随空格，完整检查返回 1，不直接修改生成物                                                            |

- 未验证项与原因：iOS/Android WebView 的单指拖动、双指缩放和实体文字选择受当前 Windows 环境限制，未运行 Native 真机 smoke。
- 剩余风险：Native WebView 手势与系统文字选择仍可能存在平台竞争，用户已明确接受该未实测风险；生成 bundle 的 bundler 第三方代码含 5 处尾随空格，会让包含该生成物的 `git diff --check` 返回 1。
- Done Contract 是否由证据满足：`按用户验收与风险接受决定收口；实现、四组目标测试、全仓静态检查、桌面核心交互、响应式弹窗和 pan/select 模式均有自动证据或用户验收。Native 真机手势未运行，不声明为 PASS，作为已接受的剩余风险。`

## 7. 恢复与同步

- 状态说明：`已收口 / Completed / Review`。
- 当前卡点：`无任务内卡点；Native 真机 smoke 未运行且风险已由用户接受。`
- 下一步唯一动作：`N/A；0030 已完成实现、验收、提交与记录回写。`
- Resume / Handoff：无需恢复；自动测试、typecheck、lint、确定性 asset、桌面核心 smoke、用户验收和 pre-commit hook 已通过。0030 commit 只包含本任务精确范围，未纳入 0026/0028/0029/0031 或旧任务的脏工作区改动。
- Project Sync Candidates：`无；Panzoom 选择与交互参数当前仅属于 0030。`
- 长期文档同步：`N/A`；若实施形成新的通用 WebView 手势/asset 规则，再在 Review 阶段评估 `docs/development.md`。

### 提交记录

| 提交信息（Commit Message）                     | 提交脚注（Commit Footer） | 关联改动或阶段  | 文档同步状态 | 备注                      |
| ---------------------------------------------- | ------------------------- | --------------- | ------------ | ------------------------- |
| `feat(app): add Mermaid pan and zoom controls` | `N/A`                     | `0030 / Review` | `已同步`     | 用户授权 amend 后完成收口 |
